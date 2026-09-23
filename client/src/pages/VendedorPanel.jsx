import { useState, useRef } from 'react';
import { apiFetch } from '../lib/api.js';
import {
  LOCATION_LABELS, DELIVERY_LABELS, SHIPPING_COST, PAYMENT_METHODS, CONDITION_LABELS, formatMoney,
} from '../lib/feriaLabels.js';
import { AppHeader, Chip, Notice, EmptyState } from '../components/ui.jsx';
import styles from './VendedorPanel.module.css';

const SEARCH_MIN_CHARS = 6;
const EMPTY_SHIPPING = { street: '', number: '', floor: '', city: '', zip: '', phone: '', notes: '' };
const REQUIRED_SHIPPING = ['street', 'number', 'city', 'zip', 'phone'];

// Devuelve null mientras no haya medio de pago elegido — el descuento depende
// del medio de pago, así que antes de elegirlo no hay precio final que mostrar.
function finalUnitPrice(tablePrice, paymentMethod) {
  const method = PAYMENT_METHODS.find(m => m.value === paymentMethod);
  if (!method) return null;
  return Math.round(tablePrice * (1 - method.discountPct / 100));
}

// Dos líneas del mismo SKU en la misma ubicación compiten por el mismo stock:
// se suman antes de comparar contra el disponible. Devuelve, por índice de
// línea, el problema a mostrar en esa línea.
function stockProblemsByLine(lines) {
  const requested = new Map();
  for (const l of lines) {
    const key = `${l.sku}__${l.location}`;
    requested.set(key, (requested.get(key) || 0) + l.qty);
  }
  const problems = {};
  lines.forEach((l, i) => {
    const qty = requested.get(`${l.sku}__${l.location}`);
    const available = l.stock?.[l.location] ?? 0;
    if (qty > available) {
      problems[i] = `En ${LOCATION_LABELS[l.location]} hay ${available} y el pedido lleva ${qty}.`;
    }
  });
  return problems;
}

export default function VendedorPanel() {
  const seller = JSON.parse(localStorage.getItem('feria_seller') || '{}');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [lines, setLines] = useState([]);
  const [customer, setCustomer] = useState({ name: '', docNumber: '' });
  const [lookup, setLookup] = useState({ kind: '', text: '' });
  const [paymentMethod, setPaymentMethod] = useState('');
  const [shipping, setShipping] = useState(EMPTY_SHIPPING);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState({ kind: '', text: '' });
  const searchTimeout = useRef(null);
  const lookupTimeout = useRef(null);

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
    setCustomer(prev => ({ ...prev, docNumber: value }));
    clearTimeout(lookupTimeout.current);
    setLookup({ kind: '', text: '' });
    if (value.trim().length < 6) return;
    lookupTimeout.current = setTimeout(async () => {
      setLookup({ kind: 'info', text: 'Buscando en Odoo…' });
      try {
        const { found, partner } = await apiFetch(`/api/feria/customers/lookup?docNumber=${encodeURIComponent(value)}`);
        if (found) {
          setCustomer({ name: partner.name, docNumber: partner.vat || value });
          setLookup({ kind: 'success', text: 'Cliente encontrado en Odoo.' });
        } else {
          setLookup({ kind: 'info', text: 'Cliente nuevo: se crea en Odoo al confirmar la venta.' });
        }
      } catch {
        setLookup({ kind: 'info', text: 'No se pudo consultar Odoo. Cargá el nombre a mano.' });
      }
    }, 400);
  }

  function addLine(product, condition) {
    const info = product.condiciones[condition];
    const location = product.stock.exhibicion > 0 ? 'exhibicion' : 'rolon';
    setLines(prev => [...prev, {
      sku: product.sku, modelo: product.modelo, condition,
      qty: 1, tablePrice: info.precioTabla, stock: product.stock,
      location, delivery: location === 'exhibicion' ? 'ahora' : 'retira_rolon',
    }]);
    setQuery('');
    setResults([]);
  }

  function updateLine(index, changes) {
    setLines(prev => prev.map((l, i) => {
      if (i !== index) return l;
      const next = { ...l, ...changes };
      // "Se lleva ahora" solo sale de Exhibición.
      if (next.delivery === 'ahora' && next.location !== 'exhibicion') next.delivery = 'retira_rolon';
      return next;
    }));
  }

  function removeLine(index) {
    setLines(prev => prev.filter((_, i) => i !== index));
  }

  const needsShipping = lines.some(l => l.delivery === 'envio');
  const shippingCost = needsShipping ? SHIPPING_COST : 0;
  const listTotal = lines.reduce((sum, l) => sum + l.qty * l.tablePrice, 0);
  const selectedMethod = PAYMENT_METHODS.find(m => m.value === paymentMethod);
  const itemsTotal = selectedMethod
    ? lines.reduce((sum, l) => sum + l.qty * finalUnitPrice(l.tablePrice, paymentMethod), 0)
    : null;
  const problems = stockProblemsByLine(lines);
  const hasProblems = Object.keys(problems).length > 0;
  const shippingOk = !needsShipping || REQUIRED_SHIPPING.every(f => shipping[f].trim());

  const missing = [];
  if (!lines.length) missing.push('productos');
  if (!customer.docNumber.trim() || !customer.name.trim()) missing.push('cliente');
  if (!paymentMethod) missing.push('medio de pago');
  if (!shippingOk) missing.push('datos de envío');
  const canSubmit = missing.length === 0 && !hasProblems && !sending;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSending(true);
    setNotice({ kind: 'info', text: 'Confirmando precios y stock…' });
    try {
      // Precio y stock se vuelven a pedir recién al enviar: caja puede activar
      // una rebaja y otro vendedor puede reservar la última unidad mientras el
      // pedido está abierto en la tablet. El backend igual vuelve a verificar
      // el stock en una transacción al crear el pedido.
      const productCache = new Map();
      const freshLines = [];
      for (const line of lines) {
        if (!productCache.has(line.sku)) {
          const { products } = await apiFetch(`/api/feria/products/search?q=${encodeURIComponent(line.sku)}`);
          productCache.set(line.sku, products.find(p => p.sku === line.sku) || null);
        }
        const fresh = productCache.get(line.sku);
        const info = fresh?.condiciones?.[line.condition];
        if (!info || !info.disponible || info.precioTabla == null) {
          throw new Error(`No se pudo confirmar el precio actual de ${line.modelo}. Sacalo del pedido y volvé a agregarlo.`);
        }
        if (!fresh.stock) {
          throw new Error(`No se pudo verificar el stock de ${line.modelo} porque Odoo no responde. Probá de nuevo en unos segundos.`);
        }
        freshLines.push({
          sku: line.sku, modelo: line.modelo, condition: line.condition,
          qty: line.qty, unitPrice: finalUnitPrice(info.precioTabla, paymentMethod),
          // Precio de tabla sin el descuento del medio de pago: a Odoo viaja
          // este como precio unitario y el descuento va aparte.
          listPrice: info.precioTabla,
          location: line.location, delivery: line.delivery,
        });
      }

      await apiFetch('/api/feria/orders', {
        method: 'POST',
        body: JSON.stringify({ customer, paymentMethod, lines: freshLines, ...(needsShipping ? { shipping } : {}) }),
      });
      setNotice({ kind: 'success', text: `Pedido de ${customer.name} enviado a caja.` });
      setLines([]);
      setQuery('');
      setResults([]);
      setCustomer({ name: '', docNumber: '' });
      setPaymentMethod('');
      setShipping(EMPTY_SHIPPING);
      setLookup({ kind: '', text: '' });
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={styles.page}>
      <AppHeader panel="vendedor" userName={seller.name} />

      <div className={styles.layout}>
        <main className={styles.main}>
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
                  const sinStock = !p.stock || p.stock.exhibicion + p.stock.rolon === 0;
                  return (
                    <li key={p.sku} className={styles.result}>
                      <div className={styles.resultInfo}>
                        <span className={styles.resultName}>{p.modelo}</span>
                        <span className={styles.resultMeta}>{p.sku}{p.color ? ` · ${p.color.trim()}` : ''}</span>
                        <div className={styles.stockRow}>
                          {p.stock ? (
                            <>
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
                            className={styles.conditionBtn}
                            disabled={sinStock}
                            onClick={() => addLine(p, condition)}
                          >
                            <span className={styles.conditionName}>{CONDITION_LABELS[condition]}</span>
                            <span className="num">{formatMoney(p.condiciones[condition].precioTabla)}</span>
                          </button>
                        ))}
                        {sinStock && p.stock && <span className={styles.noStock}>Sin stock</span>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section>
            <h2 className={styles.sectionTitle}>
              Pedido <span className={styles.count}>{lines.length ? `${lines.length} ${lines.length === 1 ? 'producto' : 'productos'}` : ''}</span>
            </h2>
            {lines.length === 0 ? (
              <EmptyState title="Todavía no agregaste productos">Buscá por SKU o modelo y elegí la condición.</EmptyState>
            ) : (
              <ul className={styles.lines}>
                {lines.map((line, i) => (
                  <li key={i} className={`${styles.line} ${problems[i] ? styles.lineProblem : ''}`}>
                    <div className={styles.lineHead}>
                      <div>
                        <p className={styles.lineName}>{line.modelo}</p>
                        <p className={styles.lineMeta}>{line.sku} · {CONDITION_LABELS[line.condition]}</p>
                      </div>
                      <div className={styles.linePrice}>
                        <span className="num">
                          {formatMoney(line.qty * (selectedMethod ? finalUnitPrice(line.tablePrice, paymentMethod) : line.tablePrice))}
                        </span>
                        {selectedMethod?.discountPct > 0 && (
                          <span className={`num ${styles.lineListPrice}`}>{formatMoney(line.qty * line.tablePrice)}</span>
                        )}
                      </div>
                      <button type="button" className={styles.removeBtn} onClick={() => removeLine(i)} aria-label={`Quitar ${line.modelo}`}>×</button>
                    </div>

                    <div className={styles.lineControls}>
                      <div className={styles.stepper} role="group" aria-label="Cantidad">
                        <button type="button" onClick={() => updateLine(i, { qty: Math.max(1, line.qty - 1) })} aria-label="Una menos">−</button>
                        <span className="num">{line.qty}</span>
                        <button type="button" onClick={() => updateLine(i, { qty: line.qty + 1 })} aria-label="Una más">+</button>
                      </div>

                      <div className={styles.segmented} role="radiogroup" aria-label="Sale de">
                        {Object.entries(LOCATION_LABELS).map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            role="radio"
                            aria-checked={line.location === value}
                            className={line.location === value ? styles.segmentActive : ''}
                            onClick={() => updateLine(i, { location: value })}
                          >
                            {label} <span className={styles.segmentCount}>{line.stock?.[value] ?? 0}</span>
                          </button>
                        ))}
                      </div>

                      <select
                        className={`select ${styles.deliverySelect}`}
                        value={line.delivery}
                        onChange={(e) => updateLine(i, { delivery: e.target.value })}
                        aria-label="Entrega"
                      >
                        {Object.entries(DELIVERY_LABELS).map(([value, label]) => (
                          <option key={value} value={value} disabled={value === 'ahora' && line.location !== 'exhibicion'}>{label}</option>
                        ))}
                      </select>
                    </div>

                    {problems[i] && <p className={styles.problem}>Sin stock suficiente. {problems[i]}</p>}
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
          </section>

          <section className={styles.summaryBlock}>
            <h2 className={styles.summaryTitle}>Medio de pago</h2>
            <div className={styles.payGrid} role="radiogroup" aria-label="Medio de pago">
              {PAYMENT_METHODS.map(m => {
                const total = lines.length
                  ? lines.reduce((s, l) => s + l.qty * finalUnitPrice(l.tablePrice, m.value), 0) + shippingCost
                  : null;
                return (
                  <button
                    key={m.value}
                    type="button"
                    role="radio"
                    aria-checked={paymentMethod === m.value}
                    className={`${styles.payOption} ${styles[`pay-${m.tone}`]} ${paymentMethod === m.value ? styles.payActive : ''}`}
                    onClick={() => setPaymentMethod(m.value)}
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
            <section className={styles.summaryBlock}>
              <h2 className={styles.summaryTitle}>Envío a domicilio</h2>
              <div className={styles.shippingGrid}>
                <div className={`field ${styles.span2}`}>
                  <label className="field-label" htmlFor="street">Calle</label>
                  <input id="street" className="input" value={shipping.street} onChange={(e) => setShipping({ ...shipping, street: e.target.value })} />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="number">Número</label>
                  <input id="number" className="input" value={shipping.number} onChange={(e) => setShipping({ ...shipping, number: e.target.value })} />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="floor">Piso / depto (opcional)</label>
                  <input id="floor" className="input" value={shipping.floor} onChange={(e) => setShipping({ ...shipping, floor: e.target.value })} />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="city">Localidad</label>
                  <input id="city" className="input" value={shipping.city} onChange={(e) => setShipping({ ...shipping, city: e.target.value })} />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="zip">Código postal</label>
                  <input id="zip" className="input" value={shipping.zip} onChange={(e) => setShipping({ ...shipping, zip: e.target.value })} />
                </div>
                <div className={`field ${styles.span2}`}>
                  <label className="field-label" htmlFor="phone">Teléfono</label>
                  <input id="phone" className="input" inputMode="tel" value={shipping.phone} onChange={(e) => setShipping({ ...shipping, phone: e.target.value })} />
                </div>
                <div className={`field ${styles.span2}`}>
                  <label className="field-label" htmlFor="notes">Observaciones u horario (opcional)</label>
                  <input id="notes" className="input" value={shipping.notes} onChange={(e) => setShipping({ ...shipping, notes: e.target.value })} />
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

            <Notice kind={notice.kind || 'info'} onClose={notice.kind !== 'info' ? () => setNotice({ kind: '', text: '' }) : undefined}>
              {notice.text}
            </Notice>

            <button className="btn btn-primary btn-lg btn-block" onClick={handleSubmit} disabled={!canSubmit}>
              {sending ? 'Enviando…' : 'Enviar pedido a caja'}
            </button>
            {missing.length > 0 && lines.length > 0 && (
              <p className={styles.totalHint}>Falta: {missing.join(', ')}.</p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
