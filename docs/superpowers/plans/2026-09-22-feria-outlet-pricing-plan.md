# Feria Outlet — Precios por Excel, cliente por DNI y panel público — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar la selección manual de pricelist de Odoo por precios de
feria importados de un Excel (condición Falla/Discontinuo + rebajas por SKU
+ descuento fijo por medio de pago), agregar autocompletado de cliente por
DNI contra Odoo, y sumar un panel público sin login para que el cliente
consulte precios por SKU.

**Architecture:** Los precios de feria viven en Firestore
(`feria_products`, doc id = SKU), cargados una vez por un script de import
que lee el Excel y sincronizados a un cache en memoria del backend vía
`onSnapshot` (así el admin puede activar rebajas en caliente sin reiniciar
el servidor). Las rutas HTTP nuevas/ajustadas viven en el mismo
`feriaRoutes.mjs` que ya existe. El precio final de cada línea del pedido se
calcula 100% en nuestro backend (condición + rebaja activa + descuento del
medio de pago) y se manda a Odoo como `price_unit` explícito con
`discount: 0` — no se usa el motor de pricelists de Odoo para calcular nada,
solo se manda `pricelist_id` de la pricelist "Feria Octubre 2026" para que
los reportes clasifiquen bien la venta. El `product_id` de Odoo (necesario
para el `sale.order`) se resuelve por SKU recién al confirmar la venta, no
al buscar (la búsqueda ahora es contra el cache de Firestore, no contra
Odoo).

**Tech Stack:** Node.js/Express (`Reportes/backend`), Firestore
(`firebase-admin`), React + Vite (`feria-alto/client`), `xlsx` (SheetJS)
para leer el Excel en el script de import.

**Spec:** `docs/superpowers/specs/2026-09-18-feria-outlet-design.md`
(sección "Actualización 2026-09-22" tiene el detalle de estas decisiones).

**Continúa de:** `docs/superpowers/plans/2026-09-18-feria-outlet-plan.md`
(Tasks 1-3, ya hechas y commiteadas en `Reportes` rama `feature/feria-outlet`
— Task 3 todavía necesita el paso de revisión antes de mergear, pero eso es
independiente de este plan). **Este plan reemplaza por completo las Tasks
4-7 del plan original** (sus briefs en
`.superpowers/sdd/2026-09-18-feria-outlet-plan/task-4-brief.md` a
`task-7-brief.md` quedan obsoletas — no ejecutar, ninguna se había empezado
a implementar). La numeración de tasks continúa desde 8 para no confundir
con esas briefs viejas.

## Global Constraints

- Medios de pago: exactamente 3, valores internos `transferencia` (20%
  descuento), `efectivo` (15% descuento), `cuotas` (0%, precio de lista).
  Elegir medio de pago es obligatorio en el panel Vendedor.
- Condiciones de venta: exactamente 2, `falla` y `discontinuo`. Un SKU puede
  tener una, la otra, o ambas — nunca asumir que las dos existen.
- Niveles de rebaja: `0` (normal), `1`, `2` — uno por condición, por SKU,
  controlado independientemente (dos banderas por SKU: `rebajaFallaActiva`,
  `rebajaDiscontinuoActiva`).
- El buscador de productos (panel Vendedor y panel público) no debe listar
  resultados hasta que el usuario haya escrito al menos 6 caracteres —
  requisito de UX confirmado (el catálogo tiene miles de SKUs).
- El panel público (`/feria`) nunca debe exponer `stock`, `proveedor`,
  `origen`, costos ni márgenes — solo `sku`, `modelo`, `color` y precios
  finales por medio de pago.
- DNI/CUIT del cliente es obligatorio en el panel Vendedor (antes era
  opcional).
- No se reintroduce el descuento manual por línea que tenía el diseño
  original — ver spec, sección "Actualización 2026-09-22".
- `Reportes/backend` descubre tests vía `test/**/*.test.mjs` (no
  co-localizados) — mismo patrón ya usado en Tasks 1-3.
- Todo el trabajo de backend va en el worktree
  `Reportes/.worktrees/feature-feria-outlet`, rama `feature/feria-outlet`
  (mismo worktree que Tasks 1-3, no crear uno nuevo).
- Todo el trabajo de frontend va en `feria-alto`, rama `master` (ídem plan
  original — repo nuevo, sin nada más que proteger).

---

### Task 8: Modelo de precios de feria en Firestore + import desde Excel

**Repo/dir:** `Reportes`, worktree
`Reportes/.worktrees/feature-feria-outlet/backend`

**Files:**
- Create: `backend/feriaPricing.mjs`
- Create: `backend/test/feriaPricing.test.mjs`
- Create: `backend/feriaProducts.mjs`
- Create: `backend/scripts/importFeriaPrices.mjs`
- Modify: `backend/package.json` (agregar `devDependencies` y un script)

**Interfaces:**
- Produces (usado por Task 9 y Task 10):
  - `PAYMENT_METHODS` — objeto `{ transferencia: {label, discountPct}, efectivo: {...}, cuotas: {...} }` (`feriaPricing.mjs`)
  - `activeRebajaField(condition)` → `'rebajaFallaActiva' | 'rebajaDiscontinuoActiva'` (`feriaPricing.mjs`)
  - `tablePrice(product, condition, rebajaLevel)` → `number | null` (`feriaPricing.mjs`)
  - `computeFinalPrice(product, condition, rebajaLevel, paymentMethod)` → `number | null` (`feriaPricing.mjs`)
  - `startFeriaProductsCache()` → `void`, arranca el listener de Firestore (`feriaProducts.mjs`)
  - `searchFeriaProducts(query)` → `Array<product>` donde `product = { sku, modelo, color, proveedor, origen, stock, precioFalla, precioDiscontinuo, precioRebaja1Falla, precioRebaja2Falla, precioRebaja1Discontinuo, precioRebaja2Discontinuo, rebajaFallaActiva, rebajaDiscontinuoActiva }` (`feriaProducts.mjs`)
  - `getFeriaProduct(sku)` → `product | null` (`feriaProducts.mjs`)
  - `setRebajaActiva(sku, condition, level)` → `Promise<void>`, lanza si el SKU no existe o `condition`/`level` son inválidos (`feriaProducts.mjs`)

- [ ] **Step 1: Write the failing tests for `feriaPricing.mjs`**

Create `backend/test/feriaPricing.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAYMENT_METHODS, tablePrice, computeFinalPrice } from '../feriaPricing.mjs';

const product = {
  precioFalla: 27990,
  precioDiscontinuo: 35990,
  precioRebaja1Falla: 21990,
  precioRebaja2Falla: 15990,
  precioRebaja1Discontinuo: 27990,
  precioRebaja2Discontinuo: 19990,
};

test('PAYMENT_METHODS tiene exactamente los 3 medios de pago con sus %', () => {
  assert.deepEqual(Object.keys(PAYMENT_METHODS).sort(), ['cuotas', 'efectivo', 'transferencia']);
  assert.equal(PAYMENT_METHODS.transferencia.discountPct, 20);
  assert.equal(PAYMENT_METHODS.efectivo.discountPct, 15);
  assert.equal(PAYMENT_METHODS.cuotas.discountPct, 0);
});

test('tablePrice devuelve el precio normal cuando la rebaja activa es 0', () => {
  assert.equal(tablePrice(product, 'falla', 0), 27990);
  assert.equal(tablePrice(product, 'discontinuo', 0), 35990);
});

test('tablePrice devuelve el precio de rebaja 1 o 2 según el nivel', () => {
  assert.equal(tablePrice(product, 'falla', 1), 21990);
  assert.equal(tablePrice(product, 'falla', 2), 15990);
  assert.equal(tablePrice(product, 'discontinuo', 1), 27990);
  assert.equal(tablePrice(product, 'discontinuo', 2), 19990);
});

test('tablePrice devuelve null si el SKU no tiene esa condición cargada', () => {
  assert.equal(tablePrice({ precioFalla: null }, 'falla', 0), null);
});

test('tablePrice rechaza una condición inválida', () => {
  assert.throws(() => tablePrice(product, 'nueva', 0), /Condición inválida/);
});

test('computeFinalPrice aplica el % de descuento del medio de pago sobre el precio de tabla', () => {
  assert.equal(computeFinalPrice(product, 'falla', 0, 'transferencia'), Math.round(27990 * 0.8));
  assert.equal(computeFinalPrice(product, 'falla', 0, 'efectivo'), Math.round(27990 * 0.85));
  assert.equal(computeFinalPrice(product, 'falla', 0, 'cuotas'), 27990);
});

test('computeFinalPrice combina rebaja activa y medio de pago', () => {
  assert.equal(computeFinalPrice(product, 'falla', 2, 'efectivo'), Math.round(15990 * 0.85));
});

test('computeFinalPrice devuelve null si la condición no tiene precio cargado', () => {
  assert.equal(computeFinalPrice({ precioFalla: null }, 'falla', 0, 'efectivo'), null);
});

test('computeFinalPrice rechaza un medio de pago inválido', () => {
  assert.throws(() => computeFinalPrice(product, 'falla', 0, 'cheque'), /Método de pago inválido/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `backend/`): `npm test`
Expected: FAIL — `feriaPricing.mjs` no existe.

- [ ] **Step 3: Write `backend/feriaPricing.mjs`**

```js
export const PAYMENT_METHODS = {
  transferencia: { label: 'Transferencia', discountPct: 20 },
  efectivo: { label: 'Efectivo', discountPct: 15 },
  cuotas: { label: '3 cuotas', discountPct: 0 },
};

const CONDITIONS = new Set(['falla', 'discontinuo']);

export function activeRebajaField(condition) {
  if (!CONDITIONS.has(condition)) throw new Error(`Condición inválida: ${condition}`);
  return condition === 'falla' ? 'rebajaFallaActiva' : 'rebajaDiscontinuoActiva';
}

// Precio de tabla para una condición (falla/discontinuo) según el nivel de
// rebaja vigente para ESA condición en ese SKU. Devuelve null si el SKU no
// tiene precio cargado para esa condición (no todos los SKU tienen las dos).
export function tablePrice(product, condition, rebajaLevel) {
  if (!CONDITIONS.has(condition)) throw new Error(`Condición inválida: ${condition}`);
  const suffix = condition === 'falla' ? 'Falla' : 'Discontinuo';
  const field = rebajaLevel === 1 ? `precioRebaja1${suffix}`
    : rebajaLevel === 2 ? `precioRebaja2${suffix}`
    : `precio${suffix}`;
  return product[field] ?? null;
}

// Precio final que paga el cliente: precio de tabla (condición + rebaja
// activa de esa condición) con el descuento fijo del medio de pago elegido.
// Devuelve null si el SKU no tiene precio cargado para esa condición.
export function computeFinalPrice(product, condition, rebajaLevel, paymentMethod) {
  const method = PAYMENT_METHODS[paymentMethod];
  if (!method) throw new Error(`Método de pago inválido: ${paymentMethod}`);
  const base = tablePrice(product, condition, rebajaLevel);
  if (base == null) return null;
  return Math.round(base * (1 - method.discountPct / 100));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `backend/`): `npm test`
Expected: PASS (104 tests — 95 previas + 9 nuevas)

- [ ] **Step 5: Write `backend/feriaProducts.mjs`**

```js
import { getDb } from './firestore.mjs';

const COLLECTION = 'feria_products';
let cache = new Map();
let unsubscribe = null;

// Mantiene un cache en memoria de todo `feria_products`, actualizado en
// tiempo real vía onSnapshot — así el admin puede activar una rebaja desde
// el panel Caja y el buscador del panel Vendedor/público la refleja al
// toque, sin tener que reiniciar el servidor ni pegarle a Firestore en cada
// búsqueda (el catálogo tiene ~3000 SKUs, cabe cómodo en memoria).
export function startFeriaProductsCache() {
  if (unsubscribe) return;
  const db = getDb();
  unsubscribe = db.collection(COLLECTION).onSnapshot(
    (snap) => {
      const next = new Map();
      snap.forEach((doc) => next.set(doc.id, { sku: doc.id, ...doc.data() }));
      cache = next;
      console.log(`[feriaProducts] Cache actualizado: ${cache.size} SKUs`);
    },
    (err) => console.error('[feriaProducts] Error escuchando feria_products:', err.message)
  );
}

export function searchFeriaProducts(query) {
  const q = (query ?? '').trim().toUpperCase();
  if (q.length < 3) return [];
  const results = [];
  for (const product of cache.values()) {
    const matches = product.sku.toUpperCase().includes(q) || (product.modelo ?? '').toUpperCase().includes(q);
    if (!matches) continue;
    results.push(product);
    if (results.length >= 30) break;
  }
  return results;
}

export function getFeriaProduct(sku) {
  return cache.get((sku ?? '').toUpperCase()) ?? null;
}

export async function setRebajaActiva(sku, condition, level) {
  if (!['falla', 'discontinuo'].includes(condition)) throw new Error(`Condición inválida: ${condition}`);
  if (![0, 1, 2].includes(level)) throw new Error(`Nivel de rebaja inválido: ${level}`);
  const field = condition === 'falla' ? 'rebajaFallaActiva' : 'rebajaDiscontinuoActiva';
  const skuId = sku.toUpperCase();
  const db = getDb();
  const doc = await db.collection(COLLECTION).doc(skuId).get();
  if (!doc.exists) throw new Error(`SKU no encontrado: ${sku}`);
  await db.collection(COLLECTION).doc(skuId).update({ [field]: level, updatedAt: new Date() });
}
```

- [ ] **Step 6: Add the `xlsx` dependency and the import script command**

Modify `backend/package.json` — add a `devDependencies` block (no existe
todavía en este archivo) y un script nuevo:

```json
{
  "name": "altorancho-reportes-backend",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node index.mjs",
    "dev": "node --watch index.mjs",
    "test": "node --test test/**/*.test.mjs",
    "backfill": "node backfill.mjs",
    "import:feria-prices": "node scripts/importFeriaPrices.mjs"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.120.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.18.2",
    "firebase-admin": "^12.0.0",
    "node-cron": "^3.0.3",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "xlsx": "^0.18.5"
  }
}
```

Run (from `backend/`): `npm install`
Expected: instala `xlsx` limpio.

- [ ] **Step 7: Write `backend/scripts/importFeriaPrices.mjs`**

```js
import 'dotenv/config';
import XLSX from 'xlsx';
import { getDb } from '../firestore.mjs';

const filePath = process.argv[2];
if (!filePath) {
  console.error('Uso: node scripts/importFeriaPrices.mjs <ruta-al-excel>');
  process.exit(1);
}

const COLUMN_MAP = {
  SKU: 'sku',
  Modelo: 'modelo',
  Color: 'color',
  Proveedor: 'proveedor',
  Origen: 'origen',
  Stock: 'stock',
  'Precio Discontinuo': 'precioDiscontinuo',
  'Precio Falla': 'precioFalla',
  'Precio Rebaja 1 Falla': 'precioRebaja1Falla',
  'Precio Rebaja 2 Falla': 'precioRebaja2Falla',
  'Precio Rebaja 1 Discontinuo': 'precioRebaja1Discontinuo',
  'Precio Rebaja 2 Discontinuo': 'precioRebaja2Discontinuo',
};
const NUMERIC_FIELDS = new Set([
  'stock', 'precioDiscontinuo', 'precioFalla',
  'precioRebaja1Falla', 'precioRebaja2Falla',
  'precioRebaja1Discontinuo', 'precioRebaja2Discontinuo',
]);

function normalizeRow(row) {
  const doc = {};
  for (const [excelCol, field] of Object.entries(COLUMN_MAP)) {
    if (field === 'sku') continue;
    const value = row[excelCol];
    doc[field] = NUMERIC_FIELDS.has(field) ? (typeof value === 'number' ? value : null) : (value ?? null);
  }
  return doc;
}

async function main() {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets['Precios Feria'];
  if (!sheet) throw new Error('No se encontró la hoja "Precios Feria" en el excel');
  const rows = XLSX.utils.sheet_to_json(sheet);

  const db = getDb();
  const collection = db.collection('feria_products');
  const existingSnap = await collection.get();
  const existingSkus = new Set(existingSnap.docs.map((d) => d.id));

  let batch = db.batch();
  let opsInBatch = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!row.SKU) { skipped++; continue; }
    const sku = String(row.SKU).trim().toUpperCase();
    const payload = { ...normalizeRow(row), updatedAt: new Date() };
    if (!existingSkus.has(sku)) {
      // Docs nuevos arrancan sin rebaja activa. Docs existentes NO tocan
      // estos dos campos acá (merge:true solo escribe lo que mandamos) —
      // así un re-import con precios actualizados no resetea una rebaja
      // que el admin ya activó a mano durante el evento.
      payload.rebajaFallaActiva = 0;
      payload.rebajaDiscontinuoActiva = 0;
      created++;
    } else {
      updated++;
    }
    batch.set(collection.doc(sku), payload, { merge: true });
    opsInBatch++;
    if (opsInBatch === 400) {
      await batch.commit();
      batch = db.batch();
      opsInBatch = 0;
    }
  }
  if (opsInBatch > 0) await batch.commit();

  console.log(`[importFeriaPrices] Listo. Creados: ${created}, actualizados: ${updated}, filas sin SKU: ${skipped}, total filas: ${rows.length}`);
}

main().catch((err) => {
  console.error('[importFeriaPrices] Error:', err.message);
  process.exit(1);
});
```

- [ ] **Step 8: Run the import against the real Excel**

Run (from `backend/`):
`npm run import:feria-prices -- "C:\Users\Usuario\Downloads\Precios Feria_4.xlsx"`
Expected: termina sin error, imprime algo como
`Creados: 3067, actualizados: 0, filas sin SKU: 0, total filas: 3067`.
Verificar a mano en la consola de Firestore que la colección
`feria_products` tiene documentos con esos campos.

- [ ] **Step 9: Run the full test suite to make sure nothing broke**

Run (from `backend/`): `npm test`
Expected: PASS (104 tests)

- [ ] **Step 10: Commit**

```bash
git add backend/feriaPricing.mjs backend/test/feriaPricing.test.mjs backend/feriaProducts.mjs backend/scripts/importFeriaPrices.mjs backend/package.json backend/package-lock.json
git commit -m "feat(feria): modelo de precios (falla/discontinuo + rebajas) e import desde excel"
```

---

### Task 9: Rutas de productos/precios (vendedor, admin y público) + wiring

**Repo/dir:** `Reportes`, worktree
`Reportes/.worktrees/feature-feria-outlet/backend`

**Files:**
- Modify: `backend/feriaRoutes.mjs` (reemplaza la ruta vieja
  `GET /products/search` que pegaba contra Odoo; agrega rutas de rebaja y
  la ruta pública; ya no monta `GET /pricelists` — el vendedor dejó de
  elegir pricelist a mano)
- Modify: `backend/index.mjs` (arrancar el cache de productos al levantar
  el server)

**Interfaces:**
- Consumes: todo lo que produce Task 8 (`feriaPricing.mjs`,
  `feriaProducts.mjs`).
- Produces (usado por Tasks 12-14, frontend):
  - `GET /api/feria/products/search?q=` (auth) → `{ products: [{ sku, modelo, color, stock, condiciones: { falla: {disponible, precioTabla, rebajaActiva}, discontinuo: {...} } }] }`
  - `PATCH /api/feria/products/:sku/rebaja` (auth, rol `caja`) body
    `{ condition: 'falla'|'discontinuo', level: 0|1|2 }` →
    `{ product: {...} }` con la misma forma que arriba (via `getFeriaProduct`)
  - `GET /api/feria/public/products/search?q=` (SIN auth) →
    `{ products: [{ sku, modelo, color, precios: { falla?: { transferencia: {label, precio}, efectivo: {...}, cuotas: {...} }, discontinuo?: {...} } }] }`
    (solo incluye las condiciones que el SKU tiene disponibles)

- [ ] **Step 1: Modify `backend/feriaRoutes.mjs`**

Reemplazar el bloque de imports del principio del archivo:

```js
import { Router } from 'express';
import { requireFeriaAuth, requireFeriaRole, validateSellerPin, validateCajaCredentials, generateToken } from './feriaAuth.mjs';
import {
  createOrder, listOrdersByStatus, getOrderById,
  updateOrderPayment, saveOdooOrderId, markOrderConfirmed, markOrderError,
} from './feriaOrders.mjs';
import {
  findOrCreatePartner, findSalesTeamId, findPricelistId, findProductIdBySku,
  buildSaleOrderPayload, createSaleOrder, confirmSaleOrder, createInvoiceForOrder,
} from './feriaOdoo.mjs';
import { searchFeriaProducts, getFeriaProduct, setRebajaActiva } from './feriaProducts.mjs';
import { PAYMENT_METHODS, tablePrice, computeFinalPrice, activeRebajaField } from './feriaPricing.mjs';
```

(`findPricelistId` y `findProductIdBySku` los agrega Task 10 en
`feriaOdoo.mjs` — esta task los importa ya, así el archivo queda completo
recién cuando Task 10 termine; se corre `npm test` de las dos tasks juntas
antes del commit final de Task 10, no de esta).

Reemplazar la ruta vieja `GET /pricelists` y `GET /products/search`
(el vendedor ya no elige pricelist a mano, y la búsqueda de productos ahora
es contra el cache de Firestore, no contra Odoo) por:

```js
function buildConditionsPayload(product) {
  const conditions = {};
  for (const condition of ['falla', 'discontinuo']) {
    const priceField = condition === 'falla' ? 'precioFalla' : 'precioDiscontinuo';
    const rebajaActiva = product[activeRebajaField(condition)] ?? 0;
    conditions[condition] = product[priceField] != null
      ? { disponible: true, precioTabla: tablePrice(product, condition, rebajaActiva), rebajaActiva }
      : { disponible: false, precioTabla: null, rebajaActiva: 0 };
  }
  return conditions;
}

router.get('/products/search', requireFeriaAuth, async (req, res) => {
  const q = req.query.q?.trim();
  if (!q) return res.json({ products: [] });
  const products = searchFeriaProducts(q).map((p) => ({
    sku: p.sku, modelo: p.modelo, color: p.color, stock: p.stock ?? null,
    condiciones: buildConditionsPayload(p),
  }));
  res.json({ products });
});

router.patch('/products/:sku/rebaja', requireFeriaAuth, requireFeriaRole('caja'), async (req, res) => {
  try {
    const { condition, level } = req.body;
    await setRebajaActiva(req.params.sku, condition, level);
    const product = getFeriaProduct(req.params.sku);
    res.json({
      product: { sku: product.sku, modelo: product.modelo, color: product.color, condiciones: buildConditionsPayload(product) },
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/public/products/search', async (req, res) => {
  const q = req.query.q?.trim();
  if (!q) return res.json({ products: [] });
  const products = searchFeriaProducts(q).map((p) => {
    const precios = {};
    for (const condition of ['falla', 'discontinuo']) {
      const priceField = condition === 'falla' ? 'precioFalla' : 'precioDiscontinuo';
      if (p[priceField] == null) continue;
      const rebajaActiva = p[activeRebajaField(condition)] ?? 0;
      precios[condition] = Object.fromEntries(
        Object.entries(PAYMENT_METHODS).map(([method, info]) => [
          method,
          { label: info.label, precio: computeFinalPrice(p, condition, rebajaActiva, method) },
        ])
      );
    }
    return { sku: p.sku, modelo: p.modelo, color: p.color, precios };
  });
  res.json({ products });
});
```

Dejar el resto de las rutas (`/auth/vendedor`, `/auth/caja`, `/orders`,
`/orders/:id`, `/orders/:id/payment`) sin tocar en este paso — el handler de
`/orders/:id/confirm` lo reescribe Task 10 completo, porque necesita
`findPricelistId`/`findProductIdBySku` que todavía no existen.

- [ ] **Step 2: Modify `backend/index.mjs`** — arrancar el cache de productos

Buscar la línea agregada en Task 3:

```js
seedCajaAdminIfNeeded().catch(err => console.error('[feria] Error seedeando admin:', err.message));
```

Agregar, en el mismo bloque `if (process.argv[1] === fileURLToPath(import.meta.url))`, justo antes de esa línea:

```js
startFeriaProductsCache();
```

Y agregar el import correspondiente junto a los otros imports de feria:

```js
import { startFeriaProductsCache } from './feriaProducts.mjs';
```

- [ ] **Step 3: Manual smoke-test (el confirm real no compila todavía, es de Task 10)**

Run (from `backend/`): `npm run dev`
En otra terminal: `curl http://localhost:3000/api/feria/public/products/search?q=BCT037MA`
— con la colección `feria_products` ya importada (Task 8), debería devolver
un JSON con `products` y los 3 precios por medio de pago para las
condiciones que ese SKU tenga.

Nota: esta task deja `feriaRoutes.mjs` con imports de funciones
(`findPricelistId`, `findProductIdBySku`) que Task 10 todavía no escribió —
`npm test` sigue pasando (los tests no importan `feriaRoutes.mjs`), pero
`npm run dev` va a fallar al arrancar hasta que Task 10 las agregue a
`feriaOdoo.mjs`. Es intencional: las dos tasks se commitean casi seguidas,
no hace falta un estado intermedio deployable.

- [ ] **Step 4: Commit**

```bash
git add backend/feriaRoutes.mjs backend/index.mjs
git commit -m "feat(feria): rutas de búsqueda de productos, rebaja por SKU y buscador público de precios"
```

---

### Task 10: Cliente por DNI + pedidos con las nuevas reglas de precio

**Repo/dir:** `Reportes`, worktree
`Reportes/.worktrees/feature-feria-outlet/backend`

**Files:**
- Modify: `backend/feriaOdoo.mjs` (agrega `findPartnerByDoc`,
  `findPricelistId`, `findProductIdBySku`)
- Modify: `backend/feriaOrders.mjs` (`validateOrderInput`/`createOrder` con
  el nuevo esquema de línea y medios de pago)
- Modify: `backend/test/feriaOrders.test.mjs` (casos actualizados al nuevo
  esquema)
- Modify: `backend/feriaRoutes.mjs` (ruta de lookup de cliente + reescribe
  `/orders/:id/confirm`)
- Modify: `backend/.env.example` (agrega `ODOO_FERIA_PRICELIST_NAME`)

**Interfaces:**
- Produces (usado por Task 13, frontend):
  - `GET /api/feria/customers/lookup?docNumber=` (auth) →
    `{ found: boolean, partner: { id, name, vat, email, phone, street, city } | null }`
  - `POST /api/feria/orders` body ahora espera
    `{ customer: {name, docNumber}, paymentMethod: 'transferencia'|'efectivo'|'cuotas', lines: [{ sku, modelo, condition: 'falla'|'discontinuo', qty, unitPrice }] }`
    (ya NO lleva `pricelistId`/`pricelistName`; `unitPrice` es el precio
    final ya calculado por el frontend con `computeFinalPrice`/las reglas de
    Task 8, no el precio de tabla crudo)

- [ ] **Step 1: Add `findPartnerByDoc`, `findPricelistId`, `findProductIdBySku` to `backend/feriaOdoo.mjs`**

Agregar estas tres funciones (dejar todo lo demás del archivo sin tocar):

```js
// Busca un partner existente por CUIT/DNI para autocompletar datos en el
// panel Vendedor. A diferencia de findOrCreatePartner, esta función NO crea
// nada — devuelve null si no existe, para que el panel deje los campos
// vacíos y el vendedor los cargue a mano (mínimo: nombre + DNI).
export async function findPartnerByDoc(docNumber) {
  if (!docNumber) return null;
  const results = await callKwReadWithRetry('res.partner', 'search_read', [
    [['vat', '=', docNumber]],
  ], { fields: ['id', 'name', 'vat', 'email', 'phone', 'street', 'city'], limit: 1 });
  return results[0] ?? null;
}

export async function findPricelistId(name) {
  if (!name) return null;
  const results = await callKwReadWithRetry('product.pricelist', 'search_read', [
    [['name', '=', name]],
  ], { fields: ['id'], limit: 1 });
  return results[0]?.id ?? null;
}

// Resuelve el product_id real de Odoo por SKU (default_code) recién al
// confirmar la venta — la búsqueda que hace el vendedor ya no pega contra
// Odoo (ver feriaProducts.mjs), así que este es el único punto del flujo
// que necesita el id real para poder armar el sale.order.
export async function findProductIdBySku(sku) {
  const results = await callKwReadWithRetry('product.product', 'search_read', [
    [['default_code', '=', sku]],
  ], { fields: ['id'], limit: 1 });
  return results[0]?.id ?? null;
}
```

- [ ] **Step 2: Update the failing tests for `validateOrderInput`**

Reemplazar por completo el contenido de `backend/test/feriaOrders.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateOrderInput } from '../feriaOrders.mjs';

const validInput = {
  sellerId: 'v1',
  sellerName: 'Ana',
  customer: { name: 'Juan Pérez', docNumber: '20304050607' },
  paymentMethod: 'efectivo',
  lines: [{ sku: 'BCT037MA', modelo: 'Organica s', condition: 'falla', qty: 1, unitPrice: 23791 }],
};

test('acepta un pedido completo y válido', () => {
  assert.deepEqual(validateOrderInput(validInput), { valid: true, errors: [] });
});

test('rechaza un pedido sin líneas', () => {
  const result = validateOrderInput({ ...validInput, lines: [] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('línea')));
});

test('rechaza un pedido sin nombre de cliente', () => {
  const result = validateOrderInput({ ...validInput, customer: { name: '', docNumber: '20304050607' } });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('cliente')));
});

test('rechaza un pedido sin DNI/CUIT del cliente', () => {
  const result = validateOrderInput({ ...validInput, customer: { name: 'Juan Pérez', docNumber: '' } });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('DNI')));
});

test('rechaza método de pago inválido', () => {
  const result = validateOrderInput({ ...validInput, paymentMethod: 'cheque' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('pago')));
});

test('rechaza una línea con condición inválida', () => {
  const result = validateOrderInput({ ...validInput, lines: [{ ...validInput.lines[0], condition: 'nueva' }] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('Condición')));
});

test('rechaza una línea con cantidad 0 o negativa', () => {
  const result = validateOrderInput({ ...validInput, lines: [{ ...validInput.lines[0], qty: 0 }] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('cantidad')));
});

test('rechaza una línea sin SKU', () => {
  const result = validateOrderInput({ ...validInput, lines: [{ ...validInput.lines[0], sku: '' }] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('SKU')));
});
```

- [ ] **Step 3: Run test to verify it fails**

Run (from `backend/`): `npm test`
Expected: FAIL — `validateOrderInput` todavía valida el esquema viejo
(pide `pricelistId`, acepta `efectivo`/`tarjeta`, espera `productId`/`name`
en vez de `sku`/`condition`).

- [ ] **Step 4: Update `validateOrderInput` and `createOrder` in `backend/feriaOrders.mjs`**

Reemplazar el contenido completo de `backend/feriaOrders.mjs`:

```js
import { getDb } from './feriaOdoo.mjs';

const COLLECTION = 'feria_orders';
const PAYMENT_METHODS = new Set(['transferencia', 'efectivo', 'cuotas']);
const CONDITIONS = new Set(['falla', 'discontinuo']);

export function validateOrderInput(input) {
  const errors = [];
  if (!input.sellerId) errors.push('Falta identificar al vendedor');
  if (!input.customer?.name?.trim()) errors.push('Falta el nombre del cliente');
  if (!input.customer?.docNumber?.trim()) errors.push('Falta el DNI/CUIT del cliente');
  if (!PAYMENT_METHODS.has(input.paymentMethod)) errors.push('Método de pago inválido');
  if (!input.lines?.length) errors.push('El pedido necesita al menos una línea de producto');
  for (const line of input.lines ?? []) {
    if (!line.sku) errors.push('Falta el SKU de un producto');
    if (!CONDITIONS.has(line.condition)) errors.push(`Condición inválida para ${line.sku ?? 'un producto'} (debe ser falla o discontinuo)`);
    if (!(line.qty > 0)) errors.push(`Cantidad inválida para ${line.sku ?? 'un producto'}`);
    if (!(line.unitPrice >= 0)) errors.push(`Precio inválido para ${line.sku ?? 'un producto'}`);
  }
  return { valid: errors.length === 0, errors };
}

export async function createOrder(input) {
  const { valid, errors } = validateOrderInput(input);
  if (!valid) throw new Error(errors.join('; '));

  const db = getDb();
  const order = {
    sellerId: input.sellerId,
    sellerName: input.sellerName,
    customer: input.customer,
    paymentMethod: input.paymentMethod,
    lines: input.lines,
    invoiceType: null,
    status: 'pendiente',
    errorDetail: null,
    odooOrderId: null,
    invoiceId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const ref = await db.collection(COLLECTION).add(order);
  return { id: ref.id, ...order };
}

export async function listOrdersByStatus(status) {
  const db = getDb();
  const snap = await db.collection(COLLECTION)
    .where('status', '==', status)
    .orderBy('createdAt', 'desc')
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getOrderById(id) {
  const db = getDb();
  const doc = await db.collection(COLLECTION).doc(id).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

export async function updateOrderPayment(id, { paymentMethod, invoiceType }) {
  const db = getDb();
  const update = { updatedAt: new Date() };
  if (paymentMethod) update.paymentMethod = paymentMethod;
  if (invoiceType !== undefined) update.invoiceType = invoiceType;
  await db.collection(COLLECTION).doc(id).update(update);
}

// Guarda el id del sale.order de Odoo apenas se crea, ANTES de intentar
// facturar — deja el pedido en 'pendiente' (no toca status). Así, si la
// factura falla y el cajero reintenta confirmar, la ruta de confirmación
// puede ver que este pedido YA tiene un odooOrderId y saltar directo a
// facturar en vez de crear un sale.order duplicado en Odoo.
export async function saveOdooOrderId(id, odooOrderId) {
  const db = getDb();
  await db.collection(COLLECTION).doc(id).update({ odooOrderId, updatedAt: new Date() });
}

export async function markOrderConfirmed(id, { odooOrderId, invoiceId = null }) {
  const db = getDb();
  await db.collection(COLLECTION).doc(id).update({
    status: invoiceId ? 'facturado' : 'confirmado',
    odooOrderId, invoiceId, errorDetail: null, updatedAt: new Date(),
  });
}

export async function markOrderError(id, errorDetail) {
  const db = getDb();
  await db.collection(COLLECTION).doc(id).update({
    status: 'error', errorDetail, updatedAt: new Date(),
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run (from `backend/`): `npm test`
Expected: PASS (107 tests — 104 de Task 8 menos las 5 pruebas viejas de
`feriaOrders.test.mjs` que este archivo reemplaza, más las 8 nuevas)

- [ ] **Step 6: Add the customer lookup route and rewrite `/orders/:id/confirm` in `backend/feriaRoutes.mjs`**

Agregar el import de `findPartnerByDoc` a los ya agregados en Task 9 (la
línea de import de `feriaOdoo.mjs` queda así):

```js
import {
  findOrCreatePartner, findPartnerByDoc, findSalesTeamId, findPricelistId, findProductIdBySku,
  buildSaleOrderPayload, createSaleOrder, confirmSaleOrder, createInvoiceForOrder,
} from './feriaOdoo.mjs';
```

Agregar la ruta de lookup, después de la ruta `/auth/caja`:

```js
router.get('/customers/lookup', requireFeriaAuth, async (req, res) => {
  try {
    const docNumber = req.query.docNumber?.trim();
    if (!docNumber) return res.status(400).json({ error: 'Falta el DNI/CUIT' });
    const partner = await findPartnerByDoc(docNumber);
    res.json({ found: !!partner, partner });
  } catch (err) {
    res.status(502).json({ error: `Error consultando Odoo: ${err.message}` });
  }
});
```

Reemplazar el handler completo de `/orders/:id/confirm`:

```js
// Confirma el pedido: crea (o busca) el partner, resuelve el product_id de
// Odoo de cada línea por SKU, arma y crea el sale.order con la pricelist y
// el Equipo de ventas de la feria, lo confirma, y factura si corresponde.
// Se puede llamar de nuevo sin problema si quedó en 'error' — es idempotente
// respecto de la creación del pedido en Odoo: si esta orden ya tiene un
// odooOrderId guardado (de un intento anterior que llegó a crear el pedido
// pero falló después, típicamente al facturar), un reintento NO vuelve a
// crear el sale.order — salta directo a facturar. Sin esto, reintentar tras
// una factura fallida crearía un pedido duplicado en Odoo con plata real ya
// cobrada.
router.post('/orders/:id/confirm', requireFeriaAuth, requireFeriaRole('caja'), async (req, res) => {
  const order = await getOrderById(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });

  try {
    let odooOrderId = order.odooOrderId;

    if (!odooOrderId) {
      const partnerId = await findOrCreatePartner({
        name: order.customer.name, docNumber: order.customer.docNumber,
      });
      const teamId = await findSalesTeamId(process.env.ODOO_FERIA_TEAM_NAME);
      const pricelistId = await findPricelistId(process.env.ODOO_FERIA_PRICELIST_NAME);

      const resolvedLines = [];
      for (const line of order.lines) {
        const productId = await findProductIdBySku(line.sku);
        if (!productId) throw new Error(`SKU no encontrado en Odoo: ${line.sku}`);
        resolvedLines.push({ productId, qty: line.qty, unitPrice: line.unitPrice, discountPct: 0 });
      }

      const vals = buildSaleOrderPayload({ partnerId, pricelistId, teamId, lines: resolvedLines });
      odooOrderId = await createSaleOrder(vals);
      await confirmSaleOrder(odooOrderId);
      await saveOdooOrderId(order.id, odooOrderId);
    }

    // createInvoiceForOrder devuelve null tanto "no se pidió factura" como
    // "se pidió pero Odoo no pudo generarla" (ver feriaOdoo.mjs). Si el
    // cajero pidió facturar, un null acá NO es un éxito silencioso — el
    // pedido ya quedó creado y confirmado en Odoo, pero sin factura, y eso
    // tiene que verse como error para que el cajero lo note y reintente
    // (en vez de creer que ya está todo listo). El reintento, gracias al
    // odooOrderId ya guardado, solo va a reintentar la factura.
    let invoiceId = null;
    if (order.invoiceType) {
      invoiceId = await createInvoiceForOrder(odooOrderId);
      if (!invoiceId) {
        await markOrderError(order.id, `Pedido #${odooOrderId} ya creado y confirmado en Odoo, pero no se pudo generar la factura ${order.invoiceType}. Reintentar solo reintenta la factura, no crea un pedido nuevo.`);
        return res.status(502).json({ error: `Pedido creado en Odoo (#${odooOrderId}) pero falló la factura — reintentar.` });
      }
    }

    await markOrderConfirmed(order.id, { odooOrderId, invoiceId });
    res.json({ order: await getOrderById(order.id) });
  } catch (err) {
    await markOrderError(order.id, err.message);
    res.status(502).json({ error: `No se pudo confirmar en Odoo: ${err.message}` });
  }
});
```

- [ ] **Step 7: Document the new env var**

Append to `backend/.env.example`:

```
ODOO_FERIA_PRICELIST_NAME=Feria Octubre 2026
```

- [ ] **Step 8: Run the full test suite and start the server to make sure it boots**

Run (from `backend/`): `npm test`
Expected: PASS (107 tests)

Run (from `backend/`): `npm run dev`
Expected: arranca sin error (antes de esta task fallaba al arrancar por los
imports faltantes — ver nota al final de Task 9).

- [ ] **Step 9: Commit**

```bash
git add backend/feriaOdoo.mjs backend/feriaOrders.mjs backend/test/feriaOrders.test.mjs backend/feriaRoutes.mjs backend/.env.example
git commit -m "feat(feria): lookup de cliente por DNI, y confirmar pedido con precios/condición/producto resueltos por SKU"
```

---

### Task 11: Scaffold del frontend (branding + rutas, incluye `/feria` pública)

**Repo/dir:** `feria-alto` (this repo, work on `master`)

**Files:**
- Create: `client/package.json`
- Create: `client/vite.config.js`
- Create: `client/index.html`
- Create: `client/src/main.jsx`
- Create: `client/src/App.jsx`
- Create: `client/src/lib/api.js`
- Create: `client/src/styles/global.css` (copiado de BOT-ALTORANCHO)
- Copy: `client/src/assets/ALTORANCHO.png` (copiado de `pick-alto/src/assets/ALTORANCHO.png`)

**Interfaces:**
- Produces (usado por Tasks 12-14):
  - `apiFetch(path, options)` → `Promise<any>` — manda
    `Authorization: Bearer <token>` desde `localStorage.getItem('feria_token')`
    cuando existe (el panel público no tiene token y llama igual, sin ese
    header); `path` es siempre la ruta completa `/api/feria/...`.

- [ ] **Step 1: Create `client/package.json`**

```json
{
  "name": "feria-alto-client",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.24.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.1",
    "vite": "^5.3.1"
  }
}
```

- [ ] **Step 2: Create `client/vite.config.js`**

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
```

- [ ] **Step 3: Create `client/index.html`**

```html
<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/png" href="/src/assets/ALTORANCHO.png" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap"
      rel="stylesheet"
    />
    <title>Feria Alto Rancho</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Copy the design tokens file verbatim**

Copiar el contenido completo de
`BOT-ALTORANCHO/client/src/styles/global.css` a
`client/src/styles/global.css`, sin modificar (paleta, Poppins, espaciados,
sombras — ya resuelto ahí).

- [ ] **Step 5: Copy the logo asset**

Copiar `pick-alto/src/assets/ALTORANCHO.png` a `client/src/assets/ALTORANCHO.png`.

- [ ] **Step 6: Create `client/src/lib/api.js`**

```js
export const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export async function apiFetch(path, options = {}) {
  const token = localStorage.getItem('feria_token');
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}
```

- [ ] **Step 7: Create `client/src/main.jsx`**

```jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
```

- [ ] **Step 8: Create `client/src/App.jsx`**

```jsx
import { Routes, Route, Navigate } from 'react-router-dom';
import VendedorLogin from './pages/VendedorLogin.jsx';
import VendedorPanel from './pages/VendedorPanel.jsx';
import CajaLogin from './pages/CajaLogin.jsx';
import CajaPanel from './pages/CajaPanel.jsx';
import FeriaPublico from './pages/FeriaPublico.jsx';

function hasSession(role) {
  return localStorage.getItem('feria_token') && localStorage.getItem('feria_role') === role;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/vendedor" replace />} />
      <Route path="/vendedor" element={hasSession('vendedor') ? <VendedorPanel /> : <VendedorLogin />} />
      <Route path="/caja" element={hasSession('caja') ? <CajaPanel /> : <CajaLogin />} />
      <Route path="/feria" element={<FeriaPublico />} />
    </Routes>
  );
}
```

Este archivo importa `pages/VendedorLogin.jsx`, `pages/VendedorPanel.jsx`,
`pages/CajaLogin.jsx`, `pages/CajaPanel.jsx` y `pages/FeriaPublico.jsx`, que
todavía no existen — las Tasks 12-14 los crean. Escribirlo ahora evita tener
que volver a tocar este archivo después (mismo patrón ya usado en el plan
original para Vendedor/Caja).

- [ ] **Step 9: Install deps**

Run (from `client/`): `npm install`
Expected: instala limpio (el build no va a andar hasta que exista Task 12 —
esperado en este punto).

- [ ] **Step 10: Commit**

```bash
git add client/package.json client/vite.config.js client/index.html client/src/main.jsx client/src/App.jsx client/src/lib/api.js client/src/styles/global.css client/src/assets/ALTORANCHO.png
git commit -m "chore: scaffold del frontend con branding de Alto Rancho y ruta pública /feria"
```

---

### Task 12: Panel Vendedor (login, cliente por DNI, condición + medio de pago obligatorio)

**Repo/dir:** `feria-alto` (this repo, work on `master`)

**Files:**
- Create: `client/src/pages/VendedorLogin.jsx`
- Create: `client/src/pages/VendedorLogin.module.css`
- Create: `client/src/pages/VendedorPanel.jsx`
- Create: `client/src/pages/VendedorPanel.module.css`

**Interfaces:**
- Consumes: `apiFetch` (Task 11). Endpoints: `POST /api/feria/auth/vendedor`,
  `GET /api/feria/customers/lookup?docNumber=`,
  `GET /api/feria/products/search?q=`, `POST /api/feria/orders`.

No hay tests automáticos de componentes en este proyecto (misma convención
que BOT-ALTORANCHO) — se verifica corriendo `npm run dev` y probando el
flujo a mano.

- [ ] **Step 1: Write `client/src/pages/VendedorLogin.jsx`**

```jsx
import { useState } from 'react';
import { apiFetch } from '../lib/api.js';
import styles from './VendedorLogin.module.css';

export default function VendedorLogin() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { token, seller } = await apiFetch('/api/feria/auth/vendedor', {
        method: 'POST', body: JSON.stringify({ pin }),
      });
      localStorage.setItem('feria_token', token);
      localStorage.setItem('feria_role', 'vendedor');
      localStorage.setItem('feria_seller', JSON.stringify(seller));
      window.location.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      <form className={styles.card} onSubmit={handleSubmit}>
        <img src="/src/assets/ALTORANCHO.png" alt="Alto Rancho" className={styles.logo} />
        <h1 className={styles.title}>Feria — Vendedor</h1>
        <input
          className={styles.input}
          type="password"
          inputMode="numeric"
          placeholder="Tu PIN"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          autoFocus
        />
        {error && <p className={styles.error}>{error}</p>}
        <button className={styles.btn} type="submit" disabled={loading || !pin}>
          {loading ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Write `client/src/pages/VendedorLogin.module.css`**

```css
.page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg);
  padding: var(--space-4);
}
.card {
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  padding: var(--space-8);
  width: 100%;
  max-width: 360px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-4);
}
.logo { width: 96px; height: auto; }
.title { font-size: var(--font-size-xl); font-weight: 600; color: var(--color-text); }
.input {
  width: 100%;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: var(--font-size-lg);
  text-align: center;
  letter-spacing: 4px;
}
.input:focus { outline: none; border-color: var(--color-primary); }
.btn {
  width: 100%;
  padding: var(--space-3);
  border: none;
  border-radius: var(--radius-md);
  background: var(--color-primary);
  color: var(--color-text-on-primary);
  font-size: var(--font-size-md);
  font-weight: 500;
  transition: background var(--transition-fast);
}
.btn:hover:not(:disabled) { background: var(--color-primary-dark); }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }
.error { color: var(--color-error); font-size: var(--font-size-sm); text-align: center; }
```

- [ ] **Step 3: Write `client/src/pages/VendedorPanel.jsx`**

```jsx
import { useState, useRef } from 'react';
import { apiFetch } from '../lib/api.js';
import styles from './VendedorPanel.module.css';

const PAYMENT_METHODS = [
  { value: 'transferencia', label: 'Transferencia', discountPct: 20 },
  { value: 'efectivo', label: 'Efectivo', discountPct: 15 },
  { value: 'cuotas', label: '3 cuotas', discountPct: 0 },
];

const SEARCH_MIN_CHARS = 6;

function finalUnitPrice(tablePrice, paymentMethod) {
  const method = PAYMENT_METHODS.find(m => m.value === paymentMethod);
  return Math.round(tablePrice * (1 - method.discountPct / 100));
}

export default function VendedorPanel() {
  const seller = JSON.parse(localStorage.getItem('feria_seller') || '{}');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [lines, setLines] = useState([]);
  const [customer, setCustomer] = useState({ name: '', docNumber: '' });
  const [lookupStatus, setLookupStatus] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('efectivo');
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
    setLines(prev => [...prev, {
      sku: product.sku, modelo: product.modelo, condition,
      qty: 1, tablePrice: info.precioTabla,
    }]);
    setQuery('');
    setResults([]);
  }

  function updateQty(index, qty) {
    setLines(prev => prev.map((l, i) => i === index ? { ...l, qty } : l));
  }

  function removeLine(index) {
    setLines(prev => prev.filter((_, i) => i !== index));
  }

  const total = lines.reduce((sum, l) => sum + l.qty * finalUnitPrice(l.tablePrice, paymentMethod), 0);

  async function handleSubmit() {
    setStatus('Enviando...');
    try {
      await apiFetch('/api/feria/orders', {
        method: 'POST',
        body: JSON.stringify({
          customer, paymentMethod,
          lines: lines.map(l => ({
            sku: l.sku, modelo: l.modelo, condition: l.condition,
            qty: l.qty, unitPrice: finalUnitPrice(l.tablePrice, paymentMethod),
          })),
        }),
      });
      setLines([]);
      setCustomer({ name: '', docNumber: '' });
      setLookupStatus('');
      setStatus('¡Pedido enviado a caja!');
      setTimeout(() => setStatus(''), 3000);
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    }
  }

  const canSubmit = lines.length > 0 && customer.name.trim() && customer.docNumber.trim();

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span>Vendedor: {seller.name}</span>
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
            {results.map(p => (
              <li key={p.sku} className={styles.resultItem}>
                <span className={styles.resultName}>{p.modelo} ({p.sku})</span>
                <div className={styles.conditionButtons}>
                  {p.condiciones.falla.disponible && (
                    <button type="button" onClick={() => addLine(p, 'falla')}>
                      Falla — ${p.condiciones.falla.precioTabla}
                    </button>
                  )}
                  {p.condiciones.discontinuo.disponible && (
                    <button type="button" onClick={() => addLine(p, 'discontinuo')}>
                      Discontinuo — ${p.condiciones.discontinuo.precioTabla}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={styles.lines}>
        {lines.map((line, i) => (
          <div key={i} className={styles.lineRow}>
            <span className={styles.lineName}>{line.modelo} ({line.condition})</span>
            <input
              className={styles.qtyInput} type="number" min="1" value={line.qty}
              onChange={(e) => updateQty(i, Number(e.target.value))}
            />
            <span>${(line.qty * finalUnitPrice(line.tablePrice, paymentMethod)).toFixed(0)}</span>
            <button className={styles.removeBtn} onClick={() => removeLine(i)}>✕</button>
          </div>
        ))}
      </div>

      <div className={styles.total}>Total: ${total.toFixed(0)}</div>

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

      {status && <p className={styles.status}>{status}</p>}

      <button className={styles.submitBtn} onClick={handleSubmit} disabled={!canSubmit}>
        Enviar pedido a caja
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Write `client/src/pages/VendedorPanel.module.css`**

```css
.page {
  max-width: 480px;
  margin: 0 auto;
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.header {
  font-weight: 600;
  color: var(--color-primary);
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--color-border);
}
.field { display: flex; flex-direction: column; gap: var(--space-1); position: relative; }
.label { font-size: var(--font-size-xs); font-weight: 600; color: var(--color-text-muted); text-transform: uppercase; }
.input {
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: var(--font-size-md);
}
.lookupStatus { font-size: var(--font-size-xs); color: var(--color-text-muted); }
.resultsList {
  position: absolute;
  top: 100%; left: 0; right: 0;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  z-index: 10;
  max-height: 280px;
  overflow-y: auto;
}
.resultItem { padding: var(--space-3); border-bottom: 1px solid var(--color-border); }
.resultName { display: block; margin-bottom: var(--space-1); font-size: var(--font-size-sm); }
.conditionButtons { display: flex; gap: var(--space-2); }
.conditionButtons button {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-primary);
  font-size: var(--font-size-xs);
}
.lines { display: flex; flex-direction: column; gap: var(--space-2); }
.lineRow {
  display: grid;
  grid-template-columns: 1fr 60px 90px 30px;
  gap: var(--space-2);
  align-items: center;
  font-size: var(--font-size-sm);
}
.lineName { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qtyInput {
  width: 100%; padding: var(--space-1); border: 1px solid var(--color-border); border-radius: var(--radius-sm);
}
.removeBtn { background: none; border: none; color: var(--color-error); font-size: var(--font-size-md); }
.total { font-size: var(--font-size-lg); font-weight: 600; text-align: right; }
.paymentButtons { display: flex; gap: var(--space-2); }
.paymentBtn {
  flex: 1;
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  font-size: var(--font-size-sm);
}
.paymentBtnActive { border-color: var(--color-primary); background: var(--color-primary-subtle); color: var(--color-primary); font-weight: 600; }
.status { text-align: center; color: var(--color-primary); }
.submitBtn {
  padding: var(--space-4);
  border: none;
  border-radius: var(--radius-md);
  background: var(--color-primary);
  color: var(--color-text-on-primary);
  font-size: var(--font-size-lg);
  font-weight: 600;
}
.submitBtn:disabled { opacity: 0.5; }
```

- [ ] **Step 5: Verify manually**

Run (from `Reportes/.worktrees/feature-feria-outlet/backend/`): `npm run dev`
Run (from `feria-alto/client/`, otra terminal): `npm run dev`, con
`VITE_API_URL=http://localhost:3000`.
Abrir la URL de Vite, loguearse con un PIN de prueba cargado a mano en
`feria_sellers` en Firestore, buscar un SKU real (≥6 caracteres) de los
importados en Task 8, agregarlo eligiendo Falla o Discontinuo, cargar un
DNI que exista en Odoo (verificar el autocompletado) y uno que no exista
(verificar el mensaje de "se crea al confirmar"), elegir un medio de pago y
confirmar que el total cambia según el descuento, y enviar el pedido.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/VendedorLogin.jsx client/src/pages/VendedorLogin.module.css client/src/pages/VendedorPanel.jsx client/src/pages/VendedorPanel.module.css
git commit -m "feat: panel Vendedor (login, cliente por DNI, condición falla/discontinuo, medio de pago obligatorio)"
```

---

### Task 13: Panel Caja/Admin (confirmar venta + gestión de rebajas por SKU)

**Repo/dir:** `feria-alto` (this repo, work on `master`)

**Files:**
- Create: `client/src/pages/CajaLogin.jsx`
- Create: `client/src/pages/CajaLogin.module.css`
- Create: `client/src/pages/CajaPanel.jsx`
- Create: `client/src/pages/CajaPanel.module.css`

**Interfaces:**
- Consumes: `apiFetch`. Endpoints: `POST /api/feria/auth/caja`,
  `GET /api/feria/orders?status=pendiente`,
  `PATCH /api/feria/orders/:id/payment`, `POST /api/feria/orders/:id/confirm`,
  `GET /api/feria/products/search?q=`, `PATCH /api/feria/products/:sku/rebaja`.

- [ ] **Step 1: Write `client/src/pages/CajaLogin.jsx`**

```jsx
import { useState } from 'react';
import { apiFetch } from '../lib/api.js';
import styles from './CajaLogin.module.css';

export default function CajaLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { token, user } = await apiFetch('/api/feria/auth/caja', {
        method: 'POST', body: JSON.stringify({ email, password }),
      });
      localStorage.setItem('feria_token', token);
      localStorage.setItem('feria_role', 'caja');
      localStorage.setItem('feria_user', JSON.stringify(user));
      window.location.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      <form className={styles.card} onSubmit={handleSubmit}>
        <img src="/src/assets/ALTORANCHO.png" alt="Alto Rancho" className={styles.logo} />
        <h1 className={styles.title}>Feria — Caja</h1>
        <input
          className={styles.input} type="email" placeholder="Email"
          value={email} onChange={(e) => setEmail(e.target.value)} autoFocus
        />
        <input
          className={styles.input} type="password" placeholder="Contraseña"
          value={password} onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className={styles.error}>{error}</p>}
        <button className={styles.btn} type="submit" disabled={loading || !email || !password}>
          {loading ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Write `client/src/pages/CajaLogin.module.css`**

```css
.page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg);
  padding: var(--space-4);
}
.card {
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  padding: var(--space-8);
  width: 100%;
  max-width: 360px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-4);
}
.logo { width: 96px; height: auto; }
.title { font-size: var(--font-size-xl); font-weight: 600; color: var(--color-text); }
.input {
  width: 100%;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: var(--font-size-md);
}
.input:focus { outline: none; border-color: var(--color-primary); }
.btn {
  width: 100%;
  padding: var(--space-3);
  border: none;
  border-radius: var(--radius-md);
  background: var(--color-primary);
  color: var(--color-text-on-primary);
  font-size: var(--font-size-md);
  font-weight: 500;
  transition: background var(--transition-fast);
}
.btn:hover:not(:disabled) { background: var(--color-primary-dark); }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }
.error { color: var(--color-error); font-size: var(--font-size-sm); text-align: center; }
```

- [ ] **Step 3: Write `client/src/pages/CajaPanel.jsx`**

```jsx
import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../lib/api.js';
import styles from './CajaPanel.module.css';

const SEARCH_MIN_CHARS = 6;
const REBAJA_LABELS = { 0: 'Normal', 1: 'Rebaja 1', 2: 'Rebaja 2' };

function PedidosTab() {
  const [orders, setOrders] = useState([]);
  const [selected, setSelected] = useState(null);
  const [invoiceType, setInvoiceType] = useState('');
  const [confirming, setConfirming] = useState(false);

  const loadOrders = useCallback(async () => {
    try {
      const { orders } = await apiFetch('/api/feria/orders?status=pendiente');
      setOrders(orders);
    } catch {
      // Silencioso — reintenta en el próximo poll.
    }
  }, []);

  useEffect(() => {
    loadOrders();
    const interval = setInterval(loadOrders, 5000);
    return () => clearInterval(interval);
  }, [loadOrders]);

  function openOrder(order) {
    setSelected(order);
    setInvoiceType(order.invoiceType || '');
  }

  async function handleConfirm() {
    if (!selected) return;
    setConfirming(true);
    try {
      if (invoiceType) {
        await apiFetch(`/api/feria/orders/${selected.id}/payment`, {
          method: 'PATCH', body: JSON.stringify({ invoiceType }),
        });
      }
      await apiFetch(`/api/feria/orders/${selected.id}/confirm`, { method: 'POST' });
      setSelected(null);
      loadOrders();
    } catch (err) {
      alert(`Error confirmando: ${err.message}`);
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className={styles.tabBody}>
      <aside className={styles.list}>
        <h2 className={styles.listTitle}>Pedidos pendientes ({orders.length})</h2>
        {orders.map(order => (
          <button
            key={order.id}
            className={`${styles.orderCard} ${selected?.id === order.id ? styles.orderCardActive : ''}`}
            onClick={() => openOrder(order)}
          >
            <strong>{order.customer.name}</strong>
            <span>{order.sellerName}</span>
          </button>
        ))}
        {orders.length === 0 && <p className={styles.empty}>No hay pedidos pendientes.</p>}
      </aside>

      <main className={styles.detail}>
        {!selected ? (
          <p className={styles.empty}>Seleccioná un pedido de la lista.</p>
        ) : (
          <>
            <h2>{selected.customer.name}</h2>
            <p className={styles.meta}>Vendedor: {selected.sellerName} · DNI/CUIT: {selected.customer.docNumber}</p>
            <table className={styles.table}>
              <tbody>
                {selected.lines.map((l, i) => (
                  <tr key={i}>
                    <td>{l.modelo} ({l.sku})</td>
                    <td>{l.condition}</td>
                    <td>x{l.qty}</td>
                    <td>${(l.qty * l.unitPrice).toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={styles.total}>
              Total: ${selected.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0).toFixed(0)}
            </p>
            <p className={styles.meta}>Método de pago cargado: {selected.paymentMethod}</p>

            <div className={styles.field}>
              <label className={styles.label}>Tipo de factura</label>
              <select className={styles.select} value={invoiceType} onChange={(e) => setInvoiceType(e.target.value)}>
                <option value="">Sin facturar todavía</option>
                <option value="B">Factura B</option>
                <option value="A">Factura A</option>
              </select>
            </div>

            {selected.status === 'error' && (
              <p className={styles.error}>Error del intento anterior: {selected.errorDetail}</p>
            )}

            <button className={styles.confirmBtn} onClick={handleConfirm} disabled={confirming}>
              {confirming ? 'Confirmando...' : (selected.status === 'error' ? 'Reintentar' : 'Confirmar venta')}
            </button>
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
    try {
      const { product } = await apiFetch(`/api/feria/products/${sku}/rebaja`, {
        method: 'PATCH', body: JSON.stringify({ condition, level }),
      });
      setResults(prev => prev.map(p => p.sku === sku ? product : p));
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setSaving('');
    }
  }

  return (
    <div className={styles.rebajasBody}>
      <div className={styles.field}>
        <label className={styles.label}>Buscar SKU o modelo (mínimo 6 caracteres)</label>
        <input
          className={styles.input}
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder="Ej: BCT037MA"
        />
      </div>
      {results.map(p => (
        <div key={p.sku} className={styles.rebajaCard}>
          <strong>{p.modelo} ({p.sku})</strong>
          {['falla', 'discontinuo'].map(condition => (
            p.condiciones[condition].disponible && (
              <div key={condition} className={styles.rebajaRow}>
                <span className={styles.rebajaLabel}>{condition} — ${p.condiciones[condition].precioTabla}</span>
                <div className={styles.rebajaButtons}>
                  {[0, 1, 2].map(level => (
                    <button
                      key={level}
                      type="button"
                      disabled={saving === p.sku + condition}
                      className={`${styles.rebajaBtn} ${p.condiciones[condition].rebajaActiva === level ? styles.rebajaBtnActive : ''}`}
                      onClick={() => setRebaja(p.sku, condition, level)}
                    >
                      {REBAJA_LABELS[level]}
                    </button>
                  ))}
                </div>
              </div>
            )
          ))}
        </div>
      ))}
    </div>
  );
}

export default function CajaPanel() {
  const [tab, setTab] = useState('pedidos');

  return (
    <div className={styles.page}>
      <nav className={styles.tabs}>
        <button className={`${styles.tabBtn} ${tab === 'pedidos' ? styles.tabBtnActive : ''}`} onClick={() => setTab('pedidos')}>
          Pedidos
        </button>
        <button className={`${styles.tabBtn} ${tab === 'rebajas' ? styles.tabBtnActive : ''}`} onClick={() => setTab('rebajas')}>
          Rebajas por SKU
        </button>
      </nav>
      {tab === 'pedidos' ? <PedidosTab /> : <RebajasTab />}
    </div>
  );
}
```

- [ ] **Step 4: Write `client/src/pages/CajaPanel.module.css`**

```css
.page { display: flex; flex-direction: column; height: 100vh; }
.tabs { display: flex; border-bottom: 1px solid var(--color-border); }
.tabBtn {
  padding: var(--space-3) var(--space-6);
  border: none;
  background: none;
  font-size: var(--font-size-md);
  color: var(--color-text-muted);
}
.tabBtnActive { color: var(--color-primary); font-weight: 600; border-bottom: 2px solid var(--color-primary); }
.tabBody {
  display: grid;
  grid-template-columns: 300px 1fr;
  flex: 1;
  overflow: hidden;
}
.list {
  border-right: 1px solid var(--color-border);
  overflow-y: auto;
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.listTitle { font-size: var(--font-size-md); font-weight: 600; margin-bottom: var(--space-2); }
.orderCard {
  display: flex; flex-direction: column; align-items: flex-start;
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  text-align: left;
}
.orderCardActive { border-color: var(--color-primary); background: var(--color-primary-subtle); }
.detail { padding: var(--space-6); overflow-y: auto; }
.meta { color: var(--color-text-muted); font-size: var(--font-size-sm); margin: var(--space-1) 0; }
.table { width: 100%; margin: var(--space-4) 0; border-collapse: collapse; }
.table td { padding: var(--space-2) 0; border-bottom: 1px solid var(--color-border); font-size: var(--font-size-sm); }
.total { font-size: var(--font-size-xl); font-weight: 600; text-align: right; }
.field { display: flex; flex-direction: column; gap: var(--space-1); margin: var(--space-4) 0; }
.label { font-size: var(--font-size-xs); font-weight: 600; color: var(--color-text-muted); text-transform: uppercase; }
.select, .input { padding: var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-md); }
.confirmBtn {
  width: 100%;
  padding: var(--space-4);
  border: none;
  border-radius: var(--radius-md);
  background: var(--color-primary);
  color: var(--color-text-on-primary);
  font-size: var(--font-size-lg);
  font-weight: 600;
}
.confirmBtn:disabled { opacity: 0.5; }
.empty { color: var(--color-text-faint); text-align: center; margin-top: var(--space-8); }
.error { color: var(--color-error); font-size: var(--font-size-sm); }
.rebajasBody { padding: var(--space-6); max-width: 640px; margin: 0 auto; display: flex; flex-direction: column; gap: var(--space-4); overflow-y: auto; }
.rebajaCard {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.rebajaRow { display: flex; justify-content: space-between; align-items: center; }
.rebajaLabel { font-size: var(--font-size-sm); text-transform: capitalize; }
.rebajaButtons { display: flex; gap: var(--space-2); }
.rebajaBtn {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  font-size: var(--font-size-xs);
}
.rebajaBtnActive { border-color: var(--color-primary); background: var(--color-primary-subtle); color: var(--color-primary); font-weight: 600; }
```

- [ ] **Step 5: Verify the end-to-end flow manually**

Con backend y client corriendo: cargar un pedido desde `/vendedor` con un
SKU que tenga las dos condiciones disponibles, confirmar que aparece en
`/caja` dentro de los 5 segundos, abrirlo, elegir Factura B, confirmar, y
chequear en Odoo que el `sale.order` se creó con el Equipo de ventas y la
pricelist "Feria Octubre 2026", y el precio de línea correcto. Después, en
la pestaña "Rebajas por SKU", activar Rebaja 1 para la condición Falla de
ese mismo SKU y verificar que el panel Vendedor lo refleja al buscarlo de
nuevo.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/CajaLogin.jsx client/src/pages/CajaLogin.module.css client/src/pages/CajaPanel.jsx client/src/pages/CajaPanel.module.css
git commit -m "feat: panel Caja (pedidos + confirmación) y gestión de rebajas por SKU"
```

---

### Task 14: Panel público `/feria` — buscador de precios sin login

**Repo/dir:** `feria-alto` (this repo, work on `master`)

**Files:**
- Create: `client/src/pages/FeriaPublico.jsx`
- Create: `client/src/pages/FeriaPublico.module.css`

**Interfaces:**
- Consumes: `apiFetch` (funciona igual sin token — el endpoint no requiere
  auth). Endpoint: `GET /api/feria/public/products/search?q=`.

- [ ] **Step 1: Write `client/src/pages/FeriaPublico.jsx`**

```jsx
import { useState, useRef } from 'react';
import { apiFetch } from '../lib/api.js';
import styles from './FeriaPublico.module.css';

const SEARCH_MIN_CHARS = 6;
const CONDITION_LABELS = { falla: 'Falla', discontinuo: 'Discontinuo' };

export default function FeriaPublico() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchTimeout = useRef(null);

  function handleQueryChange(value) {
    setQuery(value);
    clearTimeout(searchTimeout.current);
    if (value.trim().length < SEARCH_MIN_CHARS) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimeout.current = setTimeout(async () => {
      try {
        const { products } = await apiFetch(`/api/feria/public/products/search?q=${encodeURIComponent(value)}`);
        setResults(products);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }

  return (
    <div className={styles.page}>
      <img src="/src/assets/ALTORANCHO.png" alt="Alto Rancho" className={styles.logo} />
      <h1 className={styles.title}>Feria Outlet — Consultá tu precio</h1>
      <input
        className={styles.input}
        value={query}
        onChange={(e) => handleQueryChange(e.target.value)}
        placeholder="Buscá por SKU o modelo (mínimo 6 caracteres)"
        autoFocus
      />
      {searching && <p className={styles.hint}>Buscando...</p>}
      {!searching && query.trim().length >= SEARCH_MIN_CHARS && results.length === 0 && (
        <p className={styles.hint}>No encontramos ningún producto para "{query}".</p>
      )}

      <div className={styles.results}>
        {results.map(p => (
          <div key={p.sku} className={styles.card}>
            <h2 className={styles.cardTitle}>{p.modelo}</h2>
            <p className={styles.cardSku}>SKU: {p.sku}{p.color ? ` · ${p.color}` : ''}</p>
            {Object.entries(p.precios).map(([condition, precios]) => (
              <div key={condition} className={styles.conditionBlock}>
                <h3 className={styles.conditionTitle}>{CONDITION_LABELS[condition]}</h3>
                <table className={styles.priceTable}>
                  <tbody>
                    {Object.entries(precios).map(([method, info]) => (
                      <tr key={method}>
                        <td>{info.label}</td>
                        <td className={styles.price}>${info.precio}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `client/src/pages/FeriaPublico.module.css`**

```css
.page {
  max-width: 480px;
  margin: 0 auto;
  padding: var(--space-6) var(--space-4);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-4);
}
.logo { width: 96px; height: auto; }
.title { font-size: var(--font-size-lg); font-weight: 600; text-align: center; color: var(--color-text); }
.input {
  width: 100%;
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: var(--font-size-md);
  text-align: center;
}
.hint { color: var(--color-text-muted); font-size: var(--font-size-sm); }
.results { width: 100%; display: flex; flex-direction: column; gap: var(--space-4); }
.card {
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  padding: var(--space-4);
}
.cardTitle { font-size: var(--font-size-md); font-weight: 600; margin: 0; }
.cardSku { color: var(--color-text-muted); font-size: var(--font-size-sm); margin: var(--space-1) 0 var(--space-3); }
.conditionBlock { margin-top: var(--space-3); }
.conditionTitle { font-size: var(--font-size-sm); font-weight: 600; color: var(--color-primary); margin: 0 0 var(--space-1); text-transform: uppercase; }
.priceTable { width: 100%; border-collapse: collapse; }
.priceTable td { padding: var(--space-2) 0; border-bottom: 1px solid var(--color-border); font-size: var(--font-size-sm); }
.price { text-align: right; font-weight: 600; }
```

- [ ] **Step 3: Verify manually**

Run (from `feria-alto/client/`): `npm run dev`
Abrir `http://localhost:5173/feria` (sin loguearse — no debe pedir sesión),
buscar un SKU real de los importados en Task 8, y verificar que muestra los
3 precios por medio de pago para cada condición disponible, sin mostrar
stock, proveedor ni margen en ningún lado.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/FeriaPublico.jsx client/src/pages/FeriaPublico.module.css
git commit -m "feat: panel público /feria — buscador de precios por SKU sin login"
```

---

### Task 15: Deploy — actualizar README

**Repo/dir:** `feria-alto` (README)

**Files:**
- Create: `README.md`

**Interfaces:** none — solo documentación.

- [ ] **Step 1: Create `README.md`**

```markdown
# Feria Outlet Alto Rancho — frontend

Tres paneles — Vendedor, Caja/Admin y un buscador público de precios — para
la feria outlet de Alto Rancho, con carga automática a Odoo (pedido +
factura) y precios propios de feria (condición Falla/Discontinuo + rebajas
por SKU + descuento por medio de pago).

El backend **no está en este repo** — corre dentro de
`Reportes/backend` (rutas bajo `/api/feria/*`, rama
`feature/feria-outlet` hasta que se mergee). Este repo tiene solo el
frontend (`client/`).

Ver el diseño completo en `docs/superpowers/specs/2026-09-18-feria-outlet-design.md`
y los planes de implementación en `docs/superpowers/plans/` (el de
2026-09-18 para login/pedidos/Odoo, el de 2026-09-22 para precios de
feria, cliente por DNI y el panel público).

## Rutas

- `/vendedor` — login por PIN + armado de pedidos (uso interno, con tablet).
- `/caja` — login usuario/contraseña, confirma ventas y factura, y
  administra qué rebaja está activa por SKU.
- `/feria` — público, sin login: buscador de precio por SKU/modelo para
  que lo use el cliente.

## Deploy

- **Backend**: no hay nada que deployar aparte — cuando la rama
  `feature/feria-outlet` de `Reportes` se mergea a `main`, las rutas
  `/api/feria/*` quedan disponibles en el mismo servicio de Railway que ya
  corre los reportes. Variables de entorno nuevas a cargar en ese servicio:
  `FERIA_AUTH_SECRET`, `ODOO_FERIA_TEAM_NAME`, `ODOO_FERIA_PRICELIST_NAME`
  (ver `Reportes/backend/.env.example`).
- **Frontend**: deploy propio, liviano (build estático con `npm run build`
  en `client/`), con `VITE_API_URL` apuntando a la URL pública del servicio
  de Reportes.

Antes del primer uso real:
- Cargar a mano en Firestore la colección `feria_sellers` (documentos
  `{ name, pin }`) con los vendedores reales.
- Correr `npm run import:feria-prices -- "<ruta al excel>"` en
  `Reportes/backend` para cargar `feria_products` (repetir cada vez que el
  negocio actualice el Excel de precios — no pisa las rebajas ya activadas
  a mano).
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README actualizado con las 3 rutas, precios de feria y el import"
```

---

## Self-Review

**Cobertura del spec (Actualización 2026-09-22):**
- Cliente por DNI + autocompletado → Task 10 (backend) + Task 12 (frontend). ✓
- Equipo de ventas confirmado → ya no es tentativo, no requiere código, solo
  se documentó en el spec. ✓
- Precios por Excel (condición + rebajas) → Tasks 8-10 (backend). ✓
- Medio de pago obligatorio con 3 opciones y sus % → Task 12. ✓
- Buscador con umbral de 6 caracteres → Task 12, 13 (rebajas) y 14. ✓
- Panel público `/feria` sin exponer datos internos → Task 9 (ruta pública)
  + Task 14 (UI) + Task 11 (ruta wireada en `App.jsx`). ✓
- Gestión de rebajas por SKU desde caja/admin → Task 9 (ruta) + Task 13
  (UI, pestaña "Rebajas por SKU"). ✓

**Placeholder scan:** ningún paso de código quedó sin contenido real; los
únicos "TBD" son pasos manuales de verificación (correr el server, probar a
mano), que es la convención ya usada en Tasks 1-7 de este mismo proyecto.

**Consistencia de tipos:** `condition` es siempre `'falla' | 'discontinuo'`
en Task 8 (`feriaPricing.mjs`), Task 9 (rutas), Task 10
(`validateOrderInput`, líneas del pedido) y Task 12
(`VendedorPanel.jsx`) — mismo string en los cuatro lugares. `paymentMethod`
es siempre `'transferencia' | 'efectivo' | 'cuotas'` en Task 8, 10 y 12. El
shape de `condiciones` que devuelve `GET /products/search` (Task 9:
`{ disponible, precioTabla, rebajaActiva }`) es el mismo que consumen Task
12 (`VendedorPanel.jsx`) y Task 13 (`RebajasTab`).
