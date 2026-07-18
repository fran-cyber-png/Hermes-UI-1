# Cerberus (ceberusapp) — el ERP de ventas

**Qué es:** el sistema donde se registran las ventas de la escuela. Fuente de verdad
del ingreso. Repo `Goberna-Lab/ceberusapp`. Django + **MySQL** (tablas `tb_`), en
**VPS2** (app.goberna.us). Single-tenant.

## Entidades / data clave

| Entidad | Campos clave | Para Ivi |
|---|---|---|
| **Venta** (`tb_venta`) | folio, cliente, **país** (nullable→cliente.pais), moneda (+tasa congelada), **medio** (organico/pagado/...), **origen** (facebook/instagram/...), monto_total, **estado** (1 Pagado, 4 Anulado, 8 Reembolsado), fecha_venta | cabecera de la venta; el único (débil) link a Meta |
| **DetalleVenta** (`tb_detalleVenta`) | venta, **producto**, precio_venta/total | qué curso se vendió (producto a nivel línea; una venta mezcla productos) |
| **Producto** (`tb_producto`) | nombre, categoría (Curso Online/Seminario/Evento), precios, id Moodle | catálogo, ticket por producto |
| **Cliente** (`tb_cliente`) | nombre, dni, país, email/tel | comprador; email/tel = identidad para CAPI |
| **Cuota / Pago** | numero_cuota, monto; **Pago.estado=2 (Completado)**, método, fecha_pago | **ingreso REAL cobrado** = suma de pagos confirmados, NO monto_total |
| MetodoPago, Moneda, Facturacion, NotaCredito | tipo_pago, radio de cambio, comprobantes, NC | medios de pago, FX, netear reembolsos |

## Integración

- **Con Meta: casi nula.** Solo `origen`/`medio` (dropdowns MANUALES del vendedor). NO
  hay campaign_id/adset_id/UTM/fbclid/fbp/fbc ni spend. WooCommerce **hardcodea**
  `origen='correo'` + `medio='pagado'` → el e-commerce pierde el canal real.
- **Salida analítica:** (1) **dump SQL** periódico → backend meta-escuela. (2) **webhook a
  Icarus** en vivo (`sales/icarus_payload.py`, JSON rico) en cada venta/pago.

## Qué le da a Ivi
Ingreso por país / producto / período, estado (cobrado/anulado/reembolsado), ticket,
medios de pago, cobranza (cuotas en mora). **Es el numerador del ROAS.**

## Gaps
País nullable (default Perú); producto a nivel línea (join); ingreso contratado ≠
cobrado; sin atribución a campaña; ContactLead (padrón CSV de emails) desconectado del
funnel. Ver [../27](../27-PLAN-DATA-Y-MARCO-ANALITICO.md) §2.
