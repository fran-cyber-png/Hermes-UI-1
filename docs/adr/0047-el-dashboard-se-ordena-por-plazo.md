# ADR 0047 — El Dashboard se ordena por plazo, no por fuente de datos

- **Fecha**: 2026-08-10
- **Estado**: aceptado
- **Épica**: ver `docs/plan-rediseno-dashboard.md`
- **Enmienda** ADR 0006 (§4: lo que quedó sin escribir del cuadro «Equipo»)
- **Convive con** ADR 0036 (el Dashboard es de quien lo mira), que no se toca:
  la frontera del supervisor y el recorte personal siguen exactamente igual
- **Aplica al Dashboard** lo que ADR 0044 aplicó al Pipeline

## El problema

Las cinco cajas de «Mi turno» son **cinco consultas dibujadas**: `consultarRadar`,
`contarPorEtapaEfectiva`, `consultarSeriesDashboard`, `intereses`, `porVendedora`. Cada query es
una caja. Eso es una arquitectura de servidor renderizada, no una pantalla diseñada.

La consecuencia se mide. Lo que la pantalla pone al frente contra lo que la base dice del mismo
asunto, el 10-ago-2026:

| La pantalla | | La base | |
|---|---|---|---|
| «93 personas esperan» | 93 | Leads de 120 días que **nunca** recibieron un mensaje | **2 470** |
| «1397 en el embudo» | 1 397 | Filas en `leads`, 21 meses, que ninguna pantalla usa | **26 165** |
| «13 cierre» | 13 | Leads con una venta **posterior** a su formulario | **348** |
| Tabla «Por curso» | 34 | Ventas en `tb_venta` de Cerberus | **7 105** |
| — | no existe | **DIPCPOL025 abre en 9 días con 19 matriculados** (las 3 anteriores: 68 · 84 · 80) | 19 |
| — | no existe | Pagaron DIPICOT026 y no están matriculados, con la clase empezando hoy | 8 |

La cifra héroe —la más grande, la que abre la mañana— es **el 3,8 % del trabajo que está sin
hacer**. Y lo único en todo Goberna que tiene un plazo duro corriendo no tiene un solo pixel.

## Las decisiones

### 1. El eje es la decisión, y las decisiones se ordenan por plazo

Tres bandas, de arriba abajo: **lo que tiene un reloj corriendo · lo que se está perdiendo · lo que
se está haciendo**. Hoy la pantalla es solo la tercera.

| Banda | La decisión | El dato |
|---|---|---|
| **1 · El reloj** | ¿Qué edición está en riesgo? | Días a la primera clase × matriculados vs. la mediana de la familia |
| **2 · El hueco** | ¿A quién no le hablamos? | 26 040 → 664 → 348, cortado por país · curso · ocupación |
| **3 · La mesa** | ¿A quién atiendo ahora? | El radar de hoy, agrupado |

Un bloque entra a una banda si **cambia lo que alguien hace hoy**. Es el mismo test de ADR 0006
(*«¿esto cambia a quién atiende ahora?»*) con el sujeto ampliado: ahora hay dos personas mirando
esta pantalla, y ADR 0036 ya las separó.

### 2. El embudo de conversaciones NO es un embudo, y por eso la barra segmentada se queda

`sin_respuesta · interesado · contactado · cotizado · cierre · perdido` son **estados mutuamente
excluyentes**: una conversación está en exactamente uno y no anidan. Dibujarlos como embudo da
`377 → 217 → 790 → 13`, que **se ensancha en el medio** — hay 3,6× más Cotizados que Contactados
porque cotizado no es «contactado que avanzó», es otro estado.

O sea que `BarraSegmentada` (parte-todo) **es la gráfica correcta y no se sustituye**. Lo único que
le falta es el segmento que omite (§3).

La primitiva `Embudo` se construye para lo que **sí** anida: el embudo del negocio
(llenó → le hablaron → compró) y el de una edición (pagó → se matriculó). Su tipo exige
`n ≤ n` del peldaño anterior, así que el error de la panza lo impide el compilador.

### 3. El Dashboard cuenta las seis etapas, y la lista no vive en el front

`VistaDashboard.tsx` hace `ETAPAS.reduce(...)` y `ETAPAS` excluye `sin_respuesta` a propósito.
El resultado es que el titular dice **1 397** cuando el seam devuelve **3 973**:
`3 973 − 2 576 = 1 397`, y las cuatro etapas visibles coinciden dígito por dígito con el embudo
medido en producción.

El comentario que justifica la exclusión dice que «el Dashboard solo cuenta conversaciones con un
primer entrante, así que por construcción nunca lo devuelve». **Eso es cierto de `/negocio`**, cuyo
`HAVING` lo exige, **y falso del embudo del radar**, que llama a `contarPorEtapaEfectiva` — el mismo
seam del Pipeline, donde `sin_respuesta` es la columna más grande.

**`sin_respuesta` no entra a `ETAPAS`**: eso lo volvería declarable y arrastrable, que es justo lo
que ADR 0044 prohíbe. El total y los segmentos salen de **lo que el server mandó**, no de una lista
del front. El candado es un test de paridad, como los otros ocho del repo: *toda etapa que el embudo
puede devolver, el Dashboard la tiene que poder dibujar*.

### 4. El sello dice la frescura del CAÑO, no la del caché

El punto verde pulsante de «en vivo» mide que el `fetch` está fresco. Medido: **0 salientes desde
el 7-ago**, y la línea principal `51986394450` —dos tercios del tablero— no manda nada desde el
**28-jul**. A dos centímetros, el chip «sin caídas hace 1 día» y la cabecera «Captura detenida hace
1 día» lo contradicen: tres indicadores de salud en la misma banda dando tres respuestas.

Pasa a decir el último movimiento real del negocio (`Último saliente: hace 3 días`), con la misma
escala de tinta que ya usa el resto. **Un punto verde sobre un canal muerto es exactamente la clase
de mentira contra la que está escrito el resto de este repo.**

### 5. «El negocio» cambia de unidad: de conversación a edición

Hoy mide *conversaciones nacidas en el período*: 34 filas sobre un negocio de 7 105 ventas, con ocho
de las nueve filas en 1 o 2 y la columna «Cerrados» entera en cero.

El modelo medido dice que **se vende por edición y hay un reloj**: el SKU lleva el número
(`DIPICOT026`), cada edición vive 45-55 días y hace 85-90 ventas, y la ventana abre ~42 días antes
de la primera clase y **no cierra el día de inicio**. La fila pasa a ser la edición.

⚠️ **El saldo pendiente se muestra por moneda y nunca sumado**: el total crudo da 1 843 588 y el
87 % de eso son pesos colombianos de siete ventas. Es la misma trampa del `avg(total)`.

### 6. El oro se muda a donde corre el plazo

`CLAUDE.md`: *el dorado significa tiempo que se acaba, nada más*. Hoy está en el punto de
«93 personas esperan», donde no vence nada. Pasa a la Banda 1, que es el único plazo duro del
negocio. Las bandas 2 y 3 no llevan oro.

### 7. Lo que ADR 0006 dejó sin escribir sobre «Equipo»

ADR 0006 retiró el cuadro con un argumento explícito: comparar vendedoras contradice la spec
(*«jamás rachas, récords ni comparación con el equipo»*). El cuadro volvió y **ningún ADR
documentó la reversión**, lo cual incumple la regla dura #3.

La resolución honesta es que **ADR 0036 ya había resuelto la objeción y nadie lo escribió**: desde
que el Dashboard es personal, una vendedora ve **una sola fila, la suya, rotulada «Vos»**, y la
comparación solo existe para el supervisor, para quien es el trabajo. El cuadro se queda, y esta
sección es el registro que faltaba.

Lo que sí estaba roto y se arregla: el toggle arranca en **Hoy**, el único período garantizado de
estar vacío (27 ceros en la captura), y `ACTORES_DE_SISTEMA` es una lista a mano que ya envejeció
—`campana` y `Usuario1` se cuelan como personas— tal como su propio comentario predijo.

## Alternativas descartadas

- **Una vista nueva en paralelo con feature flag.** Sería un patrón nuevo en un repo que evoluciona
  cada frente en su lugar y usa las galerías como superficie de evidencia. Además N4 y N5 se
  despliegan separados, así que la app ya sabe convivir con dos versiones del contrato.
- **Sustituir `BarraSegmentada` por un embudo.** Es la gráfica correcta para estados excluyentes;
  cambiarla sería un retroceso (§2).
- **Meter una librería de gráficos.** Hay cuatro primitivas propias con la marca ya resuelta y lo
  que falta son dos de ~60 líneas. Recharts pesa 150 kB y trae su estética a pelear con los tokens.
- **Reescribir `ocupacion` y `campaign_name` en la base** para poder agrupar. Se traducen al leer,
  con el patrón de `cursos/alias.ts`. Cambiar 26 165 hechos históricos para no cambiar una consulta
  es al revés — la misma decisión que tomó `esDeLanding()` con `platform = 'web'`.
- **Pedirle a alguien que declare algo nuevo.** Todo lo que exige un clic humano en este repo está
  en cero: `gestiones` 39 · `intereses` 29 · `eventos_contacto` 1 · `notas` 5 · y las 26 165 filas
  de `leads.status` dicen `'nuevo'`.

## Lo que esto NO arregla, y hay que decirlo

El caño está casi cerrado y ninguna pantalla lo abre: los leads cayeron **97,8 %** desde mayo
(1 779 → 40), los salientes están en **cero** desde el 7-ago, el **95,4 %** de los leads de los
últimos 120 días nunca recibió un mensaje, y Hermes generó **una (1)** venta registrada en toda su
historia. Eso es marketing, operación y dotación.

Lo que un Dashboard sí puede hacer, y hoy ninguno hace, es **mostrarlas**.

## Dónde vive

- `src/features/dashboard/` — las tres bandas y el conmutador.
- `src/components/graficos/Embudo.tsx` + `embudo.ts` — la primitiva y su módulo puro (§2).
- `src/lib/etapas.ts`, `server/src/cola/etapaEfectivaSql.ts` — el contrato de etapas (§3).
- `server/src/dashboard/` — los seams; `personal.ts` no se toca.
- `server/src/cerberus/productos.ts` — los tres campos de la Banda 1 (§1).
- Plan de obra y tickets: `docs/plan-rediseno-dashboard.md`.
- Auditoría con las capturas y la medición completa: la del 10-ago-2026, citada en el plan.
