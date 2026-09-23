import { useState } from 'react';
import { Notice } from './ui.jsx';
import styles from './ShippingForm.module.css';

const EMPTY = { street: '', number: '', floor: '', city: '', zip: '', phone: '', notes: '' };
const REQUIRED = ['street', 'number', 'city', 'zip', 'phone'];

// Formulario de dirección de envío para Caja y Logística (cargar una que
// faltaba o corregirla). El teléfono arranca con el del cliente.
export default function ShippingForm({ initial, defaultPhone = '', title, hint, saving, onSave, onCancel }) {
  const [shipping, setShipping] = useState({ ...EMPTY, ...(initial ?? {}), phone: initial?.phone || defaultPhone });
  const [error, setError] = useState('');
  const set = (field) => (e) => setShipping(prev => ({ ...prev, [field]: e.target.value }));
  const complete = REQUIRED.every(f => shipping[f].trim());

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      await onSave(shipping);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div>
        <p className={styles.title}>{title}</p>
        {hint && <p className={styles.hint}>{hint}</p>}
      </div>
      <div className={styles.grid}>
        <div className={`field ${styles.span2}`}>
          <label className="field-label" htmlFor="sf-street">Calle</label>
          <input id="sf-street" className="input" value={shipping.street} onChange={set('street')} autoFocus />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="sf-number">Número</label>
          <input id="sf-number" className="input" value={shipping.number} onChange={set('number')} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="sf-floor">Piso / depto (opcional)</label>
          <input id="sf-floor" className="input" value={shipping.floor} onChange={set('floor')} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="sf-city">Localidad</label>
          <input id="sf-city" className="input" value={shipping.city} onChange={set('city')} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="sf-zip">Código postal</label>
          <input id="sf-zip" className="input" value={shipping.zip} onChange={set('zip')} />
        </div>
        <div className={`field ${styles.span2}`}>
          <label className="field-label" htmlFor="sf-phone">Teléfono</label>
          <input id="sf-phone" className="input" inputMode="tel" value={shipping.phone} onChange={set('phone')} />
        </div>
        <div className={`field ${styles.span2}`}>
          <label className="field-label" htmlFor="sf-notes">Observaciones u horario (opcional)</label>
          <input id="sf-notes" className="input" value={shipping.notes} onChange={set('notes')} />
        </div>
      </div>
      <Notice kind="error">{error}</Notice>
      <div className={styles.actions}>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>Cancelar</button>
        <button type="submit" className="btn btn-primary" disabled={!complete || saving}>
          {saving ? 'Guardando…' : 'Guardar dirección'}
        </button>
      </div>
    </form>
  );
}
