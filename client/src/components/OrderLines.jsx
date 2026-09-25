import {
  LOCATION_LABELS, DELIVERY_LABELS, RESERVING_STATUSES, formatDateTime, formatMoney,
  deliveryAllowed, defaultDeliveryFor, locationsFor, controlsStock,
} from '../lib/feriaLabels.js';
import { LineStatusChip, ProductPhoto, ConditionChip } from './ui.jsx';
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
// `onQtyChange` (solo antes de confirmar) muestra el control de cantidad.
export default function OrderLines({ lines, stockBySku = {}, disabled = false, onEdit, onQtyChange, onRemove, onSendToFeria, onDeliver }) {
  function changeLocation(line, location) {
    // Si la entrega no corresponde a la ubicación nueva (se lleva ahora solo
    // de Exhibición, retira en Rolón solo de Rolón), cambia en el mismo paso.
    const changes = deliveryAllowed(line.delivery, location)
      ? { location }
      : { location, delivery: defaultDeliveryFor(location) };
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
              <ProductPhoto sku={l.sku} alt={l.modelo} size={56} />
              <div className={styles.productText}>
                <p className={styles.name}>{l.modelo}</p>
                <p className={styles.meta}>
                  <ConditionChip condition={l.condition} /> {l.sku}
                  {!(onQtyChange && reserving) && ` · ${l.qty} ${l.qty === 1 ? 'unidad' : 'unidades'}`}
                </p>
                {onQtyChange && reserving && (
                  <div className={styles.stepper} role="group" aria-label={`Cantidad de ${l.modelo}`}>
                    <button type="button" disabled={disabled || l.qty <= 1} onClick={() => onQtyChange(l, l.qty - 1)} aria-label="Una menos">−</button>
                    <span className="num">{l.qty}</span>
                    <button type="button" disabled={disabled} onClick={() => onQtyChange(l, l.qty + 1)} aria-label="Una más">+</button>
                  </div>
                )}
              </div>
            </div>

            <div className={styles.where}>
              {onEdit && reserving ? (
                <div className={styles.editors}>
                  {/* Falla sale siempre de Fallados: no hay ubicación para elegir. */}
                  <select className="select select-sm" value={l.location} disabled={disabled || l.condition === 'falla'}
                    onChange={(e) => changeLocation(l, e.target.value)} aria-label="Sale de">
                    {locationsFor(l.condition).map(value => <option key={value} value={value}>{LOCATION_LABELS[value]}</option>)}
                  </select>
                  <select className="select select-sm" value={l.delivery} disabled={disabled}
                    onChange={(e) => onEdit(l, { delivery: e.target.value })} aria-label="Entrega">
                    {Object.entries(DELIVERY_LABELS).map(([value, label]) => (
                      <option key={value} value={value} disabled={!deliveryAllowed(value, l.location)}>{label}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <p className={styles.whereText}>
                  <strong>{DELIVERY_LABELS[l.delivery] ?? '—'}</strong>
                  <span> desde {LOCATION_LABELS[l.location] ?? '—'}</span>
                </p>
              )}
              {stock && reserving && controlsStock(l.location) && (
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
