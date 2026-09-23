import {
  LOCATION_LABELS, DELIVERY_LABELS, RESERVING_STATUSES, CONDITION_LABELS, formatDateTime, formatMoney,
} from '../lib/feriaLabels.js';
import { LineStatusChip } from './ui.jsx';
import styles from './OrderLines.module.css';

function statusDetail(line) {
  if (line.status === 'entregado') return `${formatDateTime(line.deliveredAt)} · ${line.deliveredBy ?? ''}`;
  if (line.status === 'enviado_feria') return `${formatDateTime(line.sentToFeriaAt)} · ${line.sentToFeriaBy ?? ''}`;
  if (line.status === 'eliminado') return `${formatDateTime(line.removedAt)} · ${line.removedBy ?? ''}`;
  return '';
}

// Lista de líneas de un pedido con su estado. Los controles aparecen solo si
// el que la usa pasa el callback: así Caja y Logística comparten la misma
// vista y cada una habilita lo que corresponde.
// `disabled` apaga los controles de TODAS las líneas mientras hay una acción
// en curso sobre el pedido: dos acciones simultáneas sobre el mismo pedido
// (dos "Hecho", o eliminar mientras se confirma) se pisan en Odoo.
export default function OrderLines({ lines, stockBySku = {}, disabled = false, onEdit, onRemove, onSendToFeria, onDeliver }) {
  function changeLocation(line, location) {
    // "Se lleva ahora" solo sale de Exhibición: si pasa a Rolón, cambia la
    // entrega a retiro en Rolón en el mismo paso.
    const changes = location === 'rolon' && line.delivery === 'ahora'
      ? { location, delivery: 'retira_rolon' }
      : { location };
    onEdit(line, changes);
  }

  return (
    <ul className={styles.list}>
      {lines.map((l, i) => {
        const reserving = RESERVING_STATUSES.includes(l.status);
        const stock = stockBySku[l.sku];
        const detail = statusDetail(l);
        return (
          <li key={l.lineId || i} className={`${styles.line} ${styles[`line-${l.status}`] ?? ''}`}>
            <div className={styles.product}>
              <p className={styles.name}>{l.modelo}</p>
              <p className={styles.meta}>
                {l.sku} · {CONDITION_LABELS[l.condition] ?? l.condition} · {l.qty} {l.qty === 1 ? 'unidad' : 'unidades'}
              </p>
            </div>

            <div className={styles.where}>
              {onEdit && reserving ? (
                <div className={styles.editors}>
                  <select className="select select-sm" value={l.location} disabled={disabled}
                    onChange={(e) => changeLocation(l, e.target.value)} aria-label="Sale de">
                    {Object.entries(LOCATION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  <select className="select select-sm" value={l.delivery} disabled={disabled}
                    onChange={(e) => onEdit(l, { delivery: e.target.value })} aria-label="Entrega">
                    {Object.entries(DELIVERY_LABELS).map(([value, label]) => (
                      <option key={value} value={value} disabled={value === 'ahora' && l.location !== 'exhibicion'}>{label}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <p className={styles.whereText}>
                  <strong>{DELIVERY_LABELS[l.delivery] ?? '—'}</strong>
                  <span> desde {LOCATION_LABELS[l.location] ?? '—'}</span>
                </p>
              )}
              {stock && reserving && (
                <p className={styles.meta}>Disponible · Exhibición {stock.exhibicion} · Rolón {stock.rolon}</p>
              )}
            </div>

            <div className={styles.status}>
              <LineStatusChip status={l.status} />
              {detail && <p className={styles.meta}>{detail}</p>}
            </div>

            <p className={`num ${styles.price}`}>{formatMoney(l.qty * l.unitPrice)}</p>

            {reserving && (onSendToFeria || onDeliver || onRemove) && (
              <div className={styles.actions}>
                {onSendToFeria && l.delivery === 'retira_feria' && l.status === 'pendiente' && (
                  <button type="button" className="btn btn-secondary btn-sm" disabled={disabled} onClick={() => onSendToFeria(l)}>
                    Enviado a feria
                  </button>
                )}
                {onDeliver && (
                  <button type="button" className="btn btn-success btn-sm" disabled={disabled} onClick={() => onDeliver(l)}>
                    Hecho, se lo llevó
                  </button>
                )}
                {onRemove && (
                  <button type="button" className="btn btn-danger btn-sm" disabled={disabled} onClick={() => onRemove(l)}>
                    Eliminar
                  </button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
