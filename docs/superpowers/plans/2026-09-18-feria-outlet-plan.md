# Feria Outlet Alto Rancho — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `feria-alto`, a two-panel app (Vendedor / Caja) that lets Alto
Rancho run its outlet feria without paper: a seller loads the order on a
tablet, it appears instantly at the register, the cashier confirms payment
and invoice type, and the order + invoice get created in Odoo.

**Architecture:** Standalone Node/Express backend (`server/`) that owns all
writes to Firestore and Odoo, plus a React/Vite frontend (`client/`) with two
routes (`/vendedor`, `/caja`) that talk only to the backend's REST API. The
Caja panel polls the backend every 5s for new orders (same pattern
BOT-ALTORANCHO's admin panel already uses — no websockets, no direct
Firestore access from the browser).

**Tech Stack:** Node (ESM) + Express + firebase-admin + axios (Odoo JSON-RPC)
+ jsonwebtoken, matching BOT-ALTORANCHO's backend stack exactly. React + Vite
+ CSS Modules for the frontend, reusing BOT-ALTORANCHO's design tokens
(`global.css`) and logo asset. Tests: Node's built-in `node:test` +
`node:assert/strict`, no extra test dependency — same as BOT-ALTORANCHO,
which only unit-tests pure/deterministic functions and does not mock
Odoo/Meta HTTP calls (there's no mocking library in that codebase; this plan
follows the same convention, so every I/O-calling function is paired with a
pure, tested "builder" function that contains the actual logic).

**Spec:** `docs/superpowers/specs/2026-09-18-feria-outlet-design.md`

## Global Constraints

- Firebase project: reuse `pedidos-lett-2` (same project as all other Alto
  Rancho apps). Collections prefixed `feria_`.
- Env var names for Odoo match BOT-ALTORANCHO exactly, so credentials can be
  copy-pasted: `ODOO_URL`, `ODOO_DB`, `ODOO_USER`, `ODOO_API_KEY`.
- Env var names for Firebase Admin match BOT-ALTORANCHO exactly:
  `FIREBASE_PROJECT_ID`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_CLIENT_EMAIL`.
- `JWT_SECRET` required for signing tokens (both vendedor and caja logins).
- Design tokens (colors, spacing, Poppins font) are copied verbatim from
  `BOT-ALTORANCHO/client/src/styles/global.css` — do not invent new brand
  colors.
- Sales team name in Odoo ("Feria Octubre 2026" or whatever it ends up being
  called) and the exact invoice-creation RPC method are **not yet confirmed**
  against the real Odoo instance — Task 2 writes the code against the
  documented/standard Odoo API shape and flags the one line that needs
  verification. Do not block on this; it fails loudly (visible error in the
  Caja panel) instead of silently if wrong.

---

## File Structure

```
feria-alto/
  server/
    src/
      app.js
      services/
        firebase.service.js
        odoo.service.js
        odoo.service.test.js
        feriaAuth.service.js
        feriaAuth.service.test.js
        orders.service.js
        orders.service.test.js
      middleware/
        requireAuth.js
      routes/
        auth.routes.js
        products.routes.js
        pricelists.routes.js
        orders.routes.js
    package.json
    .env.example
  client/
    index.html
    vite.config.js
    package.json
    src/
      main.jsx
      App.jsx
      lib/
        api.js
      styles/
        global.css
      assets/
        ALTORANCHO.png
      pages/
        VendedorLogin.jsx
        VendedorLogin.module.css
        VendedorPanel.jsx
        VendedorPanel.module.css
        CajaLogin.jsx
        CajaLogin.module.css
        CajaPanel.jsx
        CajaPanel.module.css
  README.md
  .gitignore
```

---

### Task 1: Repo scaffold + backend skeleton

**Files:**
- Create: `server/package.json`
- Create: `server/.env.example`
- Create: `server/src/app.js`
- Create: `server/src/app.test.js`
- Create: `.gitignore`
- Create: `README.md`

**Interfaces:**
- Produces: an Express app exported from `server/src/app.js` as default
  export, listening only when run directly (so tests can import it without
  binding a port).

- [ ] **Step 1: Create `.gitignore`**

```
node_modules
dist
.env
.env.local
*.local
```

- [ ] **Step 2: Create `server/package.json`**

```json
{
  "name": "feria-alto-server",
  "version": "1.0.0",
  "description": "Backend de Feria Outlet Alto Rancho - paneles Vendedor y Caja + integración Odoo",
  "type": "module",
  "main": "src/app.js",
  "scripts": {
    "dev": "node --watch src/app.js",
    "start": "node src/app.js",
    "test": "node --test \"src/**/*.test.js\""
  },
  "dependencies": {
    "axios": "^1.7.2",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "firebase-admin": "^12.2.0",
    "jsonwebtoken": "^9.0.3"
  }
}
```

- [ ] **Step 3: Create `server/.env.example`**

```
PORT=5000
JWT_SECRET=

# Firebase Admin SDK (mismo proyecto que los demás bots de Alto Rancho)
FIREBASE_PROJECT_ID=
FIREBASE_PRIVATE_KEY=
FIREBASE_CLIENT_EMAIL=

# Odoo (mismas credenciales que BOT-ALTORANCHO)
ODOO_URL=
ODOO_DB=
ODOO_USER=
ODOO_API_KEY=

# Nombre del Equipo de ventas en Odoo para identificar pedidos de esta feria
ODOO_FERIA_TEAM_NAME=Feria Octubre 2026
```

- [ ] **Step 4: Write the failing test for the app skeleton**

Create `server/src/app.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import app from './app.js';

test('GET /health responde ok', async () => {
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://localhost:${port}/health`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
  } finally {
    server.close();
  }
});
```

- [ ] **Step 5: Run test to verify it fails**

Run (from `server/`): `npm test`
Expected: FAIL — `app.js` doesn't exist yet.

- [ ] **Step 6: Create `server/src/app.js`**

```js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

if (process.env.NODE_ENV !== 'test' && import.meta.url === `file://${process.argv[1]}`) {
  const port = process.env.PORT || 5000;
  app.listen(port, () => console.log(`[feria-alto] server listo en :${port}`));
}

export default app;
```

- [ ] **Step 7: Install deps and run test to verify it passes**

Run (from `server/`): `npm install && npm test`
Expected: PASS

- [ ] **Step 8: Create root `README.md`**

```markdown
# Feria Outlet Alto Rancho

Dos paneles — Vendedor y Caja — para cargar y cobrar pedidos de la feria
outlet de Alto Rancho, con carga automática a Odoo (pedido + factura).

- `server/` — API (Express + Firestore + Odoo).
- `client/` — React (paneles `/vendedor` y `/caja`).

Ver el diseño completo en `docs/superpowers/specs/2026-09-18-feria-outlet-design.md`.
```

- [ ] **Step 9: Commit**

```bash
git add .gitignore README.md server/package.json server/.env.example server/src/app.js server/src/app.test.js
git commit -m "chore: scaffold del backend (Express + health check)"
```

---

### Task 2: Cliente de Odoo (lectura + escritura)

**Files:**
- Create: `server/src/services/odoo.service.js`
- Create: `server/src/services/odoo.service.test.js`

**Interfaces:**
- Consumes: nada de tasks anteriores (usa `process.env.ODOO_*` directamente).
- Produces (usados por Task 4 y las rutas de Task 5):
  - `callOdoo(model, method, args = [], kwargs = {})` → `Promise<any>`
  - `searchProducts(query)` → `Promise<Array<{ id, name, sku, price }>>`
  - `getPricelists()` → `Promise<Array<{ id, name }>>`
  - `findSalesTeamId(teamName)` → `Promise<number|null>`
  - `findOrCreatePartner({ name, docNumber })` → `Promise<number>` (id del partner)
  - `buildSaleOrderPayload({ partnerId, pricelistId, teamId, lines })` → objeto plano (función pura, sin I/O)
  - `createSaleOrder(vals)` → `Promise<number>` (id del pedido creado)
  - `confirmSaleOrder(orderId)` → `Promise<void>`
  - `createInvoiceForOrder(orderId)` → `Promise<number|null>` (id de la factura, o null si no se pudo)

- [ ] **Step 1: Write the failing tests for the pure builder**

Create `server/src/services/odoo.service.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSaleOrderPayload } from './odoo.service.js';

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

- [ ] **Step 2: Run test to verify it fails**

Run (from `server/`): `npm test`
Expected: FAIL — `odoo.service.js` doesn't exist yet.

- [ ] **Step 3: Write `server/src/services/odoo.service.js`**

```js
import axios from 'axios';

const ODOO_URL = process.env.ODOO_URL;
const ODOO_DB  = process.env.ODOO_DB ?? 'odoo';

let cachedUid = null;

async function getUid() {
  if (cachedUid) return cachedUid;
  const { data } = await axios.post(`${ODOO_URL}/jsonrpc`, {
    jsonrpc: '2.0', method: 'call',
    params: {
      service: 'common', method: 'authenticate',
      args: [ODOO_DB, process.env.ODOO_USER, process.env.ODOO_API_KEY, {}],
    },
  }, { timeout: 15000 });
  if (!data.result) throw new Error('[odoo] Auth failed');
  cachedUid = data.result;
  return cachedUid;
}

// Copiado del cliente de BOT-ALTORANCHO (server/src/services/odoo.service.js)
// — mismo patrón de reintento con reset de sesión ante token vencido.
export async function callOdoo(model, method, args = [], kwargs = {}, attempt = 1) {
  try {
    const uid = await getUid();
    const { data } = await axios.post(`${ODOO_URL}/jsonrpc`, {
      jsonrpc: '2.0', method: 'call',
      params: {
        service: 'object', method: 'execute_kw',
        args: [ODOO_DB, uid, process.env.ODOO_API_KEY, model, method, args, kwargs],
      },
    }, { timeout: 15000 });
    if (data.error) {
      cachedUid = null;
      throw new Error(data.error.data?.message ?? 'Odoo RPC error');
    }
    return data.result;
  } catch (err) {
    if (attempt < 3) {
      cachedUid = null;
      return callOdoo(model, method, args, kwargs, attempt + 1);
    }
    throw err;
  }
}

export async function searchProducts(query) {
  const results = await callOdoo('product.product', 'search_read', [
    ['|', ['default_code', 'ilike', query], ['name', 'ilike', query]],
  ], { fields: ['id', 'name', 'default_code', 'lst_price'], limit: 20 });
  return results.map(p => ({
    id: p.id, name: p.name, sku: p.default_code ?? '', price: p.lst_price,
  }));
}

export async function getPricelists() {
  const results = await callOdoo('product.pricelist', 'search_read', [[]], {
    fields: ['id', 'name'],
  });
  return results.map(p => ({ id: p.id, name: p.name }));
}

export async function findSalesTeamId(teamName) {
  if (!teamName) return null;
  const results = await callOdoo('crm.team', 'search_read', [
    [['name', '=', teamName]],
  ], { fields: ['id'], limit: 1 });
  return results[0]?.id ?? null;
}

// Busca por CUIT/DNI (campo "vat" en Odoo) y crea el partner si no existe.
// Nota: no se cargan campos de responsabilidad fiscal AR (l10n_ar_*) porque
// dependen de qué localización tenga instalada este Odoo — hay que
// confirmarlo contra la instancia real antes de necesitar Factura A.
export async function findOrCreatePartner({ name, docNumber }) {
  if (docNumber) {
    const existing = await callOdoo('res.partner', 'search_read', [
      [['vat', '=', docNumber]],
    ], { fields: ['id'], limit: 1 });
    if (existing[0]) return existing[0].id;
  }
  const vals = { name };
  if (docNumber) vals.vat = docNumber;
  const [id] = await callOdoo('res.partner', 'create', [[vals]]);
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
  const [id] = await callOdoo('sale.order', 'create', [[vals]]);
  return id;
}

export async function confirmSaleOrder(orderId) {
  await callOdoo('sale.order', 'action_confirm', [[orderId]]);
}

// Método estándar de Odoo 14+ para facturar un pedido confirmado. Si esta
// instancia de Odoo usa una automatización propia para Tienda Nube (a
// confirmar durante la implementación — ver spec), puede que haga falta
// ajustar este método al que esa automatización realmente llama.
export async function createInvoiceForOrder(orderId) {
  try {
    const result = await callOdoo('sale.order', '_create_invoices', [[orderId]]);
    return Array.isArray(result) ? (result[0] ?? null) : (result ?? null);
  } catch (err) {
    console.error('[odoo] Error creando factura:', err.message);
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `server/`): `npm test`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/services/odoo.service.js server/src/services/odoo.service.test.js
git commit -m "feat: cliente de Odoo con lectura de productos/pricelists y escritura de pedidos"
```

---

### Task 3: Autenticación (PIN vendedor + usuario/contraseña caja)

**Files:**
- Create: `server/src/services/firebase.service.js`
- Create: `server/src/services/feriaAuth.service.js`
- Create: `server/src/services/feriaAuth.service.test.js`
- Create: `server/src/middleware/requireAuth.js`

**Interfaces:**
- Consumes: nada.
- Produces (usados por Task 4 y las rutas de Task 5):
  - `getDb()` → instancia de Firestore (desde `firebase.service.js`)
  - `initFirebase()` → inicializa la app de firebase-admin
  - `hashPassword(password)` → string
  - `generateToken(payload)` → string (JWT, `payload` incluye siempre `role: 'vendedor' | 'caja'`)
  - `verifyToken(token)` → objeto decodificado
  - `validateSellerPin(pin)` → `Promise<{ id, name } | null>`
  - `validateCajaCredentials(email, password)` → `Promise<{ id, email, name } | null>`
  - `seedCajaAdminIfNeeded()` → `Promise<void>`
  - middleware `requireAuth(req, res, next)` → setea `req.user`
  - middleware factory `requireRole(role)` → `(req, res, next)`

- [ ] **Step 1: Write the failing tests for the pure/token logic**

Create `server/src/services/feriaAuth.service.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, generateToken, verifyToken } from './feriaAuth.service.js';

process.env.JWT_SECRET = 'test-secret';

test('hashPassword es determinístico y no devuelve el texto plano', () => {
  const hash = hashPassword('altolett123');
  assert.equal(hash, hashPassword('altolett123'));
  assert.notEqual(hash, 'altolett123');
});

test('generateToken + verifyToken hacen roundtrip con el payload', () => {
  const token = generateToken({ role: 'vendedor', id: 'v1', name: 'Ana' });
  const decoded = verifyToken(token);
  assert.equal(decoded.role, 'vendedor');
  assert.equal(decoded.id, 'v1');
  assert.equal(decoded.name, 'Ana');
});

test('verifyToken tira si el token es inválido', () => {
  assert.throws(() => verifyToken('token-invalido'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `server/`): `npm test`
Expected: FAIL — módulos no existen.

- [ ] **Step 3: Write `server/src/services/firebase.service.js`**

```js
import admin from 'firebase-admin';

let db = null;

export function initFirebase() {
  if (admin.apps.length) return;
  const { FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL } = process.env;
  if (!FIREBASE_PRIVATE_KEY || !FIREBASE_CLIENT_EMAIL) {
    console.warn('[firebase] Sin credenciales de service account — Firestore no disponible');
    return;
  }
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: FIREBASE_PROJECT_ID,
      privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      clientEmail: FIREBASE_CLIENT_EMAIL,
    }),
  });
  db = admin.firestore();
  console.log('[firebase] Firestore conectado');
}

export function getDb() {
  if (!db) throw new Error('Firestore no disponible — completá las credenciales en .env');
  return db;
}
```

- [ ] **Step 4: Write `server/src/services/feriaAuth.service.js`**

```js
import jwt from 'jsonwebtoken';
import { createHash } from 'crypto';
import { getDb } from './firebase.service.js';

const SELLERS_COLLECTION = 'feria_sellers';
const ADMINS_COLLECTION = 'feria_admins';

export function hashPassword(password) {
  return createHash('sha256').update(password).digest('hex');
}

export function generateToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '12h' });
}

export function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
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

// Mismo patrón de seed que BOT-ALTORANCHO — primer usuario de caja para
// poder entrar la primera vez. Cambiar la contraseña después del seed.
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
```

- [ ] **Step 5: Write `server/src/middleware/requireAuth.js`**

```js
import { verifyToken } from '../services/feriaAuth.service.js';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

export function requireRole(role) {
  return (req, res, next) => {
    if (req.user?.role !== role) return res.status(403).json({ error: 'Acceso restringido' });
    next();
  };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run (from `server/`): `npm test`
Expected: PASS (5 tests)

- [ ] **Step 7: Commit**

```bash
git add server/src/services/firebase.service.js server/src/services/feriaAuth.service.js server/src/services/feriaAuth.service.test.js server/src/middleware/requireAuth.js
git commit -m "feat: autenticación por PIN (vendedor) y usuario/contraseña (caja)"
```

---

### Task 4: Pedidos (Firestore) — validación, creación, listado, confirmación

**Files:**
- Create: `server/src/services/orders.service.js`
- Create: `server/src/services/orders.service.test.js`

**Interfaces:**
- Consumes: `getDb()` de `firebase.service.js` (Task 3).
- Produces (usados por las rutas de Task 5):
  - `validateOrderInput(input)` → `{ valid: boolean, errors: string[] }` (función pura)
  - `createOrder(input)` → `Promise<{ id, ...order }>` (guarda con `status: 'pendiente'`)
  - `listOrdersByStatus(status)` → `Promise<Array<order>>`
  - `getOrderById(id)` → `Promise<order|null>`
  - `updateOrderPayment(id, { paymentMethod, invoiceType })` → `Promise<void>`
  - `markOrderConfirmed(id, { odooOrderId, invoiceId })` → `Promise<void>`
  - `markOrderError(id, errorDetail)` → `Promise<void>`

- [ ] **Step 1: Write the failing tests for `validateOrderInput`**

Create `server/src/services/orders.service.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateOrderInput } from './orders.service.js';

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
  const result = validateOrderInput(validInput);
  assert.deepEqual(result, { valid: true, errors: [] });
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
  const result = validateOrderInput({
    ...validInput,
    lines: [{ ...validInput.lines[0], qty: 0 }],
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('cantidad')));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `server/`): `npm test`
Expected: FAIL — `orders.service.js` no existe.

- [ ] **Step 3: Write `server/src/services/orders.service.js`**

```js
import { getDb } from './firebase.service.js';

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
    odooOrderId,
    invoiceId,
    errorDetail: null,
    updatedAt: new Date(),
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

Run (from `server/`): `npm test`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/services/orders.service.js server/src/services/orders.service.test.js
git commit -m "feat: servicio de pedidos en Firestore con validación"
```

---

### Task 5: Rutas HTTP y wiring en `app.js`

**Files:**
- Create: `server/src/routes/auth.routes.js`
- Create: `server/src/routes/products.routes.js`
- Create: `server/src/routes/pricelists.routes.js`
- Create: `server/src/routes/orders.routes.js`
- Modify: `server/src/app.js`

**Interfaces:**
- Consumes: todo lo de Tasks 2, 3 y 4 (`odoo.service.js`, `feriaAuth.service.js`, `orders.service.js`, `requireAuth.js`).
- Produces: la API HTTP completa que consume el frontend (Tasks 6-8).

No hay test automatizado para esta capa (mismo criterio que BOT-ALTORANCHO:
no hay librería de mocking de HTTP en el proyecto, así que las rutas que
llaman a Odoo se prueban a mano contra la instancia real durante la
implementación, no con tests unitarios).

- [ ] **Step 1: Write `server/src/routes/auth.routes.js`**

```js
import { Router } from 'express';
import { validateSellerPin, validateCajaCredentials, generateToken } from '../services/feriaAuth.service.js';

const router = Router();

router.post('/vendedor', async (req, res) => {
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

router.post('/caja', async (req, res) => {
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

export default router;
```

- [ ] **Step 2: Write `server/src/routes/products.routes.js`**

```js
import { Router } from 'express';
import { searchProducts } from '../services/odoo.service.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

router.get('/search', requireAuth, async (req, res) => {
  try {
    const q = req.query.q?.trim();
    if (!q) return res.json({ products: [] });
    const products = await searchProducts(q);
    res.json({ products });
  } catch (err) {
    res.status(502).json({ error: `Error consultando Odoo: ${err.message}` });
  }
});

export default router;
```

- [ ] **Step 3: Write `server/src/routes/pricelists.routes.js`**

```js
import { Router } from 'express';
import { getPricelists } from '../services/odoo.service.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const pricelists = await getPricelists();
    res.json({ pricelists });
  } catch (err) {
    res.status(502).json({ error: `Error consultando Odoo: ${err.message}` });
  }
});

export default router;
```

- [ ] **Step 4: Write `server/src/routes/orders.routes.js`**

```js
import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import {
  createOrder, listOrdersByStatus, getOrderById,
  updateOrderPayment, markOrderConfirmed, markOrderError,
} from '../services/orders.service.js';
import {
  findOrCreatePartner, findSalesTeamId, buildSaleOrderPayload,
  createSaleOrder, confirmSaleOrder, createInvoiceForOrder,
} from '../services/odoo.service.js';

const router = Router();

router.post('/', requireAuth, requireRole('vendedor'), async (req, res) => {
  try {
    const order = await createOrder({
      ...req.body, sellerId: req.user.id, sellerName: req.user.name,
    });
    res.status(201).json({ order });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/', requireAuth, requireRole('caja'), async (req, res) => {
  try {
    const status = req.query.status || 'pendiente';
    const orders = await listOrdersByStatus(status);
    res.json({ orders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', requireAuth, async (req, res) => {
  const order = await getOrderById(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  res.json({ order });
});

router.patch('/:id/payment', requireAuth, requireRole('caja'), async (req, res) => {
  try {
    await updateOrderPayment(req.params.id, req.body);
    const order = await getOrderById(req.params.id);
    res.json({ order });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Confirma el pedido: crea (o busca) el partner, arma y crea el sale.order
// en Odoo con el Equipo de ventas de la feria, lo confirma, y factura si
// corresponde. Se puede llamar de nuevo sin problema si quedó en 'error'
// (reintento simple, no hay endpoint separado).
router.post('/:id/confirm', requireAuth, requireRole('caja'), async (req, res) => {
  const order = await getOrderById(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });

  try {
    const partnerId = await findOrCreatePartner({
      name: order.customer.name, docNumber: order.customer.docNumber,
    });
    const teamId = await findSalesTeamId(process.env.ODOO_FERIA_TEAM_NAME);
    const vals = buildSaleOrderPayload({
      partnerId,
      pricelistId: order.pricelistId,
      teamId,
      lines: order.lines.map(l => ({
        productId: l.productId, qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct,
      })),
    });
    const odooOrderId = await createSaleOrder(vals);
    await confirmSaleOrder(odooOrderId);

    let invoiceId = null;
    if (order.invoiceType) {
      invoiceId = await createInvoiceForOrder(odooOrderId);
    }

    await markOrderConfirmed(order.id, { odooOrderId, invoiceId });
    const updated = await getOrderById(order.id);
    res.json({ order: updated });
  } catch (err) {
    await markOrderError(order.id, err.message);
    res.status(502).json({ error: `No se pudo confirmar en Odoo: ${err.message}` });
  }
});

export default router;
```

- [ ] **Step 5: Wire everything into `server/src/app.js`**

```js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { initFirebase } from './services/firebase.service.js';
import { seedCajaAdminIfNeeded } from './services/feriaAuth.service.js';
import authRoutes from './routes/auth.routes.js';
import productsRoutes from './routes/products.routes.js';
import pricelistsRoutes from './routes/pricelists.routes.js';
import ordersRoutes from './routes/orders.routes.js';

initFirebase();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/pricelists', pricelistsRoutes);
app.use('/api/orders', ordersRoutes);

if (process.env.NODE_ENV !== 'test' && import.meta.url === `file://${process.argv[1]}`) {
  seedCajaAdminIfNeeded().catch(err => console.error('[app] Error seedeando admin:', err.message));
  const port = process.env.PORT || 5000;
  app.listen(port, () => console.log(`[feria-alto] server listo en :${port}`));
}

export default app;
```

- [ ] **Step 6: Run the full test suite to make sure nothing broke**

Run (from `server/`): `npm test`
Expected: PASS (10 tests — el `app.test.js` de Task 1 sigue pasando)

- [ ] **Step 7: Commit**

```bash
git add server/src/routes server/src/app.js
git commit -m "feat: rutas de auth, productos, pricelists y pedidos (crear/listar/confirmar)"
```

---

### Task 6: Scaffold del frontend + branding Alto Rancho

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
- Produces (usados por Tasks 7 y 8):
  - `apiFetch(path, options)` → `Promise<any>` (agrega `Authorization: Bearer <token>` desde `localStorage.getItem('feria_token')`, tira si la respuesta no es ok)
  - CSS variables globales (`--color-primary`, `--font-sans`, `--space-*`, etc.) disponibles en toda la app.

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
`BOT-ALTORANCHO/client/src/styles/global.css` a `client/src/styles/global.css`
sin modificaciones (paleta, tipografía Poppins, espaciados, sombras — ya
está resuelto ahí).

- [ ] **Step 5: Copy the logo asset**

Copiar `pick-alto/src/assets/ALTORANCHO.png` a `client/src/assets/ALTORANCHO.png`.

- [ ] **Step 6: Create `client/src/lib/api.js`**

```js
export const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

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

- [ ] **Step 8: Create `client/src/App.jsx`** (rutas — los componentes de página los crean las Tasks 7 y 8; por ahora placeholders mínimos para que el routing sea navegable de punta a punta)

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

Nota: `App.jsx` importa `pages/VendedorLogin.jsx`, `pages/VendedorPanel.jsx`,
`pages/CajaLogin.jsx` y `pages/CajaPanel.jsx`, que todavía no existen — eso
se resuelve en las Tasks 7 y 8. Este archivo queda escrito ya con esos
imports para no tener que volver a tocarlo.

- [ ] **Step 9: Install deps**

Run (from `client/`): `npm install`
Expected: instala sin errores (el build todavía va a fallar hasta la Task 7, es esperado).

- [ ] **Step 10: Commit**

```bash
git add client/package.json client/vite.config.js client/index.html client/src/main.jsx client/src/App.jsx client/src/lib/api.js client/src/styles/global.css client/src/assets/ALTORANCHO.png
git commit -m "chore: scaffold del frontend con branding de Alto Rancho (colores, Poppins, logo)"
```

---

### Task 7: Panel Vendedor

**Files:**
- Create: `client/src/pages/VendedorLogin.jsx`
- Create: `client/src/pages/VendedorLogin.module.css`
- Create: `client/src/pages/VendedorPanel.jsx`
- Create: `client/src/pages/VendedorPanel.module.css`

**Interfaces:**
- Consumes: `apiFetch` de `lib/api.js` (Task 6). Endpoints: `POST /api/auth/vendedor`, `GET /api/products/search?q=`, `GET /api/pricelists`, `POST /api/orders`.
- Produces: nada consumido por otras tasks (hoja del árbol de UI).

No hay tests automatizados de componentes React en este proyecto (mismo
criterio que BOT-ALTORANCHO, que tampoco testea UI) — se verifica corriendo
`npm run dev` y probando el flujo a mano.

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
      const { token, seller } = await apiFetch('/api/auth/vendedor', {
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
    apiFetch('/api/pricelists').then(({ pricelists }) => setPricelists(pricelists)).catch(() => {});
  }, []);

  function handleQueryChange(value) {
    setQuery(value);
    clearTimeout(searchTimeout.current);
    if (!value.trim()) return setResults([]);
    searchTimeout.current = setTimeout(async () => {
      try {
        const { products } = await apiFetch(`/api/products/search?q=${encodeURIComponent(value)}`);
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
      await apiFetch('/api/orders', {
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

- [ ] **Step 5: Verify the flow manually**

Run (from `server/`): `npm run dev`
Run (from `client/`, in another terminal): `npm run dev`
Abrir la URL de Vite, entrar con un PIN de prueba cargado a mano en
`feria_sellers` en Firestore, buscar un producto real de Odoo, armar un
pedido y confirmar que aparece en Firestore con `status: 'pendiente'`.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/VendedorLogin.jsx client/src/pages/VendedorLogin.module.css client/src/pages/VendedorPanel.jsx client/src/pages/VendedorPanel.module.css
git commit -m "feat: panel Vendedor (login por PIN, búsqueda de productos, carga de pedido)"
```

---

### Task 8: Panel Caja/Admin

**Files:**
- Create: `client/src/pages/CajaLogin.jsx`
- Create: `client/src/pages/CajaLogin.module.css`
- Create: `client/src/pages/CajaPanel.jsx`
- Create: `client/src/pages/CajaPanel.module.css`

**Interfaces:**
- Consumes: `apiFetch` de `lib/api.js`. Endpoints: `POST /api/auth/caja`, `GET /api/orders?status=pendiente`, `PATCH /api/orders/:id/payment`, `POST /api/orders/:id/confirm`.

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
      const { token, user } = await apiFetch('/api/auth/caja', {
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
      const { orders } = await apiFetch('/api/orders?status=pendiente');
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
        await apiFetch(`/api/orders/${selected.id}/payment`, {
          method: 'PATCH', body: JSON.stringify({ invoiceType }),
        });
      }
      await apiFetch(`/api/orders/${selected.id}/confirm`, { method: 'POST' });
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

Con el server y el client corriendo: cargar un pedido desde `/vendedor`,
verificar que aparece en `/caja` dentro de 5 segundos, abrirlo, elegir
Factura B, confirmar, y chequear en Odoo que se creó el `sale.order` con el
Equipo de ventas correcto (o el error que devuelva, si el nombre del equipo
todavía no existe en Odoo — es uno de los puntos pendientes del spec).

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/CajaLogin.jsx client/src/pages/CajaLogin.module.css client/src/pages/CajaPanel.jsx client/src/pages/CajaPanel.module.css
git commit -m "feat: panel Caja (login, lista de pedidos en vivo, confirmar venta + factura)"
```

---

### Task 9: Deploy en Railway

**Files:**
- Create: `server/Procfile` (opcional, Railway lo detecta solo por `start` script, pero lo dejamos explícito)
- Modify: `README.md`

**Interfaces:** ninguna (tarea de configuración/documentación).

- [ ] **Step 1: Create `server/Procfile`**

```
web: node src/app.js
```

- [ ] **Step 2: Update `README.md` with deploy instructions**

```markdown
## Deploy (Railway)

Este repo tiene dos apps que se deployan como dos servicios separados de
Railway, apuntando cada uno a su propio "root directory":

1. **Backend** — nuevo servicio en Railway, root directory `server/`,
   variables de entorno según `server/.env.example` (mismas credenciales de
   Odoo y Firebase que BOT-ALTORANCHO, más `JWT_SECRET` y
   `ODOO_FERIA_TEAM_NAME` propios de este proyecto).
2. **Frontend** — otro servicio, root directory `client/`, build command
   `npm run build`, variable `VITE_API_URL` apuntando a la URL pública del
   servicio de backend.

Antes del primer uso: cargar a mano en Firestore la colección
`feria_sellers` (documentos `{ name, pin }`) con los vendedores reales, y
crear en Odoo el Equipo de ventas con el nombre que se ponga en
`ODOO_FERIA_TEAM_NAME`, y las pricelists reales de la feria.
```

- [ ] **Step 3: Commit**

```bash
git add server/Procfile README.md
git commit -m "docs: instrucciones de deploy en Railway"
```
