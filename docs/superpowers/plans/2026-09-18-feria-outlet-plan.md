# Feria Outlet Alto Rancho — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Vendedor/Caja flow for Alto Rancho's outlet feria: a
seller loads the order on a tablet, it appears at the register, the cashier
confirms payment and invoice type, and the order + invoice get created in
Odoo.

**Architecture:** This spans **two repos** — there is no new backend
service. The API lives inside the already-deployed
`Reportes/backend` (new routes under `/api/feria/*`, added to its existing
Express app / Railway service), reusing its live Odoo client (`odoo.mjs`)
and Firebase Admin init (`firestore.mjs`). The frontend is a new, separate,
lightweight React app (repo `feria-alto`) with two routes (`/vendedor`,
`/caja`) that poll that API every 5s — same polling pattern BOT-ALTORANCHO's
admin panel already uses (no websockets, no client-side Firestore access).

**Tech Stack:**
- Backend additions: plain `.mjs` files matching `Reportes/backend`'s
  existing flat, no-framework-extras style (Express, `firebase-admin`, its
  own HMAC-signed tokens via `node:crypto` — **no new dependency**, `zod`
  is already there for validation if needed). Tests: `node:test` +
  `node:assert/strict` (`npm test` already runs `node --test`), same
  convention as the rest of that backend — pure/deterministic functions get
  unit tests; the thin Odoo/Firestore I/O wrappers don't (no HTTP-mocking
  library in that codebase, verified against the real Odoo instance
  instead).
- Frontend: React + Vite + CSS Modules, reusing BOT-ALTORANCHO's design
  tokens (`global.css`) and Alto Rancho logo asset.

**Spec:** `docs/superpowers/specs/2026-09-18-feria-outlet-design.md`

## Global Constraints

- **Two repos, two working directories:**
  - `Reportes` repo (backend) — work happens in the worktree already
    created at `Reportes/.worktrees/feature-feria-outlet` on branch
    `feature/feria-outlet`. This is a live production repo (deployed,
    serving real reports) — never work on its `main` branch directly.
  - `feria-alto` repo (frontend) — work happens directly in that repo on
    `master`. It's brand new (this session created it), nothing depends on
    it yet, low risk.
- All new backend routes are mounted under **`/api/feria/`** — never reuse
  or shadow an existing `/api/...` path in `Reportes/backend/index.mjs`.
- Firebase project: `pedidos-lett-2` (already configured in that service).
  New collections prefixed `feria_`: `feria_sellers`, `feria_admins`,
  `feria_orders`.
- Odoo credentials: already configured in that service as `ODOO_URL`,
  `ODOO_DB`, `ODOO_LOGIN`, `ODOO_PASSWORD` — do not add new Odoo env vars.
- New env vars needed (add to `Reportes/backend/.env.example` and to the
  Railway service): `FERIA_AUTH_SECRET` (signs vendedor/caja session
  tokens — separate from the dashboard's own `AUTH_SECRET`),
  `ODOO_FERIA_TEAM_NAME` (Odoo Sales Team name for this feria, e.g. "Feria
  Octubre 2026" — tentative, confirm before go-live).
- Design tokens (colors, spacing, Poppins font) are copied verbatim from
  `BOT-ALTORANCHO/client/src/styles/global.css` — do not invent new brand
  colors.
- The exact invoice-creation RPC method is **not yet confirmed** against
  the real Odoo instance — this plan writes the code against the
  documented/standard Odoo API shape (`_create_invoices`, Odoo 14+) and
  flags the one line that needs verification. It fails loudly (visible
  error in the Caja panel), not silently, if wrong.
- **Follow-up outside this plan** (not a task here, just don't forget it):
  once the real Odoo Sales Team for this feria exists, add its id to
  `FERIA_TEAM_IDS` in `Reportes/backend/sync/feria.mjs` so this feria's
  sales show up in the existing reports automatically.

---

## File Structure

```
Reportes/  (existing repo — work in .worktrees/feature-feria-outlet)
  backend/
    firestore.mjs         (MODIFY — export getDb)
    feriaOdoo.mjs          (NEW — Odoo product/pricelist/partner/order/invoice ops)
    feriaOdoo.test.mjs     (NEW)
    feriaAuth.mjs          (NEW — PIN + caja login, HMAC tokens)
    feriaAuth.test.mjs     (NEW)
    feriaOrders.mjs        (NEW — Firestore order CRUD + validation)
    feriaOrders.test.mjs   (NEW)
    feriaRoutes.mjs        (NEW — Express Router, mounted at /api/feria)
    index.mjs              (MODIFY — mount feriaRoutes)
    .env.example           (MODIFY — document 2 new vars)

feria-alto/  (this repo — work directly on master)
  client/
    index.html
    vite.config.js
    package.json
    src/
      main.jsx
      App.jsx
      lib/api.js
      styles/global.css
      assets/ALTORANCHO.png
      pages/
        VendedorLogin.jsx / .module.css
        VendedorPanel.jsx / .module.css
        CajaLogin.jsx / .module.css
        CajaPanel.jsx / .module.css
  README.md
```

---

### Task 1: `getDb()` export + Odoo write operations (`feriaOdoo.mjs`)

**Repo/dir:** `Reportes`, worktree `Reportes/.worktrees/feature-feria-outlet/backend`

**Files:**
- Modify: `backend/firestore.mjs` (add one export, no other changes)
- Create: `backend/feriaOdoo.mjs`
- Create: `backend/feriaOdoo.test.mjs`

**Interfaces:**
- Consumes: `authenticate`, `callKw` from `./odoo.mjs` (existing, unmodified).
- Produces (used by Task 3's routes):
  - `getDb()` (re-exported from `firestore.mjs`) → Firestore instance
  - `searchProducts(query)` → `Promise<Array<{ id, name, sku, price }>>`
  - `getPricelists()` → `Promise<Array<{ id, name }>>`
  - `findSalesTeamId(teamName)` → `Promise<number|null>`
  - `findOrCreatePartner({ name, docNumber })` → `Promise<number>`
  - `buildSaleOrderPayload({ partnerId, pricelistId, teamId, lines })` → plain object (pure function)
  - `createSaleOrder(vals)` → `Promise<number>`
  - `confirmSaleOrder(orderId)` → `Promise<void>`
  - `createInvoiceForOrder(orderId)` → `Promise<number|null>`

- [ ] **Step 1: Add the `getDb` export to `firestore.mjs`**

Open `backend/firestore.mjs`. It currently has an internal (non-exported)
`function getDb() { ... }`. Change only its declaration line from:

```js
function getDb() {
```

to:

```js
export function getDb() {
```

Nothing else in that file changes — every existing function in it already
calls `getDb()` locally and keeps working exactly as before.

- [ ] **Step 2: Write the failing tests for the pure builder**

Create `backend/feriaOdoo.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSaleOrderPayload } from './feriaOdoo.mjs';

test('arma el payload de sale.order con las líneas en formato Odoo (0,0,{...})', () => {
  const payload = buildSaleOrderPayload({
    partnerId: 42,
    pricelistId: 7,
    teamId: 3,
    lines: [
      { productId: 100, qty: 2, unitPrice: 1500, discountPct: 10 },
      { productId: 101, qty: 1, unitPrice: 800, discountPct: 0 },
    ],
  });

  assert.equal(payload.partner_id, 42);
  assert.equal(payload.pricelist_id, 7);
  assert.equal(payload.team_id, 3);
  assert.equal(payload.order_line.length, 2);
  assert.deepEqual(payload.order_line[0], [0, 0, {
    product_id: 100, product_uom_qty: 2, price_unit: 1500, discount: 10,
  }]);
  assert.deepEqual(payload.order_line[1], [0, 0, {
    product_id: 101, product_uom_qty: 1, price_unit: 800, discount: 0,
  }]);
});

test('sin team_id (todavía no se creó el equipo de ventas en Odoo) lo omite en vez de mandar null', () => {
  const payload = buildSaleOrderPayload({
    partnerId: 42, pricelistId: 7, teamId: null, lines: [
      { productId: 100, qty: 1, unitPrice: 100, discountPct: 0 },
    ],
  });
  assert.equal('team_id' in payload, false);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run (from `backend/`): `npm test`
Expected: FAIL — `feriaOdoo.mjs` doesn't exist yet (85 existing tests still
pass; this is a new failing file).

- [ ] **Step 4: Write `backend/feriaOdoo.mjs`**

```js
import { authenticate, callKw } from './odoo.mjs';

let authenticated = false;

async function ensureAuth() {
  if (!authenticated) {
    await authenticate();
    authenticated = true;
  }
}

// callKw (odoo.mjs) no reintenta si la sesión de Odoo expiró — no hace
// falta para los syncs de reportes, que corren cada pocas horas y toleran
// un reintento del propio cron. Las escrituras de este módulo pasan dinero
// real en el momento de la venta, así que si la sesión expiró, se
// reautentica una vez y se reintenta antes de fallarle al cajero.
async function callKwWithRetry(model, method, args = [], kwargs = {}) {
  await ensureAuth();
  try {
    return await callKw(model, method, args, kwargs);
  } catch (err) {
    authenticated = false;
    await ensureAuth();
    return callKw(model, method, args, kwargs);
  }
}

export async function searchProducts(query) {
  const results = await callKwWithRetry('product.product', 'search_read', [
    ['|', ['default_code', 'ilike', query], ['name', 'ilike', query]],
  ], { fields: ['id', 'name', 'default_code', 'lst_price'], limit: 20 });
  return results.map(p => ({
    id: p.id, name: p.name, sku: p.default_code ?? '', price: p.lst_price,
  }));
}

export async function getPricelists() {
  const results = await callKwWithRetry('product.pricelist', 'search_read', [[]], {
    fields: ['id', 'name'],
  });
  return results.map(p => ({ id: p.id, name: p.name }));
}

export async function findSalesTeamId(teamName) {
  if (!teamName) return null;
  const results = await callKwWithRetry('crm.team', 'search_read', [
    [['name', '=', teamName]],
  ], { fields: ['id'], limit: 1 });
  return results[0]?.id ?? null;
}

// Busca por CUIT/DNI (campo "vat" en Odoo) y crea el partner si no existe.
// No se cargan campos de responsabilidad fiscal AR (l10n_ar_*) porque
// dependen de qué localización tenga instalada este Odoo — confirmar
// contra la instancia real antes de necesitar Factura A (ver spec).
export async function findOrCreatePartner({ name, docNumber }) {
  if (docNumber) {
    const existing = await callKwWithRetry('res.partner', 'search_read', [
      [['vat', '=', docNumber]],
    ], { fields: ['id'], limit: 1 });
    if (existing[0]) return existing[0].id;
  }
  const vals = { name };
  if (docNumber) vals.vat = docNumber;
  const [id] = await callKwWithRetry('res.partner', 'create', [[vals]]);
  return id;
}

export function buildSaleOrderPayload({ partnerId, pricelistId, teamId, lines }) {
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
  return payload;
}

export async function createSaleOrder(vals) {
  const [id] = await callKwWithRetry('sale.order', 'create', [[vals]]);
  return id;
}

export async function confirmSaleOrder(orderId) {
  await callKwWithRetry('sale.order', 'action_confirm', [[orderId]]);
}

// Método estándar de Odoo 14+ para facturar un pedido confirmado. Si esta
// instancia usa una automatización propia para Tienda Nube (a confirmar
// durante la implementación — ver spec), puede hacer falta ajustar este
// método al que esa automatización realmente llama.
export async function createInvoiceForOrder(orderId) {
  try {
    const result = await callKwWithRetry('sale.order', '_create_invoices', [[orderId]]);
    return Array.isArray(result) ? (result[0] ?? null) : (result ?? null);
  } catch (err) {
    console.error('[feriaOdoo] Error creando factura:', err.message);
    return null;
  }
}

export { getDb } from './firestore.mjs';
```

- [ ] **Step 5: Run test to verify it passes**

Run (from `backend/`): `npm test`
Expected: PASS (87 tests — the 85 pre-existing ones plus these 2)

- [ ] **Step 6: Commit**

```bash
git add backend/firestore.mjs backend/feriaOdoo.mjs backend/feriaOdoo.test.mjs
git commit -m "feat(feria): operaciones de escritura en Odoo (partner, sale.order, factura)"
```

---

### Task 2: Autenticación (PIN vendedor + usuario/contraseña caja)

**Repo/dir:** `Reportes`, worktree `Reportes/.worktrees/feature-feria-outlet/backend`

**Files:**
- Create: `backend/feriaAuth.mjs`
- Create: `backend/feriaAuth.test.mjs`

**Interfaces:**
- Consumes: `getDb` from `./feriaOdoo.mjs` (Task 1's re-export — importing
  it from there rather than `firestore.mjs` directly keeps every new feria
  file pointing at the same one import path).
- Produces (used by Task 3's routes):
  - `generateToken(payload)` → `string` (payload always includes `role: 'vendedor' | 'caja'`)
  - `verifyToken(token)` → decoded payload object, or `null` if invalid/expired
  - `validateSellerPin(pin)` → `Promise<{ id, name } | null>`
  - `validateCajaCredentials(email, password)` → `Promise<{ id, email, name } | null>`
  - `seedCajaAdminIfNeeded()` → `Promise<void>`
  - `requireFeriaAuth(req, res, next)` → sets `req.feriaUser`
  - `requireFeriaRole(role)` → `(req, res, next)`

- [ ] **Step 1: Write the failing tests for the token logic**

Create `backend/feriaAuth.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.FERIA_AUTH_SECRET = 'test-secret';
const { generateToken, verifyToken } = await import('./feriaAuth.mjs');

test('generateToken + verifyToken hacen roundtrip con el payload', () => {
  const token = generateToken({ role: 'vendedor', id: 'v1', name: 'Ana' });
  const decoded = verifyToken(token);
  assert.equal(decoded.role, 'vendedor');
  assert.equal(decoded.id, 'v1');
  assert.equal(decoded.name, 'Ana');
});

test('verifyToken devuelve null si el token fue alterado', () => {
  const token = generateToken({ role: 'caja', id: 'c1', name: 'Joaquín' });
  const tampered = token.slice(0, -2) + 'xx';
  assert.equal(verifyToken(tampered), null);
});

test('verifyToken devuelve null para un token con formato inválido', () => {
  assert.equal(verifyToken('esto-no-es-un-token'), null);
  assert.equal(verifyToken(''), null);
  assert.equal(verifyToken(null), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `backend/`): `npm test`
Expected: FAIL — `feriaAuth.mjs` no existe.

- [ ] **Step 3: Write `backend/feriaAuth.mjs`**

```js
import 'dotenv/config';
import crypto from 'node:crypto';
import { getDb } from './feriaOdoo.mjs';

const SECRET = process.env.FERIA_AUTH_SECRET;
const TTL_SECONDS = 60 * 60 * 12; // 12hs — dura un turno del evento
const SELLERS_COLLECTION = 'feria_sellers';
const ADMINS_COLLECTION = 'feria_admins';

function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}

function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Mismo esquema de token que auth.mjs (payload + firma HMAC en vez de
// jsonwebtoken, para no sumar una dependencia nueva), extendido para
// llevar rol e identidad en vez de solo la expiración.
export function generateToken(data) {
  const exp = Date.now() + TTL_SECONDS * 1000;
  const payload = Buffer.from(JSON.stringify({ ...data, exp })).toString('base64url');
  const signature = sign(payload);
  return `${payload}.${signature}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  try {
    if (!safeEqual(sign(payload), signature)) return null;
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof decoded.exp !== 'number' || Date.now() >= decoded.exp) return null;
    return decoded;
  } catch {
    return null;
  }
}

// feria_sellers/{id} = { name, pin }. Se carga a mano en Firestore cuando
// esté definida la lista real de vendedores (ver spec, punto pendiente).
export async function validateSellerPin(pin) {
  const db = getDb();
  const snap = await db.collection(SELLERS_COLLECTION).where('pin', '==', pin).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, name: doc.data().name };
}

export async function validateCajaCredentials(email, password) {
  const db = getDb();
  const id = email.toLowerCase().trim();
  const doc = await db.collection(ADMINS_COLLECTION).doc(id).get();
  if (!doc.exists) return null;
  const data = doc.data();
  if (data.passwordHash !== hashPassword(password)) return null;
  return { id, email: data.email, name: data.name };
}

// Primer usuario de caja para poder entrar la primera vez — cambiar la
// contraseña después de correr esto una vez.
export async function seedCajaAdminIfNeeded() {
  const db = getDb();
  const email = 'joaquin.dilernia@altorancho.com';
  const doc = await db.collection(ADMINS_COLLECTION).doc(email).get();
  if (doc.exists) return;
  await db.collection(ADMINS_COLLECTION).doc(email).set({
    email, name: 'Joaquín Di Lernia', passwordHash: hashPassword('feria2026'),
    createdAt: new Date(),
  });
  console.log('[feriaAuth] Admin de caja seedeado:', email);
}

export function requireFeriaAuth(req, res, next) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  const decoded = verifyToken(token);
  if (!decoded) return res.status(401).json({ error: 'No autenticado' });
  req.feriaUser = decoded;
  next();
}

export function requireFeriaRole(role) {
  return (req, res, next) => {
    if (req.feriaUser?.role !== role) return res.status(403).json({ error: 'Acceso restringido' });
    next();
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `backend/`): `npm test`
Expected: PASS (90 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/feriaAuth.mjs backend/feriaAuth.test.mjs
git commit -m "feat(feria): login por PIN (vendedor) y usuario/contraseña (caja)"
```

---

### Task 3: Pedidos (Firestore) + rutas HTTP + wiring en `index.mjs`

**Repo/dir:** `Reportes`, worktree `Reportes/.worktrees/feature-feria-outlet/backend`

**Files:**
- Create: `backend/feriaOrders.mjs`
- Create: `backend/feriaOrders.test.mjs`
- Create: `backend/feriaRoutes.mjs`
- Modify: `backend/index.mjs` (mount the new router — one import line, one `app.use` line, nothing else touched)
- Modify: `backend/.env.example` (document the 2 new vars from Global Constraints)

**Interfaces:**
- Consumes: `getDb` from `./feriaOdoo.mjs`; everything Task 1 and Task 2 produce.
- Produces: the complete `/api/feria/*` HTTP surface the frontend (Tasks 5-7) talks to.

No automated test for the routes/wiring layer — same convention as the rest
of `Reportes/backend` (`index.mjs` itself has no tests either): verified by
running the server and exercising the flow manually during Task 6's step 5.

- [ ] **Step 1: Write the failing tests for `validateOrderInput`**

Create `backend/feriaOrders.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateOrderInput } from './feriaOrders.mjs';

const validInput = {
  sellerId: 'v1',
  sellerName: 'Ana',
  customer: { name: 'Juan Pérez', docNumber: '20304050607' },
  paymentMethod: 'efectivo',
  pricelistId: 7,
  pricelistName: 'Descuento efectivo',
  lines: [{ productId: 100, sku: 'ABC123', name: 'Silla Roma', qty: 1, unitPrice: 1000, discountPct: 0 }],
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
  const result = validateOrderInput({ ...validInput, customer: { name: '', docNumber: '' } });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('cliente')));
});

test('rechaza método de pago inválido', () => {
  const result = validateOrderInput({ ...validInput, paymentMethod: 'cheque' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('pago')));
});

test('rechaza una línea con cantidad 0 o negativa', () => {
  const result = validateOrderInput({ ...validInput, lines: [{ ...validInput.lines[0], qty: 0 }] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('cantidad')));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `backend/`): `npm test`
Expected: FAIL — `feriaOrders.mjs` no existe.

- [ ] **Step 3: Write `backend/feriaOrders.mjs`**

```js
import { getDb } from './feriaOdoo.mjs';

const COLLECTION = 'feria_orders';
const PAYMENT_METHODS = new Set(['efectivo', 'tarjeta']);

export function validateOrderInput(input) {
  const errors = [];
  if (!input.sellerId) errors.push('Falta identificar al vendedor');
  if (!input.customer?.name?.trim()) errors.push('Falta el nombre del cliente');
  if (!PAYMENT_METHODS.has(input.paymentMethod)) errors.push('Método de pago inválido');
  if (!input.pricelistId) errors.push('Falta elegir una lista de precio');
  if (!input.lines?.length) errors.push('El pedido necesita al menos una línea de producto');
  for (const line of input.lines ?? []) {
    if (!(line.qty > 0)) errors.push(`Cantidad inválida para ${line.name ?? line.sku ?? 'un producto'}`);
    if (!(line.unitPrice >= 0)) errors.push(`Precio inválido para ${line.name ?? line.sku ?? 'un producto'}`);
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
    pricelistId: input.pricelistId,
    pricelistName: input.pricelistName,
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

- [ ] **Step 4: Run test to verify it passes**

Run (from `backend/`): `npm test`
Expected: PASS (95 tests)

- [ ] **Step 5: Write `backend/feriaRoutes.mjs`**

```js
import { Router } from 'express';
import { requireFeriaAuth, requireFeriaRole, validateSellerPin, validateCajaCredentials, generateToken } from './feriaAuth.mjs';
import {
  createOrder, listOrdersByStatus, getOrderById,
  updateOrderPayment, markOrderConfirmed, markOrderError,
} from './feriaOrders.mjs';
import {
  searchProducts, getPricelists, findOrCreatePartner, findSalesTeamId,
  buildSaleOrderPayload, createSaleOrder, confirmSaleOrder, createInvoiceForOrder,
} from './feriaOdoo.mjs';

const router = Router();

router.post('/auth/vendedor', async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin) return res.status(400).json({ error: 'Falta el PIN' });
    const seller = await validateSellerPin(pin);
    if (!seller) return res.status(401).json({ error: 'PIN incorrecto' });
    const token = generateToken({ role: 'vendedor', id: seller.id, name: seller.name });
    res.json({ token, seller });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/auth/caja', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Faltan credenciales' });
    const user = await validateCajaCredentials(email, password);
    if (!user) return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    const token = generateToken({ role: 'caja', id: user.id, email: user.email, name: user.name });
    res.json({ token, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/products/search', requireFeriaAuth, async (req, res) => {
  try {
    const q = req.query.q?.trim();
    if (!q) return res.json({ products: [] });
    res.json({ products: await searchProducts(q) });
  } catch (err) {
    res.status(502).json({ error: `Error consultando Odoo: ${err.message}` });
  }
});

router.get('/pricelists', requireFeriaAuth, async (req, res) => {
  try {
    res.json({ pricelists: await getPricelists() });
  } catch (err) {
    res.status(502).json({ error: `Error consultando Odoo: ${err.message}` });
  }
});

router.post('/orders', requireFeriaAuth, requireFeriaRole('vendedor'), async (req, res) => {
  try {
    const order = await createOrder({
      ...req.body, sellerId: req.feriaUser.id, sellerName: req.feriaUser.name,
    });
    res.status(201).json({ order });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/orders', requireFeriaAuth, requireFeriaRole('caja'), async (req, res) => {
  try {
    res.json({ orders: await listOrdersByStatus(req.query.status || 'pendiente') });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/orders/:id', requireFeriaAuth, async (req, res) => {
  const order = await getOrderById(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  res.json({ order });
});

router.patch('/orders/:id/payment', requireFeriaAuth, requireFeriaRole('caja'), async (req, res) => {
  try {
    await updateOrderPayment(req.params.id, req.body);
    res.json({ order: await getOrderById(req.params.id) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Confirma el pedido: crea (o busca) el partner, arma y crea el sale.order
// en Odoo con el Equipo de ventas de la feria, lo confirma, y factura si
// corresponde. Se puede llamar de nuevo sin problema si quedó en 'error'.
router.post('/orders/:id/confirm', requireFeriaAuth, requireFeriaRole('caja'), async (req, res) => {
  const order = await getOrderById(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });

  try {
    const partnerId = await findOrCreatePartner({
      name: order.customer.name, docNumber: order.customer.docNumber,
    });
    const teamId = await findSalesTeamId(process.env.ODOO_FERIA_TEAM_NAME);
    const vals = buildSaleOrderPayload({
      partnerId, pricelistId: order.pricelistId, teamId,
      lines: order.lines.map(l => ({
        productId: l.productId, qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct,
      })),
    });
    const odooOrderId = await createSaleOrder(vals);
    await confirmSaleOrder(odooOrderId);

    let invoiceId = null;
    if (order.invoiceType) invoiceId = await createInvoiceForOrder(odooOrderId);

    await markOrderConfirmed(order.id, { odooOrderId, invoiceId });
    res.json({ order: await getOrderById(order.id) });
  } catch (err) {
    await markOrderError(order.id, err.message);
    res.status(502).json({ error: `No se pudo confirmar en Odoo: ${err.message}` });
  }
});

export default router;
```

- [ ] **Step 6: Mount the router in `index.mjs`**

Open `backend/index.mjs`. Add two imports near the other local imports
(after `import { fetchAdThumbnail } from './meta.mjs';`):

```js
import feriaRoutes from './feriaRoutes.mjs';
import { seedCajaAdminIfNeeded } from './feriaAuth.mjs';
```

Add one `app.use` line right after the existing `app.use(express.json());`
line (before the `/health` route — order doesn't matter here, but keeping
new feature mounts together and near the top makes them easy to find):

```js
app.use('/api/feria', feriaRoutes);
```

Finally, seed the first caja admin at startup — same idea as the cron
schedule at the bottom of the file, which also only runs when the server
actually starts (not on every module import, e.g. from tests). Change:

```js
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(PORT, () => console.log(`[server] listening on :${PORT}`));
}
```

to:

```js
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seedCajaAdminIfNeeded().catch(err => console.error('[feria] Error seedeando admin:', err.message));
  app.listen(PORT, () => console.log(`[server] listening on :${PORT}`));
}
```

Do not touch anything else in this file — no existing route, the cron
schedule, and the `/health` endpoint stay exactly as they are.

- [ ] **Step 7: Document the new env vars**

Append to `backend/.env.example` (create the file with just these two lines
if it doesn't already have a section for this):

```
# Feria outlet — auth de vendedor/caja y Equipo de ventas en Odoo
FERIA_AUTH_SECRET=
ODOO_FERIA_TEAM_NAME=Feria Octubre 2026
```

- [ ] **Step 8: Run the full test suite to make sure nothing broke**

Run (from `backend/`): `npm test`
Expected: PASS (95 tests — nothing in the pre-existing 85 changed)

- [ ] **Step 9: Start the server locally and smoke-test one endpoint**

Run (from `backend/`): `npm run dev`
In another terminal: `curl http://localhost:3000/api/feria/pricelists` —
expect a `401 {"error":"No autenticado"}` (proves the route is mounted and
guarded, without needing real credentials yet).

- [ ] **Step 10: Commit**

```bash
git add backend/feriaOrders.mjs backend/feriaOrders.test.mjs backend/feriaRoutes.mjs backend/index.mjs backend/.env.example
git commit -m "feat(feria): pedidos en Firestore + rutas /api/feria/* montadas en index.mjs"
```

---

### Task 4: Scaffold del frontend + branding Alto Rancho

**Repo/dir:** `feria-alto` (this repo, work on `master`)

**Files:**
- Create: `client/package.json`
- Create: `client/vite.config.js`
- Create: `client/index.html`
- Create: `client/src/main.jsx`
- Create: `client/src/App.jsx`
- Create: `client/src/lib/api.js`
- Create: `client/src/styles/global.css` (copied from BOT-ALTORANCHO)
- Copy: `client/src/assets/ALTORANCHO.png` (copied from `pick-alto/src/assets/ALTORANCHO.png`)

**Interfaces:**
- Produces (used by Tasks 5-6):
  - `apiFetch(path, options)` → `Promise<any>` — sends
    `Authorization: Bearer <token>` from `localStorage.getItem('feria_token')`;
    `path` is always the full `/api/feria/...` path, since `BASE_URL` points
    at `Reportes/backend`'s own root (it has no other `/api/feria` prefix
    of its own to collide with).
  - CSS variables (`--color-primary`, `--font-sans`, `--space-*`, etc.)

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

Copy the full contents of
`BOT-ALTORANCHO/client/src/styles/global.css` into
`client/src/styles/global.css`, unmodified (palette, Poppins, spacing,
shadows — already solved there).

- [ ] **Step 5: Copy the logo asset**

Copy `pick-alto/src/assets/ALTORANCHO.png` to `client/src/assets/ALTORANCHO.png`.

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

function hasSession(role) {
  return localStorage.getItem('feria_token') && localStorage.getItem('feria_role') === role;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/vendedor" replace />} />
      <Route path="/vendedor" element={hasSession('vendedor') ? <VendedorPanel /> : <VendedorLogin />} />
      <Route path="/caja" element={hasSession('caja') ? <CajaPanel /> : <CajaLogin />} />
    </Routes>
  );
}
```

This file imports `pages/VendedorLogin.jsx`, `pages/VendedorPanel.jsx`,
`pages/CajaLogin.jsx` and `pages/CajaPanel.jsx`, which don't exist yet —
Tasks 5 and 6 create them. Writing it now avoids touching this file again
later.

- [ ] **Step 9: Install deps**

Run (from `client/`): `npm install`
Expected: installs cleanly (the build won't succeed until Task 5 exists —
expected at this point).

- [ ] **Step 10: Commit**

```bash
git add client/package.json client/vite.config.js client/index.html client/src/main.jsx client/src/App.jsx client/src/lib/api.js client/src/styles/global.css client/src/assets/ALTORANCHO.png
git commit -m "chore: scaffold del frontend con branding de Alto Rancho (colores, Poppins, logo)"
```

---

### Task 5: Panel Vendedor

**Repo/dir:** `feria-alto` (this repo, work on `master`)

**Files:**
- Create: `client/src/pages/VendedorLogin.jsx`
- Create: `client/src/pages/VendedorLogin.module.css`
- Create: `client/src/pages/VendedorPanel.jsx`
- Create: `client/src/pages/VendedorPanel.module.css`

**Interfaces:**
- Consumes: `apiFetch` from `lib/api.js` (Task 4). Endpoints (all under the
  `/api/feria` prefix Task 3 mounted): `POST /api/feria/auth/vendedor`,
  `GET /api/feria/products/search?q=`, `GET /api/feria/pricelists`,
  `POST /api/feria/orders`.

No automated component tests in this project (same convention as
BOT-ALTORANCHO, which doesn't test React UI either) — verified by running
`npm run dev` and trying the flow by hand.

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
import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../lib/api.js';
import styles from './VendedorPanel.module.css';

export default function VendedorPanel() {
  const seller = JSON.parse(localStorage.getItem('feria_seller') || '{}');
  const [pricelists, setPricelists] = useState([]);
  const [pricelistId, setPricelistId] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [lines, setLines] = useState([]);
  const [customer, setCustomer] = useState({ name: '', docNumber: '' });
  const [paymentMethod, setPaymentMethod] = useState('efectivo');
  const [status, setStatus] = useState('');
  const searchTimeout = useRef(null);

  useEffect(() => {
    apiFetch('/api/feria/pricelists').then(({ pricelists }) => setPricelists(pricelists)).catch(() => {});
  }, []);

  function handleQueryChange(value) {
    setQuery(value);
    clearTimeout(searchTimeout.current);
    if (!value.trim()) return setResults([]);
    searchTimeout.current = setTimeout(async () => {
      try {
        const { products } = await apiFetch(`/api/feria/products/search?q=${encodeURIComponent(value)}`);
        setResults(products);
      } catch {
        setResults([]);
      }
    }, 300);
  }

  function addLine(product) {
    setLines(prev => [...prev, {
      productId: product.id, sku: product.sku, name: product.name,
      qty: 1, unitPrice: product.price, discountPct: 0,
    }]);
    setQuery('');
    setResults([]);
  }

  function updateLine(index, patch) {
    setLines(prev => prev.map((l, i) => i === index ? { ...l, ...patch } : l));
  }

  function removeLine(index) {
    setLines(prev => prev.filter((_, i) => i !== index));
  }

  const total = lines.reduce((sum, l) => sum + l.qty * l.unitPrice * (1 - l.discountPct / 100), 0);

  async function handleSubmit() {
    setStatus('Enviando...');
    try {
      const selectedPricelist = pricelists.find(p => String(p.id) === String(pricelistId));
      await apiFetch('/api/feria/orders', {
        method: 'POST',
        body: JSON.stringify({
          customer, paymentMethod,
          pricelistId: selectedPricelist?.id, pricelistName: selectedPricelist?.name,
          lines,
        }),
      });
      setLines([]);
      setCustomer({ name: '', docNumber: '' });
      setStatus('¡Pedido enviado a caja!');
      setTimeout(() => setStatus(''), 3000);
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span>Vendedor: {seller.name}</span>
      </header>

      <div className={styles.field}>
        <label className={styles.label}>Lista de precio</label>
        <select className={styles.select} value={pricelistId} onChange={(e) => setPricelistId(e.target.value)}>
          <option value="">Seleccionar...</option>
          {pricelists.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Buscar producto (SKU, etiqueta o modelo)</label>
        <input
          className={styles.input}
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder="Ej: SILLA-ROMA-GRIS"
        />
        {results.length > 0 && (
          <ul className={styles.resultsList}>
            {results.map(p => (
              <li key={p.id} className={styles.resultItem} onClick={() => addLine(p)}>
                <span>{p.name} ({p.sku})</span>
                <span>${p.price}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={styles.lines}>
        {lines.map((line, i) => (
          <div key={i} className={styles.lineRow}>
            <span className={styles.lineName}>{line.name}</span>
            <input
              className={styles.qtyInput} type="number" min="1" value={line.qty}
              onChange={(e) => updateLine(i, { qty: Number(e.target.value) })}
            />
            <input
              className={styles.discInput} type="number" min="0" max="100" value={line.discountPct}
              onChange={(e) => updateLine(i, { discountPct: Number(e.target.value) })}
              title="Descuento extra %"
            />
            <span>${(line.qty * line.unitPrice * (1 - line.discountPct / 100)).toFixed(0)}</span>
            <button className={styles.removeBtn} onClick={() => removeLine(i)}>✕</button>
          </div>
        ))}
      </div>

      <div className={styles.total}>Total: ${total.toFixed(0)}</div>

      <div className={styles.field}>
        <label className={styles.label}>Cliente</label>
        <input
          className={styles.input} placeholder="Nombre y apellido"
          value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })}
        />
        <input
          className={styles.input} placeholder="CUIT/DNI (para factura A, opcional)"
          value={customer.docNumber} onChange={(e) => setCustomer({ ...customer, docNumber: e.target.value })}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Método de pago</label>
        <select className={styles.select} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
          <option value="efectivo">Efectivo</option>
          <option value="tarjeta">Tarjeta</option>
        </select>
      </div>

      {status && <p className={styles.status}>{status}</p>}

      <button
        className={styles.submitBtn}
        onClick={handleSubmit}
        disabled={!lines.length || !pricelistId || !customer.name.trim()}
      >
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
.input, .select {
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: var(--font-size-md);
}
.resultsList {
  position: absolute;
  top: 100%; left: 0; right: 0;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  z-index: 10;
  max-height: 240px;
  overflow-y: auto;
}
.resultItem {
  display: flex; justify-content: space-between;
  padding: var(--space-3); cursor: pointer;
}
.resultItem:hover { background: var(--color-surface-alt); }
.lines { display: flex; flex-direction: column; gap: var(--space-2); }
.lineRow {
  display: grid;
  grid-template-columns: 1fr 50px 60px 70px 30px;
  gap: var(--space-2);
  align-items: center;
  font-size: var(--font-size-sm);
}
.lineName { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qtyInput, .discInput {
  width: 100%; padding: var(--space-1); border: 1px solid var(--color-border); border-radius: var(--radius-sm);
}
.removeBtn { background: none; border: none; color: var(--color-error); font-size: var(--font-size-md); }
.total { font-size: var(--font-size-lg); font-weight: 600; text-align: right; }
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
Run (from `feria-alto/client/`, another terminal): `npm run dev`, with
`VITE_API_URL=http://localhost:3000` (backend's local port from
`index.mjs`'s `PORT` default).
Open the Vite URL, log in with a test PIN loaded by hand into `feria_sellers`
in Firestore, search a real Odoo product, build an order, and confirm it
lands in Firestore's `feria_orders` with `status: 'pendiente'`.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/VendedorLogin.jsx client/src/pages/VendedorLogin.module.css client/src/pages/VendedorPanel.jsx client/src/pages/VendedorPanel.module.css
git commit -m "feat: panel Vendedor (login por PIN, búsqueda de productos, carga de pedido)"
```

---

### Task 6: Panel Caja/Admin

**Repo/dir:** `feria-alto` (this repo, work on `master`)

**Files:**
- Create: `client/src/pages/CajaLogin.jsx`
- Create: `client/src/pages/CajaLogin.module.css`
- Create: `client/src/pages/CajaPanel.jsx`
- Create: `client/src/pages/CajaPanel.module.css`

**Interfaces:**
- Consumes: `apiFetch` from `lib/api.js`. Endpoints: `POST /api/feria/auth/caja`,
  `GET /api/feria/orders?status=pendiente`, `PATCH /api/feria/orders/:id/payment`,
  `POST /api/feria/orders/:id/confirm`.

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
import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api.js';
import styles from './CajaPanel.module.css';

export default function CajaPanel() {
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
    <div className={styles.page}>
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
            <p className={styles.meta}>Vendedor: {selected.sellerName} · Lista: {selected.pricelistName}</p>
            <table className={styles.table}>
              <tbody>
                {selected.lines.map((l, i) => (
                  <tr key={i}>
                    <td>{l.name}</td>
                    <td>x{l.qty}</td>
                    <td>{l.discountPct}% off</td>
                    <td>${(l.qty * l.unitPrice * (1 - l.discountPct / 100)).toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={styles.total}>
              Total: ${selected.lines.reduce((s, l) => s + l.qty * l.unitPrice * (1 - l.discountPct / 100), 0).toFixed(0)}
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
```

- [ ] **Step 4: Write `client/src/pages/CajaPanel.module.css`**

```css
.page {
  display: grid;
  grid-template-columns: 300px 1fr;
  height: 100vh;
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
.select { padding: var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-md); }
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
```

- [ ] **Step 5: Verify the end-to-end flow manually**

With backend and client both running: load an order from `/vendedor`,
confirm it shows up on `/caja` within 5 seconds, open it, pick Factura B,
confirm, and check in Odoo that the `sale.order` was created with the
right Equipo de ventas (or the error it returns, if that team name doesn't
exist in Odoo yet — one of the spec's open items).

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/CajaLogin.jsx client/src/pages/CajaLogin.module.css client/src/pages/CajaPanel.jsx client/src/pages/CajaPanel.module.css
git commit -m "feat: panel Caja (login, lista de pedidos en vivo, confirmar venta + factura)"
```

---

### Task 7: Deploy — documentar ambos lados

**Repo/dir:** `feria-alto` (README) — no backend deploy task, it rides on
`Reportes/backend`'s existing Railway service once its branch merges.

**Files:**
- Create: `README.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Create `README.md`**

```markdown
# Feria Outlet Alto Rancho — frontend

Dos paneles — Vendedor y Caja — para cargar y cobrar pedidos de la feria
outlet de Alto Rancho, con carga automática a Odoo (pedido + factura).

El backend **no está en este repo** — corre dentro de
`Reportes/backend` (rutas bajo `/api/feria/*`, rama
`feature/feria-outlet` hasta que se mergee). Este repo tiene solo el
frontend (`client/`).

Ver el diseño completo en `docs/superpowers/specs/2026-09-18-feria-outlet-design.md`
y el plan de implementación en `docs/superpowers/plans/2026-09-18-feria-outlet-plan.md`.

## Deploy

- **Backend**: no hay nada que deployar aparte — cuando la rama
  `feature/feria-outlet` de `Reportes` se mergea a `main`, las rutas
  `/api/feria/*` quedan disponibles en el mismo servicio de Railway que ya
  corre los reportes. Variables de entorno nuevas a cargar en ese servicio:
  `FERIA_AUTH_SECRET`, `ODOO_FERIA_TEAM_NAME` (ver
  `Reportes/backend/.env.example`).
- **Frontend**: deploy propio, liviano (build estático con `npm run build`
  en `client/`), con `VITE_API_URL` apuntando a la URL pública del servicio
  de Reportes.

Antes del primer uso real: cargar a mano en Firestore la colección
`feria_sellers` (documentos `{ name, pin }`) con los vendedores reales, y
crear en Odoo el Equipo de ventas con el nombre que se ponga en
`ODOO_FERIA_TEAM_NAME`, y las pricelists reales de la feria.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README con instrucciones de deploy (backend vive en Reportes)"
```
