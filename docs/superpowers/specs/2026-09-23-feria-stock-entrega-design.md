# Feria outlet — Stock, reserva, entrega por línea y panel Logística

Fecha: 2026-09-23 · Feria: ~1 semana · Complementa `2026-09-18-feria-outlet-design.md`.

Surge de la reunión del 2026-09-22. Cubre tres partes que se construyen en
orden: **A** stock y reserva, **B** entrega por línea, **C** panel Logística.
Suma además un pedido de facturación: **precios sin IVA hacia Odoo** (ver
sección propia; es independiente y va primero por ser chico).
Quedan fuera (para después): teléfono obligatorio para todo cliente (acá solo
se pide para envío), panel "Depto retiro" separado.

## IVA — precio unitario sin IVA en Odoo

Pedido de facturación: todo se factura, así que el `price_unit` que llega a
Odoo tiene que ser **sin IVA**; Odoo aplica el impuesto del producto (21%) y
el total del pedido vuelve a dar el precio que paga el cliente.

- `price_unit = precio con IVA / 1.21`, redondeado a 2 decimales. Aplica a
  productos (`listPrice`) y a la línea de envío ($10.000 → 8.264,46).
- El `discount` del medio de pago no cambia (es un porcentaje).
- Constante `IVA_RATE = 0.21` en `feriaPricing.mjs`. Supuesto: todos los
  productos de la feria (y "Envío Feria") tienen IVA 21% en Odoo. Si alguno
  tuviera otra alícuota, su total en Odoo no coincidiría — se verifica en la
  prueba real.
- Por el redondeo a centavos, el total en Odoo puede diferir en ±$0,01–0,05
  del precio de la app. Aceptado.
- Precios en la app (vendedor, caja, `/feria`): siguen mostrándose **con
  IVA**. Solo cambia lo que viaja a Odoo.
- Ejemplo real (pedido S09476): tabla $9.990, transferencia 20%. Hoy viajó
  `price_unit 9990` → total Odoo $9.670,32. Con el cambio: `price_unit
  8256.20`, desc. 20% → subtotal 6.604,96 + IVA = **$7.992,00**.

## Odoo — lo que ya existe

- Almacén **Feria** (`FER`, id 43), entrega en 1 paso (`ship_only`),
  tipo de operación de salida "Feria: Expediciones" (id 374).
- Ubicaciones:
  - `FER/Stock/exhibicion` (id 427) — lo que está físicamente en la feria.
  - `FER/Stock/Rolon` (id 428) — lo que está en Rolón (para mandar a la
    feria, retiro en Rolón o envío a domicilio).
  - `FER/FER` (id 426) — no se usa.
- Medios de pago y equipo/pricelist de feria: ya resueltos (commit 2274753).
- **Falta crear:** producto **"Envío Feria"** (tipo servicio). Se busca por
  nombre (variable `ODOO_FERIA_SHIPPING_PRODUCT_NAME`); si no existe, confirmar
  un pedido con envío falla con error claro.

Los ids de ubicación van por variable de entorno
(`ODOO_FERIA_LOCATION_EXHIBICION_ID=427`, `ODOO_FERIA_LOCATION_ROLON_ID=428`),
no hardcodeados, por si las recrean.

## Modelo de datos (Firestore)

### Línea de pedido (`feria_orders.lines[]`)

Campos nuevos, además de `sku, modelo, condition, qty, unitPrice, listPrice`:

| Campo | Valores | Quién lo define |
|---|---|---|
| `lineId` | id único dentro del pedido | backend al crear |
| `location` | `exhibicion` · `rolon` | vendedor |
| `delivery` | `ahora` · `retira_feria` · `retira_rolon` · `envio` | vendedor |
| `status` | `pendiente` · `entregado` · `eliminado` | sistema |
| `deliveredAt`, `deliveredBy` | fecha, usuario | al pasar a entregado |
| `removedAt`, `removedBy` | fecha, usuario | al pasar a eliminado |
| `odooLineId` | id de `sale.order.line` | al confirmar en caja |

Regla: `delivery = ahora` exige `location = exhibicion` (se rechaza al crear).

Una línea eliminada **no se borra**: queda en el array con `status: eliminado`
para el historial del pedido.

### Pedido (`feria_orders`)

- `status` suma `cancelado` (además de `pendiente`, `confirmado`, `error`).
- `shipping` (solo si alguna línea tiene `delivery = envio`), todo obligatorio
  salvo observaciones:
  `{ street, number, floor, city, zip, phone, notes }` (`floor` y `notes`
  opcionales).

### Reservas (`feria_reservations`, colección nueva)

Un documento por SKU+ubicación, id `"{SKU}__{location}"`:
`{ sku, location, reserved: <número> }`.

Es el único lugar donde vive "lo reservado en la app". Se modifica **siempre
dentro de una transacción de Firestore** junto con el pedido.

## A — Stock y reserva

**Disponible(sku, ubicación) = stock Odoo en esa ubicación − reserved.**

- *Stock Odoo* = suma de `stock.quant.quantity` en la ubicación (427 o 428).
  Se ignora `reserved_quantity` de Odoo a propósito: la app es la única que
  reserva, y lo que Odoo reserve por su cuenta al confirmar ya está contado en
  `reserved` de la app hasta que la línea se entrega.
- Supuesto operativo: **nadie mueve stock del almacén Feria por fuera de la
  app**, salvo entradas (transferencias hacia la feria). Si alguien vende o
  saca desde Odoo a mano, el disponible queda mal.

### Ciclo de la reserva

| Evento | `reserved` |
|---|---|
| Vendedor crea pedido | `+qty` por línea (en su ubicación) |
| Caja elimina una línea | `−qty` de esa línea |
| Caja cancela el pedido | `−qty` de todas las líneas pendientes |
| Línea pasa a entregada (Odoo validó el remito, stock ya bajó en Odoo) | `−qty` |

### Lectura en vivo

- Búsqueda del vendedor (`/api/feria/products/search`): una consulta a
  `stock.quant` para los SKUs del resultado (hasta 30) en las 2 ubicaciones +
  lectura de sus docs de reserva. Devuelve por producto
  `stock: { exhibicion: n, rolon: n }` (disponible, nunca negativo) o
  `stock: null` si Odoo no respondió.
- **Nunca** se expone stock en el buscador público `/feria`.
- El vendedor ve "Exhibición: 2 · Rolón: 5". **No puede agregar** una línea si
  el disponible en la ubicación elegida es menor a la cantidad, o si
  `stock` es `null` (Odoo caído → no se vende; decisión explícita).
  *A confirmar con el equipo de stock si "sin stock = no se vende" se mantiene.*

### Crear pedido sin sobreventa

`POST /orders`: el backend lee el stock Odoo de los SKUs del pedido y, en
**una transacción**, lee las reservas, verifica `disponible ≥ qty` para cada
línea y suma las reservas + guarda el pedido. Si alguna no alcanza, rechaza
todo el pedido con el detalle (`"ALF029CG en Exhibición: pediste 2, hay 1"`).
Dos vendedores simultáneos por la última unidad: la transacción de Firestore
reintenta y el segundo recibe el rechazo.

## B — Entrega por línea

### Vendedor

Por cada línea elige **ubicación** y **forma de entrega**:

1. **Se lleva ahora** — solo desde Exhibición.
2. **Retira en feria otro día**
3. **Retira en Rolón**
4. **Envío a domicilio** — si hay al menos una, el formulario pide los datos de
   envío (obligatorios: calle, número, localidad, CP, teléfono; opcionales:
   piso/depto, observaciones/horario). Se muestra el cargo de envío.

### Envío

- Cargo fijo **$10.000 por pedido** (no por línea), **sin** descuento por
  medio de pago. Constante en `feriaPricing.mjs` (`SHIPPING_COST = 10000`).
- En Odoo: una línea extra con el producto "Envío Feria", `price_unit`
  10000 sin IVA (8.264,46, ver sección IVA), `discount 0`.
- Dirección: se crea un contacto hijo del cliente (`res.partner`,
  `type: 'delivery'`, `parent_id` = cliente) con la dirección, teléfono y
  observaciones en `comment`, y se pasa como `partner_shipping_id`.

### Caja

- El detalle del pedido muestra cada línea con ubicación, entrega, stock en
  vivo y estado.
- Antes de confirmar puede:
  - **Eliminar una línea** → `status: eliminado` (+ quién/cuándo), libera
    reserva. No se puede eliminar la última línea pendiente (para eso,
    cancelar).
  - **Cancelar el pedido** → `status: cancelado`, libera todas las reservas.
- Después de confirmar no se eliminan líneas ni se cancela desde la app
  (se hace en Odoo; fuera de alcance).

### Confirmar en caja (Odoo)

1. `sale.order` como hoy + `warehouse_id: 43` + `partner_shipping_id` si hay
   envío + línea de envío. **Solo líneas pendientes** (las eliminadas no van).
2. Guardar `odooLineId` de cada línea (leyendo `order_line` del pedido
   creado, en el mismo orden).
3. `action_confirm` → Odoo genera el remito de salida del almacén Feria.
4. Si hay líneas `ahora`: **validación parcial del remito** solo con esas
   líneas, tomando de `FER/Stock/exhibicion`, generando remito pendiente
   (backorder) con el resto. Esas líneas pasan a `entregado` y se libera su
   reserva.

La validación parcial (paso 4 y el "Hecho" de Logística) es una única función
`deliverLines(odooOrderId, [{odooLineId, qty, locationId}])`:
- busca el remito abierto del pedido, en los `stock.move` de esas líneas
  (`sale_line_id`) fija la ubicación origen y la cantidad hecha,
- valida el remito resolviendo el asistente de backorder con "crear
  backorder".

**Riesgo:** el detalle de cómo marcar cantidades hechas y resolver el
asistente depende de la versión de Odoo. **Primer paso del plan: spike** con
un pedido real de 2 productos (uno "ahora", uno pendiente) antes de construir
el resto.

Si la validación falla después de confirmado el pedido: el pedido queda
`confirmado` con esas líneas aún `pendiente` + `errorDetail`, y se pueden
marcar como hechas desde Logística (reintento). No se desconfirma nada.

## C — Panel Logística

Ruta nueva `/#/logistica`, mismo login que caja (rol `caja`).

- Lista pedidos `confirmado` con al menos una línea `pendiente`, ordenados por
  fecha en memoria (sin índices compuestos: `where status == confirmado` y se
  filtra/ordena en código).
- Tres pestañas: **Mandar a feria** (`retira_feria`), **Retiro en Rolón**
  (`retira_rolon`), **Envío a domicilio** (`envio`, muestra dirección,
  teléfono y observaciones).
- Cada línea tiene botón **"Hecho"** → `deliverLines` en Odoo con su ubicación
  → `entregado` + libera reserva.
- "Hecho" significa **entregado al cliente** (el remito de Odoo es la salida
  al cliente), no "preparado". En "Mandar a feria" se aprieta cuando el
  cliente lo retira en la feria; mientras tanto la línea sigue pendiente y
  reservada. El traslado físico Rolón → feria no se registra como movimiento
  aparte en Odoo (sale de `FER/Stock/Rolon` directo al cliente).

## Cómo se ve un pedido

En Caja y en Logística cada línea muestra su estado:
✅ **Entregado** (fecha, quién) · ⏳ **Pendiente** (forma de entrega, ubicación)
· ~~**Eliminado**~~ (fecha, quién).

## Rutas nuevas / cambiadas (backend)

| Ruta | Rol | Qué hace |
|---|---|---|
| `GET /products/search` | vendedor, caja | suma `stock` por ubicación |
| `POST /orders` | vendedor | valida ubicación/entrega/envío, reserva en transacción |
| `DELETE /orders/:id/lines/:lineId` | caja | elimina línea (soft), libera reserva |
| `POST /orders/:id/cancel` | caja | cancela, libera reservas |
| `POST /orders/:id/confirm` | caja | + almacén, envío, validación de líneas `ahora` |
| `GET /logistics/orders` | caja | confirmados con líneas pendientes |
| `POST /orders/:id/lines/:lineId/deliver` | caja | "Hecho" desde Logística |

## Testing

- Unitarios (node:test, como hoy): precio sin IVA (incluye el ejemplo
  9990 → 8256.20), cálculo de disponible, validación de
  línea (`ahora` ⇒ exhibición, envío ⇒ datos obligatorios), ciclo de reservas
  (crear/eliminar/cancelar/entregar), payload de `sale.order` con almacén,
  envío y `partner_shipping_id`.
- Spike real contra Odoo de la validación parcial (antes de construir).
- Prueba punta a punta real: pedido mixto (1 ahora + 1 retira Rolón + 1
  envío), confirmar, revisar remito y backorder en Odoo, "Hecho" desde
  Logística, verificar que el stock y las reservas cierran.
