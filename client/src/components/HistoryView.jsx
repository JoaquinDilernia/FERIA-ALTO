import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api.js';
import { orderBreakdown, formatMoney, formatDateTime } from '../lib/feriaLabels.js';
import OrderLines from './OrderLines.jsx';
import { OrderNumbers, OrderStatusChip, PaymentChips, Notice, EmptyState } from './ui.jsx';
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
export default function HistoryView({ onOpen }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('todos');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState(null);
  const [annulling, setAnnulling] = useState('');
  const [notice, setNotice] = useState({ kind: '', text: '' });

  // Anula en Odoo y en la app (libera lo reservado). Solo ventas sin nada
  // entregado; el backend lo vuelve a verificar.
  async function annul(order) {
    if (!window.confirm(`¿Anular la venta ${order.number ?? ''} de ${order.customer.name}? Se cancela en Odoo y se libera el stock reservado.`)) return;
    setAnnulling(order.id);
    setNotice({ kind: '', text: '' });
    try {
      await apiFetch(`/api/feria/orders/${order.id}/annul`, { method: 'POST' });
      setNotice({ kind: 'success', text: `Venta ${order.number ?? ''} anulada en Odoo y en la app.` });
      await load();
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
    } finally {
      setAnnulling('');
    }
  }

  // Reintenta la factura de una venta confirmada (AFIP caído, por ejemplo).
  async function retryInvoice(order) {
    setAnnulling(order.id);
    setNotice({ kind: '', text: '' });
    try {
      const { order: updated } = await apiFetch(`/api/feria/orders/${order.id}/invoice`, { method: 'POST' });
      setNotice({ kind: 'success', text: `Venta ${order.number ?? ''} facturada: ${updated.invoiceName}.` });
      await load();
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
      await load();
    } finally {
      setAnnulling('');
    }
  }

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
      || (o.invoiceName ?? '').toLowerCase().includes(q)
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
      <Notice kind={notice.kind || 'info'} onClose={() => setNotice({ kind: '', text: '' })}>{notice.text}</Notice>
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
                    DNI {order.customer.docNumber}{order.customer.phone ? ` · Tel. ${order.customer.phone}` : ''}{order.customer.email ? ` · ${order.customer.email}` : ''}
                    {order.cancelledBy ? ` · ${order.cancelReason ?? 'Cancelado'} (${order.cancelledBy}, ${formatDateTime(order.cancelledAt)})` : ''}
                  </p>
                  <PaymentChips order={order} />
                  {onOpen && (
                    <button type="button" className={`btn btn-secondary btn-sm ${styles.openBtn}`} onClick={() => onOpen(order)}>
                      Abrir pedido
                    </button>
                  )}
                  {order.cajaNotes && (
                    <p className={styles.meta}><strong>Observación:</strong> {order.cajaNotes} ({order.cajaNotesBy})</p>
                  )}
                  {order.errorDetail && <Notice kind="error">{order.errorDetail}</Notice>}
                  {order.status === 'confirmado' && !order.invoiceName && order.invoiceError && (
                    <>
                      <Notice kind="error">{order.invoiceError}</Notice>
                      <button type="button" className="btn btn-primary btn-sm" disabled={annulling === order.id} onClick={() => retryInvoice(order)}>
                        {annulling === order.id ? 'Facturando…' : 'Reintentar factura'}
                      </button>
                    </>
                  )}
                  {order.shipping && (
                    <p className={styles.meta}>
                      Envío: {order.shipping.street} {order.shipping.number}{order.shipping.floor ? `, ${order.shipping.floor}` : ''} — {order.shipping.city} ({order.shipping.zip}) · Tel. {order.shipping.phone}
                    </p>
                  )}
                  <OrderLines lines={order.lines ?? []} />
                  {order.status === 'confirmado' && (
                    order.invoiceName ? (
                      <p className={styles.meta}>
                        Esta venta tiene la factura {order.invoiceName}: para anularla hacé la nota de crédito en Odoo y cancelá el pedido allá; la app se actualiza sola en unos minutos.
                      </p>
                    ) : (order.lines ?? []).some(l => l.status === 'entregado') ? (
                      <p className={styles.meta}>
                        Para anular esta venta, hacelo en Odoo con la devolución de lo entregado: la app se actualiza sola en unos minutos.
                      </p>
                    ) : (
                      <button type="button" className="btn btn-danger btn-sm" disabled={annulling === order.id} onClick={() => annul(order)}>
                        {annulling === order.id ? 'Anulando en Odoo…' : 'Anular venta'}
                      </button>
                    )
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
