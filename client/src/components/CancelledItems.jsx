import { useState } from 'react';
import {
  RESERVING_STATUSES, LOCATION_LABELS, DELIVERY_LABELS, formatDateTime,
} from '../lib/feriaLabels.js';
import { OrderNumbers, EmptyState, ProductPhoto, ConditionChip, Chip } from './ui.jsx';
import styles from './CancelledItems.module.css';

// Misma regla que restockLines del backend: eliminados del pedido, o de un
// pedido cancelado/anulado que no se habían entregado.
export function restockLines(order) {
  return (order.lines ?? []).filter(l => l.status === 'eliminado'
    || (order.status === 'cancelado' && RESERVING_STATUSES.includes(l.status)));
}

export function pendingRestockCount(orders) {
  return orders.reduce((n, o) => n + restockLines(o).filter(l => !l.restockedAt).length, 0);
}

function reasonFor(order, line) {
  if (line.status === 'eliminado') return `Eliminado del pedido · ${line.removedBy ?? ''} · ${formatDateTime(line.removedAt)}`;
  return `${order.cancelReason ?? 'Pedido cancelado'} · ${order.cancelledBy ?? ''} · ${formatDateTime(order.cancelledAt)}`;
}

const LOCATION_FILTERS = [['todas', 'Todas'], ...Object.entries(LOCATION_LABELS)];

// Pestaña Cancelados de Entregas: la reserva de la app ya se liberó; esto es
// para que quien tenga el producto (depósito feria, Rolón…) lo vuelva a su
// lugar y lo marque.
export default function CancelledItems({ orders, search, busy, onRestock }) {
  const [done, setDone] = useState(false);
  const [location, setLocation] = useState('todas');

  const rows = orders
    .filter(search)
    .map(order => ({
      order,
      lines: restockLines(order).filter(l => !!l.restockedAt === done && (location === 'todas' || l.location === location)),
    }))
    .filter(x => x.lines.length > 0);

  return (
    <div className={styles.body}>
      <div className={styles.toolbar}>
        <div className={styles.segmented} role="radiogroup" aria-label="Estado">
          {[[false, 'Por devolver'], [true, 'Devueltos']].map(([value, label]) => (
            <button key={label} type="button" role="radio" aria-checked={done === value}
              className={done === value ? styles.segmentActive : ''} onClick={() => setDone(value)}>
              {label}
            </button>
          ))}
        </div>
        <div className={styles.segmented} role="radiogroup" aria-label="Ubicación">
          {LOCATION_FILTERS.map(([value, label]) => (
            <button key={value} type="button" role="radio" aria-checked={location === value}
              className={location === value ? styles.segmentActive : ''} onClick={() => setLocation(value)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 && (
        <EmptyState title={done ? 'Nada devuelto todavía' : 'Nada para devolver'}>
          {done ? 'Lo que se marque como devuelto a stock aparece acá.' : 'Los productos eliminados o de pedidos cancelados aparecen acá para volverlos a su lugar.'}
        </EmptyState>
      )}

      {rows.map(({ order, lines }) => (
        <article key={order.id} className={styles.order}>
          <header className={styles.head}>
            <OrderNumbers order={order} />
            <span className={styles.customer}>{order.customer?.name}</span>
            {order.status === 'cancelado' && <Chip tone="removed">{order.odooOrderId ? 'Venta anulada' : 'Pedido cancelado'}</Chip>}
          </header>
          <ul className={styles.lines}>
            {lines.map(line => (
              <li key={line.lineId} className={styles.line}>
                <ProductPhoto sku={line.sku} alt={line.modelo} size={56} />
                <div className={styles.info}>
                  <p className={styles.name}>{line.modelo} <span className={styles.qty}>× {line.qty}</span></p>
                  <p className={styles.meta}><ConditionChip condition={line.condition} /> {line.sku}</p>
                  <p className={styles.where}>
                    Volver a <strong>{LOCATION_LABELS[line.location] ?? line.location}</strong>
                    <span className={styles.meta}> · era {DELIVERY_LABELS[line.delivery] ?? line.delivery}{line.status === 'enviado_feria' ? ' (ya se había mandado a la feria)' : ''}</span>
                  </p>
                  <p className={styles.meta}>{reasonFor(order, line)}</p>
                </div>
                {line.restockedAt ? (
                  <p className={styles.done}>Devuelto · {line.restockedBy} · {formatDateTime(line.restockedAt)}</p>
                ) : (
                  <button type="button" className="btn btn-success btn-sm" disabled={busy === order.id} onClick={() => onRestock(order, line)}>
                    Devuelto a stock
                  </button>
                )}
              </li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
}
