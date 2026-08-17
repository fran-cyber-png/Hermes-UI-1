# ADR 0058 — El rechazo de Meta se lee, y la ventana de 24 h se avisa antes

**Fecha**: 17-ago-2026
**Estado**: aceptado — toca `server/` y trae migración, así que las dos mitades salen por **N5**
**Reemplaza**: nada.
**Enmienda**: **ADR 0041** («se le puede hablar»), en un punto que el propio ADR dejó anotado como
condicional. Su 🔴 decía: *«el argumento se escribió con "tres de cuatro líneas" y el reparto cambió…
si alguna vez corre SOLO la Cloud API, este 🔴 hay que releerlo»*. Ese día llegó.

---

## El reporte

De Luz, textual: **«no se mandó mi mensaje de seguimiento»**. Con una captura: el mensaje en el hilo,
con un triángulo rojo al lado de la hora.

Las dos mitades de esa frase eran falsas, y ninguna se podía verificar desde la app.

## Lo que había pasado, medido

El mensaje **sí se mandó**: `envios_wa` lo tiene con `estado = 'enviado'` y con el `wamid` que devolvió
Meta. Un segundo después llegó un webhook `statuses[].status = 'failed'` y eso puso
`estado_entrega = 'fallido'` — el triángulo. O sea: salió, y **WhatsApp lo rechazó al entregarlo**.

El motivo era la ventana de 24 h de la Cloud API. Los dos únicos envíos **manuales** fallidos de las
dos semanas anteriores, los dos del 16-ago 15:39:

| Teléfono | Último entrante | Envío | Distancia |
|---|---|---|---|
| `51989990974` | 15-ago 11:24 | 16-ago 15:39 | **28,3 h** |
| `51912147357` | 15-ago 15:08 | 16-ago 15:39 | **24,5 h** |

El segundo **se pasó por media hora**. (Los 202 fallidos del 14-ago son otra cosa: la campaña por
plantilla a números sin WhatsApp. Al medir esto, `vendedora_id <> 'campana'`.)

## 🔴 Por qué no se podía saber: dos huecos que se tapaban entre sí

**1. El motivo de Meta se tiraba.** `webhook/whatsapp.ts` leía `st.status`, `st.id` y `st.timestamp` de
cada recibo y **nunca `st.errors`**, que es donde viaja el código y el texto del rechazo. Verificado:
`envios_wa.motivo` vacío en las dos filas y ni una línea en `journalctl`. El triángulo rojo no era
escueto — era **mudo por construcción**, y no había forma de averiguarlo después.

**2. Una ventana cerrada no dibujaba nada.** Es la decisión de ADR 0041, y su argumento era correcto
cuando se escribió: el plazo es duro solo en la Cloud API, y decir «ya no le podés escribir» sobre una
línea whatsmeow sería **falso** — el costo de esa mentira es una venta que nadie intenta.

Juntos, los dos huecos producen exactamente lo que pasó: la caja acepta el mensaje sin decir nada, el
mensaje sale, rebota, y lo único que queda es un ícono que no explica. La vendedora concluye lo único
que puede concluir con lo que ve — «Hermes no lo mandó» — y es lo contrario de lo que ocurrió.

## Decisión 1 — El rechazo se guarda y se lee

`entrega/motivo.ts` (puro) extrae `{codigo, detalle}` de `errors[]`; `aplicarRecibo` los escribe en el
**mismo `UPDATE`** que el estado.

- **Se guarda el CÓDIGO, no la frase** (`estado_entrega_codigo`, migración **0028**). El código es
  identidad: el diccionario que lo traduce vive en el front y se puede reescribir sin tocar una fila.
  Guardar la redacción congelaría el texto de hoy en la historia.
- ⚠️ **`detalle` es prosa de Meta en inglés y NO se sirve al front.** Va a `motivo` para auditar desde
  la base; mandarlo a la pantalla terminaría con «Re-engagement message» en medio de un chat en
  castellano. Lo único que viaja es el código.
- **Los dos escritores de `motivo` no chocan**, y no por convención: el envío que no salió
  (`envioControlado.ts`) no tiene `id_externo`, y este `UPDATE` matchea justo por ahí.
- 🔴 **El motivo entra al `SET` solo cuando hay algo que escribir.** Ponerlo siempre pisaría con `NULL`
  lo ya guardado en cuanto llegara un reintento del webhook sin `errors[]` — y los reintentos son la
  norma, no el borde.
- **Sin la migración degrada hacia MENOS, nunca hacia nada**: se reintenta el `UPDATE` sin las columnas
  nuevas. El tilde es lo que la vendedora mira; el motivo es el detalle.
- ⚠️ **`entrega` sigue siendo la cadena** en la respuesta del hilo, y `entregaMotivo` viaja al lado.
  Convertirla en objeto habría roto los hilos que el front rehidrata de IndexedDB (ADR 0007): esas
  respuestas dicen `entrega: 'fallido'`, y el componente habría dibujado un tilde a partir de un objeto
  —sin error y sin pedido de red que lo delate— hasta que alguien limpiara el caché.

**En la burbuja va escrito, no en el hover** (`whatsapp/motivoEntrega.ts`): «No se entregó: pasaron más
de 24 h desde su último mensaje. Solo entra una plantilla aprobada.» Es la única cosa del hilo que pide
una acción, así que es la única que se gana un renglón propio. El `title` conserva el código crudo.

🔴 **Un código desconocido NO inventa una explicación**: cae en «WhatsApp no lo entregó» y el código va
al hover. Adivinar «probablemente la ventana» sería peor que callarse — la vendedora dejaría de
escribirle a alguien que sí podía recibir.

## Decisión 2 — El aviso antes de escribir, y por qué NO contradice ADR 0041

`avisoDeComposer` (`dominio/ventana.ts`) dibuja arriba de la caja: **oro** cuando quedan menos de 3 h,
**rojo** cuando ya cerró.

Lo que ADR 0041 protege es no **mentir** sobre una línea donde el plazo no existe. La fila de la cola
no sabe por qué línea va a salir la respuesta; **el composer sí** (`numeroPropio` → `transporte` de
`/api/whatsapp/sesion`). Donde se sabe que el plazo es duro, callarlo no es prudencia: es dejar que el
mensaje rebote. Por eso:

- `lecturaDeVentana` (la píldora de la cola) **no cambia**: sigue siendo solo positiva.
- `avisoDeComposer` avisa **solo con `transporte === 'cloud-api'`**. En whatsmeow no dice nada — ahí el
  riesgo es el ban, que es otra conversación. Con `transporte` ausente (server viejo) tampoco: es
  preferible quedarse como antes del frente a inventar una prohibición que quizá no rige.

🔴 **AVISA, NO BLOQUEA.** El cierre se calcula sobre el último entrante **que Hermes conoce**. Si la
ingesta se perdió un mensaje —ya pasó— Hermes cree cerrada una ventana abierta, y un bloqueo le
impediría contestar a alguien que sí podía recibir. Un aviso que a veces sobra cuesta una línea de más;
un bloqueo que a veces sobra cuesta la venta. **La garantía nunca es el front**: quien rechaza es Meta,
y ahora eso se lee.

⚠️ El texto nombra **el plazo**, no solo el reloj: «queda 1 h» no dice qué se cierra ni qué pasa
después, que es justo lo que nadie sabía.

## Lo que este ADR NO hace

- **No reintenta ni reencola nada.** Un mensaje rebotado sigue rebotado; alcanzar a esa persona
  necesita una plantilla aprobada (`npm run campana`), y eso es otro camino.
- **No hay backfill.** Los fallos anteriores a la migración 0028 no tienen código y nunca lo van a
  tener: `errors[]` pasó cuando no lo escuchábamos. Se dibujan con la línea neutra.
- **No nombra los 40 códigos de Meta.** El diccionario arranca con los que puede ver un envío manual de
  texto, y se agrega uno **cuando se lo ve en producción** — una lectura escrita a ciegas es una
  afirmación sin medir, y acá lo que se afirma decide si se vuelve a escribir.

## Candados

- `server/src/entrega/motivo.test.ts` — el fixture es el payload real de `131047`; fija que el código se
  guarde como **texto** (el front compara contra `'131047'`) y que `error_data.details` le gane a
  `title`, que es la etiqueta corta que no explica nada.
- `src/dominio/ventana.test.ts` — que en whatsmeow y sin `transporte` **no diga nada**. Verificado que
  se pone rojo sacando el veto.
- `src/features/whatsapp/entregaEnHilo.test.tsx` — que el motivo esté **escrito** y que un código
  desconocido no invente. Verificado que se pone rojo sacando el renglón.

## Evidencia

`docs/evidencia/entrega-motivo-*.png`, servidas por `/galeria-composer.html` con los valores reales de
producción (los dos fallos medidos), no con un caso ideal.
