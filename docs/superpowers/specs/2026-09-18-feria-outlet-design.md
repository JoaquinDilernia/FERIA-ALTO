# Feria Outlet Alto Rancho — diseño

**Fecha:** 2026-09-18
**Estado:** aprobado a nivel diseño, pendiente de completar datos de Odoo/vendedores

## Contexto

Alto Rancho hace ferias outlet de forma manual. Piden automatizar el circuito de
venta en el momento: un vendedor con tablet/celular arma el pedido con el
cliente, y ese pedido llega a un segundo puesto (caja) donde se cobra, se
confirma el pago y se factura. El pedido tiene que quedar cargado en Odoo,
identificado como venta de feria (no confundirse con web/local/mayorista).

El frontend (paneles Vendedor/Caja) es un proyecto nuevo standalone (repo
`feria-alto`). El **backend NO es un servicio nuevo**: corre adentro del
backend ya deployado de `Reportes` (mismo repo `Reportes/backend`, mismo
servicio de Railway) — decisión tomada explícitamente para no sumar un
tercer servicio de Railway a mantener, revisada en la misma sesión de
brainstorming sobre unificar backends de Alto Rancho.

## Qué se reutiliza de Reportes/backend

`Reportes/backend` ya tiene, corriendo en producción, exactamente lo que
hace falta para no reinventar la conexión a Odoo:

- **`odoo.mjs`**: cliente JSON-RPC por sesión (`authenticate()` +
  `callKw(model, method, args, kwargs)`) — genérico, sirve tanto para leer
  como para **escribir** (`create`, `write`, `action_confirm`, etc.), aunque
  hoy solo se usa para lectura (sync de reportes). Se reutiliza tal cual, sin
  tocarlo — el código nuevo de este proyecto llama a `callKw` para crear el
  partner, el `sale.order` y la factura.
- **`firestore.mjs`**: init de Firebase Admin contra `pedidos-lett-2` (mismo
  proyecto que todos los bots de Alto Rancho). Hoy no expone el `db` crudo
  (solo funciones de alto nivel) — se le agrega un export de `getDb()` para
  que el código nuevo pueda leer/escribir sus propias colecciones
  (`feria_sellers`, `feria_admins`, `feria_orders`) sin duplicar el init.
- **Variables de entorno de Odoo/Firebase ya cargadas** en ese servicio de
  Railway — no hace falta cargar credenciales nuevas, solo agregar
  `FERIA_AUTH_SECRET` (para firmar sesiones de vendedor/caja) y
  `ODOO_FERIA_TEAM_NAME`.
- **Dato extra encontrado al revisar el código**: `Reportes/backend/sync/feria.mjs`
  ya agrupa varios Equipos de venta históricos de Odoo bajo el canal
  "feria" de los reportes (`FERIA_TEAM_IDS = [10, 20, 21, 22, 23, 24]` —
  ferias/expos pasadas). Cuando se cree en Odoo el Equipo de venta de esta
  feria nueva, agregar su ID a esa lista — así las ventas de este proyecto
  aparecen solas en los reportes existentes, sin trabajo extra.

**Lo que NO se reutiliza** (auth): `Reportes/backend/auth.mjs` es una sesión
única de dashboard (una sola contraseña compartida, sin roles ni usuarios
individuales) — no sirve para identificar vendedores ni separar el rol
caja. Se agrega un archivo nuevo (`feriaAuth.mjs`) con el mismo estilo de
token firmado por HMAC que ya usa `auth.mjs` (sin sumar `jsonwebtoken` como
dependencia nueva), pero con payload de rol + identidad.

## Arquitectura

- Frontend: app React con dos vistas, `/vendedor` y `/caja`, repo propio
  (`feria-alto`), deploy propio (liviano, como ya hacen otros frontends de
  Alto Rancho) apuntando a `Reportes/backend` con `VITE_API_URL`.
- Backend: rutas nuevas bajo `/api/feria/*` agregadas a `Reportes/backend`
  (archivo `feriaRoutes.mjs` montado en `index.mjs`, sin tocar las rutas de
  reportes existentes).
- Sync entre paneles: Caja consulta `/api/feria/orders?status=pendiente`
  cada 5 segundos (mismo patrón de polling que ya usa el panel de
  BOT-ALTORANCHO — no hace falta Firestore listeners del lado del cliente).

## Login

- **Vendedor**: PIN o selección de nombre de una lista — rápido, pensado para
  cargar en el momento de la venta con el cliente al lado. Todavía no hay
  info de qué vendedores van a participar; se carga esa lista cuando esté
  definida (no bloquea el desarrollo del resto).
- **Caja/Admin**: login más formal (usuario + contraseña), porque maneja
  confirmación de pago y facturación. Asimetría intencional vs. el login del
  vendedor.

## Flujo — Panel Vendedor

1. Vendedor entra con su PIN/nombre.
2. Busca producto por SKU, etiqueta o modelo — **consulta directa a Odoo en
   tiempo real** (no hay copia sincronizada a Firestore; se decidió así para
   tener precio/disponibilidad siempre al día, aceptando la dependencia de
   que Odoo esté arriba en el momento del evento).
3. Elige lista de precio — se traen las pricelists que ya existen en Odoo.
   **Las 4 listas reales de la feria (descuento/fallas × efectivo/tarjeta)
   todavía no están creadas en Odoo** — mientras tanto se prueba con listas
   ya existentes. El diseño no debe hardcodear nombres ni cantidad de
   listas: se listan las pricelists disponibles y listo.
4. Puede cargar un descuento extra manual por línea de producto (además de
   la lista de precio elegida).
5. Carga datos del cliente: nombre, DNI/CUIT, razón social si aplica —
   suficiente para poder facturar tipo A si después lo piden, aunque la
   decisión de qué factura emitir se toma en caja.
6. Carga método de pago (referencia para caja; caja puede ajustarlo).
7. Pedido se guarda en Firestore con estado `pendiente`.

## Flujo — Panel Caja/Admin

1. Ve en vivo la lista de pedidos en estado `pendiente`.
2. Abre un pedido, revisa todo con el cliente presente.
3. Confirma o ajusta el método de pago.
4. Elige tipo de factura (B / A si corresponde por los datos cargados).
5. Confirma la venta. Al confirmar:
   - Se crea (o busca) el partner en Odoo por CUIT/DNI.
   - Se crea el `sale.order` con:
     - **Equipo de ventas = "Feria Octubre 2026"** (o el nombre que se
       defina) — mismo campo que ya usan hoy para distinguir Tienda Nube /
       Mayorista / Mercado Libre / Punto de Venta, visible en la pestaña
       "Otra información" del pedido en Odoo.
     - La pricelist elegida por el vendedor.
     - Las líneas de producto con sus descuentos.
   - Si caja marcó "Factura B" (o A), se dispara la generación de factura en
     Odoo.
6. El pedido pasa a estado `confirmado` (o `facturado`) en Firestore, con el
   ID del `sale.order`/factura de Odoo.

## Manejo de errores

Si falla la creación en Odoo (Odoo caído, timeout, dato inválido), el pedido
queda en estado `error` en el panel de caja con el detalle del fallo y un
botón de reintentar — sin perder los datos ya cargados. Mismo patrón que ya
usa BOT-ALTORANCHO para reintentar mensajes de WhatsApp/Instagram fallidos
(`msgStatus: 'error'` + botón "Reenviar").

## Pendiente de definir (no bloquea empezar a construir)

- **Nombre final de la feria** / del Sales Team en Odoo (hoy: "Feria Octubre
  2026", tentativo).
- **Mecanismo exacto de facturación automática**: hoy Odoo ya factura solo
  los pedidos de Tienda Nube, pero no está claro si es una Automated
  Action/cron, o si se dispara al confirmar el pedido. Hay que revisarlo
  directamente en el Odoo real antes de implementar el paso de facturación
  — se puede construir el resto del flujo mientras tanto y dejar esta parte
  para el final.
- **Lista de vendedores** (nombres/PINs) — se carga cuando esté definida.
- **Las 4 pricelists reales de la feria** — se crean en Odoo más adelante;
  mientras tanto se usan pricelists existentes para probar el flujo.
