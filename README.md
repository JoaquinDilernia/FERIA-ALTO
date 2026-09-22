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
- **Ruteo**: las rutas usan URLs con hash (`/#/vendedor`, `/#/caja`,
  `/#/feria`) justamente para no depender de ninguna configuración de
  rewrite del lado del servidor — el navegador nunca manda el hash al host,
  así que alcanza con que sirva `index.html` y entrar directo desde un QR
  funciona en cualquier host estático. **Ojo al armar el QR o el link del
  panel público: la URL real lleva el `#`** (`https://.../#/feria`).

Antes del primer uso real:
- Cargar a mano en Firestore la colección `feria_sellers` (documentos
  `{ name, pin }`) con los vendedores reales.
- Correr `npm run import:feria-prices -- "<ruta al excel>"` en
  `Reportes/backend` para cargar `feria_products` (repetir cada vez que el
  negocio actualice el Excel de precios — no pisa las rebajas ya activadas
  a mano).
