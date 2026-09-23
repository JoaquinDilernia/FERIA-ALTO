import { useState, useRef } from 'react';
import { apiFetch } from '../lib/api.js';
import { LOCATION_LABELS, DELIVERY_LABELS, SHIPPING_COST } from '../lib/feriaLabels.js';
import styles from './VendedorPanel.module.css';

const PAYMENT_METHODS = [
  { value: 'transferencia', label: 'Transferencia', discountPct: 20 },
  { value: 'efectivo', label: 'Efectivo', discountPct: 15 },
  { value: 'cuotas', label: '3 cuotas', discountPct: 0 },
];

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
// se suman antes de comparar contra el disponible.
function stockProblems(lines) {
  const requested = new Map();
  for (const l of lines) {
    const key = `${l.sku}__${l.location}`;
    requested.set(key, (requested.get(key) || 0) + l.qty);
  }
  const problems = [];
  for (const [key, qty] of requested) {
    const [sku, location] = key.split('__');
    const line = lines.find(l => l.sku === sku && l.location === location);
    const available = line.stock?.[location] ?? 0;
    if (qty > available) problems.push(`${line.modelo} en ${LOCATION_LABELS[location]}: pediste ${qty}, hay ${available}`);
  }
  return problems;
}

function logout() {
  localStorage.removeItem('feria_token');
  localStorage.removeItem('feria_role');
  window.location.reload();
}

export default function VendedorPanel() {
  const seller = JSON.parse(localStorage.getItem('feria_seller') || '{}');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [lines, setLines] = useState([]);
  const [customer, setCustomer] = useState({ name: '', docNumber: '' });
  const [lookupStatus, setLookupStatus] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [shipping, setShipping] = useState(EMPTY_SHIPPING);
  const [status, setStatus] = useState('');
  const searchTimeout = useRef(null);
  const lookupTimeout = useRef(null);

  function handleQueryChange(value) {
    setQuery(value);
    clearTimeout(searchTimeout.current);
    if (value.trim().length < SEARCH_MIN_CHARS) return setResults([]);
    searchTimeout.current = setTimeout(async () => {
      try {
        const { products } = await apiFetch(`/api/feria/products/search?q=${encodeURIComponent(value)}`);
        setResults(products);
      } catch {
        setResults([]);
      }
    }, 300);
  }

  function handleDocNumberChange(value) {
    setCustomer(prev => ({ ...prev, docNumber: value }));
    clearTimeout(lookupTimeout.current);
    setLookupStatus('');
    if (value.trim().length < 6) return;
    lookupTimeout.current = setTimeout(async () => {
      setLookupStatus('Buscando en Odoo...');
      try {
        const { found, partner } = await apiFetch(`/api/feria/customers/lookup?docNumber=${encodeURIComponent(value)}`);
        if (found) {
          setCustomer({ name: partner.name, docNumber: partner.vat || value });
          setLookupStatus('Cliente encontrado en Odoo — datos autocompletados.');
        } else {
          setLookupStatus('No existe en Odoo todavía — se crea al confirmar la venta.');
        }
      } catch {
        setLookupStatus('No se pudo consultar Odoo, se puede seguir cargando a mano.');
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
  const total = paymentMethod
    ? lines.reduce((sum, l) => sum + l.qty * finalUnitPrice(l.tablePrice, paymentMethod), 0) + shippingCost
    : null;
  const problems = stockProblems(lines);
  const shippingOk = !needsShipping || REQUIRED_SHIPPING.every(f => shipping[f].trim());

  async function handleSubmit() {
    if (!canSubmit) return;
    setStatus('Confirmando precios y stock actuales...');
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
          throw new Error(`No se pudo confirmar el precio actual de ${line.modelo} — sacalo del pedido y volvé a agregarlo.`);
        }
        if (!fresh.stock) {
          throw new Error(`No se pudo verificar el stock de ${line.modelo} (Odoo no responde) — probá de nuevo en unos segundos.`);
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

      setStatus('Enviando...');
      await apiFetch('/api/feria/orders', {
        method: 'POST',
        body: JSON.stringify({ customer, paymentMethod, lines: freshLines, ...(needsShipping ? { shipping } : {}) }),
      });
      setLines([]);
      setCustomer({ name: '', docNumber: '' });
      setPaymentMethod('');
      setShipping(EMPTY_SHIPPING);
      setLookupStatus('');
      setStatus('¡Pedido enviado a caja!');
      setTimeout(() => setStatus(''), 3000);
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    }
  }

  const canSubmit = lines.length > 0 && customer.name.trim() && customer.docNumber.trim()
    && paymentMethod && problems.length === 0 && shippingOk;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span>Vendedor: {seller.name}</span>
        <button type="button" className={styles.logoutBtn} onClick={logout}>Salir</button>
      </header>

      <div className={styles.field}>
        <label className={styles.label}>Buscar producto (SKU o modelo, mínimo 6 caracteres)</label>
        <input
          className={styles.input}
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder="Ej: BCT037MA"
        />
        {results.length > 0 && (
          <ul className={styles.resultsList}>
            {results.map(p => {
              const sinStock = !p.stock || p.stock.exhibicion + p.stock.rolon === 0;
              return (
                <li key={p.sku} className={styles.resultItem}>
                  <span className={styles.resultName}>{p.modelo} ({p.sku})</span>
                  <span className={styles.stockInfo}>
                    {p.stock
                      ? `Exhibición: ${p.stock.exhibicion} · Rolón: ${p.stock.rolon}`
                      : 'Stock no disponible (Odoo no responde)'}
                  </span>
                  <div className={styles.conditionButtons}>
                    {p.condiciones.falla.disponible && (
                      <button type="button" disabled={sinStock} onClick={() => addLine(p, 'falla')}>
                        Falla — ${p.condiciones.falla.precioTabla}
                      </button>
                    )}
                    {p.condiciones.discontinuo.disponible && (
                      <button type="button" disabled={sinStock} onClick={() => addLine(p, 'discontinuo')}>
                        Discontinuo — ${p.condiciones.discontinuo.precioTabla}
                      </button>
                    )}
                    {sinStock && <span className={styles.noStock}>Sin stock</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className={styles.lines}>
        {lines.map((line, i) => (
          <div key={i} className={styles.lineRow}>
            <span className={styles.lineName}>{line.modelo} ({line.condition})</span>
            <input
              className={styles.qtyInput} type="number" min="1" value={line.qty}
              onChange={(e) => updateLine(i, { qty: Number(e.target.value) })}
            />
            <select className={styles.lineSelect} value={line.location} onChange={(e) => updateLine(i, { location: e.target.value })}>
              {Object.entries(LOCATION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label} ({line.stock?.[value] ?? 0})</option>
              ))}
            </select>
            <select className={styles.lineSelect} value={line.delivery} onChange={(e) => updateLine(i, { delivery: e.target.value })}>
              {Object.entries(DELIVERY_LABELS).map(([value, label]) => (
                <option key={value} value={value} disabled={value === 'ahora' && line.location !== 'exhibicion'}>{label}</option>
              ))}
            </select>
            <span>
              {paymentMethod
                ? `$${(line.qty * finalUnitPrice(line.tablePrice, paymentMethod)).toFixed(0)}`
                : '—'}
            </span>
            <button className={styles.removeBtn} onClick={() => removeLine(i)}>✕</button>
          </div>
        ))}
      </div>

      {problems.length > 0 && (
        <div className={styles.problems}>
          {problems.map(p => <p key={p}>Sin stock suficiente — {p}</p>)}
        </div>
      )}

      <div className={styles.total}>
        {paymentMethod
          ? `Total: $${total.toFixed(0)}${needsShipping ? ` (incluye envío $${SHIPPING_COST})` : ''}`
          : 'Elegí un medio de pago para ver el total'}
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Medio de pago (obligatorio)</label>
        <div className={styles.paymentButtons}>
          {PAYMENT_METHODS.map(m => (
            <button
              key={m.value}
              type="button"
              className={`${styles.paymentBtn} ${paymentMethod === m.value ? styles.paymentBtnActive : ''}`}
              onClick={() => setPaymentMethod(m.value)}
            >
              {m.label}{m.discountPct > 0 ? ` (-${m.discountPct}%)` : ''}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Cliente</label>
        <input
          className={styles.input} placeholder="DNI/CUIT"
          value={customer.docNumber} onChange={(e) => handleDocNumberChange(e.target.value)}
        />
        {lookupStatus && <p className={styles.lookupStatus}>{lookupStatus}</p>}
        <input
          className={styles.input} placeholder="Nombre y apellido"
          value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })}
        />
      </div>

      {needsShipping && (
        <div className={styles.field}>
          <label className={styles.label}>Datos de envío (obligatorio, costo ${SHIPPING_COST})</label>
          <div className={styles.shippingGrid}>
            <input className={styles.input} placeholder="Calle *" value={shipping.street} onChange={(e) => setShipping({ ...shipping, street: e.target.value })} />
            <input className={styles.input} placeholder="Número *" value={shipping.number} onChange={(e) => setShipping({ ...shipping, number: e.target.value })} />
            <input className={styles.input} placeholder="Piso / depto" value={shipping.floor} onChange={(e) => setShipping({ ...shipping, floor: e.target.value })} />
            <input className={styles.input} placeholder="Localidad *" value={shipping.city} onChange={(e) => setShipping({ ...shipping, city: e.target.value })} />
            <input className={styles.input} placeholder="Código postal *" value={shipping.zip} onChange={(e) => setShipping({ ...shipping, zip: e.target.value })} />
            <input className={styles.input} placeholder="Teléfono *" value={shipping.phone} onChange={(e) => setShipping({ ...shipping, phone: e.target.value })} />
            <input className={`${styles.input} ${styles.full}`} placeholder="Observaciones / horario" value={shipping.notes} onChange={(e) => setShipping({ ...shipping, notes: e.target.value })} />
          </div>
        </div>
      )}

      {status && <p className={styles.status}>{status}</p>}

      <button className={styles.submitBtn} onClick={handleSubmit} disabled={!canSubmit}>
        Enviar pedido a caja
      </button>
    </div>
  );
}
