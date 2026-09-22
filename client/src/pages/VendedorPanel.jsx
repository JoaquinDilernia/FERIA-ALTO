import { useState, useRef } from 'react';
import { apiFetch } from '../lib/api.js';
import styles from './VendedorPanel.module.css';

const PAYMENT_METHODS = [
  { value: 'transferencia', label: 'Transferencia', discountPct: 20 },
  { value: 'efectivo', label: 'Efectivo', discountPct: 15 },
  { value: 'cuotas', label: '3 cuotas', discountPct: 0 },
];

const SEARCH_MIN_CHARS = 6;

function finalUnitPrice(tablePrice, paymentMethod) {
  const method = PAYMENT_METHODS.find(m => m.value === paymentMethod);
  return Math.round(tablePrice * (1 - method.discountPct / 100));
}

export default function VendedorPanel() {
  const seller = JSON.parse(localStorage.getItem('feria_seller') || '{}');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [lines, setLines] = useState([]);
  const [customer, setCustomer] = useState({ name: '', docNumber: '' });
  const [lookupStatus, setLookupStatus] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('efectivo');
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

  const total = lines.reduce((sum, l) => sum + l.qty * finalUnitPrice(l.tablePrice, paymentMethod), 0);

  async function handleSubmit() {
    setStatus('Enviando...');
    try {
      await apiFetch('/api/feria/orders', {
        method: 'POST',
        body: JSON.stringify({
          customer, paymentMethod,
          lines: lines.map(l => ({
            sku: l.sku, modelo: l.modelo, condition: l.condition,
            qty: l.qty, unitPrice: finalUnitPrice(l.tablePrice, paymentMethod),
          })),
        }),
      });
      setLines([]);
      setCustomer({ name: '', docNumber: '' });
      setLookupStatus('');
      setStatus('¡Pedido enviado a caja!');
      setTimeout(() => setStatus(''), 3000);
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    }
  }

  const canSubmit = lines.length > 0 && customer.name.trim() && customer.docNumber.trim();

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span>Vendedor: {seller.name}</span>
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
            <span>${(line.qty * finalUnitPrice(line.tablePrice, paymentMethod)).toFixed(0)}</span>
            <button className={styles.removeBtn} onClick={() => removeLine(i)}>✕</button>
          </div>
        ))}
      </div>

      <div className={styles.total}>Total: ${total.toFixed(0)}</div>

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
