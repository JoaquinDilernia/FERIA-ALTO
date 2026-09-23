export const LOCATION_LABELS = { exhibicion: 'Exhibición', rolon: 'Rolón' };

export const DELIVERY_LABELS = {
  ahora: 'Se lleva ahora',
  retira_feria: 'Retira en feria',
  retira_rolon: 'Retira en Rolón',
  envio: 'Envío a domicilio',
};

// Mismo valor que SHIPPING_COST del backend (feriaPricing.mjs): por pedido,
// con IVA, sin descuento por medio de pago.
export const SHIPPING_COST = 10000;

// Estados de línea que todavía tienen stock reservado (falta entregar).
export const RESERVING_STATUSES = ['pendiente', 'enviado_feria'];

// Las fechas llegan como Timestamp de Firestore serializado ({_seconds}) o
// como string ISO según el camino por el que vino el pedido.
export function formatDateTime(value) {
  if (!value) return '';
  const date = value._seconds != null ? new Date(value._seconds * 1000) : new Date(value);
  return date.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function orderTotal(order) {
  const items = order.lines
    .filter(l => l.status !== 'eliminado')
    .reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
  return items + (order.shippingCost || 0);
}
