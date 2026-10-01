// Cola de etiquetas para imprimir. Se llena desde Productos y Rebajas (botón
// "Etiqueta") y se imprime desde la pestaña Etiquetas. Queda guardada en el
// navegador para no perderla al cambiar de pestaña o recargar.
//
// Cada etiqueta es un SKU + condición: el precio es siempre el vigente de esa
// condición (con la rebaja activa), nunca se elige a mano.
import { useSyncExternalStore } from 'react';
import { CONDITION_LABELS, PAYMENT_METHODS } from './feriaLabels.js';

const KEY = 'feria_etiquetas_cola';
const TRANSFER_PCT = PAYMENT_METHODS.find(m => m.value === 'transferencia').discountPct;

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) ?? []; } catch { return []; }
}
let items = load();
const listeners = new Set();

function commit(next) {
  items = next;
  try {
    if (items.length) localStorage.setItem(KEY, JSON.stringify(items));
    else localStorage.removeItem(KEY);
  } catch { /* sin almacenamiento: la cola vive mientras la página esté abierta */ }
  listeners.forEach(l => l());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLabelQueue() {
  return useSyncExternalStore(subscribe, () => items);
}

export const labelKey = (sku, condition) => `${sku}|${condition}`;

// Datos de la etiqueta tomados del producto como lo devuelve la API.
function fromProduct(product, condition) {
  const info = product.condiciones?.[condition];
  return {
    modelo: product.modelo ?? '',
    color: (product.color ?? '').trim(),
    precio: info?.precioTabla ?? 0,
    rebaja: info?.rebajaActiva ?? 0,
    missing: !info?.disponible,
  };
}

export function addLabel(product, condition, qty = 1) {
  const key = labelKey(product.sku, condition);
  const data = fromProduct(product, condition);
  const existing = items.find(i => i.key === key);
  if (existing) commit(items.map(i => i.key === key ? { ...i, ...data, qty: i.qty + qty } : i));
  else commit([...items, { key, sku: product.sku, condition, qty, ...data }]);
}

// Actualiza precio y datos de las etiquetas de ese producto (después de
// cambiar una rebaja o al refrescar la cola).
export function refreshLabelsFrom(product) {
  if (!items.some(i => i.sku === product.sku)) return;
  commit(items.map(i => i.sku === product.sku ? { ...i, ...fromProduct(product, i.condition) } : i));
}

export function markLabelsMissing(sku) {
  commit(items.map(i => i.sku === sku ? { ...i, missing: true } : i));
}

export function setLabelQty(key, qty) {
  commit(items.map(i => i.key === key ? { ...i, qty: Math.max(0, qty) } : i));
}

export function removeLabel(key) {
  commit(items.filter(i => i.key !== key));
}

export function clearLabels() {
  commit([]);
}

export function queuedCount(sku, condition) {
  return items.find(i => i.key === labelKey(sku, condition))?.qty ?? 0;
}

// Etiqueta lista para el motor de impresión (zebraLabels.js).
export function toPrintable(item) {
  return {
    sku: item.sku,
    modelo: item.modelo,
    color: item.color,
    estado: CONDITION_LABELS[item.condition] ?? item.condition,
    precio: item.precio,
    transf: item.precio > 0 ? Math.round(item.precio * (1 - TRANSFER_PCT / 100)) : NaN,
    qty: item.qty,
  };
}
