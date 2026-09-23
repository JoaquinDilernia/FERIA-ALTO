import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api.js';
import { RESERVING_STATUSES, formatDateTime } from '../lib/feriaLabels.js';
import OrderLines from './OrderLines.jsx';
import styles from './EntregasView.module.css';

const FILTERS = [
  // Lo que el cliente viene a buscar a la feria (ya enviado o todavía no).
  { value: 'retiros_feria', label: 'Retiros en feria', match: l => l.delivery === 'retira_feria' },
  // Lo que se lleva ahora y quedó pendiente (falló la entrega automática al
  // confirmar, o caja lo cambió a 'Se lleva ahora' después): sin esta pestaña
  // esas líneas no aparecerían en ningún lado y su reserva quedaría trabada.
  { value: 'ahora', label: 'Se lleva ahora', match: l => l.delivery === 'ahora' },
  // Lo que Logística todavía tiene que mandar de Rolón a la feria.
  { value: 'mandar_feria', label: 'Mandar a feria', match: l => l.delivery === 'retira_feria' && l.status === 'pendiente' },
  { value: 'retiro_rolon', label: 'Retiro en Rolón', match: l => l.delivery === 'retira_rolon' },
  { value: 'envio', label: 'Envío a domicilio', match: l => l.delivery === 'envio' },
];

export default function EntregasView({ initialFilter }) {
  const [orders, setOrders] = useState([]);
  const [filter, setFilter] = useState(initialFilter);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    try {
      const { orders } = await apiFetch('/api/feria/logistics/orders');
      setOrders(orders);
    } catch {
      // Silencioso — reintenta en el próximo poll.
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, [load]);

  async function run(order, line, path, options, warning = '') {
    setBusy(`${order.id}:${line.lineId}`);
    setMessage('');
    try {
      await apiFetch(`/api/feria/orders/${order.id}/lines/${line.lineId}${path}`, options);
      if (warning) setMessage(warning);
      await load();
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setBusy('');
    }
  }

  function editLine(order, line, changes) {
    // Después de confirmar, la línea de envío y la dirección en Odoo no se
    // tocan solas: hay que ajustarlas a mano en Odoo.
    const touchesShipping = changes.delivery && (changes.delivery === 'envio' || line.delivery === 'envio');
    run(order, line, '', { method: 'PATCH', body: JSON.stringify(changes) },
      touchesShipping ? 'Ojo: el cargo de envío y la dirección en Odoo no se actualizan solos — ajustalos en Odoo.' : '');
  }

  const current = FILTERS.find(f => f.value === filter);
  const q = search.trim().toLowerCase();
  const visible = orders
    .filter(o => !q || o.customer.name.toLowerCase().includes(q) || o.customer.docNumber.includes(q))
    .map(o => ({ order: o, lines: o.lines.filter(l => RESERVING_STATUSES.includes(l.status) && current.match(l)) }))
    .filter(x => x.lines.length > 0);

  return (
    <div className={styles.body}>
      <div className={styles.toolbar}>
        {FILTERS.map(f => (
          <button
            key={f.value} type="button"
            className={`${styles.filterBtn} ${filter === f.value ? styles.filterBtnActive : ''}`}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
        <input className={styles.search} placeholder="Buscar por nombre o DNI" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {message && <p className={styles.message}>{message}</p>}
      {visible.length === 0 && <p className={styles.empty}>No hay nada pendiente acá.</p>}

      {visible.map(({ order, lines }) => (
        <div key={order.id} className={styles.card}>
          <div className={styles.cardHeader}>
            <strong>{order.customer.name}</strong>
            <span className={styles.meta}>{formatDateTime(order.createdAt)}</span>
          </div>
          <p className={styles.meta}>DNI/CUIT: {order.customer.docNumber} · Vendedor: {order.sellerName} · Pedido Odoo #{order.odooOrderId}</p>
          {order.shipping && lines.some(l => l.delivery === 'envio') && (
            <p className={styles.meta}>
              Envío: {order.shipping.street} {order.shipping.number} {order.shipping.floor} — {order.shipping.city} ({order.shipping.zip})
              · Tel {order.shipping.phone}{order.shipping.notes ? ` · ${order.shipping.notes}` : ''}
            </p>
          )}
          {order.errorDetail && <p className={styles.error}>{order.errorDetail}</p>}
          <OrderLines
            lines={lines}
            disabled={busy.startsWith(`${order.id}:`)}
            onSendToFeria={(l) => run(order, l, '/sent-to-feria', { method: 'POST' })}
            onDeliver={(l) => run(order, l, '/deliver', { method: 'POST' })}
            onEdit={(l, changes) => editLine(order, l, changes)}
          />
        </div>
      ))}
    </div>
  );
}
