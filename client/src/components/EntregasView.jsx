import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api.js';
import { RESERVING_STATUSES, formatDateTime } from '../lib/feriaLabels.js';
import OrderLines from './OrderLines.jsx';
import { PaymentChip, OrderNumbers, Notice, EmptyState } from './ui.jsx';
import ShippingForm from './ShippingForm.jsx';
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

const EMPTY_TEXT = {
  retiros_feria: 'Nadie tiene que pasar a retirar por la feria.',
  ahora: 'No quedó nada de “Se lleva ahora” sin entregar.',
  mandar_feria: 'No hay nada para mandar de Rolón a la feria.',
  retiro_rolon: 'No hay retiros pendientes en Rolón.',
  envio: 'No hay envíos a domicilio pendientes.',
};

function pendingLines(order, filter) {
  return order.lines.filter(l => RESERVING_STATUSES.includes(l.status) && filter.match(l));
}

export default function EntregasView({ initialFilter }) {
  const [orders, setOrders] = useState([]);
  const [filter, setFilter] = useState(initialFilter);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState({ kind: '', text: '' });
  // { orderId, line?, changes? }: cargando/corrigiendo la dirección de un pedido
  // (con line, para pasar esa línea a envío a domicilio después).
  const [shippingEdit, setShippingEdit] = useState(null);

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

  async function run(order, line, path, options, successText) {
    setBusy(order.id);
    setNotice({ kind: '', text: '' });
    try {
      await apiFetch(`/api/feria/orders/${order.id}/lines/${line.lineId}${path}`, options);
      setNotice({ kind: 'success', text: successText });
      await load();
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
    } finally {
      setBusy('');
    }
  }

  async function saveShipping(order, shipping) {
    setBusy(order.id);
    try {
      await apiFetch(`/api/feria/orders/${order.id}/shipping`, { method: 'PATCH', body: JSON.stringify(shipping) });
      const pending = shippingEdit?.line;
      if (pending) {
        await apiFetch(`/api/feria/orders/${order.id}/lines/${pending.lineId}`, {
          method: 'PATCH', body: JSON.stringify(shippingEdit.changes),
        });
      }
      setShippingEdit(null);
      setNotice({
        kind: 'success',
        text: pending
          ? `${pending.modelo} pasa a envío a domicilio. Ojo: en Odoo agregá el cargo de envío y la dirección a mano.`
          : 'Dirección de envío guardada. Si el pedido ya está en Odoo, corregila también allá.',
      });
      await load();
    } finally {
      setBusy('');
    }
  }

  function editLine(order, line, changes) {
    // Pasar a domicilio sin dirección: primero se carga la dirección.
    if (changes.delivery === 'envio' && !order.shipping) {
      setShippingEdit({ orderId: order.id, line, changes });
      return;
    }
    // Después de confirmar, la línea de envío y la dirección en Odoo no se
    // tocan solas: hay que ajustarlas a mano en Odoo.
    const touchesShipping = changes.delivery && (changes.delivery === 'envio' || line.delivery === 'envio');
    run(order, line, '', { method: 'PATCH', body: JSON.stringify(changes) },
      touchesShipping
        ? `${line.modelo} actualizado. Ojo: el cargo de envío y la dirección en Odoo no se actualizan solos, ajustalos en Odoo.`
        : `${line.modelo} actualizado.`);
  }

  const current = FILTERS.find(f => f.value === filter);
  const q = search.trim().toLowerCase();
  const matchesSearch = o => !q || o.customer.name.toLowerCase().includes(q) || o.customer.docNumber.includes(q);
  const counts = Object.fromEntries(FILTERS.map(f => [
    f.value, orders.filter(matchesSearch).reduce((n, o) => n + pendingLines(o, f).length, 0),
  ]));
  const visible = orders
    .filter(matchesSearch)
    .map(o => ({ order: o, lines: pendingLines(o, current) }))
    .filter(x => x.lines.length > 0);

  return (
    <div className={styles.body}>
      <div className={styles.toolbar}>
        <div className={styles.filters} role="tablist" aria-label="Tipo de entrega">
          {FILTERS.map(f => (
            <button
              key={f.value}
              type="button"
              role="tab"
              aria-selected={filter === f.value}
              className={`${styles.filter} ${filter === f.value ? styles.filterActive : ''}`}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
              <span className={`num ${styles.filterCount} ${counts[f.value] ? styles.filterCountOn : ''}`}>{counts[f.value]}</span>
            </button>
          ))}
        </div>
        <input
          className={`input ${styles.search}`}
          placeholder="Buscar por nombre o DNI"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Buscar cliente"
        />
      </div>

      <Notice kind={notice.kind || 'info'} onClose={() => setNotice({ kind: '', text: '' })}>{notice.text}</Notice>

      {visible.length === 0 && <EmptyState title="Todo al día">{EMPTY_TEXT[filter]}</EmptyState>}

      <div className={styles.orders}>
        {visible.map(({ order, lines }) => (
          <article key={order.id} className={styles.order}>
            <header className={styles.orderHead}>
              <div>
                <OrderNumbers order={order} />
                <h3 className={styles.customer}>{order.customer.name}</h3>
                <p className={styles.meta}>
                  DNI {order.customer.docNumber}{order.customer.phone ? ` · Tel. ${order.customer.phone}` : ''} · Vendió {order.sellerName} · {formatDateTime(order.createdAt)}
                  {order.odooOrderId ? ` · Odoo #${order.odooOrderId}` : ''}
                </p>
              </div>
              <PaymentChip method={order.paymentMethod} />
            </header>

            {shippingEdit?.orderId === order.id && (
              <ShippingForm
                initial={order.shipping}
                defaultPhone={order.customer.phone}
                title={shippingEdit.line ? `A dónde se manda ${shippingEdit.line.modelo}` : 'Dirección de envío'}
                hint="Logística usa esta dirección. En Odoo corregila a mano si el pedido ya está confirmado."
                saving={busy === order.id}
                onSave={(shipping) => saveShipping(order, shipping)}
                onCancel={() => setShippingEdit(null)}
              />
            )}

            {order.shipping && shippingEdit?.orderId !== order.id && lines.some(l => l.delivery === 'envio') && (
              <div className={styles.shipping}>
                <button
                  type="button"
                  className={`btn btn-secondary btn-sm ${styles.shippingEdit}`}
                  disabled={busy === order.id}
                  onClick={() => setShippingEdit({ orderId: order.id })}
                >
                  Editar dirección
                </button>
                <p className={styles.shippingLabel}>Entregar en</p>
                <p className={styles.shippingAddress}>
                  {order.shipping.street} {order.shipping.number}{order.shipping.floor ? `, ${order.shipping.floor}` : ''} — {order.shipping.city} ({order.shipping.zip})
                </p>
                <p className={styles.meta}>
                  Tel. {order.shipping.phone}{order.shipping.notes ? ` · ${order.shipping.notes}` : ''}
                </p>
              </div>
            )}

            {order.errorDetail && <Notice kind="error">{order.errorDetail}</Notice>}

            <OrderLines
              lines={lines}
              disabled={busy === order.id}
              onSendToFeria={(l) => run(order, l, '/sent-to-feria', { method: 'POST' }, `${l.modelo} marcado como enviado a la feria.`)}
              onDeliver={(l) => run(order, l, '/deliver', { method: 'POST' }, `${l.modelo} entregado a ${order.customer.name}.`)}
              onEdit={(l, changes) => editLine(order, l, changes)}
            />
          </article>
        ))}
      </div>
    </div>
  );
}
