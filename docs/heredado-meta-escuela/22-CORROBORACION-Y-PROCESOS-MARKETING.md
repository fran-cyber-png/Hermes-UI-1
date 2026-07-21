# 22 — Corroboración de datos + análisis profundo + procesos de marketing

> 2026-07-17. Pedido: "¿podemos corroborar los datos? y hacer tu análisis
> profundo, y con github.com/coreyhaines31/marketingskills generar mejores
> procesos". Tres partes: (A) cada cifra de Ivi auditada contra la base con
> SQL independiente, (B) el análisis de negocio sobre los datos ya
> verificados, (C) seis procesos operativos adoptando el patrón del repo de
> skills (instaladas en `.claude/skills/`, contexto en
> `.claude/product-marketing.md`).

---

## A. Corroboración — método y veredictos

**Método**: SQL directo contra `ontologia.*` (el espejo de Cerberus en el
Postgres local, puerto 5434), reproduciendo las definiciones canónicas del
código (`cobrada AND monto_usd IS NOT NULL`), sin pasar por la cadena
API→Ivi. Donde la cifra viene de una revisión guardada (atribución), se
verificó la aritmética interna de la revisión.

| Cifra que sirve Ivi | Verificación independiente | Veredicto |
|---|---|---|
| Julio 1-11: **155 ventas / USD 19.989** · Junio 1-11: **121 / USD 13.585** · **+28,1%** | SQL mismos días 1..11 | ✅ **EXACTO** (±1 USD de redondeo) |
| "datos hasta el **2026-07-11**" | `max(fecha_venta)` = 2026-07-11 | ✅ |
| Manual de Inteligencia **648** · Portadiploma **480** | `count(DISTINCT folio)` = 648/480 (mis 649/483 eran **unidades**, no ventas — definición del mix correcta) | ✅ |
| ROAS EE.UU. **17,46** (gasto USD 274) | revisión: 4.783/274 = 17,456 | ✅ división exacta |
| Backlog **273** fuera de ventana Meta | descartes del lazo: "Tesorería confirmó tarde" = 273; contabilidad total **cierra perfecta**: 107 enviadas + 6.175 historia + 273 tarde + 113 reembolsadas + 43 sin confirmar + 16 anuladas = 6.727 ✓ | ✅ |
| Ticket promedio **USD 77,33** | mix top-12: 169.515 / 2.192 = 77,33 | ✅ fórmula reproducida |
| Riesgo **USD 21.111** (273 × ticket) | fórmula correcta, PERO estimador bajo — ver hallazgo 2 | ⚠️ subestimado |
| Cartera: 181 cuotas mora / USD 14,3K | definición revisada en `cartera.ts` (CTE de cobrables, `pagado < debe AND vencida`); no reproducida con SQL independiente (requiere copiar el CTE) | 🟡 verificada por definición |

**Conclusión A: Ivi no miente.** Las 9 cifras centrales están confirmadas;
una (el riesgo del backlog) es honesta pero conservadora de más.

## B. Lo que la corroboración destapó (no lo sabíamos)

1. **El lazo CAPI está VIVO en producción desde el 2026-07-13.** Las 107
   conversiones Purchase se enviaron ese día y **las 107 tienen
   `events_received` de Meta** (confirmación real). No hay
   `META_TEST_EVENT_CODE` en el `.env` → no fueron a Test Events. El switch
   de decisiones de pauta sigue fail-closed (`DECISIONES_MODO` ausente →
   default `simulacion` ✓, verificado en `decisions.ts:21`). **Acción:
   confirmar que el encendido del lazo fue decisión humana consciente** —
   si lo fue, es LA noticia del mes: Meta optimiza con compras reales desde
   hace 4 días.
2. **El riesgo del backlog está subestimado ~50%**: USD 21.111 usa el ticket
   del mix (77,33 — promedio por línea de producto); el ticket por VENTA es
   115,13 → el riesgo real ronda **USD 31.400**. Mejor todavía: sumar el
   monto real de las 273 ventas identificadas (mejora chica de backend, va
   al backlog de P3).
3. **El bug de la fecha autoreportada del asesor está ARREGLADO** (2026-07-16,
   verificado en `ontologia/ventas.ts`): el respaldo a `fecha_pago` aplica
   solo a los 5.228 pagos históricos migrados del Excel, que van a la
   audiencia de valor, nunca al lazo con ventana.
4. La frescura real es de 6 días (dump del 11/07, hoy 17/07) — Ivi lo declara
   en cada respuesta, pero para decisiones de pauta diaria hace falta acortar
   el ciclo de dumps (pendiente conocido de infraestructura).

## C. Análisis profundo (solo sobre cifras verificadas)

**La foto**: negocio de USD 719,9K históricos (6.448 ventas cobradas desde
2024), corriendo a ~USD 20K/mes con crecimiento comparable de +28,1%.

1. **La pauta es muy rentable y está sub-invertida.** ROAS blended ≈ **7,2×**
   (gasto ~16,6K → ~119K atribuidos) contra un objetivo de 4×. Los 4 países
   core están TODOS en "escalar" con confianza alta y techo calculado (solo
   Perú admite ~USD +4.800 sin caer del objetivo). La decisión de mayor
   impacto disponible hoy es **escalar presupuesto hacia los techos, país
   por país** — no hace falta creatividad nueva, hace falta capital y
   cadencia de revisión.
2. **EE.UU. es la señal de expansión**: 17,46× con USD 274 (27 ventas,
   USD 4.783). Diáspora latina pagando en USD. Merece un test controlado
   (subir a USD ~500-800/mes y medir 4 semanas) antes de declararlo mercado.
3. **El lazo recién encendido es el multiplicador silencioso.** Hasta el
   13/07 Meta optimizó a ciegas (cero Purchase). Ahora aprende de compras
   reales → audiencias mejores → CAC a la baja [HIPÓTESIS, medible]. Hay que
   MEDIR la curva: CAC semanal por país desde el 13/07 (proceso 3).
4. **Instagram rinde 33-44% de las interacciones vs Facebook** — o
   sub-inversión o desajuste creativo. Antes de mover plata: 2-3 variantes
   nativas de IG (formato historia/reel) con el proceso de fatiga (proceso 2).
5. **El activo muerto más grande: 34.118 personas de Messenger con UNA
   respuesta registrada en toda la historia.** El diálogo que cierra el 61%
   de las ventas (WhatsApp) vive fuera de los sistemas. Cada mejora acá
   (instrumentar respuestas, SLA de primera respuesta) toca directamente la
   tasa de cierre — y es el insumo del customer-research que hoy no existe.
6. **Cartera sana pero sin proceso**: la mora (~USD 14K) es ~2% del histórico
   — no es incendio, es goteo. Lo que falta no es urgencia sino un ritual de
   dunning (proceso 4).
7. **La escalera de ofertas está implícita**: Manual barato como front-end
   masivo (648 ventas), certificados al medio, diplomados caros sosteniendo
   el USD. La skill `offers` da el marco para hacerla explícita: bump de
   certificado en el checkout del manual, upsell de diplomado post-curso,
   garantías. Hoy nadie es dueño de ese diseño.

## D. Los seis procesos (patrón marketing-loops: trigger → pasos → auto-chequeo → stop)

Adoptamos del repo la idea central: un proceso de marketing es un **loop con
cadencia, dueño y condición de corte**, no una tarea que se recuerda cuando
se puede. Ivi es el insumo de datos de cada loop; las skills instaladas son
el manual de cada práctica; la Compuerta (K1, docs/21) los volverá efectos
gobernados.

| # | Loop | Cadencia | Dueño | Skill guía | Cómo corre HOY | Cómo correrá solo |
|---|---|---|---|---|---|---|
| 1 | **Revisión de pauta con materialidad** | Lunes | Growth | `ads` + `analytics` | Ivi: "ROAS por país" + tabla de techos (`oportunidadUsd`) → decidir subas/bajas por país; solo países con señal | detector H1 (P3) + efecto `meta.pauta` con aprobación en Mattermost (K1) |
| 2 | **Fatiga creativa** | Semanal | Growth | `ad-creative` + `ab-testing` | `pauta/fatiga.ts` + brief de reemplazo para creativos con frecuencia alta/CTR en caída; variantes IG nativas primero | trigger de fatiga → brief automático → cola creativa (Bóveda con procedencia) |
| 3 | **Curva CAC post-lazo** | Semanal ×6 semanas | Dev+Growth | `analytics` | consulta fija: CAC por país por semana desde 2026-07-13; ¿baja tras encender el lazo? | detector CAC-trend cuando exista serie histórica de gasto (P3/P4) |
| 4 | **Dunning de cuotas** | Semanal | Tesorería | `churn-prevention` | top-10 morosos de cartera + guion de WhatsApp OFICIAL; **dry-run con lista visible SIEMPRE** (regla dura 7) | efecto `whatsapp.oficial` gated por la Compuerta (K1) |
| 5 | **SLA de leads** | Diaria | Ventas | `revops` | bandeja accionable (leads dentro de ventana sin atender) + registrar la respuesta — matar el "1 respuesta en la historia" | detector lead-sin-atender > X horas → notificación |
| 6 | **Consejo de marketing** | Mensual | Estephano | `marketing-plan` + `offers` | "dame el informe completo" de Ivi + esta tabla de loops como agenda; una decisión de oferta/pricing por mes | informe mensual auto-generado por el warmer (P2) |

**Regla de adopción** (para no morir de procesos): empezar con los loops 1 y
3 esta semana (son los de más plata por hora invertida), sumar uno por semana.
Un loop que dos semanas seguidas no produce decisión se elimina — el proceso
sirve a la decisión, no al ritual.

## E. Qué quedó instalado

- **13 skills** en `.claude/skills/` (project-level, disponibles en cualquier
  sesión de Claude Code en este repo): product-marketing, ads, ad-creative,
  ab-testing, analytics, cro, offers, pricing, churn-prevention,
  marketing-loops, customer-research, revops, marketing-plan.
- **`.claude/product-marketing.md`**: el contexto fundacional que todas las
  skills leen primero — poblado con las cifras VERIFICADAS de este doc (no
  con folklore). Mantenerlo al día cuando cambien los números gordos.
- Uso: "usá la skill offers para diseñar el bump del Manual", "con
  ad-creative dame 6 variantes IG del diplomado X", "armá el loop semanal de
  pauta con marketing-loops".

## F. Lo que esto le pide al roadmap existente

1. **P3 (docs/19)** gana tres detectores concretos salidos de datos
   verificados: curva CAC post-lazo, riesgo de backlog con montos reales
   (no ticket promedio), fatiga creativa como señal.
2. **K1 (docs/21)**: los loops 1, 2 y 4 son exactamente los efectos que la
   Compuerta debe gobernar (`meta.pauta`, cola creativa, `whatsapp.oficial`).
3. **Infra**: acortar el ciclo del dump de Cerberus (frescura 6 días) sube el
   valor de TODOS los loops; y confirmar por decisión humana el estado del
   lazo en producción (hallazgo B.1).
