# Product Marketing Context — Goberna Escuela

> Contexto fundacional que TODAS las marketing skills leen antes de trabajar
> (convención del repo coreyhaines31/marketingskills). Cifras verificadas
> contra el espejo de Cerberus el 2026-07-17 (datos hasta el 2026-07-11) —
> ver `docs/22-CORROBORACION-Y-PROCESOS-MARKETING.md`. Actualizar cuando
> cambien los números gordos, no cada semana.

## El negocio

- **Qué**: Goberna vende cursos, certificados y diplomados de **formación
  política** a adultos en LATAM (compra de alta consideración, decisión
  mediada por conversación humana).
- **Dónde**: 6 países core — Perú, México, Ecuador, Bolivia, Colombia, Chile.
  Señal de expansión: EE.UU. (diáspora que paga en USD, mejor ticket).
- **Volumen verificado**: 6.448 ventas cobradas / USD 719.903 históricos
  (desde 2024). Ritmo actual ~USD 20K/mes, creciendo (+28,1% jul vs jun,
  mismos días 1..11).

## El embudo (el camino del dinero)

Anuncio Meta (24 cuentas, ~12.100 anuncios) → comentario FB/IG, Messenger
(34.118 personas), formulario Lead Ads o landing (grupogoberna.com) →
**WhatsApp cierra el 61% de las ventas** → Cerberus (ERP, la venta) →
Moodle/escuela (cursa) → certificaciones (se certifica).

- **CAPI/lazo**: VIVO desde 2026-07-13 — Meta recibe compras reales
  (Purchase). Antes optimizaba a ciegas.
- Dato duro: de 76.869 mensajes de Messenger hay **1 respuesta registrada** —
  el diálogo comercial vive en WhatsApp personal, sin instrumentar.

## Productos y precios (mix verificado)

| Producto | Rol en la escalera | Ventas | Señal |
|---|---|---|---|
| Manual de Inteligencia y Contrainteligencia Ed.2 | front-end masivo, ticket bajo | 648 | el más vendido |
| Certificado con Portadiploma | medio | 480 | segundo |
| Diplomados / programas | back-end ticket alto | — | sostienen el USD |

- Ticket promedio por línea de producto (mix): **USD 77,33** · por venta:
  **USD 115,13** (las ventas multi-producto son comunes — usar el de venta
  para estimar revenue).
- 9,9% de ventas en cuotas; cobranza vía vouchers + confirmación de
  Tesorería (p90 = 3,9 días).

## Pauta (verificado 2026-07-15, revisión de atribución)

- **ROAS blended ≈ 7,2×** (gasto ~USD 16,6K → ~USD 119K atribuidos) vs
  objetivo interno 4× — rentable y con techo de inversión disponible.
- Por país (confianza alta, acción "escalar"): Perú 7,25× (CAC 14,87) ·
  México 7,07× · Ecuador 5,82× · Bolivia 4,28× (CAC 24,5, el más caro).
- EE.UU.: 17,46× con solo USD 274 de gasto (confianza media) — candidato a
  test de escala.
- Canales: Facebook domina interacciones (55-67%), Instagram débil (33-44%).
- REGLA DE MATERIALIDAD: países con gasto < USD 150 o confianza baja NO se
  accionan (son gasto de prueba; el caso Honduras 65× con USD 33).

## Restricciones duras (no negociables)

1. WhatsApp: SOLO API oficial para clientes (Baileys prohibido, política
   2026-07-03). Todo envío masivo exige dry-run con destinatarios visibles.
2. Español siempre. Marca Goberna: azul + dorado, Montserrat
   (`goberna-design-system` skill).
3. Cifras en piezas públicas: solo verificadas (etiquetas HECHO/ESTIMACIÓN
   del motor Ivi — no inventar números en creativos ni landings).
4. Los datos del negocio (P&L, PII) no salen a modelos cloud sin decisión
   humana.

## Herramientas propias

- **Ivi** (`goberna-kos/ivi/`): analista BI conversacional — pregunta en
  lenguaje natural, responde con HECHO/ESTIMACIÓN/SIN EVIDENCIA. UI en
  geógrafo :8080.
- Dashboard meta-escuela (React, local :5173): pauta maestro, embudo,
  bandeja de leads, cartera.
- Landings: `goberna-landings` skill (folder-shadow en grupogoberna.com con
  Pixel + Sheet + Bravo).
