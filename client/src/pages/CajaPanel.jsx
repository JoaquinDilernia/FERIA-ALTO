import { getSession } from '../lib/session.js';
import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../lib/api.js';
import OrderLines from '../components/OrderLines.jsx';
import SplitPayment from '../components/SplitPayment.jsx';
import EntregasView from '../components/EntregasView.jsx';
import ShippingForm from '../components/ShippingForm.jsx';
import AddProductSearch from '../components/AddProductSearch.jsx';
import HistoryView from '../components/HistoryView.jsx';
import UsersView from '../components/UsersView.jsx';
import StatsView from '../components/StatsView.jsx';
import CashView from '../components/CashView.jsx';
import {
  AppHeader, PaymentChips, OrderStatusChip, OrderNumbers, Notice, EmptyState, ProductPhoto, ConditionChip,
} from '../components/ui.jsx';
import {
  orderBreakdown, formatMoney, formatTime, formatDateTime, paymentMethodInfo, CONDITION_LABELS, PAYMENT_METHODS, readAmount,
  SHIPPING_ZONE_HINT,
} from '../lib/feriaLabels.js';
import styles from './CajaPanel.module.css';

const SEARCH_MIN_CHARS = 6;
const REBAJA_LABELS = { 0: 'Normal', 1: 'Rebaja 1', 2: 'Rebaja 2', 3: 'Rebaja 3' };
// Mismo tope que AUTO_RETRY_MAX del backend (feriaLines.mjs).
const AUTO_RETRY_MAX = 6;
const MANUAL_LEVEL = 3;
const percentOff = (value) => PAYMENT_METHODS.find(m => m.value === value).discountPct;

// Rebaja 3: precio manual (con IVA, como los de tabla) para liquidar un
// producto. Muestra lo que pagaría el cliente con cada medio antes de activarla.
function ManualRebajaCard({ info, saving, onSave }) {
  const active = info.rebajaActiva === MANUAL_LEVEL;
  const [text, setText] = useState(info.precioManual != null ? String(info.precioManual) : '');
  const price = readAmount(text);
  const valid = price > 0;
  const pay = (method) => (valid ? Math.round(price * (1 - percentOff(method) / 100)) : null);
  const unchanged = active && price === info.precioManual;
  return (
    <div className={`${styles.levelCard} ${styles.levelCardManual} ${active ? styles.levelCardActive : ''}`}>
      <span className={styles.levelName}>Rebaja 3 · precio manual{active ? ' · activa' : ''}</span>
      <input className={`input num ${styles.manualInput}`} inputMode="decimal" placeholder="Precio de lista" value={text}
        disabled={saving} aria-label="Precio manual de la rebaja 3" onChange={(e) => setText(e.target.value)} />
      <span className={styles.levelPays}>
        <span>Transferencia <b className="num">{formatMoney(pay('transferencia'))}</b></span>
        <span>Efectivo <b className="num">{formatMoney(pay('efectivo'))}</b></span>
        <span>Mercado Pago <b className="num">{formatMoney(pay('mp_debito'))}</b></span>
      </span>
      <button type="button" className={`btn btn-sm ${active ? 'btn-secondary' : 'btn-primary'}`} disabled={saving || !valid || unchanged}
        onClick={() => onSave(price)}>
        {active ? 'Cambiar precio' : 'Activar a este precio'}
      </button>
    </div>
  );
}

// `openRequest` ({ id }): pedido que se abrió desde el Historial, en cualquier estado.
function PedidosTab({ openRequest }) {
  const [orders, setOrders] = useState([]);
  const [selected, setSelected] = useState(null);
  const [stockBySku, setStockBySku] = useState({});
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState({ kind: '', text: '' });
  // null: mostrando la dirección. {}: editándola. { line, changes }: cargándola
  // para pasar esa línea a envío a domicilio.
  const [shippingEdit, setShippingEdit] = useState(null);
  const [offline, setOffline] = useState(false);
  const [adding, setAdding] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [orderNotes, setOrderNotes] = useState('');
  const [queueSearch, setQueueSearch] = useState('');
  // null = todavía no se sabe; false = caja cerrada (no se confirma).
  const [cashOpen, setCashOpen] = useState(null);

  // Traemos pendientes Y errores: si un confirm falla, el backend deja el
  // pedido en 'error' y, si sólo miráramos 'pendiente', la venta desaparecería
  // de la lista y no habría forma de reintentarla desde la app.
  const loadOrders = useCallback(async () => {
    try {
      const [pendientes, errores] = await Promise.all([
        apiFetch('/api/feria/orders?status=pendiente'),
        apiFetch('/api/feria/orders?status=error'),
      ]);
      const all = [...(errores.orders || []), ...(pendientes.orders || [])];
      setOrders(all);
      // Si otro dispositivo cambió el pedido abierto (agregó un producto, cambió
      // una cantidad), se refresca: el total a cobrar tiene que ser el real.
      setSelected(prev => {
        const fresh = prev && all.find(o => o.id === prev.id);
        return fresh && JSON.stringify(fresh.updatedAt) !== JSON.stringify(prev.updatedAt) ? fresh : prev;
      });
      setOffline(false);
    } catch {
      // Reintenta en el próximo poll; mientras tanto se avisa en pantalla.
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    loadOrders();
    const interval = setInterval(loadOrders, 5000);
    return () => clearInterval(interval);
  }, [loadOrders]);

  // Abrir desde el Historial: se trae el pedido fresco (puede ser confirmado o
  // cancelado, que no están en la lista de "Por confirmar").
  useEffect(() => {
    if (!openRequest) return;
    apiFetch(`/api/feria/orders/${openRequest.id}`)
      .then(({ order }) => openOrder(order))
      .catch(err => setNotice({ kind: 'error', text: `No se pudo abrir el pedido: ${err.message}` }));
  }, [openRequest]);

  // Sin caja abierta el backend no deja confirmar: se avisa antes de cobrar.
  useEffect(() => {
    const loadCash = () => apiFetch('/api/feria/cash/current')
      .then(({ session }) => setCashOpen(!!session))
      .catch(() => {});
    loadCash();
    const interval = setInterval(loadCash, 15000);
    return () => clearInterval(interval);
  }, []);

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
    setAdding(false);
    setSplitting(false);
    setOrderNotes(order.cajaNotes ?? '');
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

  function changeQty(line, qty) {
    runAction(line.lineId, () => apiFetch(`/api/feria/orders/${selected.id}/lines/${line.lineId}`, {
      method: 'PATCH', body: JSON.stringify({ qty }),
    }));
  }

  function addProduct({ modelo, ...input }) {
    runAction('add', () => apiFetch(`/api/feria/orders/${selected.id}/lines`, {
      method: 'POST', body: JSON.stringify(input),
    }), `${modelo} agregado al pedido. Revisá de dónde sale y cómo se entrega.`);
    setAdding(false);
  }

  // Después de confirmar (como en Entregas): marcar entregado o enviado a feria.
  function deliverLine(line) {
    runAction(line.lineId, () => apiFetch(`/api/feria/orders/${selected.id}/lines/${line.lineId}/deliver`, { method: 'POST' }),
      `${line.modelo} entregado a ${selected.customer.name}.`);
  }

  function sendToFeria(line) {
    runAction(line.lineId, () => apiFetch(`/api/feria/orders/${selected.id}/lines/${line.lineId}/sent-to-feria`, { method: 'POST' }),
      `${line.modelo} marcado como enviado a la feria.`);
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
      // La dirección ya quedó guardada aunque falle el cambio de la línea.
      setSelected(order);
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

  // El cliente decide pagar con otro medio: el servidor recalcula los precios
  // con el descuento nuevo (solo antes de confirmar).
  // Elegir un solo medio también deshace un pago dividido.
  function changePayment(value) {
    if (value === selected.paymentMethod && !selected.payments) return;
    const next = paymentMethodInfo(value);
    setSplitting(false);
    runAction('payment', () => apiFetch(`/api/feria/orders/${selected.id}/payment`, {
      method: 'PATCH', body: JSON.stringify({ paymentMethod: value }),
    }), `Medio de pago cambiado a ${next.label}. Revisá el nuevo total a cobrar.`);
  }

  // Pago en varios medios: el servidor fija el precio con el de mayor costo
  // (el que va a Odoo) y verifica que los montos sumen el total.
  async function saveSplit(payments) {
    await runAction('payment', () => apiFetch(`/api/feria/orders/${selected.id}/payment`, {
      method: 'PATCH', body: JSON.stringify({ payments }),
    }), 'Pago dividido guardado.');
    setSplitting(false);
  }

  function saveOrderNotes() {
    runAction('notes', () => apiFetch(`/api/feria/orders/${selected.id}/notes`, {
      method: 'PATCH', body: JSON.stringify({ notes: orderNotes }),
    }), 'Observación del pedido guardada.');
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
      // Confirmar también factura (si está activada en el backend). Un error
      // de entrega o de factura no deshace la venta: se avisa y se sigue.
      const { order } = await apiFetch(`/api/feria/orders/${selected.id}/confirm`, { method: 'POST' });
      setSelected(null);
      const numbers = `${order.number ?? ''}${order.odooOrderName ? ` (Odoo ${order.odooOrderName})` : ''}`;
      const warnings = [
        order.errorDetail,
        order.invoiceError && `${order.invoiceError}. Reintentala desde Historial.`,
      ].filter(Boolean);
      setNotice(warnings.length
        ? { kind: 'error', text: `Venta ${numbers} de ${order.customer.name} confirmada, con un aviso: ${warnings.join(' ')}` }
        : { kind: 'success', text: `Venta ${numbers} de ${order.customer.name} confirmada en Odoo${order.invoiceName ? ` y facturada (${order.invoiceName})` : ''}.` });
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

  // Buscador de la cola: nombre del cliente, número de pedido (F2-0012) o DNI.
  const q = queueSearch.trim().toLowerCase();
  const visibleOrders = !q ? orders : orders.filter(o => (o.number ?? '').toLowerCase().includes(q)
    || (o.customer?.name ?? '').toLowerCase().includes(q)
    || (o.customer?.docNumber ?? '').includes(q));

  const editable = selected && ['pendiente', 'error'].includes(selected.status);
  // Confirmado: ya no cambian cantidades ni precios (están en Odoo), pero sí
  // de dónde sale y cómo se entrega, y se marca entregado.
  const confirmed = selected?.status === 'confirmado';
  // Abierto desde el Historial (no está en la lista de la izquierda).
  const inQueue = !!selected && orders.some(o => o.id === selected.id);
  const breakdown = selected ? orderBreakdown(selected) : null;
  const method = selected ? paymentMethodInfo(selected.paymentMethod) : null;
  const paymentEditable = editable && !selected.odooOrderId;
  // Si Caja cambió productos después de dividir el pago, los montos no cierran.
  const splitPaid = selected?.payments?.reduce((sum, p) => sum + p.amount, 0) ?? 0;
  const splitMismatch = !!selected?.payments && Math.abs(splitPaid - breakdown.total) >= 0.01;
  // Total que quedaría con cada medio de pago (mismo cálculo que el servidor:
  // precio de lista con el descuento del medio, más el envío).
  const totalWith = (m) => selected.lines
    .filter(l => l.status !== 'eliminado')
    .reduce((sum, l) => {
      const list = l.listPrice ?? Math.round(l.unitPrice / (1 - method.discountPct / 100));
      return sum + l.qty * Math.round(list * (1 - m.discountPct / 100));
    }, 0) + breakdown.shipping;

  return (
    <div className={styles.pedidos}>
      <aside className={styles.queue} aria-label="Pedidos por confirmar">
        <h2 className={styles.queueTitle}>
          Por confirmar <span className={`num ${styles.queueCount}`}>{orders.length}</span>
        </h2>
        {orders.length > 0 && (
          <input
            className={`input ${styles.queueSearch}`}
            type="search"
            placeholder="Nombre, N.º de pedido o DNI"
            aria-label="Buscar pedido por nombre, número o DNI"
            value={queueSearch}
            onChange={(e) => setQueueSearch(e.target.value)}
          />
        )}
        {offline && <Notice kind="error">Sin conexión con el servidor. Reintentando…</Notice>}
        {orders.length === 0 && <EmptyState title="No hay pedidos esperando">Los pedidos que carguen los vendedores aparecen acá.</EmptyState>}
        {orders.length > 0 && visibleOrders.length === 0 && (
          <EmptyState title="Ningún pedido coincide">Si ya se confirmó, buscalo en Historial.</EmptyState>
        )}
        <ul className={styles.queueList}>
          {visibleOrders.map(order => (
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
                  <PaymentChips order={order} />
                  {order.status === 'error' && <OrderStatusChip status="error" />}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main className={styles.detail}>
        <Notice kind={notice.kind || 'info'} onClose={() => setNotice({ kind: '', text: '' })}>{notice.text}</Notice>
        {cashOpen === false && (
          <Notice kind="error">La caja está cerrada: abrila en la pestaña “Caja del día” para poder confirmar ventas.</Notice>
        )}

        {!selected ? (
          <EmptyState title="Elegí un pedido de la lista">Vas a ver sus productos, el stock y el total a cobrar.</EmptyState>
        ) : (
          <>
            <header className={styles.detailHead}>
              <div>
                <OrderNumbers order={selected} large />
                <h2 className={styles.detailName}>{selected.customer.name}</h2>
                <p className={styles.detailMeta}>
                  DNI {selected.customer.docNumber}{selected.customer.phone ? ` · Tel. ${selected.customer.phone}` : ''}{selected.customer.email ? ` · ${selected.customer.email}` : ''} · Vendió {selected.sellerName} · {formatDateTime(selected.createdAt)}
                </p>
              </div>
              <div className={styles.detailChips}>
                <OrderStatusChip status={selected.status} large />
                <PaymentChips order={selected} large />
                {!inQueue && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(null)}>Cerrar</button>
                )}
              </div>
            </header>

            {selected.status === 'error' && (
              <Notice kind="error">
                No se pudo confirmar en Odoo: {selected.errorDetail}{' '}
                {(selected.autoRetryCount ?? 0) < AUTO_RETRY_MAX
                  ? `El sistema lo reintenta solo cada pocos minutos (van ${selected.autoRetryCount ?? 0} de ${AUTO_RETRY_MAX} intentos automáticos); también podés reintentarlo vos.`
                  : 'Ya se reintentó solo varias veces sin suerte: revisá el error y reintentalo a mano.'}
              </Notice>
            )}

            <section className={styles.linesCard}>
              <OrderLines
                lines={selected.lines}
                stockBySku={stockBySku}
                disabled={!!busy}
                onEdit={editable || confirmed ? editLine : undefined}
                onDeliver={confirmed ? deliverLine : undefined}
                onSendToFeria={confirmed ? sendToFeria : undefined}
                onQtyChange={editable && !selected.odooOrderId ? changeQty : undefined}
                onRemove={editable ? removeLine : undefined}
              />
            </section>

            {editable && !selected.odooOrderId && (adding ? (
              <AddProductSearch disabled={!!busy} onAdd={addProduct} onClose={() => setAdding(false)} />
            ) : (
              <button type="button" className={`btn btn-secondary ${styles.addBtn}`} onClick={() => setAdding(true)} disabled={!!busy}>
                + Agregar producto
              </button>
            ))}

            {shippingEdit ? (
              <ShippingForm
                initial={selected.shipping}
                defaultPhone={selected.customer.phone}
                title={shippingEdit.line ? `A dónde se manda ${shippingEdit.line.modelo}` : 'Dirección de envío'}
                hint={`${SHIPPING_ZONE_HINT} ${selected.odooOrderId
                  ? 'El pedido ya está en Odoo: esta dirección la usa Logística; en Odoo corregila a mano.'
                  : 'Se carga en Odoo al confirmar la venta.'}`}
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

            <section className={styles.orderNotes}>
              <label className={styles.payPickerLabel} htmlFor="order-notes">Observación del pedido</label>
              <textarea id="order-notes" className="input" rows={2} maxLength={1000} value={orderNotes}
                onChange={(e) => setOrderNotes(e.target.value)} placeholder="Ej. pagó con dos tarjetas, retira otra persona, revisar en Odoo…" />
              {selected.cajaNotesBy && (
                <p className={styles.detailMeta}>Última edición: {selected.cajaNotesBy} · {formatDateTime(selected.cajaNotesAt)}</p>
              )}
              <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy || orderNotes.trim() === (selected.cajaNotes ?? '')}
                onClick={saveOrderNotes}>
                {busy === 'notes' ? 'Guardando…' : 'Guardar observación'}
              </button>
            </section>

            <section className={styles.checkout}>
              {paymentEditable && (
                <div className={styles.payPicker}>
                  <p className={styles.payPickerLabel}>Medio de pago</p>
                  <div className={styles.payGrid} role="radiogroup" aria-label="Medio de pago">
                    {PAYMENT_METHODS.map(m => {
                      const active = m.value === selected.paymentMethod && !selected.payments;
                      return (
                        <button
                          key={m.value}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          disabled={!!busy}
                          className={`${styles.payOpt} ${active ? styles.payOptActive : ''}`}
                          onClick={() => changePayment(m.value)}
                        >
                          <span className={styles.payOptName}>{m.label}{m.discountPct ? ` −${m.discountPct}%` : ''}</span>
                          <span className="num">{formatMoney(totalWith(m))}</span>
                        </button>
                      );
                    })}
                  </div>
                  {splitting ? (
                    <SplitPayment
                      order={selected}
                      totalFor={(value) => totalWith(paymentMethodInfo(value))}
                      saving={busy === 'payment'}
                      onSave={saveSplit}
                      onCancel={() => setSplitting(false)}
                    />
                  ) : (
                    <button type="button" className={`btn btn-ghost btn-sm ${styles.splitBtn}`} disabled={!!busy} onClick={() => setSplitting(true)}>
                      {selected.payments ? 'Editar pago dividido' : 'Dividir el pago en varios medios'}
                    </button>
                  )}
                </div>
              )}
              {selected.payments && !splitting && (
                <div className={styles.splitSummary}>
                  <p className={styles.payPickerLabel}>Pago dividido · a Odoo va {method.label}</p>
                  <ul>
                    {selected.payments.map(p => (
                      <li key={p.method}><span>{paymentMethodInfo(p.method).label}</span><span className="num">{formatMoney(p.amount)}</span></li>
                    ))}
                  </ul>
                  {splitMismatch && (
                    <Notice kind="error">
                      Los pagos suman {formatMoney(splitPaid)} y el total es {formatMoney(breakdown.total)}: corregí los montos antes de confirmar.
                    </Notice>
                  )}
                </div>
              )}
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
                <span>{editable ? 'A cobrar' : confirmed ? 'Cobrado' : 'Total'} <span className={styles.chargeMethod}>{selected.payments ? 'en varios medios' : `con ${method.label}`}</span></span>
                <span className="num">{formatMoney(breakdown.total)}</span>
              </div>

              {editable && (
                <div className={styles.actions}>
                  <button className="btn btn-danger btn-lg" onClick={handleCancel} disabled={!!busy}>Cancelar pedido</button>
                  <button className={`btn btn-primary btn-lg ${styles.confirmBtn}`} onClick={handleConfirm} disabled={!!busy || cashOpen === false || splitMismatch || splitting}>
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
  // 'buscar' o el nivel de rebaja (1, 2, 3) para ver todo lo que la tiene activa.
  const [view, setView] = useState('buscar');
  const [counts, setCounts] = useState({ 1: 0, 2: 0, 3: 0 });
  const searchTimeout = useRef(null);

  const loadRebajas = useCallback(async (level) => {
    try {
      const data = await apiFetch(`/api/feria/products/rebajas${level ? `?level=${level}` : ''}`);
      setCounts(data.counts);
      if (level) setResults(data.products);
    } catch (err) {
      setNotice({ kind: 'error', text: `No se pudieron cargar las rebajas: ${err.message}` });
    }
  }, []);

  useEffect(() => { loadRebajas(null); }, [loadRebajas]);

  function changeView(next) {
    setView(next);
    setNotice({ kind: '', text: '' });
    setResults([]);
    if (next === 'buscar') setQuery('');
    else loadRebajas(next);
  }

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

  async function setRebaja(sku, condition, level, price) {
    setSaving(sku + condition);
    setNotice({ kind: '', text: '' });
    try {
      const { product } = await apiFetch(`/api/feria/products/${sku}/rebaja`, {
        method: 'PATCH', body: JSON.stringify({ condition, level, ...(price != null ? { price } : {}) }),
      });
      // La tarjeta se queda a la vista aunque ya no esté en el filtro (se ve
      // el cambio); los contadores sí se actualizan.
      setResults(prev => prev.map(p => p.sku === sku ? { ...p, condiciones: product.condiciones } : p));
      loadRebajas(null);
      setNotice({ kind: 'success', text: `${product.modelo} (${CONDITION_LABELS[condition]}): ${REBAJA_LABELS[level]} activa, ${formatMoney(product.condiciones[condition].precioTabla)}.` });
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
    } finally {
      setSaving('');
    }
  }

  return (
    <div className={styles.rebajas}>
      <div className={styles.rebajaFilters} role="tablist" aria-label="Qué ver">
        <button type="button" role="tab" aria-selected={view === 'buscar'}
          className={`${styles.rebajaFilter} ${view === 'buscar' ? styles.rebajaFilterActive : ''}`} onClick={() => changeView('buscar')}>
          Buscar producto
        </button>
        {[1, 2, 3].map(level => (
          <button key={level} type="button" role="tab" aria-selected={view === level}
            className={`${styles.rebajaFilter} ${view === level ? styles.rebajaFilterActive : ''}`} onClick={() => changeView(level)}>
            En {REBAJA_LABELS[level]}{level === MANUAL_LEVEL ? ' (manual)' : ''} <span className="num">{counts[level]}</span>
          </button>
        ))}
      </div>
      {view === 'buscar' ? (
        <div className="field">
          <label className={styles.rebajasLabel} htmlFor="rebaja-search">Cambiar la rebaja de un producto</label>
          <input id="rebaja-search" className={`input ${styles.rebajasSearch}`} value={query}
            onChange={(e) => handleQueryChange(e.target.value)} placeholder="SKU o modelo, mínimo 6 caracteres" autoComplete="off" />
        </div>
      ) : results.length === 0 && (
        <EmptyState title={`Nada en ${REBAJA_LABELS[view]}`}>Ningún producto tiene esta rebaja activa.</EmptyState>
      )}
      <Notice kind={notice.kind || 'info'} onClose={() => setNotice({ kind: '', text: '' })}>{notice.text}</Notice>
      {results.map(p => (
        <article key={p.sku} className={styles.rebajaCard}>
          <div className={styles.rebajaHead}>
            <ProductPhoto sku={p.sku} alt={p.modelo} size={72} />
            <div>
              <h3 className={styles.rebajaName}>{p.modelo}</h3>
              <p className={styles.detailMeta}>{p.sku}{p.color ? ` · ${p.color.trim()}` : ''}</p>
            </div>
          </div>
          {['falla', 'discontinuo'].map(condition => p.condiciones[condition].disponible && (
            <div key={condition} className={`${styles.rebajaSection} cond-${condition}`}>
              <p className={styles.rebajaCondition}>
                <ConditionChip condition={condition} large /> vigente <span className="num">{formatMoney(p.condiciones[condition].precioTabla)}</span>
              </p>
              {/* Cada nivel muestra lo que paga el cliente con cada medio de
                  pago: se elige la rebaja sabiendo el precio final. */}
              <div className={styles.levelCards} role="radiogroup" aria-label={`Rebaja ${CONDITION_LABELS[condition]}`}>
                {(p.condiciones[condition].niveles ?? []).filter(n => n.level !== MANUAL_LEVEL).map(n => {
                  const active = p.condiciones[condition].rebajaActiva === n.level;
                  return (
                    <button
                      key={n.level}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      disabled={saving === p.sku + condition}
                      className={`${styles.levelCard} ${active ? styles.levelCardActive : ''}`}
                      onClick={() => !active && setRebaja(p.sku, condition, n.level)}
                    >
                      <span className={styles.levelName}>{REBAJA_LABELS[n.level]}{active ? ' · activa' : ''}</span>
                      <span className={`num ${styles.levelPrice}`}>{formatMoney(n.precioTabla)}</span>
                      <span className={styles.levelPays}>
                        <span>Transferencia <b className="num">{formatMoney(n.precios.transferencia)}</b></span>
                        <span>Efectivo <b className="num">{formatMoney(n.precios.efectivo)}</b></span>
                        <span>Mercado Pago <b className="num">{formatMoney(n.precios.mercadopago)}</b></span>
                      </span>
                    </button>
                  );
                })}
                <ManualRebajaCard
                  key={`${p.sku}-${condition}-${p.condiciones[condition].precioManual ?? ''}`}
                  info={p.condiciones[condition]}
                  saving={saving === p.sku + condition}
                  onSave={(price) => setRebaja(p.sku, condition, MANUAL_LEVEL, price)}
                />
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
  { value: 'caja', label: 'Caja del día' },
  { value: 'entregas', label: 'Entregas' },
  { value: 'historial', label: 'Historial' },
  { value: 'estadisticas', label: 'Estadísticas' },
  { value: 'rebajas', label: 'Rebajas' },
];
// Solo el super admin administra usuarios.
const SUPERADMIN_TABS = [...TABS, { value: 'usuarios', label: 'Usuarios' }];

export default function CajaPanel() {
  const user = getSession('caja')?.profile ?? {};
  const [tab, setTab] = useState('pedidos');
  const [openRequest, setOpenRequest] = useState(null);

  // "Abrir" en el Historial lleva el pedido a la pestaña Pedidos. Un objeto
  // nuevo cada vez: abrir dos veces el mismo pedido también lo vuelve a traer.
  function openFromHistory(order) {
    setOpenRequest({ id: order.id });
    setTab('pedidos');
  }

  // Un usuario de Logística no usa Caja: se lo manda a su panel.
  if (user.adminRole === 'logistica') {
    return (
      <div className={styles.page}>
        <AppHeader panel="caja" userName={user.name} />
        <div className={styles.detail}>
          <EmptyState title="Tu usuario es de Logística">Entrá desde <a href="#/logistica">el panel de Logística</a>.</EmptyState>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <AppHeader panel="caja" userName={user.name} tabs={user.adminRole === 'superadmin' ? SUPERADMIN_TABS : TABS} activeTab={tab} onTabChange={setTab} />
      {tab === 'pedidos' && <PedidosTab openRequest={openRequest} />}
      {tab === 'caja' && <CashView />}
      {/* Caja arranca en "Retiros en depósito feria" (lo que el cliente viene a buscar),
          pero puede ver y marcar todo, igual que Logística. */}
      {tab === 'entregas' && <EntregasView initialFilter="retiros_feria" />}
      {tab === 'historial' && <HistoryView onOpen={openFromHistory} />}
      {tab === 'estadisticas' && <StatsView />}
      {tab === 'rebajas' && <RebajasTab />}
      {tab === 'usuarios' && user.adminRole === 'superadmin' && <UsersView />}
    </div>
  );
}
