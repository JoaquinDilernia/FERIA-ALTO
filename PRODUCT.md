# Product

## Register

product

## Users

- **Vendedores** de Alto Rancho en la feria outlet (octubre 2026). Usan el panel
  `/#/vendedor` **solo desde el celular**, parados y caminando por la feria con
  el cliente, con una mano, luz variable y apuro. Arman el carrito, reservan
  stock, anotan el número de pedido en la etiqueta de "vendido" y lo mandan a caja.
- **Clientes** en la página pública `/#/feria`, **desde su celular** (entran por
  QR): buscan un producto y ven el precio según cómo paguen.
- **Caja / administración** en `/#/caja`, **en una notebook común (~1366×768)**,
  sentados: confirman ventas en Odoo, dividen pagos, abren y cierran la caja,
  manejan rebajas, entregas, historial y estadísticas.
- **Logística** (depósito feria, Rolón) en `/#/logistica`: entregas y devoluciones a stock.

## Product Purpose

Vender durante la feria sin que se venda dos veces el mismo mueble: stock
reservado desde el carrito, precios por condición (falla / discontinuo) y
medio de pago, y todo sincronizado con Odoo (pedido, remito, factura).
Éxito = vendedores rápidos en el celular, caja que cierra justo, cero ventas
duplicadas.

## Brand Personality

Alto Rancho: sobria, cálida, directa. Minúsculas con punto como el logo
("vendedor.", "feria outlet."). Blanco + gris carbón (#353434), Poppins.
Falla en rojo (#a01c19) y discontinuo en gris azulado (#35454e).

## Anti-references

- Paneles de escritorio achicados en el celular (dos columnas apretadas,
  botones chicos, zoom al tocar un campo).
- Dashboards SaaS genéricos con métricas gigantes y gradientes.
- Diseños pensados para un monitor grande que en una notebook obligan a
  scrollear para confirmar una venta.

## Design Principles

1. **Mobile-first donde se vende**: vendedor y `/feria` se diseñan para una
   mano en el celular y recién después se expanden a pantallas grandes.
2. **Notebook-first donde se cobra**: Caja entra completa en ~1366×768; el
   total a cobrar y "confirmar" se ven sin buscar.
3. **Lo importante al alcance del pulgar**: la acción principal (enviar a
   caja) queda fija abajo en el celular.
4. **El estado se ve de un vistazo**: número de pedido, condición por color,
   stock y faltantes, sin leer párrafos.
5. **Familiaridad antes que sorpresa**: controles estándar, mismo vocabulario
   visual en todas las pantallas.

## Accessibility & Inclusion

- Objetivos táctiles de 44px como mínimo en celular.
- Campos con letra ≥16px en celular (evita el zoom automático de iOS).
- Contraste AA en textos; color nunca como única señal (la condición siempre
  lleva su etiqueta escrita).
- Respeta `prefers-reduced-motion`.
