import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../lib/api.js';
import OrderLines from '../components/OrderLines.jsx';
import EntregasView from '../components/EntregasView.jsx';
import ShippingForm from '../components/ShippingForm.jsx';
import {
  AppHeader, PaymentChip, OrderStatusChip, OrderNumbers, Notice, EmptyState,
} from '../components/ui.jsx';
import {
  orderBreakdown, formatMoney, formatTime, formatDateTime, paymentMethodInfo, CONDITION_LABELS,
} from '../lib/feriaLabels.js';
import styles from './CajaPanel.module.css';

const SEARCH_MIN_CHARS = 6;
const REBAJA_LABELS = { 0: 'Normal', 1: 'Rebaja 1', 2: 'Rebaja 2' };

function PedidosTab() {
  const [orders, setOrders] = useState([]);
  const [selected, setSelected] = useState(null);
  const [stockBySku, setStockBySku] = useState({});
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState({ kind: '', text: '' });
  // null: mostrando la dirección. {}: editándola. { line, changes }: cargándola
  // para pasar esa línea a envío a domicilio.
  const [shippingEdit, setShippingEdit] = useState(null);

  // Traemos pendientes Y errores: si un confirm falla, el backend deja el
  // pedido en 'error' y, si sólo miráramos 'pendiente', la venta desaparecería
  // de la lista y no habría forma de reintentarla desde la app.
  const loadOrders = useCallback(async () => {
    try {
      const [pendientes, errores] = await Promise.all([
        apiFetch('/api/feria/orders?status=pendiente'),
        apiFetch('/api/feria/orders?status=error'),
      ]);
      setOrders([...(errores.orders || []), ...(pendientes.orders || [])]);
    } catch {
      // Silencioso — reintenta en el próximo poll.
    }
  }, []);

  useEffect(() => {
    loadOrders();
    const interval = setInterval(loadOrders, 5000);
    return () => clearInterval(interval);
  }, [loadOrders]);

  // Stock en vivo de cada SKU del pedido (disponible = Odoo − reservado, así
  // que ya descuenta lo que reserva este mismo pedido).
  async function loadStock(order) {
    const skus = [...new Set(order.lines.map(l => l.sku))];
    const entries = await Promise.all(skus.map(async (sku) => {
      try {
        const { products } = await apiFetch(`/api/feria/products/search?q=${encodeURIComponent(sku)}`);
        return [sku, products.find(p => p.sku === sku)?.stock ?? null];
      } catch {
        return [sku, null];
      }
    }));
    setStockBySku(Object.fromEntries(entries));
  }

  function openOrder(order) {
    setSelected(order);
    setNotice({ kind: '', text: '' });
    setStockBySku({});
    setShippingEdit(null);
    loadStock(order);
  }

  async function runAction(key, request, successText = '') {
    setBusy(key);
    setNotice({ kind: '', text: '' });
    try {
      const { order } = await request();
      setSelected(order);
      loadStock(order);
      if (successText) setNotice({ kind: 'success', text: successText });
      loadOrders();
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
    } finally {
      setBusy('');
    }
  }

  function removeLine(line) {
    runAction(line.lineId,
      () => apiFetch(`/api/feria/orders/${selected.id}/lines/${line.lineId}`, { method: 'DELETE' }),
      `${line.modelo} eliminado del pedido.`);
  }

  function editLine(line, changes) {
    // Pasar a domicilio un pedido sin dirección: primero se carga la
    // dirección y recién después se cambia la línea.
    if (changes.delivery === 'envio' && !selected.shipping) {
      setShippingEdit({ line, changes });
      return;
    }
    runAction(line.lineId, () => apiFetch(`/api/feria/orders/${selected.id}/lines/${line.lineId}`, {
      method: 'PATCH', body: JSON.stringify(changes),
    }));
  }

  async function saveShipping(shipping) {
    setBusy('shipping');
    try {
      let { order } = await apiFetch(`/api/feria/orders/${selected.id}/shipping`, {
        method: 'PATCH', body: JSON.stringify(shipping),
      });
      const pending = shippingEdit?.line;
      if (pending) {
        ({ order } = await apiFetch(`/api/feria/orders/${selected.id}/lines/${pending.lineId}`, {
          method: 'PATCH', body: JSON.stringify(shippingEdit.changes),
        }));
      }
      setSelected(order);
      setShippingEdit(null);
      setNotice({ kind: 'success', text: pending ? `${pending.modelo} pasa a envío a domicilio.` : 'Dirección de envío guardada.' });
      loadOrders();
    } finally {
      setBusy('');
    }
  }

  function handleCancel() {
    if (!window.confirm(`¿Cancelar el pedido de ${selected.customer.name}? Se libera todo el stock reservado.`)) return;
    runAction('cancel', () => apiFetch(`/api/feria/orders/${selected.id}/cancel`, { method: 'POST' }), 'Pedido cancelado.');
  }

  async function handleConfirm() {
    if (!selected) return;
    setBusy('confirm');
    setNotice({ kind: '', text: '' });
    try {
      // La facturación automática quedó desactivada en el backend (el pedido
      // igual se crea y se confirma en Odoo), así que vamos directo al confirm.
      const { order } = await apiFetch(`/api/feria/orders/${selected.id}/confirm`, { method: 'POST' });
      setSelected(null);
      const numbers = `${order.number ?? ''}${order.odooOrderName ? ` (Odoo ${order.odooOrderName})` : ''}`;
      setNotice(order.errorDetail
        ? { kind: 'error', text: `Venta ${numbers} de ${order.customer.name} confirmada, con un aviso: ${order.errorDetail}` }
        : { kind: 'success', text: `Venta ${numbers} de ${order.customer.name} confirmada en Odoo.` });
      loadOrders();
    } catch (err) {
      // Releemos el pedido para quedarnos con el estado real ('error' + el
      // detalle que guardó el backend) y que aparezca "Reintentar".
      try {
        const { order } = await apiFetch(`/api/feria/orders/${selected.id}`);
        setSelected(order);
      } catch {
        setSelected(prev => (prev ? { ...prev, status: 'error', errorDetail: err.message } : prev));
      }
      setNotice({ kind: 'error', text: `No se pudo confirmar: ${err.message}` });
      loadOrders();
    } finally {
      setBusy('');
    }
  }

  const editable = selected && ['pendiente', 'error'].includes(selected.status);
  const breakdown = selected ? orderBreakdown(selected) : null;
  const method = selected ? paymentMethodInfo(selected.paymentMethod) : null;

  return (
    <div className={styles.pedidos}>
      <aside className={styles.queue} aria-label="Pedidos por confirmar">
        <h2 className={styles.queueTitle}>
          Por confirmar <span className={`num ${styles.queueCount}`}>{orders.length}</span>
        </h2>
        {orders.length === 0 && <EmptyState title="No hay pedidos esperando">Los pedidos que carguen los vendedores aparecen acá.</EmptyState>}
        <ul className={styles.queueList}>
          {orders.map(order => (
            <li key={order.id}>
              <button
                type="button"
                className={[
                  styles.ticket,
                  order.status === 'error' ? styles.ticketError : '',
                  selected?.id === order.id ? styles.ticketActive : '',
                ].filter(Boolean).join(' ')}
                onClick={() => openOrder(order)}
              >
                <span className={styles.ticketTop}>
                  <strong className={styles.ticketName}>{order.customer.name}</strong>
                  <span className="num">{formatMoney(orderBreakdown(order).total)}</span>
                </span>
                <span className={styles.ticketMeta}>
                  {order.number ?? ''} · {formatTime(order.createdAt)} · {order.sellerName} · {order.lines.filter(l => l.status !== 'eliminado').length} prod.
                </span>
                <span className={styles.ticketChips}>
                  <PaymentChip method={order.paymentMethod} />
                  {order.status === 'error' && <OrderStatusChip status="error" />}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main className={styles.detail}>
        <Notice kind={notice.kind || 'info'} onClose={() => setNotice({ kind: '', text: '' })}>{notice.text}</Notice>

        {!selected ? (
          <EmptyState title="Elegí un pedido de la lista">Vas a ver sus productos, el stock y el total a cobrar.</EmptyState>
        ) : (
          <>
            <header className={styles.detailHead}>
              <div>
                <OrderNumbers order={selected} large />
                <h2 className={styles.detailName}>{selected.customer.name}</h2>
                <p className={styles.detailMeta}>
                  DNI {selected.customer.docNumber}{selected.customer.phone ? ` · Tel. ${selected.customer.phone}` : ''} · Vendió {selected.sellerName} · {formatDateTime(selected.createdAt)}
                </p>
              </div>
              <div className={styles.detailChips}>
                <OrderStatusChip status={selected.status} large />
                <PaymentChip method={selected.paymentMethod} large />
              </div>
            </header>

            {selected.status === 'error' && (
              <Notice kind="error">No se pudo confirmar en Odoo: {selected.errorDetail}</Notice>
            )}

            <section className={styles.linesCard}>
              <OrderLines
                lines={selected.lines}
                stockBySku={stockBySku}
                disabled={!!busy}
                onEdit={editable ? editLine : undefined}
                onRemove={editable ? removeLine : undefined}
              />
            </section>

            {shippingEdit ? (
              <ShippingForm
                initial={selected.shipping}
                defaultPhone={selected.customer.phone}
                title={shippingEdit.line ? `A dónde se manda ${shippingEdit.line.modelo}` : 'Dirección de envío'}
                hint={selected.odooOrderId
                  ? 'El pedido ya está en Odoo: esta dirección la usa Logística; en Odoo corregila a mano.'
                  : 'Se carga en Odoo al confirmar la venta.'}
                saving={busy === 'shipping'}
                onSave={saveShipping}
                onCancel={() => setShippingEdit(null)}
              />
            ) : selected.shipping && (
              <section className={styles.shipping}>
                <div className={styles.shippingText}>
                  <p className={styles.shippingLabel}>Envío a domicilio</p>
                  <p className={styles.shippingAddress}>
                    {selected.shipping.street} {selected.shipping.number}{selected.shipping.floor ? `, ${selected.shipping.floor}` : ''} — {selected.shipping.city} ({selected.shipping.zip})
                  </p>
                  <p className={styles.detailMeta}>
                    Tel. {selected.shipping.phone}{selected.shipping.notes ? ` · ${selected.shipping.notes}` : ''}
                  </p>
                </div>
                {selected.status !== 'cancelado' && (
                  <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => setShippingEdit({})}>
                    Editar dirección
                  </button>
                )}
              </section>
            )}

            <section className={styles.checkout}>
              <dl className={styles.breakdown}>
                <div><dt>Precio de lista</dt><dd className="num">{formatMoney(breakdown.list)}</dd></div>
                {breakdown.discount > 0 && (
                  <div className={styles.discount}>
                    <dt>{method.label} −{method.discountPct}%</dt>
                    <dd className="num">− {formatMoney(breakdown.discount)}</dd>
                  </div>
                )}
                {breakdown.shipping > 0 && <div><dt>Envío</dt><dd className="num">{formatMoney(breakdown.shipping)}</dd></div>}
              </dl>
              <div className={styles.charge}>
                <span>A cobrar <span className={styles.chargeMethod}>con {method.label}</span></span>
                <span className="num">{formatMoney(breakdown.total)}</span>
              </div>

              {editable && (
                <div className={styles.actions}>
                  <button className="btn btn-danger btn-lg" onClick={handleCancel} disabled={!!busy}>Cancelar pedido</button>
                  <button className={`btn btn-primary btn-lg ${styles.confirmBtn}`} onClick={handleConfirm} disabled={!!busy}>
                    {busy === 'confirm' ? 'Confirmando en Odoo…' : (selected.status === 'error' ? 'Reintentar confirmación' : 'Cobrado, confirmar venta')}
                  </button>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function RebajasTab() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [saving, setSaving] = useState('');
  const [notice, setNotice] = useState({ kind: '', text: '' });
  const searchTimeout = useRef(null);

  function handleQueryChange(value) {
    setQuery(value);
    clearTimeout(searchTimeout.current);
    if (value.trim().length < SEARCH_MIN_CHARS) return setResults([]);
    searchTimeout.current = setTimeout(async () => {
      try {
        const { products } = await apiFetch(`/api/feria/products/search?q=${encodeURIComponent(value)}`);
        setResults(products);
      } catch {
        setResults([]);
      }
    }, 300);
  }

  async function setRebaja(sku, condition, level) {
    setSaving(sku + condition);
    setNotice({ kind: '', text: '' });
    try {
      const { product } = await apiFetch(`/api/feria/products/${sku}/rebaja`, {
        method: 'PATCH', body: JSON.stringify({ condition, level }),
      });
      setResults(prev => prev.map(p => p.sku === sku ? { ...p, condiciones: product.condiciones } : p));
      setNotice({ kind: 'success', text: `${product.modelo} (${CONDITION_LABELS[condition]}): ${REBAJA_LABELS[level]} activa, ${formatMoney(product.condiciones[condition].precioTabla)}.` });
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
    } finally {
      setSaving('');
    }
  }

  return (
    <div className={styles.rebajas}>
      <div className="field">
        <label className={styles.rebajasLabel} htmlFor="rebaja-search">Cambiar la rebaja de un producto</label>
        <input id="rebaja-search" className={`input ${styles.rebajasSearch}`} value={query}
          onChange={(e) => handleQueryChange(e.target.value)} placeholder="SKU o modelo, mínimo 6 caracteres" autoComplete="off" />
      </div>
      <Notice kind={notice.kind || 'info'} onClose={() => setNotice({ kind: '', text: '' })}>{notice.text}</Notice>
      {results.map(p => (
        <article key={p.sku} className={styles.rebajaCard}>
          <div>
            <h3 className={styles.rebajaName}>{p.modelo}</h3>
            <p className={styles.detailMeta}>{p.sku}{p.color ? ` · ${p.color.trim()}` : ''}</p>
          </div>
          {['falla', 'discontinuo'].map(condition => p.condiciones[condition].disponible && (
            <div key={condition} className={styles.rebajaRow}>
              <div>
                <p className={styles.rebajaCondition}>{CONDITION_LABELS[condition]}</p>
                <p className={`num ${styles.rebajaPrice}`}>{formatMoney(p.condiciones[condition].precioTabla)}</p>
              </div>
              <div className={styles.levels} role="radiogroup" aria-label={`Rebaja ${CONDITION_LABELS[condition]}`}>
                {[0, 1, 2].map(level => (
                  <button
                    key={level}
                    type="button"
                    role="radio"
                    aria-checked={p.condiciones[condition].rebajaActiva === level}
                    disabled={saving === p.sku + condition}
                    className={p.condiciones[condition].rebajaActiva === level ? styles.levelActive : ''}
                    onClick={() => setRebaja(p.sku, condition, level)}
                  >
                    {REBAJA_LABELS[level]}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </article>
      ))}
    </div>
  );
}

const TABS = [
  { value: 'pedidos', label: 'Pedidos' },
  { value: 'entregas', label: 'Entregas' },
  { value: 'rebajas', label: 'Rebajas' },
];

export default function CajaPanel() {
  const user = JSON.parse(localStorage.getItem('feria_user') || '{}');
  const [tab, setTab] = useState('pedidos');

  return (
    <div className={styles.page}>
      <AppHeader panel="caja" userName={user.name} tabs={TABS} activeTab={tab} onTabChange={setTab} />
      {tab === 'pedidos' && <PedidosTab />}
      {/* Caja arranca en "Retiros en feria" (lo que el cliente viene a buscar),
          pero puede ver y marcar todo, igual que Logística. */}
      {tab === 'entregas' && <EntregasView initialFilter="retiros_feria" />}
      {tab === 'rebajas' && <RebajasTab />}
    </div>
  );
}
