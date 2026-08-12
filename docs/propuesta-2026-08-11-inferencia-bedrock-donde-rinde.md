# Potenciar Hermes con inferencia (Bedrock): dónde rinde, medido

**11-ago-2026.** Complemento de `analisis-2026-08-11-que-ve-luz-y-si-el-pipeline-ayuda.md`.
Todo medido contra producción (`/srv/hermes` en `3a077d3`), read-only.

> **Bedrock ya está en producción.** `@anthropic-ai/bedrock-sdk` +
> `us.anthropic.claude-haiku-4-5-20251001-v1:0` (`server/src/bot/clienteBedrock.ts`). La pregunta no
> es cómo introducirlo — es **dónde ponerlo que rinda más**.

---

## El número que ordena todo

Sobre los envíos de los últimos 30 días, ¿el lead contestó dentro de 48 h?

| Quién manda | Salientes | Contestaron | Tasa |
|---|---|---|---|
| **BOT** (Haiku 4.5) | 258 | 164 | **63,6 %** |
| Humanas | 500 | 175 | 35,0 % |
| Difusión / campaña | 1.093 | 32 | **2,9 %** |

🔴 **El sesgo obvio lo descarté midiéndolo.** Un bot que solo responde a quien acaba de escribir
tendría ventaja injusta. Pero:

| Quién | Salientes que respondían a un entrante de las 24 h previas |
|---|---|
| BOT | 251 / 258 (97 %) |
| Humanas | 498 / 503 (99 %) |
| Campaña | **3 / 1.093 (0,3 %)** |

Bot y humanas están en **la misma situación**, así que la comparación entre esos dos vale. La campaña
no: es outbound frío puro, y por eso su 2,9 % no se compara con nada — se compara consigo mismo.

⚠️ **Lo que este número NO dice.** No dice «el bot vende mejor»: dice que consigue **respuesta**. Entre
respuesta y venta hay un tramo que Hermes todavía no puede medir (`conversiones_wa` dice «compró alguna
vez», no «esta conversación vendió»; ADR 0044). Y quedan sesgos residuales que no descarté: el bot corre
en la línea de Meta Ads —leads más calientes— y responde en segundos, mientras una humana puede tardar
horas. Ese último punto no es una objeción: **es la palanca**, porque la velocidad es lo único de esa
lista que se puede reproducir a voluntad.

---

## Palanca 1 — El bot no está donde está la gente

| Línea | Personas (30 d) | Respuestas del bot |
|---|---|---|
| `51986394450` Ventas Perú | **2.564** | **0** |
| `51984429504` Ventas Meta | 1.100 | 345 |
| `51941654039` Walter | 311 | 12 |
| `51963139984` Betto (campaña) | 20 | 49 |

**El 62 % del tráfico no tiene bot.** Y `BOT_LINEAS` es una variable de entorno: prenderlo ahí no es
un frente, es una línea de config.

⚠️ **Pero no lo prendería sin resolver esto primero**, y es serio: esa línea **no se opera desde
Hermes** — 6.623 salientes en `interactions` contra **4** filas en `envios_wa`. Quien la atiende
escribe desde el WhatsApp del teléfono. Meter un bot ahí es poner **dos entidades contestando el mismo
chat sin verse**, que es exactamente el problema que el reparto de leads existe para evitar.

**El orden correcto**: primero `modo: sombra` (el bot piensa y guarda, no envía) durante una semana en
esa línea, y se compara lo que habría dicho contra lo que la persona dijo. `bot_respuestas` ya
distingue `sombra` de `enviada` — el andamio existe.

---

## Palanca 2 — La difusión ciega es lo que llenó el tablero de muertos

1.093 envíos → 32 respuestas. Esos mismos envíos crearon las **969 conversaciones que nunca
contestaron** y hoy son el 65 % del embudo.

**Acá la inferencia no sirve para escribir mejor el mensaje: sirve para decidir a quién NO mandárselo.**
Antes de una difusión, clasificar la lista contra el historial y quedarse con el tramo que tiene algún
indicio. Con 2,9 % de base, cualquier segmentación que suba a 6 % **duplica el resultado y manda la
mitad** — y mandar la mitad, en whatsmeow, también es la mitad de riesgo de ban (regla dura #7).

⚠️ Esto se mide con dry-run obligatorio y lista de destinatarios a la vista. No es negociable.

---

## Palanca 3 — Leer lo que nadie declara (la de mayor techo)

| Registro manual | Filas en TODA la base |
|---|---|
| `gestiones` (declarar etapa) | **39** |
| `eventos_contacto` | **2** |
| `intereses` | 29 |

Nadie declara nada. Pero hay **miles de conversaciones con texto** que dicen exactamente lo que esas
tablas están vacías de decir: qué objetó, qué curso pidió, en qué quedaron, por qué se enfrió.

Eso es un trabajo de **extracción**, que es donde Haiku 4.5 es más barato por unidad de valor. Y encaja
en un molde que ya existe: `eventos_contacto` tiene seis tipos, y ADR 0037 ya decidió que el tipo es lo
que se cuenta.

- **Structured outputs está disponible en Bedrock** — el modelo devuelve el tipo validado contra el
  esquema, no texto libre que después hay que parsear.
- 🔴 **El evento propuesto NO se asienta solo.** ADR 0018 ya fijó la regla para la auto-respuesta —
  *Hermes no manda solo: siempre hay una persona aprobando*— y acá vale igual: lo inferido entra como
  **sugerencia** en el timeline, con un botón. Un embudo que se llena de inferencias sin que nadie las
  confirme deja de ser un registro y pasa a ser una opinión del modelo.

**Por qué esta es la de mayor techo**: ADR 0022 construyó el lazo de resultados —qué pieza se mandó,
qué pasó después— y hoy no puede cerrar porque casi no hay datos de resultado. Esto los produce.

---

## Palanca 4 — Ponerle nombre a los 2.575 silencios

«Nunca contestaron» son 2.575 tarjetas indiferenciadas. No son lo mismo: número inválido · mensaje
equivocado · mal momento · no era el público. Cada una tiene un trabajo distinto y hoy comparten
columna.

Lo bueno: **el material de calibración ya existe y es del mismo envío** — 114 contestaron y 969 no, a
partir del mismo disparo del 5-ago. Eso es un caso de estudio, no una hipótesis.

⚠️ **Restricción real de Bedrock**: **la Batch API no está disponible ahí.** Clasificar 2.575 hilos no
tiene el 50 % de descuento del batch — va por llamadas normales con concurrencia. Sigue siendo barato
a precio de Haiku, pero conviene saberlo antes de dimensionar.

---

## Palanca 5 — El caché está marcado y NO está cacheando

🔴 **Esto ya es un defecto, no una propuesta.**

`agente.ts:119-128` pone `cache_control` sobre el bloque grande del system, con el orden correcto
(estable primero, volátil después). El comentario explica bien por qué. Y sin embargo:

```
397 llamadas · tokens_entrada 1.237.340 · cache_escritura 0 · cache_lectura 0
```

**Cero, en todas.** La causa más probable, medida:

| Estado | n | mediana de tokens de entrada | ≥ 4.096 |
|---|---|---|---|
| enviada | 217 | **3.990** | 102 |
| bloqueada | 106 | 4.318 | 12 |
| sombra | 73 | 4.804 | 59 |

**El mínimo cacheable de Haiku 4.5 es 4.096 tokens.** Por debajo de eso, la API **no cachea y no
avisa** — no hay error, `cache_creation_input_tokens` simplemente vuelve en 0. Y la cifra de la tabla
es el **total** de entrada (system + contacto + mensajes); el prefijo marcado —solo `sistemaGrande`—
es forzosamente **menor**, así que está sistemáticamente bajo el umbral.

Tres salidas, en orden de lo que yo haría:

1. **Medirlo primero, una llamada**: `count_tokens` sobre `sistemaGrande` dice el número exacto y
   cierra la hipótesis. Cuesta nada.
2. **Subir el prefijo estable por encima de 4.096** moviendo al bloque cacheado lo que hoy viaja suelto
   y no cambia turno a turno (catálogo, guardrails). Es la opción que no toca el modelo.
3. **Cambiar de modelo**: el mínimo es **1.024 en Sonnet 5** y **512 en Opus 5**. No lo recomiendo solo
   por el caché —Haiku es el modelo correcto para este trabajo— pero es el dato que decide si algún día
   se sube de tier.

⚠️ **Y ojo con una trampa de Bedrock**: el *automatic prompt caching* (el `cache_control` de nivel
superior) **no está disponible ahí**; el manual por bloque **sí**. El código ya usa el manual, que es
lo correcto — no lo cambien por el automático «para simplificar».

### Bonus del mismo archivo: el costo está subreportado

`acumularUso` (`agente.ts:41`) **no acumula: reemplaza.** Devuelve el uso de UNA respuesta, y el loop
hace `uso = acumularUso(...)` en cada vuelta. En un turno con tool-use, lo que queda en
`bot_respuestas` es **solo la última llamada**.

Consecuencia: los 1.237.340 tokens medidos son **un piso, no el total**, y cualquier cuenta de costo
del bot hecha con esa tabla va corta. El nombre de la función dice lo que debería hacer.

---

## Palanca 6 — `lecciones` está en 0

La tabla existe, el módulo existe (`bot/lecciones.ts`), y tiene **cero filas**. `bot_memoria_lead`
tiene 4.

Mientras tanto el bot escaló **20 conversaciones «por cerrar»** y **17 fueron atendidas por un humano
después** — o sea que el chip de escalada funciona y el lazo se cierra. Pero de esas 20 no se aprendió
nada: el bot va a escalar la 21.ª por el mismo motivo.

---

## Lo que NO propongo, y por qué

- **Que el modelo escriba texto libre hacia el lead.** El catálogo manda su texto literal (ADR 0023, e
  Ivi devuelve **ids, nunca texto**). Ya pasó una vez que un hecho redactado como instrucción se le
  filtró entero a dos leads. Esa decisión no se reabre acá.
- **Ranking del embudo por «intención de compra» del modelo.** La urgencia vive una vez
  (`cola/urgencia.ts` + `urgenciaSql.ts`) con test de paridad. El patrón correcto ya está inventado en
  este repo: **el veredicto del bot NO toca el orden de la cola, se ofrece como chip de filtro con su
  número**. Una señal nueva se agrega igual.
- **Prender la auto-respuesta nocturna.** Sigue apagada por decisión del dueño y el issue #166 está sin
  leer. Nada de esto la toca.

---

## Por dónde empezaría

| # | Qué | Costo | Por qué primero |
|---|---|---|---|
| 1 | `count_tokens` sobre `sistemaGrande` + arreglar `acumularUso` | horas | Son dos defectos ya medidos, no apuestas. Y sin el costo bien medido, ninguna decisión de escala se puede tomar |
| 2 | Bot en `51986394450`, **modo sombra** | días | Es el 62 % del tráfico. Sombra evita el choque con quien escribe desde el teléfono |
| 3 | Extracción de eventos sobre hilos cerrados, **como sugerencia** | 1–2 semanas | Mayor techo: es lo que hace que ADR 0022 pueda cerrar el lazo |
| 4 | Clasificar los 2.575 silencios | 1 semana | Ya hay corpus de calibración del 5-ago |
| 5 | Segmentar antes de la próxima difusión | — | Depende de (4) |

⚠️ **Y una cosa que no es de IA y le gana a las cinco**: la línea del 62 % del tráfico no se opera desde
Hermes. Mientras eso siga así, cualquier inferencia que corra ahí trabaja sobre un espejo — ve los
mensajes, no participa de ellos.

---

## Reproducir

```bash
# Tasa de respuesta por tipo de emisor y el control de sesgo
ssh deploy@161.132.39.165 "docker exec -i hermes_db psql -U meta_escuela -d meta_escuela" < consulta.sql

# El embudo real (el seam, no una reimplementación)
ssh deploy@161.132.39.165 "cd /srv/hermes/server && ./node_modules/.bin/tsx --env-file=.env /tmp/x.mts"
```

⚠️ El script va en `/tmp` con extensión `.mts` — **nunca en el checkout**: un archivo suelto en
`/srv/hermes` bloquea N4 por la regla dura #6.
