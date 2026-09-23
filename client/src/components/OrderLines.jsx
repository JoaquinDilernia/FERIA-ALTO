import { LOCATION_LABELS, DELIVERY_LABELS, RESERVING_STATUSES, formatDateTime } from '../lib/feriaLabels.js';
import styles from './OrderLines.module.css';

function StatusBadge({ line }) {
  switch (line.status) {
    case 'entregado':
      return <span className={`${styles.badge} ${styles.badgeDone}`}>✅ Entregado {formatDateTime(line.deliveredAt)} · {line.deliveredBy}</span>;
    case 'enviado_feria':
      return <span className={`${styles.badge} ${styles.badgeSent}`}>🚚 Enviado a feria {formatDateTime(line.sentToFeriaAt)} · {line.sentToFeriaBy}</span>;
    case 'eliminado':
      return <span className={`${styles.badge} ${styles.badgeRemoved}`}>Eliminado {formatDateTime(line.removedAt)} · {line.removedBy}</span>;
    case 'pendiente':
      return <span className={`${styles.badge} ${styles.badgePending}`}>⏳ Pendiente</span>;
    default:
      return null;
  }
}

// Tabla de líneas de un pedido con su estado. Los controles aparecen solo si
// el que la usa pasa el callback: así Caja y Logística comparten la misma
// vista y cada una habilita lo que corresponde.
export default function OrderLines({ lines, stockBySku = {}, busyLineId = null, onEdit, onRemove, onSendToFeria, onDeliver }) {
  function changeLocation(line, location) {
    // "Se lleva ahora" solo sale de Exhibición: si pasa a Rolón, cambia la
    // entrega a retiro en Rolón en el mismo paso.
    const changes = location === 'rolon' && line.delivery === 'ahora'
      ? { location, delivery: 'retira_rolon' }
      : { location };
    onEdit(line, changes);
  }

  return (
    <table className={styles.table}>
      <tbody>
        {lines.map((l, i) => {
          const reserving = RESERVING_STATUSES.includes(l.status);
          const busy = busyLineId != null && busyLineId === l.lineId;
          const stock = stockBySku[l.sku];
          return (
            <tr key={l.lineId || i} className={l.status === 'eliminado' ? styles.removed : ''}>
              <td>
                {l.modelo} ({l.sku})
                <div className={styles.sub}>{l.condition} · x{l.qty} · ${(l.qty * l.unitPrice).toFixed(0)}</div>
              </td>
              <td>
                {onEdit && reserving ? (
                  <>
                    <select className={styles.select} value={l.location} disabled={busy} onChange={(e) => changeLocation(l, e.target.value)}>
                      {Object.entries(LOCATION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                    <select className={styles.select} value={l.delivery} disabled={busy} onChange={(e) => onEdit(l, { delivery: e.target.value })}>
                      {Object.entries(DELIVERY_LABELS).map(([value, label]) => (
                        <option key={value} value={value} disabled={value === 'ahora' && l.location !== 'exhibicion'}>{label}</option>
                      ))}
                    </select>
                  </>
                ) : (
                  <span>{LOCATION_LABELS[l.location] ?? '—'} · {DELIVERY_LABELS[l.delivery] ?? '—'}</span>
                )}
                {stock && <div className={styles.sub}>Disponible: Exhibición {stock.exhibicion} · Rolón {stock.rolon}</div>}
              </td>
              <td><StatusBadge line={l} /></td>
              <td>
                <div className={styles.actions}>
                  {reserving && onSendToFeria && l.delivery === 'retira_feria' && l.status === 'pendiente' && (
                    <button type="button" disabled={busy} onClick={() => onSendToFeria(l)}>Enviado a feria</button>
                  )}
                  {reserving && onDeliver && (
                    <button type="button" disabled={busy} onClick={() => onDeliver(l)}>Hecho</button>
                  )}
                  {reserving && onRemove && (
                    <button type="button" disabled={busy} onClick={() => onRemove(l)}>Eliminar</button>
                  )}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
