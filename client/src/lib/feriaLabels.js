export const LOCATION_LABELS = { exhibicion: 'Exhibición', rolon: 'Rolón', fallados: 'Fallados' };

// Misma regla que el backend (feriaLines.mjs): falla sale siempre de
// Fallados, sin control de stock (stock ficticio en Odoo, puede quedar en
// negativo); discontinuo sale de Exhibición o Rolón, con stock controlado.
export const STOCK_LOCATIONS = ['exhibicion', 'rolon'];

export function locationsFor(condition) {
  return condition === 'falla' ? ['fallados'] : STOCK_LOCATIONS;
}

export function controlsStock(location) {
  return STOCK_LOCATIONS.includes(location);
}

export function defaultLocationFor(condition, stock) {
  if (condition === 'falla') return 'fallados';
  return stock?.exhibicion > 0 ? 'exhibicion' : 'rolon';
}

// Discontinuo necesita stock en Exhibición o Rolón; falla se vende siempre.
export function hasDiscontinuoStock(stock) {
  return !!stock && stock.exhibicion + stock.rolon > 0;
}

export const DELIVERY_LABELS = {
  ahora: 'Me llevo ahora (caja)',
  retira_feria: 'Retira en depósito feria',
  retira_rolon: 'Retira en Rolón',
  envio: 'Envío a domicilio',
};

// Mismos medios y porcentajes que PAYMENT_METHODS del backend
// (feriaPricing.mjs). `tone` es el color de su etiqueta.
export const PAYMENT_METHODS = [
  { value: 'transferencia', label: 'Transferencia (Mercado Pago)', discountPct: 15, tone: 'transfer' },
  { value: 'efectivo', label: 'Efectivo', discountPct: 10, tone: 'cash' },
  { value: 'mp_debito', label: 'Tarjeta débito', discountPct: 0, tone: 'mp' },
  { value: 'mp_1_cuota', label: 'Tarjeta crédito 1 cuota', discountPct: 0, tone: 'mp' },
  { value: 'mp_3_cuotas', label: 'Tarjeta crédito 3 cuotas', discountPct: 0, tone: 'mp' },
];

export function paymentMethodInfo(value) {
  return PAYMENT_METHODS.find(m => m.value === value) ?? { value, label: value || 'Sin medio de pago', discountPct: 0, tone: 'neutral' };
}

// Mismo valor que SHIPPING_COST del backend (feriaPricing.mjs): por pedido,
// con IVA, sin descuento por medio de pago.
export const SHIPPING_COST = 25000;
// Producto de envío en Odoo (ODOO_FERIA_SHIPPING_PRODUCT_SKU del backend).
export const SHIPPING_SKU = 'ENV002EX';

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

// Misma regla que validateLineDelivery del backend: "Me llevo ahora" sale de
// Exhibición o Fallados (los dos están en la feria); "Retira en Rolón" y el
// envío a domicilio, solo de Rolón; retira en feria, de cualquier ubicación.
export function deliveryAllowed(delivery, location) {
  if (delivery === 'ahora') return location === 'exhibicion' || location === 'fallados';
  if (delivery === 'retira_rolon' || delivery === 'envio') return location === 'rolon';
  return true;
}

// Condiciones que el vendedor tiene que decirle al cliente.
export const RETIRA_FERIA_HINT = 'Se retira por la feria hasta el sábado 18 hs. Insistí en que se lo lleve ahora: si lo deja, no se asegura que esté igual al retirarlo. Que chequee que quede guardado en el lugar de retiro antes de irse.';
export const SHIPPING_ZONE_HINT = 'Envío a domicilio solo a CABA o GBA, y solo para lo que sale de Rolón.';

export function defaultDeliveryFor(location) {
  return location === 'rolon' ? 'retira_rolon' : 'ahora';
}

// Lee un monto escrito a mano ("20000", "20.000", "20000,50"). null si no es válido.
export function readAmount(text) {
  const raw = String(text).trim().replace(/[$\s]/g, '');
  // Con coma, la coma es decimal y los puntos son de miles; sin coma, los
  // puntos son de miles solo si agrupan de a tres (20.000).
  const clean = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.')
    : /^\d{1,3}(\.\d{3})+$/.test(raw) ? raw.replace(/\./g, '') : raw;
  if (clean === '') return null;
  const n = Number(clean);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Mismo orden que el backend (feriaPricing.mjs): con el pago dividido, a Odoo
// va el medio de mayor costo y ese fija el precio de todo el pedido.
const ODOO_PAYMENT_PRIORITY = ['mp_3_cuotas', 'mp_1_cuota', 'mp_debito', 'transferencia', 'efectivo'];

export function principalPaymentMethod(methods) {
  return ODOO_PAYMENT_PRIORITY.find(m => methods.includes(m)) ?? null;
}
