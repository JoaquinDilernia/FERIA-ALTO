# Feria — Stock, reserva, entrega por línea, Logística e IVA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Precios sin IVA hacia Odoo, stock en vivo por ubicación con reserva en la app, forma de entrega por línea (con envío a domicilio y validación parcial del remito en Odoo 16), acciones de Caja sobre líneas y un panel de Logística.

**Architecture:** La lógica de negocio va en funciones **puras** (validación de líneas, máquina de estados de línea, deltas de reserva, disponibilidad, armado de payloads) testeadas con `node:test`; la E/S (Firestore en transacciones, Odoo por JSON-RPC) queda en wrappers finos. Las reservas viven en una colección `feria_reservations` (un doc por SKU+ubicación) que se modifica siempre en una transacción de Firestore junto con el pedido. El frontend comparte un componente `OrderLines` entre Caja y Logística.

**Tech Stack:** Node 22 ESM + Express 4 + firebase-admin 12 + Odoo 16 JSON-RPC (backend); React 18 + Vite 5 + CSS modules (frontend); `node:test` + `node:assert/strict`.

**Spec:** `feria-alto/docs/superpowers/specs/2026-09-23-feria-stock-entrega-design.md` (leerlo antes de cada tarea).

**Rutas de trabajo:**
- `BACKEND` = `Reportes/.worktrees/feature-feria-outlet/backend` (rama `feature/feria-outlet`; es el backend productivo de Reportes, trabajar solo en este worktree).
- `CLIENT` = `feria-alto/client` (rama `master`).
- Tests backend: `cd BACKEND && npm test` (corre `node --test test/**/*.test.mjs`). Hoy: 118 tests pasando.
- Frontend no tiene tests: se verifica con `cd CLIENT && npm run build` + prueba manual.

## Global Constraints

- **Sin índices compuestos de Firestore:** ninguna query combina `where` + `orderBy` en campos distintos; se filtra con un `where` simple y se ordena/filtra en código.
- IVA: `IVA_RATE = 0.21`; `price_unit` a Odoo = precio con IVA / 1.21 redondeado a 2 decimales. Los precios en la app se siguen mostrando con IVA.
- Envío: `SHIPPING_COST = 10000` por pedido, sin descuento por medio de pago; producto Odoo "Otros envíos terciarizados" (buscado por nombre, variable `ODOO_FERIA_SHIPPING_PRODUCT_NAME`).
- Odoo: almacén Feria id 43 (`ODOO_FERIA_WAREHOUSE_ID=43`), `FER/Stock/exhibicion` id 427 (`ODOO_FERIA_LOCATION_EXHIBICION_ID=427`), `FER/Stock/Rolon` id 428 (`ODOO_FERIA_LOCATION_ROLON_ID=428`).
- Disponible(sku, ubicación) = `stock.quant.quantity` en la ubicación − `reserved` de la app, nunca negativo. Se ignora `reserved_quantity` de Odoo.
- Sin stock suficiente en la ubicación, o Odoo sin responder (`stock: null`) → no se puede agregar/crear la línea.
- Ubicaciones: `exhibicion` · `rolon`. Entregas: `ahora` · `retira_feria` · `retira_rolon` · `envio`. Estados de línea: `pendiente` · `enviado_feria` · `entregado` · `eliminado`. `ahora` exige `exhibicion`.
- Una línea reserva stock mientras su estado es `pendiente` o `enviado_feria`.
- El usuario de la API de Odoo **no** tiene acceso a `stock.backorder.confirmation` ni `stock.immediate.transfer`: toda validación de remito va por `button_validate` con contexto `skip_backorder: true, skip_immediate: true, skip_sms: true, skip_expired: true`.
- Nunca exponer stock en `/api/feria/public/*`.
- Comentarios y textos de UI en español, con el estilo de los archivos existentes (comentarios que explican el *por qué*).
- Commits terminan con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Toda escritura real contra Odoo fuera de los tests (spike, prueba punta a punta) requiere OK explícito del usuario antes de correrla.

## Review Focus

1. **"Hecho" repetido después de un corte a mitad de camino** (Odoo validó pero Firestore no se actualizó): el segundo "Hecho" no debe fallar ni duplicar nada; el move ya `done` se trata como entregado y la línea pasa a `entregado`. → test en Task 2 (`alreadyDone`) y Task 6 (ruta usa `alreadyDone` como éxito).
2. **Mismo SKU dos veces en el mismo pedido y misma ubicación**: las cantidades se suman contra un único disponible; no se puede reservar 2 teniendo 1. → test en Task 5.
3. **`default_code` de Odoo en minúsculas/mixto** vs SKUs en mayúsculas de la app: el stock tiene que aparecer igual. → test en Task 4.
4. **Pedidos viejos en Firestore sin `lineId`/`status`/`delivery`** (los 2 de prueba ya confirmados): el panel de Logística y la lista de Caja no deben romperse ni mostrarlos como pendientes. → test en Task 6 (`hasPendingDeliveries` con pedido legacy).
5. **Mover una línea a una ubicación sin stock desde Caja**: se rechaza con mensaje claro y la reserva no cambia; liberar reserva (deltas negativos) nunca se bloquea por falta de stock. → test en Task 5 (`checkAvailability` ignora deltas ≤ 0).

---

## File Structure

**Backend (`BACKEND`)**

| Archivo | Responsabilidad |
|---|---|
| `feriaPricing.mjs` (mod) | + `IVA_RATE`, `SHIPPING_COST`, `netOfIva`; `odooLinePricing` devuelve precio sin IVA |
| `feriaLines.mjs` (nuevo) | Puro: constantes de ubicación/entrega/estado, validación de línea y envío, máquina de estados de línea, reglas por estado de pedido, deltas de reserva, `hasPendingDeliveries` |
| `feriaStock.mjs` (nuevo) | Stock Odoo por ubicación (`fetchOdooStock`), reservas en Firestore (leer/escribir en transacción), disponibilidad (puro) |
| `feriaDelivery.mjs` (nuevo) | Validación parcial de remito en Odoo (`deliverLines`) + planificador puro `planMoveLineWrites` |
| `feriaConfirm.mjs` (nuevo) | Orquestación de confirmar pedido (`confirmOrder`) + puros `buildOdooLines`, `pairOdooLineIds` |
| `feriaOdoo.mjs` (mod) | exporta `ensureAuth`/`callKwReadWithRetry`; payload con almacén/envío; partner de envío; producto de envío; ids de líneas |
| `feriaOrders.mjs` (mod) | `createOrder` con reserva en transacción; acciones de línea; cancelar; lista de logística; guardar ids de Odoo |
| `feriaRoutes.mjs` (mod) | stock en búsqueda; rutas nuevas; confirm usa `confirmOrder` |
| `scripts/feriaDeliverySpike.mjs` (nuevo) | Spike manual contra Odoo real (Task 2) |
| `.env.example` (mod) | variables nuevas |

**Frontend (`CLIENT/src`)**

| Archivo | Responsabilidad |
|---|---|
| `lib/feriaLabels.js` (nuevo) | Etiquetas, `SHIPPING_COST`, `formatDateTime`, `orderTotal` |
| `components/OrderLines.jsx` + `.module.css` (nuevo) | Tabla de líneas con estado, selects de edición y botones de acción |
| `components/EntregasView.jsx` + `.module.css` (nuevo) | Vista de entregas con filtros (Retiros en feria / Mandar a feria / Retiro en Rolón / Envío) — la usan Caja y Logística |
| `pages/VendedorPanel.jsx` + css (mod) | Stock, ubicación y entrega por línea, datos de envío |
| `pages/CajaPanel.jsx` (mod) | Detalle con acciones de línea, cancelar, stock en vivo; pestaña "Entregas" |
| `pages/LogisticaPanel.jsx` (nuevo) | Ruta `/logistica` |
| `App.jsx` (mod) | ruta `/logistica` |

---

### Task 1: IVA — precio sin IVA hacia Odoo

**Files:**
- Modify: `BACKEND/feriaPricing.mjs`
- Test: `BACKEND/test/feriaPricing.test.mjs`

**Interfaces:**
- Produces: `IVA_RATE` (0.21), `SHIPPING_COST` (10000), `netOfIva(price: number): number`, `odooLinePricing(line, paymentMethod) → { unitPrice: number /* sin IVA */, discountPct: number }`.

- [ ] **Step 1: Actualizar los tests existentes de `odooLinePricing` y agregar los nuevos**

En `test/feriaPricing.test.mjs`, cambiar la línea 3 por:

```js
import { PAYMENT_METHODS, tablePrice, computeFinalPrice, odooLinePricing, netOfIva, IVA_RATE, SHIPPING_COST } from '../feriaPricing.mjs';
```

Reemplazar los tests `'odooLinePricing manda el precio de tabla completo y el descuento del medio de pago aparte'` y `'odooLinePricing reconstruye el precio de tabla en pedidos viejos sin listPrice'` por:

```js
test('netOfIva saca el 21% y redondea a centavos', () => {
  assert.equal(IVA_RATE, 0.21);
  assert.equal(netOfIva(9990), 8256.2);
  assert.equal(netOfIva(10000), 8264.46);
});

test('SHIPPING_COST es 10000', () => {
  assert.equal(SHIPPING_COST, 10000);
});

test('odooLinePricing manda el precio de tabla SIN IVA y el descuento del medio de pago aparte', () => {
  assert.deepEqual(
    odooLinePricing({ listPrice: 9990, unitPrice: 7992 }, 'transferencia'),
    { unitPrice: 8256.2, discountPct: 20 },
  );
  assert.deepEqual(
    odooLinePricing({ listPrice: 9990, unitPrice: 9990 }, 'cuotas'),
    { unitPrice: 8256.2, discountPct: 0 },
  );
});

test('odooLinePricing reconstruye el precio de tabla en pedidos viejos sin listPrice', () => {
  assert.deepEqual(
    odooLinePricing({ unitPrice: 7992 }, 'transferencia'),
    { unitPrice: 8256.2, discountPct: 20 },
  );
});

test('con el precio sin IVA, el total que calcula Odoo vuelve a dar el precio que paga el cliente', () => {
  const { unitPrice, discountPct } = odooLinePricing({ listPrice: 9990, unitPrice: 7992 }, 'transferencia');
  const subtotal = Math.round(unitPrice * (1 - discountPct / 100) * 100) / 100;
  assert.equal(Math.round(subtotal * (1 + IVA_RATE) * 100) / 100, 7992);
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `cd BACKEND && node --test test/feriaPricing.test.mjs`
Expected: FAIL (`netOfIva` no exportado / `unitPrice` 9990 ≠ 8256.2).

- [ ] **Step 3: Implementar**

En `feriaPricing.mjs`, después de `const CONDITIONS = ...` agregar:

```js
// Todos los productos de la feria tienen "IVA 21% Ventas" en Odoo con el
// impuesto NO incluido en el precio: si mandáramos el precio de la tabla
// (que ya incluye IVA) Odoo le sumaría el 21% arriba. Por eso a Odoo viaja
// el precio neto y Odoo recompone el total que paga el cliente.
export const IVA_RATE = 0.21;

// Cargo fijo de envío a domicilio, por pedido, con IVA incluido y sin
// descuento por medio de pago.
export const SHIPPING_COST = 10000;

export function netOfIva(price) {
  return Math.round((price / (1 + IVA_RATE)) * 100) / 100;
}
```

Y reemplazar el cuerpo de `odooLinePricing` (y su comentario) por:

```js
// Precio y descuento de una línea tal como viajan a Odoo: price_unit es el
// precio de tabla completo (condición + rebaja, SIN el descuento del medio de
// pago) y SIN IVA — Odoo agrega el impuesto — y el descuento del medio de
// pago va en el campo discount de la línea.
// Los pedidos creados antes de guardar listPrice solo tienen el unitPrice ya
// descontado: se reconstruye el precio de tabla deshaciendo el porcentaje.
export function odooLinePricing(line, paymentMethod) {
  const method = PAYMENT_METHODS[paymentMethod];
  if (!method) throw new Error(`Método de pago inválido: ${paymentMethod}`);
  const grossListPrice = line.listPrice ?? Math.round(line.unitPrice / (1 - method.discountPct / 100));
  return { unitPrice: netOfIva(grossListPrice), discountPct: method.discountPct };
}
```

- [ ] **Step 4: Correr toda la suite**

Run: `cd BACKEND && npm test`
Expected: PASS, 0 fail.

- [ ] **Step 5: Commit**

```bash
cd BACKEND && git add feriaPricing.mjs test/feriaPricing.test.mjs && git commit -m "feat(feria): precio unitario sin IVA hacia Odoo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `deliverLines` — validación parcial del remito + spike real

**Files:**
- Modify: `BACKEND/feriaOdoo.mjs` (exportar `ensureAuth` y `callKwReadWithRetry`)
- Create: `BACKEND/feriaDelivery.mjs`
- Create: `BACKEND/scripts/feriaDeliverySpike.mjs`
- Test: `BACKEND/test/feriaDelivery.test.mjs`

**Interfaces:**
- Consumes: `callKw` de `odoo.mjs`; `ensureAuth`, `callKwReadWithRetry` de `feriaOdoo.mjs`.
- Produces:
  - `planMoveLineWrites({ moves, moveLines, items, openPickingIds }) → { writes: [{id, vals}], creates: [vals], pickingIdsToValidate: number[], alreadyDone: number[], missing: number[] }`
  - `deliverLines(odooOrderId: number, items: [{ odooLineId: number, qty: number, locationId: number }]) → Promise<{ delivered: number[], alreadyDone: number[] }>` (ids de `sale.order.line`).

- [ ] **Step 1: Exportar los helpers de auth de `feriaOdoo.mjs`**

En `feriaOdoo.mjs` cambiar `async function ensureAuth()` por `export async function ensureAuth()` y `async function callKwReadWithRetry(` por `export async function callKwReadWithRetry(`. Nada más.

- [ ] **Step 2: Escribir los tests del planificador**

Crear `test/feriaDelivery.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planMoveLineWrites } from '../feriaDelivery.mjs';

const EXHIB = 427;
const ROLON = 428;

// Remito 900 abierto con dos movimientos: línea de venta 11 (reservada en
// Rolón por Odoo) y línea 12 (reservada en exhibición).
const moves = [
  { id: 1, sale_line_id: [11, 'x'], picking_id: [900, 'WH/OUT/1'], product_id: [501, 'A'], product_uom: [1, 'u'], location_dest_id: [5, 'Clientes'], state: 'assigned' },
  { id: 2, sale_line_id: [12, 'x'], picking_id: [900, 'WH/OUT/1'], product_id: [502, 'B'], product_uom: [1, 'u'], location_dest_id: [5, 'Clientes'], state: 'assigned' },
];
const moveLines = [
  { id: 101, move_id: [1, 'm'], location_id: [ROLON, 'Rolon'], qty_done: 0 },
  { id: 102, move_id: [2, 'm'], location_id: [EXHIB, 'exhib'], qty_done: 0 },
];

test('marca la cantidad hecha en la move line que ya está en la ubicación pedida', () => {
  const plan = planMoveLineWrites({ moves, moveLines, items: [{ odooLineId: 12, qty: 1, locationId: EXHIB }], openPickingIds: [900] });
  assert.deepEqual(plan.writes, [{ id: 102, vals: { qty_done: 1 } }]);
  assert.deepEqual(plan.creates, []);
  assert.deepEqual(plan.pickingIdsToValidate, [900]);
  assert.deepEqual(plan.missing, []);
  assert.deepEqual(plan.alreadyDone, []);
});

test('si Odoo reservó en otra ubicación, crea una move line en la ubicación pedida', () => {
  const plan = planMoveLineWrites({ moves, moveLines, items: [{ odooLineId: 11, qty: 1, locationId: EXHIB }], openPickingIds: [900] });
  assert.deepEqual(plan.creates, [{
    move_id: 1, picking_id: 900, product_id: 501, product_uom_id: 1,
    location_id: EXHIB, location_dest_id: 5, qty_done: 1,
  }]);
  assert.deepEqual(plan.writes, []);
});

test('pone en 0 cualquier qty_done previa que no corresponda a lo que se entrega', () => {
  const dirty = [
    { id: 101, move_id: [1, 'm'], location_id: [ROLON, 'Rolon'], qty_done: 1 },
    { id: 102, move_id: [2, 'm'], location_id: [EXHIB, 'exhib'], qty_done: 0 },
  ];
  const plan = planMoveLineWrites({ moves, moveLines: dirty, items: [{ odooLineId: 12, qty: 1, locationId: EXHIB }], openPickingIds: [900] });
  assert.deepEqual(plan.writes, [
    { id: 102, vals: { qty_done: 1 } },
    { id: 101, vals: { qty_done: 0 } },
  ]);
});

test('una línea cuyo movimiento ya está hecho vuelve como alreadyDone, no como error', () => {
  const doneMoves = [{ ...moves[0], state: 'done', picking_id: [899, 'WH/OUT/0'] }, moves[1]];
  const plan = planMoveLineWrites({ moves: doneMoves, moveLines, items: [{ odooLineId: 11, qty: 1, locationId: EXHIB }], openPickingIds: [900] });
  assert.deepEqual(plan.alreadyDone, [11]);
  assert.deepEqual(plan.writes, []);
  assert.deepEqual(plan.creates, []);
  assert.deepEqual(plan.pickingIdsToValidate, []);
});

test('una línea sin movimiento en ningún remito abierto vuelve como missing', () => {
  const plan = planMoveLineWrites({ moves, moveLines, items: [{ odooLineId: 99, qty: 1, locationId: EXHIB }], openPickingIds: [900] });
  assert.deepEqual(plan.missing, [99]);
});
```

- [ ] **Step 3: Correr y ver que fallan**

Run: `cd BACKEND && node --test test/feriaDelivery.test.mjs`
Expected: FAIL (`Cannot find module '../feriaDelivery.mjs'`).

- [ ] **Step 4: Implementar `feriaDelivery.mjs`**

```js
import { callKw } from './odoo.mjs';
import { ensureAuth, callKwReadWithRetry } from './feriaOdoo.mjs';

// Contexto para validar un remito sin abrir asistentes: el usuario de la API
// no tiene acceso a stock.backorder.confirmation ni a
// stock.immediate.transfer. En Odoo 16, con skip_backorder (y sin
// picking_ids_not_to_backorder) button_validate valida lo marcado como hecho
// y crea el remito pendiente (backorder) con el resto, sin preguntar.
const VALIDATE_CONTEXT = {
  lang: 'es_AR', skip_backorder: true, skip_immediate: true, skip_sms: true, skip_expired: true,
};

// Decide qué escribir en las stock.move.line para que al validar salga
// EXACTAMENTE lo pedido (cantidad y ubicación de origen) y nada más.
// Puro para poder testearlo sin Odoo.
export function planMoveLineWrites({ moves, moveLines, items, openPickingIds }) {
  const open = new Set(openPickingIds);
  const writes = [];
  const creates = [];
  const alreadyDone = [];
  const missing = [];
  const pickingIds = new Set();
  const targetedMoveLineIds = new Set();

  for (const item of items) {
    const forLine = moves.filter((m) => m.sale_line_id?.[0] === item.odooLineId && m.state !== 'cancel');
    const openMove = forLine.find((m) => m.state !== 'done' && open.has(m.picking_id?.[0]));
    if (!openMove) {
      if (forLine.some((m) => m.state === 'done')) alreadyDone.push(item.odooLineId);
      else missing.push(item.odooLineId);
      continue;
    }
    pickingIds.add(openMove.picking_id[0]);
    const atLocation = moveLines.find((ml) => ml.move_id[0] === openMove.id && ml.location_id[0] === item.locationId);
    if (atLocation) {
      writes.push({ id: atLocation.id, vals: { qty_done: item.qty } });
      targetedMoveLineIds.add(atLocation.id);
    } else {
      creates.push({
        move_id: openMove.id,
        picking_id: openMove.picking_id[0],
        product_id: openMove.product_id[0],
        product_uom_id: openMove.product_uom[0],
        location_id: item.locationId,
        location_dest_id: openMove.location_dest_id[0],
        qty_done: item.qty,
      });
    }
  }

  // Cualquier qty_done que haya quedado de antes (alguien tocó el remito a
  // mano, o un intento anterior cortado) saldría validada junto con esto.
  for (const ml of moveLines) {
    if (!targetedMoveLineIds.has(ml.id) && ml.qty_done > 0) writes.push({ id: ml.id, vals: { qty_done: 0 } });
  }

  return { writes, creates, pickingIdsToValidate: [...pickingIds], alreadyDone, missing };
}

// Marca como entregadas (salida al cliente) esas líneas del pedido de Odoo,
// desde la ubicación indicada, y valida el remito. Lo no incluido queda en el
// remito pendiente. Es seguro llamarla de nuevo: lo que ya estaba hecho
// vuelve en alreadyDone en vez de fallar.
export async function deliverLines(odooOrderId, items) {
  const pickings = await callKwReadWithRetry('stock.picking', 'search_read', [
    [['sale_id', '=', odooOrderId], ['state', 'not in', ['done', 'cancel']], ['picking_type_code', '=', 'outgoing']],
  ], { fields: ['id'] });
  const openPickingIds = pickings.map((p) => p.id);

  const moves = await callKwReadWithRetry('stock.move', 'search_read', [
    [['sale_line_id', 'in', items.map((i) => i.odooLineId)], ['state', '!=', 'cancel']],
  ], { fields: ['id', 'sale_line_id', 'picking_id', 'product_id', 'product_uom', 'location_dest_id', 'state'] });

  const moveLines = openPickingIds.length
    ? await callKwReadWithRetry('stock.move.line', 'search_read', [
      [['picking_id', 'in', openPickingIds]],
    ], { fields: ['id', 'move_id', 'location_id', 'qty_done'] })
    : [];

  const plan = planMoveLineWrites({ moves, moveLines, items, openPickingIds });
  if (plan.missing.length) {
    throw new Error(`Líneas sin remito abierto en Odoo: ${plan.missing.join(', ')}`);
  }

  await ensureAuth();
  for (const w of plan.writes) await callKw('stock.move.line', 'write', [[w.id], w.vals]);
  for (const vals of plan.creates) await callKw('stock.move.line', 'create', [[vals]]);
  for (const pickingId of plan.pickingIdsToValidate) {
    const result = await callKw('stock.picking', 'button_validate', [[pickingId]], { context: VALIDATE_CONTEXT });
    if (result !== true && result?.res_model) {
      throw new Error(`Odoo pidió confirmación manual (${result.res_model}) al validar el remito ${pickingId}`);
    }
  }

  const alreadyDone = new Set(plan.alreadyDone);
  return {
    delivered: items.map((i) => i.odooLineId).filter((id) => !alreadyDone.has(id)),
    alreadyDone: plan.alreadyDone,
  };
}
```

- [ ] **Step 5: Correr los tests**

Run: `cd BACKEND && npm test`
Expected: PASS.

- [ ] **Step 6: Escribir el script de spike**

Crear `scripts/feriaDeliverySpike.mjs`:

```js
// Spike manual (Task 2 del plan 2026-09-23): prueba deliverLines contra el
// Odoo REAL. Mueve stock de verdad. Correr solo con OK del usuario.
//
// Sin argumentos: lista qué hay en FER/Stock/exhibicion y FER/Stock/Rolon.
// Con dos SKUs:   node scripts/feriaDeliverySpike.mjs <SKU_EXHIBICION> <SKU_ROLON>
//   1. crea un sale.order (partner 77753, almacén Feria) con 1 u. de cada SKU
//   2. lo confirma
//   3. entrega el primero desde exhibición → espera remito done + backorder
//   4. entrega el segundo desde Rolón     → espera backorder done
import 'dotenv/config';
import { authenticate, callKw } from '../odoo.mjs';
import { deliverLines } from '../feriaDelivery.mjs';

const EXHIB = Number(process.env.ODOO_FERIA_LOCATION_EXHIBICION_ID || 427);
const ROLON = Number(process.env.ODOO_FERIA_LOCATION_ROLON_ID || 428);
const WAREHOUSE = Number(process.env.ODOO_FERIA_WAREHOUSE_ID || 43);
const TEST_PARTNER = 77753; // "Altorancho Nordelta" — cliente de prueba acordado

async function showPickings(orderId) {
  const pickings = await callKw('stock.picking', 'search_read', [[['sale_id', '=', orderId]]], {
    fields: ['name', 'state', 'backorder_id', 'move_ids'],
  });
  for (const p of pickings) {
    const moves = await callKw('stock.move', 'read', [p.move_ids], { fields: ['product_id', 'product_uom_qty', 'quantity_done', 'state'] });
    console.log(`  ${p.name} [${p.state}] backorder_de=${p.backorder_id ? p.backorder_id[1] : '-'}`);
    for (const m of moves) console.log(`     ${m.product_id[1]} pedido=${m.product_uom_qty} hecho=${m.quantity_done} ${m.state}`);
  }
}

await authenticate();
const [skuA, skuB] = process.argv.slice(2);

if (!skuA || !skuB) {
  const quants = await callKw('stock.quant', 'search_read', [[['location_id', 'in', [EXHIB, ROLON]], ['quantity', '>', 0]]], {
    fields: ['product_id', 'location_id', 'quantity'],
  });
  for (const q of quants) console.log(`${q.location_id[1]}  ${q.product_id[1]}  qty=${q.quantity}`);
  process.exit(0);
}

async function productId(sku) {
  const [p] = await callKw('product.product', 'search_read', [[['default_code', '=ilike', sku]]], { fields: ['id'], limit: 1 });
  if (!p) throw new Error(`SKU no encontrado: ${sku}`);
  return p.id;
}

const orderId = (await callKw('sale.order', 'create', [[{
  partner_id: TEST_PARTNER,
  warehouse_id: WAREHOUSE,
  order_line: [
    [0, 0, { product_id: await productId(skuA), product_uom_qty: 1 }],
    [0, 0, { product_id: await productId(skuB), product_uom_qty: 1 }],
  ],
}]]))[0];
await callKw('sale.order', 'action_confirm', [[orderId]]);
const [order] = await callKw('sale.order', 'read', [[orderId]], { fields: ['name', 'order_line'] });
console.log(`Pedido ${order.name} (id ${orderId}) confirmado. Remitos:`);
await showPickings(orderId);

console.log(`\n→ Entregando ${skuA} desde exhibición`);
console.log(await deliverLines(orderId, [{ odooLineId: order.order_line[0], qty: 1, locationId: EXHIB }]));
await showPickings(orderId);

console.log(`\n→ Entregando ${skuA} otra vez (tiene que volver alreadyDone)`);
console.log(await deliverLines(orderId, [{ odooLineId: order.order_line[0], qty: 1, locationId: EXHIB }]));

console.log(`\n→ Entregando ${skuB} desde Rolón`);
console.log(await deliverLines(orderId, [{ odooLineId: order.order_line[1], qty: 1, locationId: ROLON }]));
await showPickings(orderId);

console.log(`\nListo. Revisar ${order.name} en Odoo y hacer la devolución de las 2 unidades si hace falta.`);
process.exit(0);
```

- [ ] **Step 7: Correr el spike (con OK del usuario)**

Primero, sin argumentos, para elegir SKUs con stock:
Run: `cd BACKEND && node scripts/feriaDeliverySpike.mjs`
Mostrarle la lista al usuario, pedirle OK explícito (mueve 2 unidades reales de stock) y correr:
Run: `cd BACKEND && node scripts/feriaDeliverySpike.mjs <SKU_en_exhibicion> <SKU_en_Rolon>`

Expected:
- Tras la primera entrega: remito original `done` con solo el SKU A hecho, y un remito nuevo con `backorder_de=<original>` que contiene el SKU B pendiente.
- La segunda llamada devuelve `{ delivered: [], alreadyDone: [<id>] }`.
- Tras la tercera: el backorder `done`.
- En Odoo, el SKU A salió de `FER/Stock/exhibicion` y el B de `FER/Stock/Rolon`.

**Si algo de esto no pasa: PARAR y reportar al usuario la salida completa.** Las Tasks 6 y 7 dependen de este comportamiento; puede hacer falta ajustar `planMoveLineWrites`/`VALIDATE_CONTEXT` y re-correr antes de seguir.

- [ ] **Step 8: Commit**

```bash
cd BACKEND && git add feriaOdoo.mjs feriaDelivery.mjs scripts/feriaDeliverySpike.mjs test/feriaDelivery.test.mjs && git commit -m "feat(feria): validación parcial de remitos en Odoo (deliverLines) + spike

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Modelo de línea — validación, estados y deltas de reserva (puro)

**Files:**
- Create: `BACKEND/feriaLines.mjs`
- Modify: `BACKEND/feriaOrders.mjs` (`validateOrderInput`)
- Test: `BACKEND/test/feriaLines.test.mjs`, `BACKEND/test/feriaOrders.test.mjs`

**Interfaces:**
- Produces (todas puras, exportadas de `feriaLines.mjs`):
  - `LOCATIONS: string[]`, `DELIVERIES: string[]`, `RESERVING_STATUSES: Set<string>`
  - `validateLineDelivery(line) → string[]`
  - `validateShipping(shipping) → string[]`
  - `needsShipping(lines) → boolean`
  - `isReserving(line) → boolean`
  - `reservationKey(sku, location) → string` (`"SKU__location"`, SKU en mayúsculas)
  - `parseReservationKey(key) → { sku, location }`
  - `reservationDeltas(beforeLines, afterLines) → Map<key, number>` (sin ceros)
  - `assignLineIds(lines) → lines` con `lineId: 'L1'…` y `status: 'pendiente'`
  - `applyLineAction(line, action, { user, now, changes }) → line` (acciones `remove` · `sendToFeria` · `deliver` · `edit`)
  - `assertLineActionAllowed(order, line, action)` (tira `Error`)
  - `hasPendingDeliveries(order) → boolean`

- [ ] **Step 1: Escribir los tests**

Crear `test/feriaLines.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateLineDelivery, validateShipping, needsShipping, isReserving,
  reservationKey, parseReservationKey, reservationDeltas, assignLineIds,
  applyLineAction, assertLineActionAllowed, hasPendingDeliveries,
} from '../feriaLines.mjs';

const now = new Date('2026-09-23T15:00:00Z');
const base = { lineId: 'L1', sku: 'ALF029CG', qty: 1, location: 'exhibicion', delivery: 'ahora', status: 'pendiente' };

test('validateLineDelivery acepta una línea completa', () => {
  assert.deepEqual(validateLineDelivery(base), []);
});

test('validateLineDelivery rechaza ubicación o entrega inválidas', () => {
  assert.match(validateLineDelivery({ ...base, location: 'deposito' }).join(), /Ubicación inválida/);
  assert.match(validateLineDelivery({ ...base, delivery: 'flete' }).join(), /Forma de entrega inválida/);
});

test('"Se lleva ahora" solo puede salir de Exhibición', () => {
  assert.match(validateLineDelivery({ ...base, location: 'rolon' }).join(), /solo puede salir de Exhibición/);
});

test('validateShipping exige calle, número, localidad, CP y teléfono', () => {
  const ok = { street: 'Av. Siempreviva', number: '742', floor: '', city: 'Tigre', zip: '1648', phone: '1155555555', notes: '' };
  assert.deepEqual(validateShipping(ok), []);
  assert.equal(validateShipping({ ...ok, phone: '  ' }).length, 1);
  assert.equal(validateShipping(undefined).length, 5);
});

test('needsShipping mira solo líneas no eliminadas', () => {
  assert.equal(needsShipping([{ ...base, delivery: 'envio', status: 'eliminado' }]), false);
  assert.equal(needsShipping([{ ...base, delivery: 'envio' }]), true);
});

test('isReserving: pendiente y enviado_feria reservan; entregado, eliminado y líneas viejas sin estado no', () => {
  assert.equal(isReserving({ status: 'pendiente' }), true);
  assert.equal(isReserving({ status: 'enviado_feria' }), true);
  assert.equal(isReserving({ status: 'entregado' }), false);
  assert.equal(isReserving({ status: 'eliminado' }), false);
  assert.equal(isReserving({}), false);
});

test('reservationKey normaliza el SKU a mayúsculas y se puede volver a parsear', () => {
  assert.equal(reservationKey('alf029cg', 'rolon'), 'ALF029CG__rolon');
  assert.deepEqual(parseReservationKey('ALF029CG__rolon'), { sku: 'ALF029CG', location: 'rolon' });
});

test('reservationDeltas: crear un pedido suma, y dos líneas del mismo SKU+ubicación se acumulan', () => {
  const after = [base, { ...base, lineId: 'L2', qty: 2 }, { ...base, lineId: 'L3', location: 'rolon', delivery: 'envio' }];
  assert.deepEqual([...reservationDeltas([], after)], [['ALF029CG__exhibicion', 3], ['ALF029CG__rolon', 1]]);
});

test('reservationDeltas: entregar o eliminar libera, mover de ubicación traslada', () => {
  assert.deepEqual([...reservationDeltas([base], [{ ...base, status: 'entregado' }])], [['ALF029CG__exhibicion', -1]]);
  assert.deepEqual(
    [...reservationDeltas([base], [{ ...base, location: 'rolon', delivery: 'retira_rolon' }])],
    [['ALF029CG__exhibicion', -1], ['ALF029CG__rolon', 1]],
  );
  assert.deepEqual([...reservationDeltas([base], [{ ...base, delivery: 'retira_feria' }])], []);
});

test('assignLineIds numera y deja todo en pendiente', () => {
  const lines = assignLineIds([{ sku: 'A' }, { sku: 'B' }]);
  assert.deepEqual(lines.map((l) => [l.lineId, l.status]), [['L1', 'pendiente'], ['L2', 'pendiente']]);
});

test('applyLineAction remove / deliver guardan quién y cuándo', () => {
  const removed = applyLineAction(base, 'remove', { user: 'Caja', now });
  assert.equal(removed.status, 'eliminado');
  assert.equal(removed.removedBy, 'Caja');
  assert.equal(removed.removedAt, now);
  const delivered = applyLineAction(base, 'deliver', { user: 'Caja', now });
  assert.equal(delivered.status, 'entregado');
  assert.equal(delivered.deliveredBy, 'Caja');
});

test('applyLineAction sendToFeria solo para retira_feria pendiente', () => {
  const line = { ...base, location: 'rolon', delivery: 'retira_feria' };
  assert.equal(applyLineAction(line, 'sendToFeria', { user: 'Log', now }).status, 'enviado_feria');
  assert.throws(() => applyLineAction(base, 'sendToFeria', { user: 'Log', now }), /Solo se envían a la feria/);
});

test('applyLineAction no toca líneas ya entregadas o eliminadas', () => {
  assert.throws(() => applyLineAction({ ...base, status: 'entregado' }, 'deliver', { user: 'C', now }), /ya está entregada/);
  assert.throws(() => applyLineAction({ ...base, status: 'eliminado' }, 'edit', { user: 'C', now, changes: { location: 'rolon' } }), /eliminada/);
});

test('applyLineAction edit valida la combinación y vuelve a pendiente si deja de ser retira_feria', () => {
  const sent = { ...base, location: 'rolon', delivery: 'retira_feria', status: 'enviado_feria' };
  const edited = applyLineAction(sent, 'edit', { user: 'C', now, changes: { delivery: 'retira_rolon' } });
  assert.equal(edited.delivery, 'retira_rolon');
  assert.equal(edited.status, 'pendiente');
  assert.throws(() => applyLineAction(base, 'edit', { user: 'C', now, changes: { location: 'rolon' } }), /solo puede salir de Exhibición/);
});

test('assertLineActionAllowed: no se elimina después de confirmar ni la última línea', () => {
  const order = { status: 'confirmado', lines: [base, { ...base, lineId: 'L2' }] };
  assert.throws(() => assertLineActionAllowed(order, base, 'remove'), /Después de confirmar/);
  const single = { status: 'pendiente', lines: [base] };
  assert.throws(() => assertLineActionAllowed(single, base, 'remove'), /última línea/);
  assert.doesNotThrow(() => assertLineActionAllowed({ status: 'pendiente', lines: [base, { ...base, lineId: 'L2' }] }, base, 'remove'));
});

test('assertLineActionAllowed: "Hecho" exige pedido confirmado con línea en Odoo; cancelado bloquea todo', () => {
  assert.throws(() => assertLineActionAllowed({ status: 'pendiente', lines: [base] }, base, 'deliver'), /confirmar el pedido/);
  assert.doesNotThrow(() => assertLineActionAllowed({ status: 'confirmado', lines: [base] }, { ...base, odooLineId: 5 }, 'deliver'));
  assert.throws(() => assertLineActionAllowed({ status: 'cancelado', lines: [base] }, base, 'edit'), /cancelado/);
});

test('hasPendingDeliveries: true con una línea que reserva; false para pedidos viejos sin delivery/status', () => {
  assert.equal(hasPendingDeliveries({ lines: [{ ...base, delivery: 'retira_rolon' }] }), true);
  assert.equal(hasPendingDeliveries({ lines: [{ ...base, status: 'entregado' }] }), false);
  assert.equal(hasPendingDeliveries({ lines: [{ sku: 'ALF029CG', qty: 1, unitPrice: 7992 }] }), false);
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `cd BACKEND && node --test test/feriaLines.test.mjs`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar `feriaLines.mjs`**

```js
// Modelo de línea de pedido de la feria: de dónde sale (ubicación), cómo se
// entrega y en qué estado está. Todo puro — la E/S (Firestore, Odoo) vive en
// feriaOrders/feriaStock/feriaDelivery.

export const LOCATIONS = ['exhibicion', 'rolon'];
export const DELIVERIES = ['ahora', 'retira_feria', 'retira_rolon', 'envio'];
// Mientras una línea está en alguno de estos estados, su stock está
// reservado en la app (todavía no salió físicamente para el cliente).
export const RESERVING_STATUSES = new Set(['pendiente', 'enviado_feria']);

const LOCATION_LABELS = { exhibicion: 'Exhibición', rolon: 'Rolón' };
const SHIPPING_REQUIRED = { street: 'la calle', number: 'el número', city: 'la localidad', zip: 'el código postal', phone: 'el teléfono' };

export function validateLineDelivery(line) {
  const errors = [];
  const sku = line.sku ?? 'un producto';
  if (!LOCATIONS.includes(line.location)) errors.push(`Ubicación inválida para ${sku}`);
  if (!DELIVERIES.includes(line.delivery)) errors.push(`Forma de entrega inválida para ${sku}`);
  if (line.delivery === 'ahora' && line.location !== 'exhibicion') {
    errors.push(`${sku}: "Se lleva ahora" solo puede salir de Exhibición`);
  }
  return errors;
}

export function validateShipping(shipping) {
  return Object.entries(SHIPPING_REQUIRED)
    .filter(([field]) => typeof shipping?.[field] !== 'string' || !shipping[field].trim())
    .map(([, label]) => `Falta ${label} del envío`);
}

export function needsShipping(lines) {
  return lines.some((l) => l.delivery === 'envio' && l.status !== 'eliminado');
}

export function isReserving(line) {
  return RESERVING_STATUSES.has(line.status);
}

export function reservationKey(sku, location) {
  return `${String(sku).toUpperCase()}__${location}`;
}

export function parseReservationKey(key) {
  const [sku, location] = key.split('__');
  return { sku, location };
}

function addDelta(deltas, line, sign) {
  const key = reservationKey(line.sku, line.location);
  deltas.set(key, (deltas.get(key) ?? 0) + sign * line.qty);
}

// Diferencia de reservas entre dos versiones de las líneas de un pedido:
// lo que reservaba antes se devuelve, lo que reserva ahora se toma. Así un
// mismo cálculo cubre crear, eliminar, entregar, cancelar y mover de
// ubicación.
export function reservationDeltas(beforeLines, afterLines) {
  const deltas = new Map();
  for (const line of beforeLines) if (isReserving(line)) addDelta(deltas, line, -1);
  for (const line of afterLines) if (isReserving(line)) addDelta(deltas, line, +1);
  for (const [key, value] of deltas) if (value === 0) deltas.delete(key);
  return deltas;
}

export function assignLineIds(lines) {
  return lines.map((line, i) => ({ ...line, lineId: `L${i + 1}`, status: 'pendiente' }));
}

function assertReserving(line, verb) {
  if (line.status === 'entregado') throw new Error(`La línea ${line.sku} ya está entregada: no se puede ${verb}`);
  if (line.status === 'eliminado') throw new Error(`La línea ${line.sku} está eliminada: no se puede ${verb}`);
}

export function applyLineAction(line, action, { user, now, changes = {} }) {
  switch (action) {
    case 'remove':
      assertReserving(line, 'eliminar');
      return { ...line, status: 'eliminado', removedAt: now, removedBy: user };
    case 'deliver':
      assertReserving(line, 'marcar como hecha');
      return { ...line, status: 'entregado', deliveredAt: now, deliveredBy: user };
    case 'sendToFeria':
      if (line.delivery !== 'retira_feria' || line.status !== 'pendiente') {
        throw new Error(`Solo se envían a la feria líneas pendientes de "Retira en feria" (${line.sku})`);
      }
      return { ...line, status: 'enviado_feria', sentToFeriaAt: now, sentToFeriaBy: user };
    case 'edit': {
      assertReserving(line, 'editar');
      const next = { ...line };
      if (changes.location !== undefined) next.location = changes.location;
      if (changes.delivery !== undefined) next.delivery = changes.delivery;
      const errors = validateLineDelivery(next);
      if (errors.length) throw new Error(errors.join('; '));
      // "Enviado a feria" solo tiene sentido para retira_feria.
      if (next.status === 'enviado_feria' && next.delivery !== 'retira_feria') next.status = 'pendiente';
      return next;
    }
    default:
      throw new Error(`Acción inválida: ${action}`);
  }
}

// Reglas que dependen del pedido completo, no solo de la línea.
export function assertLineActionAllowed(order, line, action) {
  if (order.status === 'cancelado') throw new Error('El pedido está cancelado');
  if (action === 'remove') {
    if (!['pendiente', 'error'].includes(order.status)) {
      throw new Error('Después de confirmar no se pueden eliminar líneas desde la app (hacelo en Odoo)');
    }
    const others = order.lines.filter((l) => l.lineId !== line.lineId && isReserving(l));
    if (others.length === 0) throw new Error('No se puede eliminar la última línea: cancelá el pedido');
  }
  if (action === 'deliver' && (order.status !== 'confirmado' || !line.odooLineId)) {
    throw new Error('Primero hay que confirmar el pedido en caja');
  }
}

// Pedido con algo todavía por entregar. Los pedidos viejos (sin delivery ni
// status por línea) no cuentan: nunca pasaron por este flujo.
export function hasPendingDeliveries(order) {
  return (order.lines ?? []).some((l) => l.delivery && isReserving(l));
}

export { LOCATION_LABELS };
```

- [ ] **Step 4: Sumar la validación al pedido**

En `feriaOrders.mjs`, agregar al import:

```js
import { validateLineDelivery, validateShipping, needsShipping } from './feriaLines.mjs';
```

En `validateOrderInput`, dentro del `for (const line of input.lines ?? [])`, al final del bloque agregar:

```js
    errors.push(...validateLineDelivery(line));
```

y antes del `return { valid: ... }`:

```js
  if (needsShipping(input.lines ?? [])) errors.push(...validateShipping(input.shipping));
```

En `test/feriaOrders.test.mjs`, cambiar la línea del `validInput` que define `lines` por:

```js
  lines: [{ sku: 'BCT037MA', modelo: 'Organica s', condition: 'falla', qty: 1, unitPrice: 23791, location: 'exhibicion', delivery: 'ahora' }],
```

y agregar al final:

```js
test('rechaza una línea sin ubicación ni forma de entrega', () => {
  const lines = [{ ...validInput.lines[0], location: undefined, delivery: undefined }];
  const result = validateOrderInput({ ...validInput, lines });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /Ubicación inválida/);
});

test('con una línea de envío exige los datos de envío', () => {
  const lines = [{ ...validInput.lines[0], location: 'rolon', delivery: 'envio' }];
  assert.match(validateOrderInput({ ...validInput, lines }).errors.join(' '), /Falta la calle del envío/);
  const shipping = { street: 'Av. Siempreviva', number: '742', city: 'Tigre', zip: '1648', phone: '1155555555' };
  assert.deepEqual(validateOrderInput({ ...validInput, lines, shipping }), { valid: true, errors: [] });
});
```

- [ ] **Step 5: Correr la suite**

Run: `cd BACKEND && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd BACKEND && git add feriaLines.mjs feriaOrders.mjs test/feriaLines.test.mjs test/feriaOrders.test.mjs && git commit -m "feat(feria): modelo de línea con ubicación, entrega, estados y deltas de reserva

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Stock en vivo por ubicación en la búsqueda

**Files:**
- Create: `BACKEND/feriaStock.mjs`
- Modify: `BACKEND/feriaRoutes.mjs` (ruta `/products/search`)
- Modify: `BACKEND/.env.example`
- Test: `BACKEND/test/feriaStock.test.mjs`

**Interfaces:**
- Consumes: `callKwReadWithRetry` (Task 2), `reservationKey`, `parseReservationKey`, `LOCATION_LABELS` (Task 3), `extractSkuFromDisplayName` de `normalize.mjs`, `getDb` de `firestore.mjs`.
- Produces:
  - `feriaLocationIds() → { exhibicion: number, rolon: number }` (de env)
  - `skuDomain(skus) → Odoo domain` (OR de `=ilike`)
  - `sumQuantsBySku(quants, locationIds) → Map<SKU, {exhibicion, rolon}>`
  - `fetchOdooStock(skus) → Promise<Map<SKU, {exhibicion, rolon}>>`
  - `RESERVATIONS_COLLECTION = 'feria_reservations'`
  - `readReservations(db, keys, tx?) → Promise<Map<key, number>>`
  - `availabilityFor(odooStock, reserved, sku) → {exhibicion, rolon}` (≥ 0)
  - `getAvailability(db, skus) → Promise<Map<SKU, {exhibicion, rolon}>>`

- [ ] **Step 1: Tests**

Crear `test/feriaStock.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skuDomain, sumQuantsBySku, availabilityFor } from '../feriaStock.mjs';

const ids = { exhibicion: 427, rolon: 428 };

test('skuDomain arma un OR de =ilike (Odoo puede tener default_code en minúsculas)', () => {
  assert.deepEqual(skuDomain(['A']), [['product_id.default_code', '=ilike', 'A']]);
  assert.deepEqual(skuDomain(['A', 'B', 'C']), [
    '|', '|',
    ['product_id.default_code', '=ilike', 'A'],
    ['product_id.default_code', '=ilike', 'B'],
    ['product_id.default_code', '=ilike', 'C'],
  ]);
});

test('sumQuantsBySku suma por SKU (en mayúsculas) y ubicación', () => {
  const quants = [
    { product_id: [1, '[alf029cg] FELPUDO'], location_id: [427, 'FER/Stock/exhibicion'], quantity: 2 },
    { product_id: [1, '[ALF029CG] FELPUDO'], location_id: [427, 'FER/Stock/exhibicion'], quantity: 1 },
    { product_id: [1, '[ALF029CG] FELPUDO'], location_id: [428, 'FER/Stock/Rolon'], quantity: 5 },
  ];
  assert.deepEqual(sumQuantsBySku(quants, ids).get('ALF029CG'), { exhibicion: 3, rolon: 5 });
});

test('availabilityFor resta lo reservado y nunca da negativo', () => {
  const odoo = new Map([['ALF029CG', { exhibicion: 3, rolon: 1 }]]);
  const reserved = new Map([['ALF029CG__exhibicion', 1], ['ALF029CG__rolon', 4]]);
  assert.deepEqual(availabilityFor(odoo, reserved, 'ALF029CG'), { exhibicion: 2, rolon: 0 });
  assert.deepEqual(availabilityFor(odoo, reserved, 'NOEXISTE'), { exhibicion: 0, rolon: 0 });
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `cd BACKEND && node --test test/feriaStock.test.mjs`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar `feriaStock.mjs`**

```js
import { callKwReadWithRetry } from './feriaOdoo.mjs';
import { getDb } from './firestore.mjs';
import { extractSkuFromDisplayName } from './normalize.mjs';
import { reservationKey, LOCATIONS } from './feriaLines.mjs';

export const RESERVATIONS_COLLECTION = 'feria_reservations';

// Ids de FER/Stock/exhibicion y FER/Stock/Rolon. Por variable de entorno y no
// hardcodeados: si alguien recrea las ubicaciones en Odoo, se cambia el env.
export function feriaLocationIds() {
  const exhibicion = Number(process.env.ODOO_FERIA_LOCATION_EXHIBICION_ID);
  const rolon = Number(process.env.ODOO_FERIA_LOCATION_ROLON_ID);
  if (!exhibicion || !rolon) throw new Error('Faltan ODOO_FERIA_LOCATION_EXHIBICION_ID / ODOO_FERIA_LOCATION_ROLON_ID');
  return { exhibicion, rolon };
}

// '=ilike' y no 'in': los default_code de Odoo pueden estar en minúsculas o
// mezclados y los SKU de la app están en mayúsculas.
export function skuDomain(skus) {
  const leaves = skus.map((sku) => ['product_id.default_code', '=ilike', sku]);
  return [...Array(Math.max(leaves.length - 1, 0)).fill('|'), ...leaves];
}

export function sumQuantsBySku(quants, locationIds) {
  const byLocationId = Object.fromEntries(Object.entries(locationIds).map(([name, id]) => [id, name]));
  const result = new Map();
  for (const q of quants) {
    const location = byLocationId[q.location_id[0]];
    if (!location) continue;
    const sku = extractSkuFromDisplayName(q.product_id[1]).toUpperCase();
    if (!result.has(sku)) result.set(sku, { exhibicion: 0, rolon: 0 });
    result.get(sku)[location] += q.quantity;
  }
  return result;
}

// Stock físico en Odoo por ubicación de la feria, consultado en vivo (una
// sola llamada para todos los SKUs).
export async function fetchOdooStock(skus) {
  const unique = [...new Set(skus.map((s) => s.toUpperCase()))];
  if (!unique.length) return new Map();
  const locationIds = feriaLocationIds();
  const quants = await callKwReadWithRetry('stock.quant', 'search_read', [
    [['location_id', 'in', Object.values(locationIds)], ...skuDomain(unique)],
  ], { fields: ['product_id', 'location_id', 'quantity'] });
  return sumQuantsBySku(quants, locationIds);
}

// Lee los contadores de reserva. Con `tx` lo hace dentro de la transacción
// (obligatorio antes de escribirlos: así dos vendedores no se pisan).
export async function readReservations(db, keys, tx = null) {
  const result = new Map();
  if (!keys.length) return result;
  const refs = keys.map((key) => db.collection(RESERVATIONS_COLLECTION).doc(key));
  const snaps = tx ? await tx.getAll(...refs) : await db.getAll(...refs);
  snaps.forEach((snap, i) => result.set(keys[i], snap.exists ? (snap.data().reserved ?? 0) : 0));
  return result;
}

export function availabilityFor(odooStock, reserved, sku) {
  const upper = sku.toUpperCase();
  const odoo = odooStock.get(upper) ?? { exhibicion: 0, rolon: 0 };
  const out = {};
  for (const location of LOCATIONS) {
    out[location] = Math.max(0, (odoo[location] ?? 0) - (reserved.get(reservationKey(upper, location)) ?? 0));
  }
  return out;
}

export async function getAvailability(db, skus) {
  const odooStock = await fetchOdooStock(skus);
  const keys = [...new Set(skus.flatMap((sku) => LOCATIONS.map((loc) => reservationKey(sku, loc))))];
  const reserved = await readReservations(db, keys);
  return new Map(skus.map((sku) => [sku.toUpperCase(), availabilityFor(odooStock, reserved, sku)]));
}

export { getDb };
```

- [ ] **Step 4: Stock en la búsqueda del vendedor/caja**

En `feriaRoutes.mjs` agregar `import { getAvailability } from './feriaStock.mjs';` y `import { getDb } from './firestore.mjs';` (si `getDb` no está importado ya), y reemplazar el handler de `router.get('/products/search', ...)` por:

```js
router.get('/products/search', requireFeriaAuth, async (req, res) => {
  try {
    const q = req.query.q?.trim();
    if (!q) return res.json({ products: [] });
    const found = searchFeriaProducts(q);

    // Stock en vivo desde Odoo menos lo reservado en la app. Si Odoo no
    // responde, stock: null — el panel no deja agregar (decisión explícita:
    // sin stock confirmado no se vende).
    let availability = null;
    try {
      availability = found.length ? await getAvailability(getDb(), found.map((p) => p.sku)) : new Map();
    } catch (err) {
      console.error('[feria] stock en vivo no disponible:', err.message);
    }

    const products = found.map((p) => ({
      sku: p.sku, modelo: p.modelo, color: p.color,
      stock: availability ? (availability.get(p.sku.toUpperCase()) ?? { exhibicion: 0, rolon: 0 }) : null,
      condiciones: buildConditionsPayload(p),
    }));
    res.json({ products });
  } catch (err) {
    // tablePrice/computeFinalPrice tiran si un documento de Firestore quedó
    // con un nivel de rebaja inválido (p. ej. editado a mano durante la
    // feria). Sin este catch, el rechazo sin manejar en un handler async de
    // Express 4 voltea el proceso entero.
    console.error('[feria] products/search error:', err.message);
    res.status(500).json({ error: 'Error buscando productos' });
  }
});
```

(`/public/products/search` NO se toca: nunca devuelve stock.)

- [ ] **Step 5: Variables de entorno**

En `.env.example`, debajo de `ODOO_FERIA_PRICELIST_NAME=...`, agregar:

```
# Almacén Feria en Odoo y sus dos ubicaciones (stock en vivo + entregas)
ODOO_FERIA_WAREHOUSE_ID=43
ODOO_FERIA_LOCATION_EXHIBICION_ID=427
ODOO_FERIA_LOCATION_ROLON_ID=428
# Producto de servicio para el cargo de envío a domicilio
ODOO_FERIA_SHIPPING_PRODUCT_NAME=Otros envíos terciarizados
```

Y agregar esas mismas 5 líneas al `.env` local del backend (gitignored; no imprimir su contenido).

- [ ] **Step 6: Tests + verificación real (solo lectura)**

Run: `cd BACKEND && npm test`
Expected: PASS.

Levantar el backend (`node index.mjs` en background), loguear un vendedor (`POST /api/feria/auth/vendedor` con el PIN de prueba) y:
Run: `curl -s "localhost:3000/api/feria/products/search?q=<SKU con stock en FER>" -H "Authorization: Bearer <token>"`
Expected: el producto trae `"stock":{"exhibicion":n,"rolon":m}` coincidente con Odoo. Y `curl -s "localhost:3000/api/feria/public/products/search?q=<mismo SKU>"` NO trae `stock`.

- [ ] **Step 7: Commit**

```bash
cd BACKEND && git add feriaStock.mjs feriaRoutes.mjs .env.example test/feriaStock.test.mjs && git commit -m "feat(feria): stock en vivo por ubicación (Odoo - reservas de la app) en la búsqueda

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Reserva al crear el pedido (transacción)

**Files:**
- Modify: `BACKEND/feriaStock.mjs` (+ `checkAvailability`, `nextReserved`, `writeReservations`)
- Modify: `BACKEND/feriaOrders.mjs` (`createOrder`)
- Test: `BACKEND/test/feriaStock.test.mjs`

**Interfaces:**
- Consumes: `reservationDeltas`, `assignLineIds`, `needsShipping`, `parseReservationKey`, `LOCATION_LABELS` (Task 3); `fetchOdooStock`, `readReservations`, `availabilityFor` (Task 4); `SHIPPING_COST` (Task 1).
- Produces:
  - `checkAvailability(odooStock, reserved, deltas) → string[]` (solo mira deltas > 0)
  - `nextReserved(reserved, deltas) → Map<key, number>` (≥ 0)
  - `writeReservations(tx, db, reserved, deltas)`
  - `createOrder(input)` guarda `lines` con `lineId`/`status`, `shipping` (o `null`), `shippingCost` (10000 o 0) y reserva; tira `Error` con el detalle si falta stock.

- [ ] **Step 1: Tests**

Agregar a `test/feriaStock.test.mjs` (y sumar `checkAvailability, nextReserved` al import):

```js
test('checkAvailability rechaza si dos líneas del mismo SKU+ubicación superan el disponible', () => {
  const odoo = new Map([['ALF029CG', { exhibicion: 1, rolon: 0 }]]);
  const errors = checkAvailability(odoo, new Map(), new Map([['ALF029CG__exhibicion', 2]]));
  assert.deepEqual(errors, ['ALF029CG en Exhibición: pediste 2, hay 1']);
});

test('checkAvailability descuenta lo ya reservado por otros pedidos', () => {
  const odoo = new Map([['ALF029CG', { exhibicion: 3, rolon: 0 }]]);
  const reserved = new Map([['ALF029CG__exhibicion', 3]]);
  assert.equal(checkAvailability(odoo, reserved, new Map([['ALF029CG__exhibicion', 1]])).length, 1);
});

test('checkAvailability nunca bloquea liberar reserva (deltas negativos)', () => {
  const odoo = new Map([['ALF029CG', { exhibicion: 0, rolon: 0 }]]);
  assert.deepEqual(checkAvailability(odoo, new Map([['ALF029CG__exhibicion', 1]]), new Map([['ALF029CG__exhibicion', -1]])), []);
});

test('checkAvailability al mover de ubicación solo exige stock en la nueva', () => {
  const odoo = new Map([['ALF029CG', { exhibicion: 1, rolon: 0 }]]);
  const deltas = new Map([['ALF029CG__exhibicion', -1], ['ALF029CG__rolon', 1]]);
  assert.deepEqual(checkAvailability(odoo, new Map([['ALF029CG__exhibicion', 1]]), deltas), ['ALF029CG en Rolón: pediste 1, hay 0']);
});

test('nextReserved aplica los deltas sin bajar de 0', () => {
  const next = nextReserved(new Map([['A__rolon', 1]]), new Map([['A__rolon', -3], ['B__exhibicion', 2]]));
  assert.deepEqual([...next], [['A__rolon', 0], ['B__exhibicion', 2]]);
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `cd BACKEND && node --test test/feriaStock.test.mjs`
Expected: FAIL (`checkAvailability` no exportado).

- [ ] **Step 3: Implementar en `feriaStock.mjs`**

Cambiar el import de `feriaLines.mjs` por:

```js
import { reservationKey, parseReservationKey, LOCATIONS, LOCATION_LABELS } from './feriaLines.mjs';
```

y agregar al final:

```js
// Verifica que las reservas nuevas (deltas > 0) entren en el disponible.
// Liberar (deltas ≤ 0) nunca se bloquea.
export function checkAvailability(odooStock, reserved, deltas) {
  const errors = [];
  for (const [key, delta] of deltas) {
    if (delta <= 0) continue;
    const { sku, location } = parseReservationKey(key);
    const available = availabilityFor(odooStock, reserved, sku)[location];
    if (delta > available) errors.push(`${sku} en ${LOCATION_LABELS[location]}: pediste ${delta}, hay ${available}`);
  }
  return errors;
}

export function nextReserved(reserved, deltas) {
  const next = new Map();
  for (const [key, delta] of deltas) next.set(key, Math.max(0, (reserved.get(key) ?? 0) + delta));
  return next;
}

export function writeReservations(tx, db, reserved, deltas) {
  for (const [key, value] of nextReserved(reserved, deltas)) {
    const { sku, location } = parseReservationKey(key);
    tx.set(db.collection(RESERVATIONS_COLLECTION).doc(key), { sku, location, reserved: value, updatedAt: new Date() });
  }
}
```

- [ ] **Step 4: `createOrder` con reserva**

En `feriaOrders.mjs`:
- Agregar a los imports: `assignLineIds, reservationDeltas` (de `./feriaLines.mjs`, junto a los ya importados), `import { fetchOdooStock, readReservations, checkAvailability, writeReservations } from './feriaStock.mjs';` y `SHIPPING_COST` al import de `./feriaPricing.mjs` (`import { PAYMENT_METHODS as PAYMENT_METHOD_INFO, SHIPPING_COST } from './feriaPricing.mjs';`).
- Reemplazar `createOrder` completo por:

```js
export async function createOrder(input) {
  const { valid, errors } = validateOrderInput(input);
  if (!valid) throw new Error(errors.join('; '));

  const lines = assignLineIds(input.lines.map((l) => ({
    sku: l.sku.toUpperCase(), modelo: l.modelo, condition: l.condition, qty: l.qty,
    unitPrice: l.unitPrice, listPrice: l.listPrice, location: l.location, delivery: l.delivery,
  })));
  const withShipping = needsShipping(lines);
  const deltas = reservationDeltas([], lines);
  // Stock de Odoo afuera de la transacción (es una llamada HTTP lenta y las
  // transacciones de Firestore se reintentan); las reservas, adentro.
  const odooStock = await fetchOdooStock(lines.map((l) => l.sku));

  const db = getDb();
  const ref = db.collection(COLLECTION).doc();
  const order = {
    sellerId: input.sellerId,
    sellerName: input.sellerName,
    customer: input.customer,
    paymentMethod: input.paymentMethod,
    lines,
    shipping: withShipping ? input.shipping : null,
    shippingCost: withShipping ? SHIPPING_COST : 0,
    invoiceType: null,
    status: 'pendiente',
    errorDetail: null,
    odooOrderId: null,
    invoiceId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await db.runTransaction(async (tx) => {
    const reserved = await readReservations(db, [...deltas.keys()], tx);
    const stockErrors = checkAvailability(odooStock, reserved, deltas);
    if (stockErrors.length) throw new Error(`Sin stock suficiente — ${stockErrors.join('; ')}`);
    writeReservations(tx, db, reserved, deltas);
    tx.set(ref, order);
  });
  return { id: ref.id, ...order };
}
```

(La ruta `POST /orders` ya devuelve 400 con `err.message`; no cambia.)

- [ ] **Step 5: Tests**

Run: `cd BACKEND && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd BACKEND && git add feriaStock.mjs feriaOrders.mjs test/feriaStock.test.mjs && git commit -m "feat(feria): reserva de stock en transacción al crear el pedido

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Acciones de línea, cancelar pedido y lista de Logística (backend)

**Files:**
- Modify: `BACKEND/feriaOrders.mjs`
- Modify: `BACKEND/feriaRoutes.mjs`

**Interfaces:**
- Consumes: `applyLineAction`, `assertLineActionAllowed`, `reservationDeltas`, `hasPendingDeliveries`, `isReserving` (Task 3); `fetchOdooStock`, `readReservations`, `checkAvailability`, `writeReservations`, `feriaLocationIds` (Tasks 4–5); `deliverLines` (Task 2).
- Produces (en `feriaOrders.mjs`):
  - `applyOrderLineActions(orderId, lineIds: string[], action, { user, changes }) → Promise<order>`
  - `cancelOrder(orderId, user) → Promise<order>`
  - `listLogisticsOrders() → Promise<order[]>`
  - `setOrderErrorDetail(orderId, detail)`
- Rutas (rol `caja`):
  - `DELETE /orders/:id/lines/:lineId` · `PATCH /orders/:id/lines/:lineId` (`{location?, delivery?}`) · `POST /orders/:id/lines/:lineId/sent-to-feria` · `POST /orders/:id/lines/:lineId/deliver` · `POST /orders/:id/cancel` · `GET /logistics/orders`. Todas responden `{ order }` (o `{ orders }`).

La lógica está testeada en Tasks 3–5 (funciones puras); esta tarea es cableado de E/S y se verifica con requests reales.

- [ ] **Step 1: Funciones en `feriaOrders.mjs`**

Sumar a los imports de `./feriaLines.mjs`: `applyLineAction, assertLineActionAllowed, hasPendingDeliveries, isReserving`. Agregar al final del archivo:

```js
// Aplica la misma acción a una o más líneas del pedido y ajusta las reservas,
// todo en una transacción (pedido + contadores de reserva juntos).
export async function applyOrderLineActions(orderId, lineIds, action, { user, changes } = {}) {
  const db = getDb();
  const ref = db.collection(COLLECTION).doc(orderId);

  // Mover una línea de ubicación reserva en la nueva: hace falta el stock de
  // Odoo, que se lee afuera de la transacción.
  let odooStock = null;
  if (action === 'edit' && changes?.location) {
    const snap = await ref.get();
    const skus = (snap.data()?.lines ?? []).filter((l) => lineIds.includes(l.lineId)).map((l) => l.sku);
    odooStock = await fetchOdooStock(skus);
  }

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('Pedido no encontrado');
    const order = { id: snap.id, ...snap.data() };
    const now = new Date();
    const newLines = order.lines.map((line) => {
      if (!lineIds.includes(line.lineId)) return line;
      assertLineActionAllowed(order, line, action);
      return applyLineAction(line, action, { user, now, changes });
    });
    const missing = lineIds.filter((id) => !order.lines.some((l) => l.lineId === id));
    if (missing.length) throw new Error(`Línea no encontrada: ${missing.join(', ')}`);

    const deltas = reservationDeltas(order.lines, newLines);
    const reserved = await readReservations(db, [...deltas.keys()], tx);
    if (odooStock) {
      const stockErrors = checkAvailability(odooStock, reserved, deltas);
      if (stockErrors.length) throw new Error(`Sin stock suficiente — ${stockErrors.join('; ')}`);
    }
    writeReservations(tx, db, reserved, deltas);
    tx.update(ref, { lines: newLines, updatedAt: now });
    return { ...order, lines: newLines, updatedAt: now };
  });
}

// Cancela un pedido todavía no confirmado y libera todo lo que reservaba. Las
// líneas quedan como estaban (historial); el pedido pasa a 'cancelado'.
export async function cancelOrder(orderId, user) {
  const db = getDb();
  const ref = db.collection(COLLECTION).doc(orderId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('Pedido no encontrado');
    const order = { id: snap.id, ...snap.data() };
    if (!['pendiente', 'error'].includes(order.status)) {
      throw new Error('Solo se cancelan pedidos que todavía no se confirmaron (los confirmados se cancelan en Odoo)');
    }
    const deltas = reservationDeltas(order.lines, []);
    const reserved = await readReservations(db, [...deltas.keys()], tx);
    writeReservations(tx, db, reserved, deltas);
    const now = new Date();
    const update = { status: 'cancelado', cancelledAt: now, cancelledBy: user, updatedAt: now };
    tx.update(ref, update);
    return { ...order, ...update };
  });
}

// Pedidos confirmados con algo por entregar. Un solo where (sin índice
// compuesto); el resto se filtra y ordena acá.
export async function listLogisticsOrders() {
  const db = getDb();
  const snap = await db.collection(COLLECTION).where('status', '==', 'confirmado').get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter(hasPendingDeliveries)
    .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
}

export async function setOrderErrorDetail(id, errorDetail) {
  const db = getDb();
  await db.collection(COLLECTION).doc(id).update({ errorDetail, updatedAt: new Date() });
}
```

(`isReserving` queda importado para Task 7; si el linter se queja de import sin usar, sumarlo recién en Task 7.)

- [ ] **Step 2: Rutas en `feriaRoutes.mjs`**

Sumar a los imports: `applyOrderLineActions, cancelOrder, listLogisticsOrders` (de `./feriaOrders.mjs`), `import { deliverLines } from './feriaDelivery.mjs';`, `import { feriaLocationIds } from './feriaStock.mjs';` (junto a `getAvailability`), `import { assertLineActionAllowed } from './feriaLines.mjs';`.

Agregar antes de `export default router;`:

```js
function feriaUserName(req) {
  return req.feriaUser?.name || req.feriaUser?.email || 'caja';
}

router.delete('/orders/:id/lines/:lineId', requireFeriaAuth, requireFeriaRole('caja'), async (req, res) => {
  try {
    res.json({ order: await applyOrderLineActions(req.params.id, [req.params.lineId], 'remove', { user: feriaUserName(req) }) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/orders/:id/lines/:lineId', requireFeriaAuth, requireFeriaRole('caja'), async (req, res) => {
  try {
    const { location, delivery } = req.body;
    res.json({ order: await applyOrderLineActions(req.params.id, [req.params.lineId], 'edit', {
      user: feriaUserName(req), changes: { location, delivery },
    }) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/orders/:id/lines/:lineId/sent-to-feria', requireFeriaAuth, requireFeriaRole('caja'), async (req, res) => {
  try {
    res.json({ order: await applyOrderLineActions(req.params.id, [req.params.lineId], 'sendToFeria', { user: feriaUserName(req) }) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// "Hecho": el cliente ya se lo llevó. Primero Odoo (valida esa línea del
// remito desde su ubicación), después la app. Si Odoo ya la tenía hecha (un
// intento anterior se cortó antes de actualizar la app), deliverLines la
// devuelve en alreadyDone y se marca igual.
router.post('/orders/:id/lines/:lineId/deliver', requireFeriaAuth, requireFeriaRole('caja'), async (req, res) => {
  try {
    const order = await getOrderById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
    const line = order.lines.find((l) => l.lineId === req.params.lineId);
    if (!line) return res.status(404).json({ error: 'Línea no encontrada' });
    assertLineActionAllowed(order, line, 'deliver');

    try {
      await deliverLines(order.odooOrderId, [{
        odooLineId: line.odooLineId, qty: line.qty, locationId: feriaLocationIds()[line.location],
      }]);
    } catch (err) {
      return res.status(502).json({ error: `No se pudo marcar en Odoo: ${err.message}` });
    }
    res.json({ order: await applyOrderLineActions(order.id, [line.lineId], 'deliver', { user: feriaUserName(req) }) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/orders/:id/cancel', requireFeriaAuth, requireFeriaRole('caja'), async (req, res) => {
  try {
    res.json({ order: await cancelOrder(req.params.id, feriaUserName(req)) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/logistics/orders', requireFeriaAuth, requireFeriaRole('caja'), async (req, res) => {
  try {
    res.json({ orders: await listLogisticsOrders() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 3: Tests + verificación con requests reales**

Run: `cd BACKEND && npm test`
Expected: PASS.

Con el backend levantado y tokens de vendedor (PIN de prueba) y caja: crear un pedido de 2 líneas (`location`/`delivery` válidos) y verificar con curl:
- `DELETE .../lines/L2` → `L2` queda `eliminado` con `removedBy`; `DELETE .../lines/L1` → 400 "última línea".
- `PATCH .../lines/L1` con `{"location":"rolon","delivery":"retira_rolon"}` → cambia (o 400 "Sin stock suficiente" si no hay en Rolón).
- `POST .../cancel` → `status: cancelado`.
- Leer los docs `feria_reservations` de esos SKUs antes y después (con `getAvailability` vía la búsqueda): al final del ciclo la disponibilidad vuelve a la inicial.
- `GET /logistics/orders` → responde `{ orders: [...] }` sin romper con los 2 pedidos viejos confirmados (no aparecen).

- [ ] **Step 4: Commit**

```bash
cd BACKEND && git add feriaOrders.mjs feriaRoutes.mjs && git commit -m "feat(feria): eliminar/editar/enviar/entregar líneas, cancelar pedido y lista de logística

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Confirmar en Caja — almacén Feria, envío, ids de línea y entrega de "Se lleva ahora"

**Files:**
- Modify: `BACKEND/feriaOdoo.mjs`
- Create: `BACKEND/feriaConfirm.mjs`
- Modify: `BACKEND/feriaOrders.mjs` (+ `saveOdooLineIds`)
- Modify: `BACKEND/feriaRoutes.mjs` (ruta confirm)
- Test: `BACKEND/test/feriaOdoo.test.mjs`, `BACKEND/test/feriaConfirm.test.mjs`

**Interfaces:**
- Consumes: `odooLinePricing`, `netOfIva`, `SHIPPING_COST` (Task 1); `deliverLines` (Task 2); `needsShipping`, `RESERVING_STATUSES` (Task 3); `feriaLocationIds` (Task 4); `applyOrderLineActions`, `setOrderErrorDetail` (Task 6).
- Produces:
  - `buildSaleOrderPayload({ partnerId, pricelistId, teamId, paymentMethodId, warehouseId, partnerShippingId, lines })`
  - `buildShippingPartnerVals(parentId, customerName, shipping) → vals` · `createShippingPartner(parentId, customerName, shipping) → id`
  - `findShippingProductId() → id|null` · `readOrderLineIds(orderId) → number[]`
  - `buildOdooLines(activeLines, paymentMethod, productIds, shippingProductId) → [{productId, qty, unitPrice, discountPct}]`
  - `pairOdooLineIds(activeLines, odooLineIds) → { [lineId]: odooLineId }`
  - `confirmOrder(order, user) → Promise<order>`
  - `saveOdooLineIds(orderId, map)`

- [ ] **Step 1: Tests de payload y partner de envío**

Agregar a `test/feriaOdoo.test.mjs` (sumar `buildShippingPartnerVals` al import):

```js
test('con almacén y dirección de envío los carga en el pedido', () => {
  const payload = buildSaleOrderPayload({
    partnerId: 42, pricelistId: 7, teamId: 3, paymentMethodId: 6, warehouseId: 43, partnerShippingId: 99,
    lines: [{ productId: 100, qty: 1, unitPrice: 8256.2, discountPct: 20 }],
  });
  assert.equal(payload.warehouse_id, 43);
  assert.equal(payload.partner_shipping_id, 99);
});

test('sin almacén ni envío no manda esas claves', () => {
  const payload = buildSaleOrderPayload({ partnerId: 42, pricelistId: 7, lines: [] });
  assert.equal('warehouse_id' in payload, false);
  assert.equal('partner_shipping_id' in payload, false);
});

test('buildShippingPartnerVals arma un contacto de entrega hijo del cliente', () => {
  assert.deepEqual(buildShippingPartnerVals(42, 'Juan Pérez', {
    street: 'Av. Siempreviva', number: '742', floor: '3B', city: 'Tigre', zip: '1648', phone: '1155555555', notes: 'Tocar timbre',
  }), {
    parent_id: 42, type: 'delivery', name: 'Juan Pérez', street: 'Av. Siempreviva 742', street2: '3B',
    city: 'Tigre', zip: '1648', phone: '1155555555', comment: 'Tocar timbre',
  });
});
```

Crear `test/feriaConfirm.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOdooLines, pairOdooLineIds } from '../feriaConfirm.mjs';

const lines = [
  { lineId: 'L1', sku: 'A', qty: 1, listPrice: 9990, unitPrice: 7992, delivery: 'ahora', status: 'pendiente' },
  { lineId: 'L3', sku: 'B', qty: 2, listPrice: 10000, unitPrice: 8000, delivery: 'envio', status: 'pendiente' },
];

test('buildOdooLines: precios sin IVA con descuento del medio de pago + línea de envío sin descuento', () => {
  assert.deepEqual(buildOdooLines(lines, 'transferencia', [501, 502], 9759), [
    { productId: 501, qty: 1, unitPrice: 8256.2, discountPct: 20 },
    { productId: 502, qty: 2, unitPrice: 8264.46, discountPct: 20 },
    { productId: 9759, qty: 1, unitPrice: 8264.46, discountPct: 0 },
  ]);
});

test('buildOdooLines sin producto de envío no agrega la línea', () => {
  assert.equal(buildOdooLines(lines.slice(0, 1), 'efectivo', [501], null).length, 1);
});

test('pairOdooLineIds empareja en orden e ignora la línea de envío que queda al final', () => {
  assert.deepEqual(pairOdooLineIds(lines, [11, 12, 13]), { L1: 11, L3: 12 });
});

test('pairOdooLineIds falla si Odoo devolvió menos líneas de las esperadas', () => {
  assert.throws(() => pairOdooLineIds(lines, [11]), /Odoo devolvió 1 líneas/);
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `cd BACKEND && npm test`
Expected: FAIL (`buildShippingPartnerVals` / `feriaConfirm.mjs` no existen; `warehouse_id` ausente).

- [ ] **Step 3: `feriaOdoo.mjs`**

Reemplazar `buildSaleOrderPayload` por:

```js
export function buildSaleOrderPayload({ partnerId, pricelistId, teamId, paymentMethodId, warehouseId, partnerShippingId, lines }) {
  const payload = {
    partner_id: partnerId,
    pricelist_id: pricelistId,
    order_line: lines.map(l => [0, 0, {
      product_id: l.productId,
      product_uom_qty: l.qty,
      price_unit: l.unitPrice,
      discount: l.discountPct,
    }]),
  };
  if (teamId) payload.team_id = teamId;
  // payment_method_ids es un many2one (a pesar del sufijo _ids) a
  // payment.method: el campo "Medio de pago" del pedido en este Odoo.
  if (paymentMethodId) payload.payment_method_ids = paymentMethodId;
  // Almacén Feria: el remito sale de ahí (y de sus ubicaciones exhibición /
  // Rolón), no del almacén por defecto.
  if (warehouseId) payload.warehouse_id = warehouseId;
  if (partnerShippingId) payload.partner_shipping_id = partnerShippingId;
  return payload;
}
```

Y agregar debajo de `findPaymentMethodId`:

```js
export function buildShippingPartnerVals(parentId, customerName, shipping) {
  return {
    parent_id: parentId,
    type: 'delivery',
    name: customerName,
    street: `${shipping.street} ${shipping.number}`.trim(),
    street2: shipping.floor || false,
    city: shipping.city,
    zip: shipping.zip,
    phone: shipping.phone,
    comment: shipping.notes || false,
  };
}

// Dirección de entrega como contacto hijo del cliente: así el pedido lleva
// su propia dirección sin pisar la dirección principal del cliente en Odoo.
export async function createShippingPartner(parentId, customerName, shipping) {
  await ensureAuth();
  const [id] = await callKw('res.partner', 'create', [[buildShippingPartnerVals(parentId, customerName, shipping)]]);
  return id;
}

export async function findShippingProductId() {
  const name = process.env.ODOO_FERIA_SHIPPING_PRODUCT_NAME || 'Otros envíos terciarizados';
  const results = await callKwReadWithRetry('product.product', 'search_read', [
    [['name', '=', name]],
  ], { fields: ['id'], limit: 1 });
  return results[0]?.id ?? null;
}

// Ids de sale.order.line en el orden en que se crearon (Odoo los devuelve
// ordenados por secuencia e id, que es el orden de creación).
export async function readOrderLineIds(orderId) {
  const [order] = await callKwReadWithRetry('sale.order', 'read', [[orderId]], { fields: ['order_line'] });
  return order?.order_line ?? [];
}
```

- [ ] **Step 4: `feriaOrders.mjs` — guardar ids de línea**

Agregar:

```js
// Guarda el id de sale.order.line de cada línea de la app: lo necesita
// "Hecho" para validar justo esa línea del remito.
export async function saveOdooLineIds(orderId, odooLineIdByLineId) {
  const db = getDb();
  const ref = db.collection(COLLECTION).doc(orderId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const lines = snap.data().lines.map((l) => (
      odooLineIdByLineId[l.lineId] ? { ...l, odooLineId: odooLineIdByLineId[l.lineId] } : l
    ));
    tx.update(ref, { lines, updatedAt: new Date() });
  });
}
```

- [ ] **Step 5: Crear `feriaConfirm.mjs`**

```js
import {
  findOrCreatePartner, findSalesTeamId, findPricelistId, findProductIdBySku, findPaymentMethodId,
  findShippingProductId, createShippingPartner, buildSaleOrderPayload, createSaleOrder, confirmSaleOrder,
  readOrderLineIds,
} from './feriaOdoo.mjs';
import { PAYMENT_METHODS, odooLinePricing, netOfIva, SHIPPING_COST } from './feriaPricing.mjs';
import { needsShipping, RESERVING_STATUSES } from './feriaLines.mjs';
import { feriaLocationIds } from './feriaStock.mjs';
import { deliverLines } from './feriaDelivery.mjs';
import {
  getOrderById, saveOdooOrderId, saveOdooLineIds, markOrderConfirmed, applyOrderLineActions, setOrderErrorDetail,
} from './feriaOrders.mjs';

export function buildOdooLines(activeLines, paymentMethod, productIds, shippingProductId) {
  const lines = activeLines.map((line, i) => ({
    productId: productIds[i], qty: line.qty, ...odooLinePricing(line, paymentMethod),
  }));
  if (shippingProductId) {
    lines.push({ productId: shippingProductId, qty: 1, unitPrice: netOfIva(SHIPPING_COST), discountPct: 0 });
  }
  return lines;
}

// La línea de envío (si hay) va siempre última, así que alcanza con
// emparejar por posición.
export function pairOdooLineIds(activeLines, odooLineIds) {
  if (odooLineIds.length < activeLines.length) {
    throw new Error(`Odoo devolvió ${odooLineIds.length} líneas y el pedido tiene ${activeLines.length}`);
  }
  return Object.fromEntries(activeLines.map((line, i) => [line.lineId, odooLineIds[i]]));
}

// Crea (si hace falta) y confirma el pedido en Odoo, y entrega en el acto lo
// que el cliente se lleva ahora. Es reintentable: si un intento anterior ya
// creó el sale.order, no se crea otro (ver comentario en la ruta).
export async function confirmOrder(order, user) {
  let odooOrderId = order.odooOrderId;
  // Las eliminadas no viajan. Líneas de pedidos viejos (sin status) sí.
  const activeLines = order.lines.filter((l) => l.status !== 'eliminado');

  if (!odooOrderId) {
    const partnerId = await findOrCreatePartner({ name: order.customer.name, docNumber: order.customer.docNumber });
    const teamId = await findSalesTeamId(process.env.ODOO_FERIA_TEAM_NAME);
    const pricelistId = await findPricelistId(process.env.ODOO_FERIA_PRICELIST_NAME);
    if (!pricelistId) throw new Error(`Pricelist de feria no encontrada en Odoo: "${process.env.ODOO_FERIA_PRICELIST_NAME}"`);
    const odooPaymentName = PAYMENT_METHODS[order.paymentMethod]?.odooName;
    const paymentMethodId = await findPaymentMethodId(odooPaymentName);
    if (!paymentMethodId) throw new Error(`Medio de pago no encontrado en Odoo: "${odooPaymentName ?? order.paymentMethod}"`);

    const productIds = [];
    for (const line of activeLines) {
      const productId = await findProductIdBySku(line.sku);
      if (!productId) throw new Error(`SKU no encontrado en Odoo: ${line.sku}`);
      productIds.push(productId);
    }

    let shippingProductId = null;
    let partnerShippingId = null;
    if (needsShipping(activeLines)) {
      shippingProductId = await findShippingProductId();
      if (!shippingProductId) throw new Error('Producto de envío no encontrado en Odoo (ODOO_FERIA_SHIPPING_PRODUCT_NAME)');
      partnerShippingId = await createShippingPartner(partnerId, order.customer.name, order.shipping);
    }

    const vals = buildSaleOrderPayload({
      partnerId, pricelistId, teamId, paymentMethodId,
      warehouseId: Number(process.env.ODOO_FERIA_WAREHOUSE_ID) || null,
      partnerShippingId,
      lines: buildOdooLines(activeLines, order.paymentMethod, productIds, shippingProductId),
    });
    odooOrderId = await createSaleOrder(vals);
    // El id se guarda ANTES de seguir: si algo falla después, el pedido de
    // Odoo YA existe y un reintento no tiene que crear otro.
    await saveOdooOrderId(order.id, odooOrderId);
  }

  // Afuera del if: cubre también el reintento de un intento que creó el
  // pedido pero se cortó antes de guardar los ids de línea.
  if (activeLines.some((l) => l.lineId && !l.odooLineId)) {
    await saveOdooLineIds(order.id, pairOdooLineIds(activeLines, await readOrderLineIds(odooOrderId)));
  }

  // Re-confirmar uno ya confirmado es un no-op seguro en Odoo.
  await confirmSaleOrder(odooOrderId);
  await markOrderConfirmed(order.id, { odooOrderId, invoiceId: null });

  // Lo que se lleva ahora sale ya de exhibición. Si falla, el pedido queda
  // confirmado igual (la venta está hecha) y se avisa para marcarlo con "Hecho".
  const confirmed = await getOrderById(order.id);
  const ahora = confirmed.lines.filter((l) => l.delivery === 'ahora' && RESERVING_STATUSES.has(l.status) && l.odooLineId);
  if (ahora.length) {
    try {
      const exhibicionId = feriaLocationIds().exhibicion;
      await deliverLines(odooOrderId, ahora.map((l) => ({ odooLineId: l.odooLineId, qty: l.qty, locationId: exhibicionId })));
      await applyOrderLineActions(order.id, ahora.map((l) => l.lineId), 'deliver', { user });
    } catch (err) {
      await setOrderErrorDetail(order.id,
        `Pedido confirmado, pero no se pudo marcar como entregado lo que se lleva ahora (${err.message}). Marcalo con "Hecho".`);
    }
  }
  return getOrderById(order.id);
}
```

- [ ] **Step 6: Ruta confirm**

En `feriaRoutes.mjs`, `import { confirmOrder } from './feriaConfirm.mjs';` y reemplazar TODO el handler `router.post('/orders/:id/confirm', ...)` (desde el comentario de arriba hasta su `});`) por:

```js
// Confirma el pedido en Odoo (ver feriaConfirm.mjs). NO factura: la
// facturación automática está deshabilitada por ahora. Es reintentable si
// quedó en 'error': si ya había un odooOrderId guardado, no se crea otro
// sale.order (reintentar no puede duplicar una venta ya cobrada).
router.post('/orders/:id/confirm', requireFeriaAuth, requireFeriaRole('caja'), async (req, res) => {
  const order = await getOrderById(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  if (order.status === 'cancelado') return res.status(400).json({ error: 'El pedido está cancelado' });

  // Pedido ya confirmado/facturado: doble click o cajero reabriendo — inocuo.
  if (order.invoiceId || order.status === 'facturado' || order.status === 'confirmado') {
    return res.json({ order });
  }

  try {
    res.json({ order: await confirmOrder(order, feriaUserName(req)) });
  } catch (err) {
    // markOrderError escribe en Firestore: si lo caído es Firestore, tirar acá
    // voltearía el proceso (rechazo sin manejar en Express 4). Se registra y
    // se sigue: al cajero le importa recibir el 502.
    try {
      await markOrderError(order.id, err.message);
    } catch (markErr) {
      console.error('[feria] no se pudo marcar el pedido como error:', markErr.message);
    }
    res.status(502).json({ error: `No se pudo confirmar en Odoo: ${err.message}` });
  }
});
```

Mover la función `feriaUserName` (Task 6) arriba de este handler si quedó más abajo. Limpiar de los imports de `feriaRoutes.mjs` lo que ya no se usa ahí (`findOrCreatePartner`, `findSalesTeamId`, `findPricelistId`, `findProductIdBySku`, `findPaymentMethodId`, `buildSaleOrderPayload`, `createSaleOrder`, `confirmSaleOrder`, `saveOdooOrderId`, `markOrderConfirmed`, `odooLinePricing`) — dejar solo lo que las rutas restantes usen (`findPartnerByDoc` sigue usándose en `/customers/lookup`).

- [ ] **Step 7: Tests**

Run: `cd BACKEND && npm test`
Expected: PASS.

Run: `cd BACKEND && node -e "import('./feriaRoutes.mjs').then(() => console.log('ok'))"`
Expected: `ok` (sin errores de import).

- [ ] **Step 8: Commit**

```bash
cd BACKEND && git add feriaOdoo.mjs feriaConfirm.mjs feriaOrders.mjs feriaRoutes.mjs test/feriaOdoo.test.mjs test/feriaConfirm.test.mjs && git commit -m "feat(feria): confirmar en almacén Feria con envío, ids de línea y entrega de lo que se lleva ahora

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Frontend — etiquetas compartidas y componente `OrderLines`

**Files:**
- Create: `CLIENT/src/lib/feriaLabels.js`
- Create: `CLIENT/src/components/OrderLines.jsx`
- Create: `CLIENT/src/components/OrderLines.module.css`

**Interfaces:**
- Produces:
  - `LOCATION_LABELS`, `DELIVERY_LABELS`, `SHIPPING_COST` (10000), `RESERVING_STATUSES` (array), `formatDateTime(value)`, `orderTotal(order)`
  - `<OrderLines lines stockBySku busyLineId onEdit onRemove onSendToFeria onDeliver />` — `onEdit(line, changes)`, los demás `(line)`. Sin callback → no muestra ese control.

- [ ] **Step 1: `lib/feriaLabels.js`**

```js
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
```

- [ ] **Step 2: `components/OrderLines.module.css`**

```css
.table { width: 100%; margin: var(--space-4) 0; border-collapse: collapse; }
.table td {
  padding: var(--space-2);
  border-bottom: 1px solid var(--color-border);
  font-size: var(--font-size-sm);
  vertical-align: top;
}
.sub { color: var(--color-text-muted); font-size: var(--font-size-xs); margin-top: var(--space-1); }
.removed td { text-decoration: line-through; color: var(--color-text-faint); }
.removed td:nth-child(3) { text-decoration: none; }
.select {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  margin-right: var(--space-1);
  font-size: var(--font-size-xs);
}
.badge {
  display: inline-block;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-full);
  font-size: var(--font-size-xs);
  white-space: nowrap;
}
.badgePending { background: var(--color-warning-bg); color: var(--color-warning); }
.badgeSent { background: var(--color-primary-subtle); color: var(--color-primary); }
.badgeDone { background: var(--color-success-bg); color: var(--color-success); }
.badgeRemoved { background: var(--color-surface-alt); color: var(--color-text-muted); }
.actions { display: flex; gap: var(--space-1); flex-wrap: wrap; justify-content: flex-end; }
.actions button {
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-primary);
  font-size: var(--font-size-xs);
}
.actions button:disabled { opacity: 0.5; }
```

- [ ] **Step 3: `components/OrderLines.jsx`**

```jsx
import { LOCATION_LABELS, DELIVERY_LABELS, RESERVING_STATUSES, formatDateTime } from '../lib/feriaLabels.js';
import styles from './OrderLines.module.css';

function StatusBadge({ line }) {
  switch (line.status) {
    case 'entregado':
      return <span className={`${styles.badge} ${styles.badgeDone}`}>✅ Entregado {formatDateTime(line.deliveredAt)} · {line.deliveredBy}</span>;
    case 'enviado_feria':
      return <span className={`${styles.badge} ${styles.badgeSent}`}>🚚 Enviado a feria {formatDateTime(line.sentToFeriaAt)} · {line.sentToFeriaBy}</span>;
    case 'eliminado':
      return <span className={`${styles.badge} ${styles.badgeRemoved}`}>Eliminado {formatDateTime(line.removedAt)} · {line.removedBy}</span>;
    case 'pendiente':
      return <span className={`${styles.badge} ${styles.badgePending}`}>⏳ Pendiente</span>;
    default:
      return null;
  }
}

// Tabla de líneas de un pedido con su estado. Los controles aparecen solo si
// el que la usa pasa el callback: así Caja y Logística comparten la misma
// vista y cada una habilita lo que corresponde.
export default function OrderLines({ lines, stockBySku = {}, busyLineId = null, onEdit, onRemove, onSendToFeria, onDeliver }) {
  function changeLocation(line, location) {
    // "Se lleva ahora" solo sale de Exhibición: si pasa a Rolón, cambia la
    // entrega a retiro en Rolón en el mismo paso.
    const changes = location === 'rolon' && line.delivery === 'ahora'
      ? { location, delivery: 'retira_rolon' }
      : { location };
    onEdit(line, changes);
  }

  return (
    <table className={styles.table}>
      <tbody>
        {lines.map((l, i) => {
          const reserving = RESERVING_STATUSES.includes(l.status);
          const busy = busyLineId != null && busyLineId === l.lineId;
          const stock = stockBySku[l.sku];
          return (
            <tr key={l.lineId || i} className={l.status === 'eliminado' ? styles.removed : ''}>
              <td>
                {l.modelo} ({l.sku})
                <div className={styles.sub}>{l.condition} · x{l.qty} · ${(l.qty * l.unitPrice).toFixed(0)}</div>
              </td>
              <td>
                {onEdit && reserving ? (
                  <>
                    <select className={styles.select} value={l.location} disabled={busy} onChange={(e) => changeLocation(l, e.target.value)}>
                      {Object.entries(LOCATION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                    <select className={styles.select} value={l.delivery} disabled={busy} onChange={(e) => onEdit(l, { delivery: e.target.value })}>
                      {Object.entries(DELIVERY_LABELS).map(([value, label]) => (
                        <option key={value} value={value} disabled={value === 'ahora' && l.location !== 'exhibicion'}>{label}</option>
                      ))}
                    </select>
                  </>
                ) : (
                  <span>{LOCATION_LABELS[l.location] ?? '—'} · {DELIVERY_LABELS[l.delivery] ?? '—'}</span>
                )}
                {stock && <div className={styles.sub}>Disponible: Exhibición {stock.exhibicion} · Rolón {stock.rolon}</div>}
              </td>
              <td><StatusBadge line={l} /></td>
              <td>
                <div className={styles.actions}>
                  {reserving && onSendToFeria && l.delivery === 'retira_feria' && l.status === 'pendiente' && (
                    <button type="button" disabled={busy} onClick={() => onSendToFeria(l)}>Enviado a feria</button>
                  )}
                  {reserving && onDeliver && (
                    <button type="button" disabled={busy} onClick={() => onDeliver(l)}>Hecho</button>
                  )}
                  {reserving && onRemove && (
                    <button type="button" disabled={busy} onClick={() => onRemove(l)}>Eliminar</button>
                  )}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Build**

Run: `cd CLIENT && npm run build`
Expected: `✓ built`.

- [ ] **Step 5: Commit**

```bash
cd feria-alto && git add client/src/lib/feriaLabels.js client/src/components/OrderLines.jsx client/src/components/OrderLines.module.css && git commit -m "feat: etiquetas de entrega y componente OrderLines compartido

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Panel Vendedor — stock, ubicación, entrega y envío

**Files:**
- Modify: `CLIENT/src/pages/VendedorPanel.jsx` (reemplazo completo)
- Modify: `CLIENT/src/pages/VendedorPanel.module.css`

**Interfaces:**
- Consumes: `LOCATION_LABELS`, `DELIVERY_LABELS`, `SHIPPING_COST` (Task 8); `GET /products/search` con `stock` (Task 4); `POST /orders` con `location`, `delivery`, `shipping` (Tasks 3, 5).

- [ ] **Step 1: CSS**

Agregar al final de `VendedorPanel.module.css`, y cambiar `grid-template-columns` de `.lineRow` a `1fr 60px 150px 170px 90px 30px`:

```css
.stockInfo { display: block; margin-bottom: var(--space-1); font-size: var(--font-size-xs); color: var(--color-text-muted); }
.noStock { font-size: var(--font-size-xs); color: var(--color-error); }
.lineSelect {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
}
.problems { color: var(--color-error); font-size: var(--font-size-sm); margin: var(--space-2) 0; }
.shippingGrid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2); }
.shippingGrid .full { grid-column: 1 / -1; }
```

- [ ] **Step 2: Reemplazar `VendedorPanel.jsx` completo**

```jsx
import { useState, useRef } from 'react';
import { apiFetch } from '../lib/api.js';
import { LOCATION_LABELS, DELIVERY_LABELS, SHIPPING_COST } from '../lib/feriaLabels.js';
import styles from './VendedorPanel.module.css';

const PAYMENT_METHODS = [
  { value: 'transferencia', label: 'Transferencia', discountPct: 20 },
  { value: 'efectivo', label: 'Efectivo', discountPct: 15 },
  { value: 'cuotas', label: '3 cuotas', discountPct: 0 },
];

const SEARCH_MIN_CHARS = 6;
const EMPTY_SHIPPING = { street: '', number: '', floor: '', city: '', zip: '', phone: '', notes: '' };
const REQUIRED_SHIPPING = ['street', 'number', 'city', 'zip', 'phone'];

// Devuelve null mientras no haya medio de pago elegido — el descuento depende
// del medio de pago, así que antes de elegirlo no hay precio final que mostrar.
function finalUnitPrice(tablePrice, paymentMethod) {
  const method = PAYMENT_METHODS.find(m => m.value === paymentMethod);
  if (!method) return null;
  return Math.round(tablePrice * (1 - method.discountPct / 100));
}

// Dos líneas del mismo SKU en la misma ubicación compiten por el mismo stock:
// se suman antes de comparar contra el disponible.
function stockProblems(lines) {
  const requested = new Map();
  for (const l of lines) {
    const key = `${l.sku}__${l.location}`;
    requested.set(key, (requested.get(key) || 0) + l.qty);
  }
  const problems = [];
  for (const [key, qty] of requested) {
    const [sku, location] = key.split('__');
    const line = lines.find(l => l.sku === sku && l.location === location);
    const available = line.stock?.[location] ?? 0;
    if (qty > available) problems.push(`${line.modelo} en ${LOCATION_LABELS[location]}: pediste ${qty}, hay ${available}`);
  }
  return problems;
}

function logout() {
  localStorage.removeItem('feria_token');
  localStorage.removeItem('feria_role');
  window.location.reload();
}

export default function VendedorPanel() {
  const seller = JSON.parse(localStorage.getItem('feria_seller') || '{}');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [lines, setLines] = useState([]);
  const [customer, setCustomer] = useState({ name: '', docNumber: '' });
  const [lookupStatus, setLookupStatus] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [shipping, setShipping] = useState(EMPTY_SHIPPING);
  const [status, setStatus] = useState('');
  const searchTimeout = useRef(null);
  const lookupTimeout = useRef(null);

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

  function handleDocNumberChange(value) {
    setCustomer(prev => ({ ...prev, docNumber: value }));
    clearTimeout(lookupTimeout.current);
    setLookupStatus('');
    if (value.trim().length < 6) return;
    lookupTimeout.current = setTimeout(async () => {
      setLookupStatus('Buscando en Odoo...');
      try {
        const { found, partner } = await apiFetch(`/api/feria/customers/lookup?docNumber=${encodeURIComponent(value)}`);
        if (found) {
          setCustomer({ name: partner.name, docNumber: partner.vat || value });
          setLookupStatus('Cliente encontrado en Odoo — datos autocompletados.');
        } else {
          setLookupStatus('No existe en Odoo todavía — se crea al confirmar la venta.');
        }
      } catch {
        setLookupStatus('No se pudo consultar Odoo, se puede seguir cargando a mano.');
      }
    }, 400);
  }

  function addLine(product, condition) {
    const info = product.condiciones[condition];
    const location = product.stock.exhibicion > 0 ? 'exhibicion' : 'rolon';
    setLines(prev => [...prev, {
      sku: product.sku, modelo: product.modelo, condition,
      qty: 1, tablePrice: info.precioTabla, stock: product.stock,
      location, delivery: location === 'exhibicion' ? 'ahora' : 'retira_rolon',
    }]);
    setQuery('');
    setResults([]);
  }

  function updateLine(index, changes) {
    setLines(prev => prev.map((l, i) => {
      if (i !== index) return l;
      const next = { ...l, ...changes };
      // "Se lleva ahora" solo sale de Exhibición.
      if (next.delivery === 'ahora' && next.location !== 'exhibicion') next.delivery = 'retira_rolon';
      return next;
    }));
  }

  function removeLine(index) {
    setLines(prev => prev.filter((_, i) => i !== index));
  }

  const needsShipping = lines.some(l => l.delivery === 'envio');
  const shippingCost = needsShipping ? SHIPPING_COST : 0;
  const total = paymentMethod
    ? lines.reduce((sum, l) => sum + l.qty * finalUnitPrice(l.tablePrice, paymentMethod), 0) + shippingCost
    : null;
  const problems = stockProblems(lines);
  const shippingOk = !needsShipping || REQUIRED_SHIPPING.every(f => shipping[f].trim());

  async function handleSubmit() {
    if (!canSubmit) return;
    setStatus('Confirmando precios y stock actuales...');
    try {
      // Precio y stock se vuelven a pedir recién al enviar: caja puede activar
      // una rebaja y otro vendedor puede reservar la última unidad mientras el
      // pedido está abierto en la tablet. El backend igual vuelve a verificar
      // el stock en una transacción al crear el pedido.
      const productCache = new Map();
      const freshLines = [];
      for (const line of lines) {
        if (!productCache.has(line.sku)) {
          const { products } = await apiFetch(`/api/feria/products/search?q=${encodeURIComponent(line.sku)}`);
          productCache.set(line.sku, products.find(p => p.sku === line.sku) || null);
        }
        const fresh = productCache.get(line.sku);
        const info = fresh?.condiciones?.[line.condition];
        if (!info || !info.disponible || info.precioTabla == null) {
          throw new Error(`No se pudo confirmar el precio actual de ${line.modelo} — sacalo del pedido y volvé a agregarlo.`);
        }
        if (!fresh.stock) {
          throw new Error(`No se pudo verificar el stock de ${line.modelo} (Odoo no responde) — probá de nuevo en unos segundos.`);
        }
        freshLines.push({
          sku: line.sku, modelo: line.modelo, condition: line.condition,
          qty: line.qty, unitPrice: finalUnitPrice(info.precioTabla, paymentMethod),
          // Precio de tabla sin el descuento del medio de pago: a Odoo viaja
          // este como precio unitario y el descuento va aparte.
          listPrice: info.precioTabla,
          location: line.location, delivery: line.delivery,
        });
      }

      setStatus('Enviando...');
      await apiFetch('/api/feria/orders', {
        method: 'POST',
        body: JSON.stringify({ customer, paymentMethod, lines: freshLines, ...(needsShipping ? { shipping } : {}) }),
      });
      setLines([]);
      setCustomer({ name: '', docNumber: '' });
      setPaymentMethod('');
      setShipping(EMPTY_SHIPPING);
      setLookupStatus('');
      setStatus('¡Pedido enviado a caja!');
      setTimeout(() => setStatus(''), 3000);
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    }
  }

  const canSubmit = lines.length > 0 && customer.name.trim() && customer.docNumber.trim()
    && paymentMethod && problems.length === 0 && shippingOk;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span>Vendedor: {seller.name}</span>
        <button type="button" className={styles.logoutBtn} onClick={logout}>Salir</button>
      </header>

      <div className={styles.field}>
        <label className={styles.label}>Buscar producto (SKU o modelo, mínimo 6 caracteres)</label>
        <input
          className={styles.input}
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder="Ej: BCT037MA"
        />
        {results.length > 0 && (
          <ul className={styles.resultsList}>
            {results.map(p => {
              const sinStock = !p.stock || p.stock.exhibicion + p.stock.rolon === 0;
              return (
                <li key={p.sku} className={styles.resultItem}>
                  <span className={styles.resultName}>{p.modelo} ({p.sku})</span>
                  <span className={styles.stockInfo}>
                    {p.stock
                      ? `Exhibición: ${p.stock.exhibicion} · Rolón: ${p.stock.rolon}`
                      : 'Stock no disponible (Odoo no responde)'}
                  </span>
                  <div className={styles.conditionButtons}>
                    {p.condiciones.falla.disponible && (
                      <button type="button" disabled={sinStock} onClick={() => addLine(p, 'falla')}>
                        Falla — ${p.condiciones.falla.precioTabla}
                      </button>
                    )}
                    {p.condiciones.discontinuo.disponible && (
                      <button type="button" disabled={sinStock} onClick={() => addLine(p, 'discontinuo')}>
                        Discontinuo — ${p.condiciones.discontinuo.precioTabla}
                      </button>
                    )}
                    {sinStock && <span className={styles.noStock}>Sin stock</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className={styles.lines}>
        {lines.map((line, i) => (
          <div key={i} className={styles.lineRow}>
            <span className={styles.lineName}>{line.modelo} ({line.condition})</span>
            <input
              className={styles.qtyInput} type="number" min="1" value={line.qty}
              onChange={(e) => updateLine(i, { qty: Number(e.target.value) })}
            />
            <select className={styles.lineSelect} value={line.location} onChange={(e) => updateLine(i, { location: e.target.value })}>
              {Object.entries(LOCATION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label} ({line.stock?.[value] ?? 0})</option>
              ))}
            </select>
            <select className={styles.lineSelect} value={line.delivery} onChange={(e) => updateLine(i, { delivery: e.target.value })}>
              {Object.entries(DELIVERY_LABELS).map(([value, label]) => (
                <option key={value} value={value} disabled={value === 'ahora' && line.location !== 'exhibicion'}>{label}</option>
              ))}
            </select>
            <span>
              {paymentMethod
                ? `$${(line.qty * finalUnitPrice(line.tablePrice, paymentMethod)).toFixed(0)}`
                : '—'}
            </span>
            <button className={styles.removeBtn} onClick={() => removeLine(i)}>✕</button>
          </div>
        ))}
      </div>

      {problems.length > 0 && (
        <div className={styles.problems}>
          {problems.map(p => <p key={p}>Sin stock suficiente — {p}</p>)}
        </div>
      )}

      <div className={styles.total}>
        {paymentMethod
          ? `Total: $${total.toFixed(0)}${needsShipping ? ` (incluye envío $${SHIPPING_COST})` : ''}`
          : 'Elegí un medio de pago para ver el total'}
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Medio de pago (obligatorio)</label>
        <div className={styles.paymentButtons}>
          {PAYMENT_METHODS.map(m => (
            <button
              key={m.value}
              type="button"
              className={`${styles.paymentBtn} ${paymentMethod === m.value ? styles.paymentBtnActive : ''}`}
              onClick={() => setPaymentMethod(m.value)}
            >
              {m.label}{m.discountPct > 0 ? ` (-${m.discountPct}%)` : ''}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Cliente</label>
        <input
          className={styles.input} placeholder="DNI/CUIT"
          value={customer.docNumber} onChange={(e) => handleDocNumberChange(e.target.value)}
        />
        {lookupStatus && <p className={styles.lookupStatus}>{lookupStatus}</p>}
        <input
          className={styles.input} placeholder="Nombre y apellido"
          value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })}
        />
      </div>

      {needsShipping && (
        <div className={styles.field}>
          <label className={styles.label}>Datos de envío (obligatorio, costo ${SHIPPING_COST})</label>
          <div className={styles.shippingGrid}>
            <input className={styles.input} placeholder="Calle *" value={shipping.street} onChange={(e) => setShipping({ ...shipping, street: e.target.value })} />
            <input className={styles.input} placeholder="Número *" value={shipping.number} onChange={(e) => setShipping({ ...shipping, number: e.target.value })} />
            <input className={styles.input} placeholder="Piso / depto" value={shipping.floor} onChange={(e) => setShipping({ ...shipping, floor: e.target.value })} />
            <input className={styles.input} placeholder="Localidad *" value={shipping.city} onChange={(e) => setShipping({ ...shipping, city: e.target.value })} />
            <input className={styles.input} placeholder="Código postal *" value={shipping.zip} onChange={(e) => setShipping({ ...shipping, zip: e.target.value })} />
            <input className={styles.input} placeholder="Teléfono *" value={shipping.phone} onChange={(e) => setShipping({ ...shipping, phone: e.target.value })} />
            <input className={`${styles.input} ${styles.full}`} placeholder="Observaciones / horario" value={shipping.notes} onChange={(e) => setShipping({ ...shipping, notes: e.target.value })} />
          </div>
        </div>
      )}

      {status && <p className={styles.status}>{status}</p>}

      <button className={styles.submitBtn} onClick={handleSubmit} disabled={!canSubmit}>
        Enviar pedido a caja
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Build**

Run: `cd CLIENT && npm run build`
Expected: `✓ built`.

- [ ] **Step 4: Prueba manual** (backend + `npm run dev` levantados)

En `http://localhost:5173/#/vendedor` (PIN de prueba): buscar un SKU con stock en FER → se ve "Exhibición: n · Rolón: m"; un SKU sin stock en FER → botones deshabilitados + "Sin stock". Agregar una línea, cambiar cantidad por encima del disponible → aparece "Sin stock suficiente" y el botón de enviar se deshabilita. Elegir "Envío a domicilio" → aparece el formulario y el total suma $10.000. NO enviar todavía (el envío real se prueba en Task 12).

- [ ] **Step 5: Commit**

```bash
cd feria-alto && git add client/src/pages/VendedorPanel.jsx client/src/pages/VendedorPanel.module.css && git commit -m "feat: vendedor ve stock por ubicación y elige ubicación, entrega y datos de envío

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Vista de entregas (Logística) y ruta `/logistica`

**Files:**
- Create: `CLIENT/src/components/EntregasView.jsx`
- Create: `CLIENT/src/components/EntregasView.module.css`
- Create: `CLIENT/src/pages/LogisticaPanel.jsx`
- Modify: `CLIENT/src/App.jsx`

**Interfaces:**
- Consumes: `OrderLines` (Task 8), `RESERVING_STATUSES`, `DELIVERY_LABELS`, `formatDateTime` (Task 8); `GET /logistics/orders`, `POST .../sent-to-feria`, `POST .../deliver`, `PATCH .../lines/:lineId` (Task 6).
- Produces: `<EntregasView initialFilter="retiros_feria" | "mandar_feria" | "retiro_rolon" | "envio" />` (la usa Caja en Task 11).

- [ ] **Step 1: `EntregasView.module.css`**

```css
.body { padding: var(--space-6); overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: var(--space-4); }
.toolbar { display: flex; gap: var(--space-2); flex-wrap: wrap; align-items: center; }
.filterBtn {
  padding: var(--space-2) var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-surface);
  font-size: var(--font-size-sm);
}
.filterBtnActive { border-color: var(--color-primary); color: var(--color-primary); font-weight: 600; }
.search {
  margin-left: auto;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  min-width: 240px;
}
.card { border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: var(--space-4); }
.cardHeader { display: flex; justify-content: space-between; gap: var(--space-2); }
.meta { color: var(--color-text-muted); font-size: var(--font-size-sm); margin: var(--space-1) 0; }
.error { color: var(--color-error); font-size: var(--font-size-sm); }
.message { font-size: var(--font-size-sm); color: var(--color-error); }
.empty { color: var(--color-text-muted); }
```

- [ ] **Step 2: `EntregasView.jsx`**

```jsx
import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api.js';
import { RESERVING_STATUSES, formatDateTime } from '../lib/feriaLabels.js';
import OrderLines from './OrderLines.jsx';
import styles from './EntregasView.module.css';

const FILTERS = [
  // Lo que el cliente viene a buscar a la feria (ya enviado o todavía no).
  { value: 'retiros_feria', label: 'Retiros en feria', match: l => l.delivery === 'retira_feria' },
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
            busyLineId={busy.startsWith(`${order.id}:`) ? busy.slice(order.id.length + 1) : null}
            onSendToFeria={(l) => run(order, l, '/sent-to-feria', { method: 'POST' })}
            onDeliver={(l) => run(order, l, '/deliver', { method: 'POST' })}
            onEdit={(l, changes) => editLine(order, l, changes)}
          />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: `pages/LogisticaPanel.jsx`**

```jsx
import EntregasView from '../components/EntregasView.jsx';
import styles from './CajaPanel.module.css';

function logout() {
  localStorage.removeItem('feria_token');
  localStorage.removeItem('feria_role');
  window.location.reload();
}

// Mismo login que caja (rol 'caja'): para la feria no hace falta un rol
// aparte, y así el admin en caja puede resolver cualquier cosa desde acá.
export default function LogisticaPanel() {
  return (
    <div className={styles.page}>
      <nav className={styles.tabs}>
        <span className={`${styles.tabBtn} ${styles.tabBtnActive}`}>Logística</span>
        <button type="button" className={styles.logoutBtn} onClick={logout}>Salir</button>
      </nav>
      <EntregasView initialFilter="mandar_feria" />
    </div>
  );
}
```

- [ ] **Step 4: Ruta en `App.jsx`**

Agregar `import LogisticaPanel from './pages/LogisticaPanel.jsx';` y, debajo de la ruta `/caja`:

```jsx
      <Route path="/logistica" element={hasSession('caja') ? <LogisticaPanel /> : <CajaLogin />} />
```

- [ ] **Step 5: Build**

Run: `cd CLIENT && npm run build`
Expected: `✓ built`.

- [ ] **Step 6: Commit**

```bash
cd feria-alto && git add client/src/components/EntregasView.jsx client/src/components/EntregasView.module.css client/src/pages/LogisticaPanel.jsx client/src/App.jsx && git commit -m "feat: panel de logística (/logistica) con vista de entregas por tipo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Panel Caja — acciones sobre el pedido y pestaña Entregas

**Files:**
- Modify: `CLIENT/src/pages/CajaPanel.jsx` (reemplazar `PedidosTab` y el `export default`; `RebajasTab` NO se toca)
- Modify: `CLIENT/src/pages/CajaPanel.module.css`

**Interfaces:**
- Consumes: `OrderLines`, `orderTotal`, `SHIPPING_COST` (Task 8); `EntregasView` (Task 10); rutas `DELETE/PATCH .../lines/:lineId`, `POST .../cancel`, `POST .../confirm` (Tasks 6–7); `GET /products/search` con `stock` (Task 4).

- [ ] **Step 1: CSS**

Agregar al final de `CajaPanel.module.css`:

```css
.actionsRow { display: flex; gap: var(--space-2); margin-top: var(--space-4); }
.cancelBtn {
  padding: var(--space-3) var(--space-6);
  border: 1px solid var(--color-error);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-error);
}
.message { font-size: var(--font-size-sm); margin: var(--space-2) 0; }
```

- [ ] **Step 2: Imports**

Al principio de `CajaPanel.jsx`, debajo de `import { apiFetch } ...`, agregar:

```jsx
import OrderLines from '../components/OrderLines.jsx';
import EntregasView from '../components/EntregasView.jsx';
import { orderTotal, SHIPPING_COST } from '../lib/feriaLabels.js';
```

- [ ] **Step 3: Reemplazar `function PedidosTab() { ... }` completo por:**

```jsx
function PedidosTab() {
  const [orders, setOrders] = useState([]);
  const [selected, setSelected] = useState(null);
  const [stockBySku, setStockBySku] = useState({});
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

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
    setMessage('');
    setStockBySku({});
    loadStock(order);
  }

  async function runAction(key, request, successMessage = '') {
    setBusy(key);
    setMessage('');
    try {
      const { order } = await request();
      setSelected(order);
      loadStock(order);
      if (successMessage) setMessage(successMessage);
      loadOrders();
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setBusy('');
    }
  }

  function removeLine(line) {
    runAction(line.lineId, () => apiFetch(`/api/feria/orders/${selected.id}/lines/${line.lineId}`, { method: 'DELETE' }));
  }

  function editLine(line, changes) {
    runAction(line.lineId, () => apiFetch(`/api/feria/orders/${selected.id}/lines/${line.lineId}`, {
      method: 'PATCH', body: JSON.stringify(changes),
    }));
  }

  function handleCancel() {
    if (!window.confirm('¿Cancelar el pedido? Se libera todo el stock reservado.')) return;
    runAction('cancel', () => apiFetch(`/api/feria/orders/${selected.id}/cancel`, { method: 'POST' }), 'Pedido cancelado.');
  }

  async function handleConfirm() {
    if (!selected) return;
    setBusy('confirm');
    setMessage('');
    try {
      // La facturación automática quedó desactivada en el backend (el pedido
      // igual se crea y se confirma en Odoo), así que vamos directo al confirm.
      const { order } = await apiFetch(`/api/feria/orders/${selected.id}/confirm`, { method: 'POST' });
      setSelected(null);
      setMessage(order.errorDetail ? `Confirmado con aviso: ${order.errorDetail}` : 'Pedido confirmado en Odoo.');
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
      setMessage(`Error confirmando: ${err.message}`);
      loadOrders();
    } finally {
      setBusy('');
    }
  }

  const editable = selected && ['pendiente', 'error'].includes(selected.status);

  return (
    <div className={styles.tabBody}>
      <aside className={styles.list}>
        <h2 className={styles.listTitle}>Pedidos pendientes ({orders.length})</h2>
        {orders.map(order => (
          <button
            key={order.id}
            className={[
              styles.orderCard,
              order.status === 'error' ? styles.orderCardError : '',
              selected?.id === order.id ? styles.orderCardActive : '',
            ].filter(Boolean).join(' ')}
            onClick={() => openOrder(order)}
          >
            <strong>{order.customer.name}</strong>
            <span>{order.sellerName}</span>
            {order.status === 'error' && <span className={styles.errorTag}>Falló — reintentar</span>}
          </button>
        ))}
        {orders.length === 0 && <p className={styles.empty}>No hay pedidos pendientes.</p>}
      </aside>

      <main className={styles.detail}>
        {message && <p className={styles.message}>{message}</p>}
        {!selected ? (
          <p className={styles.empty}>Seleccioná un pedido de la lista.</p>
        ) : (
          <>
            <h2>{selected.customer.name}</h2>
            <p className={styles.meta}>Vendedor: {selected.sellerName} · DNI/CUIT: {selected.customer.docNumber}</p>
            {selected.status === 'cancelado' && <p className={styles.error}>Pedido cancelado.</p>}

            <OrderLines
              lines={selected.lines}
              stockBySku={stockBySku}
              busyLineId={busy}
              onEdit={editable ? editLine : undefined}
              onRemove={editable ? removeLine : undefined}
            />

            {selected.shipping && (
              <p className={styles.meta}>
                Envío (${SHIPPING_COST}): {selected.shipping.street} {selected.shipping.number} {selected.shipping.floor}
                {' '}— {selected.shipping.city} ({selected.shipping.zip}) · Tel {selected.shipping.phone}
                {selected.shipping.notes ? ` · ${selected.shipping.notes}` : ''}
              </p>
            )}
            <p className={styles.total}>Total: ${orderTotal(selected).toFixed(0)}</p>
            <p className={styles.meta}>Método de pago cargado: {selected.paymentMethod}</p>

            {selected.status === 'error' && (
              <p className={styles.error}>Error del intento anterior: {selected.errorDetail}</p>
            )}

            {editable && (
              <div className={styles.actionsRow}>
                <button className={styles.confirmBtn} onClick={handleConfirm} disabled={!!busy}>
                  {busy === 'confirm' ? 'Confirmando...' : (selected.status === 'error' ? 'Reintentar' : 'Confirmar venta')}
                </button>
                <button className={styles.cancelBtn} onClick={handleCancel} disabled={!!busy}>Cancelar pedido</button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Reemplazar `export default function CajaPanel() { ... }` por:**

```jsx
const TABS = [
  { value: 'pedidos', label: 'Pedidos' },
  { value: 'entregas', label: 'Entregas' },
  { value: 'rebajas', label: 'Rebajas por SKU' },
];

export default function CajaPanel() {
  const [tab, setTab] = useState('pedidos');

  return (
    <div className={styles.page}>
      <nav className={styles.tabs}>
        {TABS.map(t => (
          <button key={t.value} className={`${styles.tabBtn} ${tab === t.value ? styles.tabBtnActive : ''}`} onClick={() => setTab(t.value)}>
            {t.label}
          </button>
        ))}
        <button type="button" className={styles.logoutBtn} onClick={logout}>Salir</button>
      </nav>
      {tab === 'pedidos' && <PedidosTab />}
      {/* Caja arranca en "Retiros en feria" (lo que el cliente viene a buscar),
          pero puede ver y marcar todo, igual que Logística. */}
      {tab === 'entregas' && <EntregasView initialFilter="retiros_feria" />}
      {tab === 'rebajas' && <RebajasTab />}
    </div>
  );
}
```

- [ ] **Step 5: Build**

Run: `cd CLIENT && npm run build`
Expected: `✓ built`.

- [ ] **Step 6: Commit**

```bash
cd feria-alto && git add client/src/pages/CajaPanel.jsx client/src/pages/CajaPanel.module.css && git commit -m "feat: caja elimina/edita líneas, cancela pedidos, ve stock en vivo y tiene pestaña Entregas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Configuración, README y prueba punta a punta real

**Files:**
- Modify: `feria-alto/README.md`
- (local, sin commit) `BACKEND/.env` — ya actualizado en Task 4

- [ ] **Step 1: README**

En `feria-alto/README.md`:
- En **Rutas**, agregar: `` - `/logistica` — mismo login que caja: pedidos confirmados con entregas pendientes (mandar a feria, retiro en Rolón, envío a domicilio). ``
- En **Deploy → Backend**, reemplazar la lista de variables nuevas por: `FERIA_AUTH_SECRET`, `ODOO_FERIA_TEAM_NAME`, `ODOO_FERIA_PRICELIST_NAME`, `ODOO_FERIA_WAREHOUSE_ID`, `ODOO_FERIA_LOCATION_EXHIBICION_ID`, `ODOO_FERIA_LOCATION_ROLON_ID`, `ODOO_FERIA_SHIPPING_PRODUCT_NAME` (ver `Reportes/backend/.env.example`).
- En **Antes del primer uso real**, agregar: `` - Borrar el vendedor de prueba `vendedor-prueba` (PIN 9090) de `feria_sellers`. `` y `` - El stock sale de Odoo en vivo (almacén Feria: `FER/Stock/exhibicion` y `FER/Stock/Rolon`); la columna Stock del Excel ya no se usa. Nadie debe sacar stock del almacén Feria por fuera de la app. ``

- [ ] **Step 2: Commit README**

```bash
cd feria-alto && git add README.md && git commit -m "docs: README con /logistica, variables de Odoo nuevas y stock en vivo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Prueba punta a punta real (con OK explícito del usuario — crea pedido real y mueve stock)**

Levantar backend y frontend. Con el vendedor de prueba y el cliente acordado (DNI 41835755, "Altorancho Nordelta"), en `/#/vendedor` cargar un pedido **mixto** con transferencia:
1. 1 u. de un SKU con stock en Exhibición → "Se lleva ahora".
2. 1 u. de un SKU con stock en Rolón → "Retira en Rolón".
3. 1 u. de un SKU con stock en Rolón → "Envío a domicilio" (completar datos de envío).

Verificar:
- Al crear: la disponibilidad de esos SKUs baja en 1 en cada ubicación (buscarlos de nuevo).
- En `/#/caja` → Pedidos: se ven las 3 líneas con estado ⏳, stock y envío; total = suma con 20% + $10.000.
- Confirmar → mensaje "Pedido confirmado en Odoo." En Odoo: pedido en almacén Feria, 4 líneas (3 productos + "Otros envíos terciarizados"), precios sin IVA con Desc. 20% (envío 8.264,46 sin desc.), **total del pedido = total de la app** (±$0,05), medio de pago Transferencia, dirección de entrega = contacto hijo con los datos cargados; remito original `done` solo con la línea 1 desde `FER/Stock/exhibicion`, y un backorder con las líneas 2 y 3.
- En `/#/logistica` → "Retiro en Rolón": aparece la línea 2; "Hecho" → pasa a ✅ y en Odoo sale de `FER/Stock/Rolon`. "Envío a domicilio": aparece la 3 con la dirección; "Hecho" → backorder `done`.
- Al final, la disponibilidad de los 3 SKUs = stock Odoo (sin reservas colgadas).

Anotar el número de pedido de Odoo para que el usuario lo cancele/devuelva.

- [ ] **Step 4: Actualizar memoria del proyecto** con el estado final (qué quedó probado, pedido de Odoo a revertir, variables a cargar en Railway).
