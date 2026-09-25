import { getSession } from '../lib/session.js';
import { useState, useRef, useEffect } from 'react';
import { apiFetch } from '../lib/api.js';
import {
  LOCATION_LABELS, DELIVERY_LABELS, SHIPPING_COST, PAYMENT_METHODS, CONDITION_LABELS, formatMoney,
  deliveryAllowed, defaultDeliveryFor, locationsFor, defaultLocationFor, hasDiscontinuoStock,
} from '../lib/feriaLabels.js';
import { AppHeader, Chip, Notice, EmptyState, ProductPhoto, ConditionChip } from '../components/ui.jsx';
import styles from './VendedorPanel.module.css';

const SEARCH_MIN_CHARS = 6;
const EMPTY_CUSTOMER = { name: '', docNumber: '', phone: '', email: '' };
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMPTY_SHIPPING = { street: '', number: '', floor: '', city: '', zip: '', phone: '', notes: '' };
const REQUIRED_SHIPPING = ['street', 'number', 'city', 'zip', 'phone'];
// Lo que el vendedor va cargando de cada carrito (cliente, pago, envío) vive
// en la tablet hasta mandarlo a caja; los productos y el stock, en el servidor.
const EMPTY_DRAFT = { customer: EMPTY_CUSTOMER, paymentMethod: '', shipping: EMPTY_SHIPPING, lookup: { kind: '', text: '' } };
// Carrito todavía sin crear: se crea (y toma número) con el primer producto.
const NEW_CART = 'nuevo';

// Devuelve null mientras no haya medio de pago elegido — el descuento depende
// del medio de pago, así que antes de elegirlo no hay precio final que mostrar.
function finalUnitPrice(listPrice, paymentMethod) {
  const method = PAYMENT_METHODS.find(m => m.value === paymentMethod);
  if (!method) return null;
  return Math.round(listPrice * (1 - method.discountPct / 100));
}

export default function VendedorPanel() {
  const seller = getSession('vendedor')?.profile ?? {};
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [carts, setCarts] = useState([]);
  const [activeId, setActiveId] = useState(NEW_CART);
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState({ kind: '', text: '' });
  const searchTimeout = useRef(null);
  const lookupTimeout = useRef(null);

  // Al entrar (o recargar la tablet) se recuperan los carritos abiertos.
  useEffect(() => {
    apiFetch('/api/feria/carts')
      .then(({ carts: open }) => {
        setCarts(open);
        if (open.length) setActiveId(open[open.length - 1].id);
      })
      .catch(err => setNotice({ kind: 'error', text: `No se pudieron cargar tus carritos: ${err.message}` }));
  }, []);

  const cart = carts.find(c => c.id === activeId) ?? null;
  const lines = cart?.lines ?? [];
  const draft = drafts[activeId] ?? EMPTY_DRAFT;
  const { customer, paymentMethod, shipping, lookup } = draft;

  function patchDraft(key, changes) {
    setDrafts(prev => {
      const current = prev[key] ?? EMPTY_DRAFT;
      return { ...prev, [key]: { ...current, ...(typeof changes === 'function' ? changes(current) : changes) } };
    });
  }
  const setCustomer = (value) => patchDraft(activeId, { customer: value });

  function replaceCart(updated) {
    setCarts(prev => prev.map(c => (c.id === updated.id ? updated : c)));
  }

  function dropCart(id) {
    setCarts(prev => prev.filter(c => c.id !== id));
    setDrafts(prev => {
      const { [id]: _dropped, ...rest } = prev;
      return rest;
    });
    setActiveId(NEW_CART);
  }

  // Cada cambio del carrito va al servidor, que reserva o devuelve el stock
  // en el momento: si otro vendedor se llevó la última unidad, se entera acá.
  async function run(action) {
    setBusy(true);
    setNotice({ kind: '', text: '' });
    try {
      await action();
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  function handleQueryChange(value) {
    setQuery(value);
    clearTimeout(searchTimeout.current);
    if (value.trim().length < SEARCH_MIN_CHARS) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimeout.current = setTimeout(async () => {
      try {
        const { products } = await apiFetch(`/api/feria/products/search?q=${encodeURIComponent(value)}`);
        setResults(products);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }

  function handleDocNumberChange(value) {
    const key = activeId;
    patchDraft(key, d => ({ customer: { ...d.customer, docNumber: value }, lookup: { kind: '', text: '' } }));
    clearTimeout(lookupTimeout.current);
    if (value.trim().length < 6) return;
    lookupTimeout.current = setTimeout(async () => {
      patchDraft(key, { lookup: { kind: 'info', text: 'Buscando en Odoo…' } });
      try {
        const { found, partner } = await apiFetch(`/api/feria/customers/lookup?docNumber=${encodeURIComponent(value)}`);
        if (found) {
          patchDraft(key, d => ({
            customer: {
              name: partner.name, docNumber: partner.vat || value,
              phone: partner.phone || d.customer.phone, email: partner.email || d.customer.email,
            },
            lookup: partner.email
              ? { kind: 'success', text: 'Cliente encontrado en Odoo. Confirmá con el cliente que el email sea ese: ahí le llega la factura.' }
              : { kind: 'info', text: 'Cliente encontrado en Odoo, pero no tiene email. Pedíselo: ahí le llega la factura.' },
          }));
        } else {
          patchDraft(key, { lookup: { kind: 'info', text: 'Cliente nuevo: se crea en Odoo al confirmar la venta.' } });
        }
      } catch {
        patchDraft(key, { lookup: { kind: 'info', text: 'No se pudo consultar Odoo. Cargá el nombre a mano.' } });
      }
    }, 400);
  }

  function addLine(product, condition) {
    const location = defaultLocationFor(condition, product.stock);
    const body = JSON.stringify({ sku: product.sku, condition, qty: 1, location, delivery: defaultDeliveryFor(location) });
    run(async () => {
      if (cart) {
        const { cart: updated } = await apiFetch(`/api/feria/carts/${cart.id}/lines`, { method: 'POST', body });
        replaceCart(updated);
      } else {
        const { cart: created } = await apiFetch('/api/feria/carts', { method: 'POST', body });
        setCarts(prev => [...prev, created]);
        // Lo que ya se había cargado del cliente pasa al carrito recién creado.
        setDrafts(prev => {
          const { [NEW_CART]: pending, ...rest } = prev;
          return pending ? { ...rest, [created.id]: pending } : rest;
        });
        setActiveId(created.id);
      }
      setQuery('');
      setResults([]);
    });
  }

  function updateLine(line, changes) {
    const next = { ...line, ...changes };
    // Si la entrega no corresponde a la ubicación nueva (se lleva ahora solo
    // de Exhibición o Fallados, retira en Rolón solo de Rolón), pasa a la habitual.
    if (!deliveryAllowed(next.delivery, next.location)) changes = { ...changes, delivery: defaultDeliveryFor(next.location) };
    run(async () => {
      const { cart: updated } = await apiFetch(`/api/feria/carts/${cart.id}/lines/${line.lineId}`, {
        method: 'PATCH', body: JSON.stringify(changes),
      });
      replaceCart(updated);
    });
  }

  function removeLine(line) {
    run(async () => {
      const { cart: updated } = await apiFetch(`/api/feria/carts/${cart.id}/lines/${line.lineId}`, { method: 'DELETE' });
      replaceCart(updated);
    });
  }

  function discardCart() {
    if (!window.confirm(`¿Vaciar el carrito ${cart.number}? Se devuelve todo el stock reservado y el número queda sin usar.`)) return;
    run(async () => {
      await apiFetch(`/api/feria/carts/${cart.id}`, { method: 'DELETE' });
      dropCart(cart.id);
      setNotice({ kind: 'success', text: `Carrito ${cart.number} vaciado: el stock quedó libre. Si le pusiste la etiqueta a algún mueble, sacala.` });
    });
  }

  const needsShipping = lines.some(l => l.delivery === 'envio');
  const shippingCost = needsShipping ? SHIPPING_COST : 0;
  const listTotal = lines.reduce((sum, l) => sum + l.qty * l.listPrice, 0);
  const selectedMethod = PAYMENT_METHODS.find(m => m.value === paymentMethod);
  const itemsTotal = selectedMethod
    ? lines.reduce((sum, l) => sum + l.qty * finalUnitPrice(l.listPrice, paymentMethod), 0)
    : null;
  // El teléfono de envío arranca con el del cliente; se cambia solo si es otro.
  const effectiveShipping = { ...shipping, phone: shipping.phone || customer.phone };
  const phoneDigits = customer.phone.replace(/\D/g, '').length;
  const emailOk = EMAIL_PATTERN.test(customer.email.trim());
  const shippingOk = !needsShipping || REQUIRED_SHIPPING.every(f => effectiveShipping[f].trim());

  const missing = [];
  if (!lines.length) missing.push('productos');
  if (!customer.docNumber.trim() || !customer.name.trim()) missing.push('cliente');
  if (phoneDigits < 8) missing.push('teléfono del cliente');
  if (!emailOk) missing.push('email del cliente');
  if (!paymentMethod) missing.push('medio de pago');
  if (!shippingOk) missing.push('datos de envío');
  const canSubmit = !!cart && missing.length === 0 && !busy;
  const submitLabel = busy ? 'Un momento…' : cart ? `Enviar ${cart.number} a caja` : 'Enviar pedido a caja';

  function handleSubmit() {
    if (!canSubmit) return;
    // El servidor fija el precio con la rebaja vigente y el medio de pago; el
    // stock ya está reservado desde que se agregó cada producto.
    run(async () => {
      const { order } = await apiFetch(`/api/feria/carts/${cart.id}/submit`, {
        method: 'POST',
        body: JSON.stringify({ customer, paymentMethod, ...(needsShipping ? { shipping: effectiveShipping } : {}) }),
      });
      dropCart(cart.id);
      setNotice({ kind: 'success', text: `Pedido ${order.number} de ${order.customer.name} enviado a caja. Decile al cliente que pase con ese número.` });
    });
  }

  return (
    <div className={styles.page}>
      <AppHeader panel="vendedor" userName={seller.name} />

      <div className={styles.layout}>
        <main className={styles.main}>
          {(carts.length > 0 || cart) && (
            <nav className={styles.cartTabs} aria-label="Carritos abiertos">
              {carts.map(c => {
                const name = drafts[c.id]?.customer.name.trim();
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`${styles.cartTab} ${c.id === activeId ? styles.cartTabActive : ''}`}
                    aria-current={c.id === activeId ? 'true' : undefined}
                    disabled={busy}
                    onClick={() => setActiveId(c.id)}
                  >
                    <span className={`num ${styles.cartTabNumber}`}>{c.number}</span>
                    <span className={styles.cartTabMeta}>
                      {name || `${c.lines.length} ${c.lines.length === 1 ? 'producto' : 'productos'}`}
                    </span>
                  </button>
                );
              })}
              <button
                type="button"
                className={`${styles.cartTab} ${styles.cartTabNew} ${activeId === NEW_CART ? styles.cartTabActive : ''}`}
                disabled={busy}
                onClick={() => setActiveId(NEW_CART)}
              >
                + Nuevo carrito
              </button>
            </nav>
          )}

          <section className={styles.searchBlock}>
            <label className={styles.searchLabel} htmlFor="search">Agregar producto</label>
            <input
              id="search"
              className={`input ${styles.searchInput}`}
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder="SKU o modelo, mínimo 6 caracteres"
              autoComplete="off"
            />
            {searching && <p className={styles.searchHint}>Buscando…</p>}
            {!searching && query.trim().length >= SEARCH_MIN_CHARS && results.length === 0 && (
              <p className={styles.searchHint}>No hay productos de la feria que coincidan con “{query}”.</p>
            )}
            {results.length > 0 && (
              <ul className={styles.results}>
                {results.map(p => {
                  const sinStock = !hasDiscontinuoStock(p.stock);
                  return (
                    <li key={p.sku} className={styles.result}>
                      <ProductPhoto sku={p.sku} alt={p.modelo} size={64} />
                      <div className={styles.resultInfo}>
                        <span className={styles.resultName}>{p.modelo}</span>
                        <span className={styles.resultMeta}>{p.sku}{p.color ? ` · ${p.color.trim()}` : ''}</span>
                        <div className={styles.stockRow}>
                          {p.stock ? (
                            <>
                              <span className={styles.stockLabel}>Stock discontinuo</span>
                              <Chip tone={p.stock.exhibicion > 0 ? 'done' : 'neutral'}>Exhibición {p.stock.exhibicion}</Chip>
                              <Chip tone={p.stock.rolon > 0 ? 'done' : 'neutral'}>Rolón {p.stock.rolon}</Chip>
                            </>
                          ) : (
                            <Chip tone="removed">Stock no disponible: Odoo no responde</Chip>
                          )}
                        </div>
                      </div>
                      <div className={styles.conditionButtons}>
                        {['falla', 'discontinuo'].map(condition => p.condiciones[condition].disponible && (
                          <button
                            key={condition}
                            type="button"
                            className={`${styles.conditionBtn} cond-${condition}`}
                            disabled={busy || (condition === 'discontinuo' && sinStock)}
                            onClick={() => addLine(p, condition)}
                          >
                            <span className={styles.conditionName}>{CONDITION_LABELS[condition]}</span>
                            <span className="num">{formatMoney(p.condiciones[condition].precioTabla)}</span>
                          </button>
                        ))}
                        {sinStock && p.stock && p.condiciones.discontinuo.disponible && <span className={styles.noStock}>Discontinuo sin stock</span>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section>
            <div className={styles.cartHead}>
              <h2 className={styles.sectionTitle}>
                {cart ? <>Pedido <span className={`num ${styles.cartNumber}`}>{cart.number}</span></> : 'Pedido nuevo'}
                <span className={styles.count}>{lines.length ? `${lines.length} ${lines.length === 1 ? 'producto' : 'productos'}` : ''}</span>
              </h2>
              {cart && (
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={discardCart}>
                  Vaciar carrito
                </button>
              )}
            </div>
            {cart && (
              <p className={styles.cartHint}>
                Anotá <strong className="num">{cart.number}</strong> en la etiqueta de vendido. Lo que está en el carrito ya quedó reservado.
              </p>
            )}
            {lines.length === 0 ? (
              <EmptyState title="Todavía no agregaste productos">
                {cart
                  ? 'Buscá por SKU o modelo y elegí la condición.'
                  : 'Buscá por SKU o modelo y elegí la condición. Con el primer producto el pedido toma su número y el stock queda reservado.'}
              </EmptyState>
            ) : (
              <ul className={styles.lines}>
                {lines.map(line => (
                  <li key={line.lineId} className={`${styles.line} cond-${line.condition}`}>
                    <div className={styles.lineHead}>
                      <ProductPhoto sku={line.sku} alt={line.modelo} size={56} />
                      <div>
                        <p className={styles.lineName}>{line.modelo}</p>
                        <p className={styles.lineMeta}><ConditionChip condition={line.condition} /> {line.sku}</p>
                      </div>
                      <div className={styles.linePrice}>
                        <span className="num">
                          {formatMoney(line.qty * (selectedMethod ? finalUnitPrice(line.listPrice, paymentMethod) : line.listPrice))}
                        </span>
                        {selectedMethod?.discountPct > 0 && (
                          <span className={`num ${styles.lineListPrice}`}>{formatMoney(line.qty * line.listPrice)}</span>
                        )}
                      </div>
                      <button type="button" className={styles.removeBtn} disabled={busy} onClick={() => removeLine(line)} aria-label={`Quitar ${line.modelo}`}>×</button>
                    </div>

                    <div className={styles.lineControls}>
                      <div className={styles.stepper} role="group" aria-label="Cantidad">
                        <button type="button" disabled={busy || line.qty <= 1} onClick={() => updateLine(line, { qty: line.qty - 1 })} aria-label="Una menos">−</button>
                        <span className="num">{line.qty}</span>
                        <button type="button" disabled={busy} onClick={() => updateLine(line, { qty: line.qty + 1 })} aria-label="Una más">+</button>
                      </div>

                      {line.condition === 'falla' ? (
                        <span className={styles.fixedLocation}>Sale de Fallados</span>
                      ) : (
                        <div className={styles.segmented} role="radiogroup" aria-label="Sale de">
                          {locationsFor(line.condition).map(value => (
                            <button
                              key={value}
                              type="button"
                              role="radio"
                              aria-checked={line.location === value}
                              className={line.location === value ? styles.segmentActive : ''}
                              disabled={busy}
                              onClick={() => line.location !== value && updateLine(line, { location: value })}
                            >
                              {LOCATION_LABELS[value]}
                            </button>
                          ))}
                        </div>
                      )}

                      <select
                        className={`select ${styles.deliverySelect}`}
                        value={line.delivery}
                        disabled={busy}
                        onChange={(e) => updateLine(line, { delivery: e.target.value })}
                        aria-label="Entrega"
                      >
                        {Object.entries(DELIVERY_LABELS).map(([value, label]) => (
                          <option key={value} value={value} disabled={!deliveryAllowed(value, line.location)}>{label}</option>
                        ))}
                      </select>
                    </div>

                    {line.delivery === 'envio' && (
                      <p className={styles.shippingNote}>
                        Va a domicilio: cargá la dirección en <a href="#envio" onClick={(e) => { e.preventDefault(); document.getElementById('envio')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>Datos de envío</a>.
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </main>

        <aside className={styles.summary}>
          <section className={styles.summaryBlock}>
            <h2 className={styles.summaryTitle}>Cliente</h2>
            <div className="field">
              <label className="field-label" htmlFor="doc">DNI o CUIT</label>
              <input id="doc" className="input" inputMode="numeric" value={customer.docNumber}
                onChange={(e) => handleDocNumberChange(e.target.value)} />
            </div>
            {lookup.text && <p className={`${styles.lookup} ${styles[`lookup-${lookup.kind}`]}`}>{lookup.text}</p>}
            <div className="field">
              <label className="field-label" htmlFor="name">Nombre y apellido</label>
              <input id="name" className="input" value={customer.name}
                onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="customer-phone">Teléfono</label>
              <input id="customer-phone" className="input" inputMode="tel" autoComplete="off" placeholder="11 5555-5555"
                value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} />
              {customer.phone.trim() && phoneDigits < 8 && <p className={styles.fieldError}>Tiene que tener al menos 8 números.</p>}
            </div>
            <div className="field">
              <label className="field-label" htmlFor="customer-email">Email (le llega la factura)</label>
              <input id="customer-email" className="input" type="email" inputMode="email" autoComplete="off" autoCapitalize="none"
                spellCheck={false} placeholder="cliente@mail.com"
                value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} />
              {customer.email.trim() && !emailOk && <p className={styles.fieldError}>Revisá el email: parece mal escrito.</p>}
            </div>
          </section>

          <section className={styles.summaryBlock}>
            <h2 className={styles.summaryTitle}>Medio de pago</h2>
            <div className={styles.payGrid} role="radiogroup" aria-label="Medio de pago">
              {PAYMENT_METHODS.map(m => {
                const total = lines.length
                  ? lines.reduce((s, l) => s + l.qty * finalUnitPrice(l.listPrice, m.value), 0) + shippingCost
                  : null;
                return (
                  <button
                    key={m.value}
                    type="button"
                    role="radio"
                    aria-checked={paymentMethod === m.value}
                    className={`${styles.payOption} ${styles[`pay-${m.tone}`]} ${paymentMethod === m.value ? styles.payActive : ''}`}
                    onClick={() => patchDraft(activeId, { paymentMethod: m.value })}
                  >
                    <span className={styles.payRadio} aria-hidden="true" />
                    <span className={styles.payName}>{m.label}</span>
                    {m.discountPct > 0 && <span className={styles.payOff}>−{m.discountPct}%</span>}
                    {total != null && <span className={`num ${styles.payTotal}`}>{formatMoney(total)}</span>}
                  </button>
                );
              })}
            </div>
          </section>

          {needsShipping && (
            <section id="envio" className={`${styles.summaryBlock} ${shippingOk ? '' : styles.summaryBlockTodo}`}>
              <h2 className={styles.summaryTitle}>
                Datos de envío <span className={styles.shippingCost}>+ {formatMoney(SHIPPING_COST)}</span>
              </h2>
              <p className={styles.shippingHelp}>Una línea va a domicilio: completá a dónde se manda.</p>
              <div className={styles.shippingGrid}>
                {[
                  ['street', 'Calle', true], ['number', 'Número'], ['floor', 'Piso / depto (opcional)'],
                  ['city', 'Localidad'], ['zip', 'Código postal'],
                ].map(([field, label, wide]) => (
                  <div key={field} className={`field ${wide ? styles.span2 : ''}`}>
                    <label className="field-label" htmlFor={field}>{label}</label>
                    <input id={field} className="input" value={shipping[field]}
                      onChange={(e) => patchDraft(activeId, { shipping: { ...shipping, [field]: e.target.value } })} />
                  </div>
                ))}
                <div className={`field ${styles.span2}`}>
                  <label className="field-label" htmlFor="phone">Teléfono</label>
                  <input id="phone" className="input" inputMode="tel" value={effectiveShipping.phone}
                    onChange={(e) => patchDraft(activeId, { shipping: { ...shipping, phone: e.target.value } })} />
                </div>
                <div className={`field ${styles.span2}`}>
                  <label className="field-label" htmlFor="notes">Observaciones u horario (opcional)</label>
                  <input id="notes" className="input" value={shipping.notes}
                    onChange={(e) => patchDraft(activeId, { shipping: { ...shipping, notes: e.target.value } })} />
                </div>
              </div>
            </section>
          )}

          <section className={styles.totals}>
            <dl className={styles.totalsList}>
              <div><dt>Precio de lista</dt><dd className="num">{formatMoney(listTotal)}</dd></div>
              {selectedMethod?.discountPct > 0 && (
                <div className={styles.discountRow}>
                  <dt>{selectedMethod.label} −{selectedMethod.discountPct}%</dt>
                  <dd className="num">− {formatMoney(listTotal - itemsTotal)}</dd>
                </div>
              )}
              {needsShipping && <div><dt>Envío</dt><dd className="num">{formatMoney(SHIPPING_COST)}</dd></div>}
            </dl>
            <div className={styles.grandTotal}>
              <span>Total</span>
              <span className="num">{itemsTotal != null ? formatMoney(itemsTotal + shippingCost) : '—'}</span>
            </div>
            {!selectedMethod && lines.length > 0 && <p className={styles.totalHint}>Elegí el medio de pago para ver el total.</p>}

            <div className={styles.desktopOnly}>
              <Notice kind={notice.kind || 'info'} onClose={notice.text ? () => setNotice({ kind: '', text: '' }) : undefined}>
                {notice.text}
              </Notice>
            </div>

            <button className={`btn btn-primary btn-lg btn-block ${styles.desktopSubmit}`} onClick={handleSubmit} disabled={!canSubmit}>
              {submitLabel}
            </button>
            {missing.length > 0 && lines.length > 0 && (
              <p className={styles.totalHint}>Falta: {missing.join(', ')}.</p>
            )}
          </section>
        </aside>
      </div>

      {/* Celular: el aviso y el botón de enviar quedan fijos abajo, al
          alcance del pulgar, estés donde estés de la página. */}
      <div className={styles.mobileBar}>
        <Notice kind={notice.kind || 'info'} onClose={notice.text ? () => setNotice({ kind: '', text: '' }) : undefined}>
          {notice.text}
        </Notice>
        {(cart || lines.length > 0) && (
          <div className={styles.mobileBarRow}>
            <div className={styles.mobileTotal}>
              <span className={styles.mobileTotalLabel}>
                {missing.length && lines.length ? `Falta: ${missing.join(', ')}` : selectedMethod ? `Total con ${selectedMethod.label}` : 'Total de lista'}
              </span>
              <span className="num">{formatMoney((itemsTotal ?? listTotal) + shippingCost)}</span>
            </div>
            <button className="btn btn-primary btn-lg" onClick={handleSubmit} disabled={!canSubmit}>
              {busy ? 'Un momento…' : 'Enviar a caja'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
