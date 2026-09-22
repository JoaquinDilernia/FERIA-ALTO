import { useState, useRef } from 'react';
import { apiFetch } from '../lib/api.js';
import styles from './VendedorPanel.module.css';

const PAYMENT_METHODS = [
  { value: 'transferencia', label: 'Transferencia', discountPct: 20 },
  { value: 'efectivo', label: 'Efectivo', discountPct: 15 },
  { value: 'cuotas', label: '3 cuotas', discountPct: 0 },
];

const SEARCH_MIN_CHARS = 6;

// Devuelve null mientras no haya medio de pago elegido — el descuento depende
// del medio de pago, así que antes de elegirlo no hay precio final que mostrar.
function finalUnitPrice(tablePrice, paymentMethod) {
  const method = PAYMENT_METHODS.find(m => m.value === paymentMethod);
  if (!method) return null;
  return Math.round(tablePrice * (1 - method.discountPct / 100));
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
    setLines(prev => [...prev, {
      sku: product.sku, modelo: product.modelo, condition,
      qty: 1, tablePrice: info.precioTabla,
    }]);
    setQuery('');
    setResults([]);
  }

  function updateQty(index, qty) {
    setLines(prev => prev.map((l, i) => i === index ? { ...l, qty } : l));
  }

  function removeLine(index) {
    setLines(prev => prev.filter((_, i) => i !== index));
  }

  const total = paymentMethod
    ? lines.reduce((sum, l) => sum + l.qty * finalUnitPrice(l.tablePrice, paymentMethod), 0)
    : null;

  async function handleSubmit() {
    if (!canSubmit) return;
    setStatus('Confirmando precios actuales...');
    try {
      // El precio se vuelve a pedir recién al enviar: caja puede activar una
      // rebaja mientras el pedido está abierto en la tablet, y el precio que
      // se guardó al agregar la línea ya puede estar viejo.
      const priceCache = new Map();
      const freshLines = [];
      for (const line of lines) {
        if (!priceCache.has(line.sku)) {
          const { products } = await apiFetch(
            `/api/feria/products/search?q=${encodeURIComponent(line.sku)}`,
          );
          priceCache.set(line.sku, products.find(p => p.sku === line.sku) || null);
        }
        const fresh = priceCache.get(line.sku);
        const info = fresh?.condiciones?.[line.condition];
        if (!info || !info.disponible || info.precioTabla == null) {
          throw new Error(
            `No se pudo confirmar el precio actual de ${line.modelo} — sacalo del pedido y volvé a agregarlo.`,
          );
        }
        freshLines.push({
          sku: line.sku, modelo: line.modelo, condition: line.condition,
          qty: line.qty, unitPrice: finalUnitPrice(info.precioTabla, paymentMethod),
        });
      }

      setStatus('Enviando...');
      await apiFetch('/api/feria/orders', {
        method: 'POST',
        body: JSON.stringify({ customer, paymentMethod, lines: freshLines }),
      });
      setLines([]);
      setCustomer({ name: '', docNumber: '' });
      setPaymentMethod('');
      setLookupStatus('');
      setStatus('¡Pedido enviado a caja!');
      setTimeout(() => setStatus(''), 3000);
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    }
  }

  const canSubmit = lines.length > 0 && customer.name.trim() && customer.docNumber.trim() && paymentMethod;

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
            {results.map(p => (
              <li key={p.sku} className={styles.resultItem}>
                <span className={styles.resultName}>{p.modelo} ({p.sku})</span>
                <div className={styles.conditionButtons}>
                  {p.condiciones.falla.disponible && (
                    <button type="button" onClick={() => addLine(p, 'falla')}>
                      Falla — ${p.condiciones.falla.precioTabla}
                    </button>
                  )}
                  {p.condiciones.discontinuo.disponible && (
                    <button type="button" onClick={() => addLine(p, 'discontinuo')}>
                      Discontinuo — ${p.condiciones.discontinuo.precioTabla}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={styles.lines}>
        {lines.map((line, i) => (
          <div key={i} className={styles.lineRow}>
            <span className={styles.lineName}>{line.modelo} ({line.condition})</span>
            <input
              className={styles.qtyInput} type="number" min="1" value={line.qty}
              onChange={(e) => updateQty(i, Number(e.target.value))}
            />
            <span>
              {paymentMethod
                ? `$${(line.qty * finalUnitPrice(line.tablePrice, paymentMethod)).toFixed(0)}`
                : '—'}
            </span>
            <button className={styles.removeBtn} onClick={() => removeLine(i)}>✕</button>
          </div>
        ))}
      </div>

      <div className={styles.total}>
        {paymentMethod ? `Total: $${total.toFixed(0)}` : 'Elegí un medio de pago para ver el total'}
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

      {status && <p className={styles.status}>{status}</p>}

      <button className={styles.submitBtn} onClick={handleSubmit} disabled={!canSubmit}>
        Enviar pedido a caja
      </button>
    </div>
  );
}
