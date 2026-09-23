import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api.js';
import { orderBreakdown, formatMoney, formatDateTime } from '../lib/feriaLabels.js';
import OrderLines from './OrderLines.jsx';
import { OrderNumbers, OrderStatusChip, PaymentChip, Notice, EmptyState } from './ui.jsx';
import styles from './HistoryView.module.css';

const STATUS_FILTERS = [
  { value: 'todos', label: 'Todos' },
  { value: 'pendiente', label: 'Por confirmar' },
  { value: 'confirmado', label: 'Confirmados' },
  { value: 'error', label: 'Con error' },
  { value: 'cancelado', label: 'Cancelados' },
];

// Cuántas líneas quedan por entregar: un pedido confirmado con 0 está cerrado.
function pendingCount(order) {
  return (order.lines ?? []).filter(l => ['pendiente', 'enviado_feria'].includes(l.status)).length;
}

// Historial de todos los pedidos (solo lectura): para responder "¿qué pasó
// con el F-0012?" aunque ya no esté en ninguna cola.
export default function HistoryView() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('todos');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const { orders } = await apiFetch('/api/feria/history');
      setOrders(orders);
    } catch (err) {
      setError(`No se pudo cargar el historial: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const q = search.trim().toLowerCase();
  const visible = orders
    .filter(o => status === 'todos' || o.status === status)
    .filter(o => !q
      || (o.number ?? '').toLowerCase().includes(q)
      || (o.odooOrderName ?? '').toLowerCase().includes(q)
      || o.customer.name.toLowerCase().includes(q)
      || o.customer.docNumber.includes(q));

  return (
    <div className={styles.body}>
      <div className={styles.toolbar}>
        <div className={styles.filters}>
          {STATUS_FILTERS.map(f => (
            <button key={f.value} type="button"
              className={`${styles.filter} ${status === f.value ? styles.filterActive : ''}`}
              onClick={() => setStatus(f.value)}>
              {f.label}
            </button>
          ))}
        </div>
        <div className={styles.searchRow}>
          <input className={`input ${styles.search}`} placeholder="Número, nombre o DNI" value={search}
            onChange={(e) => setSearch(e.target.value)} aria-label="Buscar pedido" />
          <button type="button" className="btn btn-secondary" onClick={load}>Actualizar</button>
        </div>
      </div>

      <Notice kind="error">{error}</Notice>
      {!loading && visible.length === 0 && <EmptyState title="No hay pedidos para mostrar">Probá con otro filtro o búsqueda.</EmptyState>}

      <ul className={styles.list}>
        {visible.map(order => {
          const open = openId === order.id;
          const pending = pendingCount(order);
          return (
            <li key={order.id} className={styles.item}>
              <button type="button" className={styles.row} onClick={() => setOpenId(open ? null : order.id)} aria-expanded={open}>
                <span className={styles.rowMain}>
                  <OrderNumbers order={order} />
                  <strong className={styles.customer}>{order.customer.name}</strong>
                  <span className={styles.meta}>{formatDateTime(order.createdAt)} · {order.sellerName}</span>
                </span>
                <span className={styles.rowSide}>
                  <OrderStatusChip status={order.status} />
                  {order.status === 'confirmado' && (
                    <span className={styles.meta}>{pending ? `${pending} por entregar` : 'Todo entregado'}</span>
                  )}
                  <span className={`num ${styles.total}`}>{formatMoney(orderBreakdown(order).total)}</span>
                </span>
              </button>
              {open && (
                <div className={styles.detail}>
                  <p className={styles.meta}>
                    DNI {order.customer.docNumber}{order.customer.phone ? ` · Tel. ${order.customer.phone}` : ''}
                    {order.cancelledBy ? ` · Cancelado por ${order.cancelledBy} el ${formatDateTime(order.cancelledAt)}` : ''}
                  </p>
                  <PaymentChip method={order.paymentMethod} />
                  {order.errorDetail && <Notice kind="error">{order.errorDetail}</Notice>}
                  {order.shipping && (
                    <p className={styles.meta}>
                      Envío: {order.shipping.street} {order.shipping.number}{order.shipping.floor ? `, ${order.shipping.floor}` : ''} — {order.shipping.city} ({order.shipping.zip}) · Tel. {order.shipping.phone}
                    </p>
                  )}
                  <OrderLines lines={order.lines ?? []} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
