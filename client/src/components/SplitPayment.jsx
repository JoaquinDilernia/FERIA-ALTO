import { useState } from 'react';
import { PAYMENT_METHODS, formatMoney, readAmount, paymentMethodInfo, principalPaymentMethod } from '../lib/feriaLabels.js';
import styles from './SplitPayment.module.css';

const toText = (n) => (n == null ? '' : String(n).replace('.', ','));

// Caja divide el cobro en varios medios. El de mayor costo es el que va a
// Odoo y fija el precio de todo el pedido; los montos reparten ese total y
// tienen que sumarlo exacto. `totalFor(method)` da el total con ese medio.
export default function SplitPayment({ order, totalFor, saving, onSave, onCancel }) {
  const [rows, setRows] = useState(() => (order.payments?.length
    ? order.payments.map(p => ({ method: p.method, amount: toText(p.amount) }))
    : [
      { method: order.paymentMethod, amount: '' },
      { method: PAYMENT_METHODS.find(m => m.value !== order.paymentMethod).value, amount: '' },
    ]));

  const methods = rows.map(r => r.method);
  const principal = principalPaymentMethod(methods);
  const total = principal ? totalFor(principal) : 0;
  const amounts = rows.map(r => readAmount(r.amount));
  const assigned = amounts.reduce((sum, n) => sum + (n ?? 0), 0);
  const remaining = Math.round((total - assigned) * 100) / 100;
  const repeated = new Set(methods).size !== methods.length;
  const ready = rows.length > 1 && !repeated && amounts.every(n => n > 0) && Math.abs(remaining) < 0.01;

  const setRow = (i, changes) => setRows(prev => prev.map((r, j) => (j === i ? { ...r, ...changes } : r)));
  const unused = PAYMENT_METHODS.filter(m => !methods.includes(m.value));

  return (
    <div className={styles.box}>
      <p className={styles.title}>Pago dividido</p>
      <ul className={styles.rows}>
        {rows.map((row, i) => (
          <li key={i} className={styles.row}>
            <select className="select" value={row.method} disabled={saving} aria-label="Medio de pago"
              onChange={(e) => setRow(i, { method: e.target.value })}>
              {PAYMENT_METHODS.map(m => (
                <option key={m.value} value={m.value} disabled={m.value !== row.method && methods.includes(m.value)}>{m.label}</option>
              ))}
            </select>
            <input className={`input num ${styles.amount}`} inputMode="decimal" placeholder="Monto" value={row.amount} disabled={saving}
              aria-label={`Monto en ${paymentMethodInfo(row.method).label}`} onChange={(e) => setRow(i, { amount: e.target.value })} />
            {remaining > 0 && !(amounts[i] > 0) && (
              <button type="button" className="btn btn-ghost btn-sm" disabled={saving}
                onClick={() => setRow(i, { amount: toText(remaining) })}>
                Completar {formatMoney(remaining)}
              </button>
            )}
            {rows.length > 2 && (
              <button type="button" className={styles.remove} disabled={saving} aria-label="Quitar este medio"
                onClick={() => setRows(prev => prev.filter((_, j) => j !== i))}>×</button>
            )}
          </li>
        ))}
      </ul>
      {unused.length > 0 && (
        <button type="button" className={`btn btn-ghost btn-sm ${styles.addRow}`} disabled={saving}
          onClick={() => setRows(prev => [...prev, { method: unused[0].value, amount: '' }])}>
          + Otro medio
        </button>
      )}

      <dl className={styles.status}>
        <div>
          <dt>Total con {paymentMethodInfo(principal).label} <span className={styles.odoo}>(va a Odoo)</span></dt>
          <dd className="num">{formatMoney(total)}</dd>
        </div>
        <div><dt>Cargado</dt><dd className="num">{formatMoney(assigned)}</dd></div>
        <div className={Math.abs(remaining) < 0.01 ? styles.ok : styles.todo}>
          <dt>{remaining < 0 ? 'Sobra' : 'Falta'}</dt>
          <dd className="num">{formatMoney(Math.abs(remaining))}</dd>
        </div>
      </dl>
      {repeated && <p className={styles.error}>Hay un medio repetido: sumá los montos en uno solo.</p>}

      <div className={styles.actions}>
        <button type="button" className="btn btn-secondary" disabled={saving} onClick={onCancel}>Cancelar</button>
        <button type="button" className="btn btn-primary" disabled={saving || !ready}
          onClick={() => onSave(rows.map((r, i) => ({ method: r.method, amount: amounts[i] })))}>
          {saving ? 'Guardando…' : 'Guardar pago dividido'}
        </button>
      </div>
    </div>
  );
}
