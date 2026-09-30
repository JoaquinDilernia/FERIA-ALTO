import { useState } from 'react';
import { formatMoney, readAmount, paymentMethodInfo, VARIOS_SKU } from '../lib/feriaLabels.js';
import styles from './AddProductSearch.module.css';

// Artículo varios (ARTVARIOS): para vender algo que no está en la lista. Caja
// escribe qué es y el precio de lista; el descuento del medio de pago del
// pedido se aplica igual que a cualquier producto. Sale siempre "Me llevo
// ahora" desde Exhibición y no reserva stock.
export default function VariosForm({ disabled, paymentMethod, onAdd, onClose }) {
  const [description, setDescription] = useState('');
  const [priceText, setPriceText] = useState('');
  const [qty, setQty] = useState(1);

  const listPrice = readAmount(priceText);
  const method = paymentMethodInfo(paymentMethod);
  const unitPrice = listPrice ? Math.round(listPrice * (1 - method.discountPct / 100)) : null;
  const ready = description.trim() && listPrice > 0 && qty >= 1;

  function submit(e) {
    e.preventDefault();
    if (!ready || disabled) return;
    onAdd({ sku: VARIOS_SKU, modelo: description.trim(), description: description.trim(), listPrice, qty });
  }

  return (
    <form className={styles.box} onSubmit={submit}>
      <div className={styles.head}>
        <p className={styles.title}>Artículo varios</p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cerrar</button>
      </div>
      <p className={styles.hint}>Para vender algo que no está en la lista. Sale en el momento ("Me llevo ahora") y en Odoo va como {VARIOS_SKU} con esta descripción.</p>
      <div className="field">
        <label className="field-label" htmlFor="varios-desc">Qué se vende</label>
        <input id="varios-desc" className="input" value={description} maxLength={120} autoFocus
          onChange={(e) => setDescription(e.target.value)} placeholder="Ej. lámpara de pie sin etiqueta" />
      </div>
      <div className={styles.variosRow}>
        <div className="field">
          <label className="field-label" htmlFor="varios-price">Precio de lista (con IVA)</label>
          <input id="varios-price" className="input" inputMode="decimal" value={priceText}
            onChange={(e) => setPriceText(e.target.value)} placeholder="Ej. 25.000" />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="varios-qty">Cantidad</label>
          <input id="varios-qty" className="input" type="number" min={1} step={1} value={qty}
            onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
        </div>
      </div>
      {unitPrice != null && (
        <p className={styles.hint}>
          {paymentMethod ? `Con ${method.label}${method.discountPct ? ` −${method.discountPct}%` : ''}` : 'Total de lista (el descuento se aplica al elegir el medio de pago)'}:{' '}
          <strong className="num">{formatMoney(unitPrice * qty)}</strong>
          {qty > 1 ? ` (${formatMoney(unitPrice)} c/u)` : ''}
        </p>
      )}
      <button type="submit" className="btn btn-primary" disabled={!ready || disabled}>Agregar al pedido</button>
    </form>
  );
}
