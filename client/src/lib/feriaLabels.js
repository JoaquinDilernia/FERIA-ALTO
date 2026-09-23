export const LOCATION_LABELS = { exhibicion: 'Exhibición', rolon: 'Rolón' };

export const DELIVERY_LABELS = {
  ahora: 'Se lleva ahora',
  retira_feria: 'Retira en feria',
  retira_rolon: 'Retira en Rolón',
  envio: 'Envío a domicilio',
};

// Mismos medios y porcentajes que PAYMENT_METHODS del backend
// (feriaPricing.mjs). `tone` es el color de su etiqueta.
export const PAYMENT_METHODS = [
  { value: 'transferencia', label: 'Transferencia', discountPct: 15, tone: 'transfer' },
  { value: 'efectivo', label: 'Efectivo', discountPct: 10, tone: 'cash' },
  { value: 'mp_debito', label: 'Mercado Pago Débito', discountPct: 0, tone: 'mp' },
  { value: 'mp_1_cuota', label: 'Mercado Pago 1 cuota', discountPct: 0, tone: 'mp' },
  { value: 'mp_3_cuotas', label: 'Mercado Pago 3 cuotas', discountPct: 0, tone: 'mp' },
];

export function paymentMethodInfo(value) {
  return PAYMENT_METHODS.find(m => m.value === value) ?? { value, label: value || 'Sin medio de pago', discountPct: 0, tone: 'neutral' };
}

// Mismo valor que SHIPPING_COST del backend (feriaPricing.mjs): por pedido,
// con IVA, sin descuento por medio de pago.
export const SHIPPING_COST = 10000;

// Estados de línea que todavía tienen stock reservado (falta entregar).
export const RESERVING_STATUSES = ['pendiente', 'enviado_feria'];

export const LINE_STATUS = {
  pendiente: { label: 'Pendiente', tone: 'pending' },
  enviado_feria: { label: 'Enviado a feria', tone: 'sent' },
  entregado: { label: 'Entregado', tone: 'done' },
  eliminado: { label: 'Eliminado', tone: 'removed' },
};

export const ORDER_STATUS = {
  pendiente: { label: 'Por confirmar', tone: 'pending' },
  error: { label: 'Falló al confirmar', tone: 'removed' },
  confirmado: { label: 'Confirmado', tone: 'done' },
  cancelado: { label: 'Cancelado', tone: 'neutral' },
};

export const CONDITION_LABELS = { falla: 'Falla', discontinuo: 'Discontinuo' };

export function formatMoney(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return `$ ${Math.round(value).toLocaleString('es-AR')}`;
}

// Las fechas llegan como Timestamp de Firestore serializado ({_seconds}) o
// como string ISO según el camino por el que vino el pedido.
export function formatDateTime(value) {
  if (!value) return '';
  const date = value._seconds != null ? new Date(value._seconds * 1000) : new Date(value);
  return date.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function formatTime(value) {
  if (!value) return '';
  const date = value._seconds != null ? new Date(value._seconds * 1000) : new Date(value);
  return date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

// Desglose del total de un pedido: precio de lista, descuento del medio de
// pago, envío y total cobrado. Las líneas eliminadas no suman.
export function orderBreakdown(order) {
  const active = order.lines.filter(l => l.status !== 'eliminado');
  const total = active.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
  const list = active.reduce((sum, l) => sum + l.qty * (l.listPrice ?? l.unitPrice), 0);
  const shipping = order.shippingCost || 0;
  return { list, discount: list - total, shipping, total: total + shipping };
}

export function orderTotal(order) {
  return orderBreakdown(order).total;
}

// Misma regla que validateLineDelivery del backend: "Se lleva ahora" sale de
// Exhibición y "Retira en Rolón" sale de Rolón; retira en feria y envío,
// de cualquiera de las dos.
export function deliveryAllowed(delivery, location) {
  if (delivery === 'ahora') return location === 'exhibicion';
  if (delivery === 'retira_rolon') return location === 'rolon';
  return true;
}

export function defaultDeliveryFor(location) {
  return location === 'exhibicion' ? 'ahora' : 'retira_rolon';
}
