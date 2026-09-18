# Feria Outlet Alto Rancho — diseño

**Fecha:** 2026-09-18
**Estado:** aprobado a nivel diseño, pendiente de completar datos de Odoo/vendedores

## Contexto

Alto Rancho hace ferias outlet de forma manual. Piden automatizar el circuito de
venta en el momento: un vendedor con tablet/celular arma el pedido con el
cliente, y ese pedido llega a un segundo puesto (caja) donde se cobra, se
confirma el pago y se factura. El pedido tiene que quedar cargado en Odoo,
identificado como venta de feria (no confundirse con web/local/mayorista).

Es un proyecto nuevo y standalone (repo propio, `feria-alto`), no una feature
dentro de BOT-ALTORANCHO — decisión explícita del cliente, revisada en la
sesión de brainstorming sobre unificar backends de Alto Rancho (se decidió NO
unificar por ahora).

## Qué se reutiliza de BOT-ALTORANCHO

- **Proyecto Firebase**: se reutiliza `pedidos-lett-2` (mismo patrón que
  todos los demás proyectos de Alto Rancho), con colecciones prefijadas
  `feria_...`.
- **Cliente RPC de Odoo**: se copia `callOdoo(model, method, args, kwargs)` de
  `BOT-ALTORANCHO/server/src/services/odoo.service.js` como punto de partida
  — ya tiene reintentos y reautenticación resueltos ante sesión expirada.
  Importante: ese cliente hoy es **solo de lectura** (`search_read`/`read`).
  Este proyecto necesita **escribir** en Odoo (crear `sale.order`, líneas,
  partner, y disparar factura) — es trabajo nuevo, no algo que ya exista para
  copiar tal cual.

## Arquitectura

- App web con dos vistas: `/vendedor` y `/caja`.
- Sync en tiempo real entre ambas vía listeners de Firestore (mismo patrón
  que usa el bot para reflejar mensajes al instante) — un pedido creado en
  `/vendedor` aparece al instante en `/caja` sin refrescar.
- Backend chico en Node (Express), con el cliente Odoo extendido para
  escritura.

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
