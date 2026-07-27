# ADR 0016 — Modo supervisado: la máquina prepara, la vendedora aprueba

**Fecha:** 2026-07-25 · **Estado:** aceptado · **Issue:** #125 · **Reemplaza parcialmente:** ADR 0015

## Contexto

ADR 0015 abrió una excepción acotada a «un envío = una acción humana»: fuera de horario, tras 30
minutos sin respuesta, Hermes puede mandar **un acuse de una plantilla registrada**. Está construido,
probado y **apagado**.

El dueño, al verlo funcionando, pidió el punto del medio (2026-07-25):

> «quiero dar solución a esto pero **que sea igual medio supervisado por la misma vendedora**.
> Automatizar respuestas a campañas.»

El problema con lo que había es que es **todo o nada**: prendida manda sola, apagada no hace nada. Y
«manda sola» es exactamente el escalón que cuesta subir — no porque el ritmo esté mal, sino porque
nadie mira lo que sale. Mientras tanto el agujero medido sigue abierto: 44% de los leads llega fuera
de horario y el 44% de esos nunca recibe respuesta.

## Decisión

El interruptor deja de ser un booleano. Tres modos:

| Modo | Qué hace la cola | Qué sale |
|---|---|---|
| **apagada** | nada | nada. **Sigue siendo el default.** |
| **supervisada** | prepara igual: misma decisión, mismo ritmo | **nada, hasta que una persona lo apruebe** |
| **automatica** | prepara y despacha | lo de ADR 0015, tal cual |

Lo que hace **supervisada** distinta de «apagada + trabajo manual» es que la decisión y el ritmo ya
están hechos: la vendedora no elige a quién ni a qué hora, elige **si va**. Lo que la hace distinta de
automática es una sola línea de código: lo que el encolado escribe queda en estado `preparada`, y
`EN_COLA_DE_ENVIO` no incluye `preparada`. **El despachador no la ignora por cortesía: no la ve.**

### La máquina de estados (`autorespuesta/estados.ts`)

```
                     ┌─ descartada   (una PERSONA dijo que no va)
   preparada ────────┼─ caducada     (nadie la aprobó a tiempo)
       │             └─ cancelada    (la retiró el sistema)
       │
       └─ aprobada ──┬─ enviada
                     ├─ fallida      (frena la cola entera)
                     └─ cancelada

   pendiente ────────┬─ enviada | fallida | cancelada     (modo automático)
```

**El salto prohibido es la feature**: `preparada → enviada` no existe. Vive en una lista blanca con su
test; si viviera en un `if` del despachador, el primer atajo futuro («total, es lo mismo») lo borraría
sin que nada se queje.

Las tres salidas laterales no se colapsan en una a propósito: a fin de mes son tres preguntas
distintas — «¿cuánto rechaza la vendedora?», «¿cuánto se nos pasa por no revisar a tiempo?» y «¿cuánto
retira el sistema solo?».

### Tres reglas de ADR 0015 que cambian, y por qué

1. **Entrar al horario de atención ya no cancela todo.** Cancela lo **automático**. La regla existía
   para callar a la máquina cuando llega la vendedora; lo que ella aprobó no tiene a quién callar, y lo
   que espera su OK es justamente lo que va a mirar a las 9. Vaciarle la bandeja al llegar sería tapar
   el agujero con el mismo agujero.
2. **Aprobar no respeta la ventana de despacho de la máquina** (07:30–09:00 y 20:00–21:00). Esa
   ventana es la banda de horas creíbles **menos** su horario, y ese recorte existe porque adentro de
   su turno ella contesta en 10 minutos y una plantilla sería peor que su respuesta. Si la que decidió
   mandar la plantilla es ella, el recorte se cae solo. Lo que **queda en pie** es la otra mitad, la que
   protege a la persona del otro lado: **nada sale fuera de 07:30–21:00**. Un lote aprobado a las 22:00
   no sale; se aprueba mañana temprano.
3. **La caducidad de una preparada no es el atraso de un envío.** La cola automática cancela lo que
   sale con más de 90 minutos de atraso. Una preparada no está atrasada: está **esperando a una
   persona**, que llega cuando llega. Aplicarle los 90 minutos vaciaría la bandeja justo antes de que
   la vendedora la abra. La regla es **3 h de gracia desde la hora reservada, y nunca cruza el día**
   (`AUTO_RESPUESTA_GRACIA_MIN`): lo preparado para las 07:30 sigue ahí a las 9 y se apaga a las 10:30.
   A las 3 de la tarde —la hora que el dueño nombró— no queda nada.

### Aprobar en lote sin que salga un lote

> ⚠️ **APROBAR EN LOTE SE RETIRÓ — ADR 0020 §6 (#166).** Ya no hay ningún botón que apruebe más
> de uno: la cabecera del grupo dice «Revisar 8 ›» y abre la primera. Lo de abajo **sigue
> vigente igual** y por eso no se borra: `POST /aprobar` recibe un array, lo reparte con el
> MISMO `programar.ts`, y esa es la razón por la que aprobar de a uno tampoco produce ráfagas.

Un click sobre cuarenta mensajes tiene que dar **cuarenta salidas espaciadas**. El reparto lo hace el
**mismo `programar.ts`** del modo automático —uno por vez, 60–240 s de aire, techos de 20/h y 60/día
por número—, recalculado desde el momento del OK (la hora que traían la calculó el encolado de la
madrugada para una ventana que a esa altura ya pasó; respetarla sería mandarlas todas juntas). Si
hubiera un segundo repartidor acá, el lote aprobado tendría **otra firma de tráfico** que la del modo
automático, que es justamente lo que no se puede permitir. Lo que no entra vuelve con su motivo en vez
de apretarse.

### Respuestas por campaña

`campana.ts` elige entre tres fuentes con la **misma precedencia del chip de curso de la cola** (#72):
interés asentado > formulario que llenó > anuncio del que vino. No es una coincidencia estética: si el
chip de la fila dice «OSINT» y el acuse dice «Inteligencia», la vendedora abre el chat y encuentra dos
verdades.

Lo que cambia por campaña es **una frase** (`gancho`: qué manda la asesora al abrir), no una plantilla
por curso — 38 textos no los mantiene nadie. Agregar un curso es una entrada en `FAMILIAS`. Y
«[JUL] INTELIGENCIA» se dice «Inteligencia y Contrainteligencia»: el prefijo de mes es plomería de
pauta y las mayúsculas de campaña, en un WhatsApp, son un grito. Un nombre ya escrito con minúsculas
(«Diplomado en Gestión Pública») se respeta tal cual: lo escribió una persona.

**Punto de integración con las plantillas-secuencia (#138, ya en `main`)**: `server/src/plantillas/`
es el hogar del contenido que manda la vendedora —secuencias con media, precio en vivo de Cerberus,
familia por prefijo de SKU—. Este ADR **no duplica ese modelo y tampoco lo consume todavía**, por tres
diferencias que son de producto y las cierra el dueño: (1) una secuencia son N mensajes y un acuse es
UNO —mandar solo el paso 1 de cuatro le cambia el sentido a la plantilla—; (2) son **por vendedora** y
la auto-respuesta no tiene vendedora; (3) su `{precio}` se resuelve en vivo, y un acuse que cotiza sin
que nadie lo mire es otra feature con otro riesgo. **La costura, cuando se decida**: `catalogo()` lee
de `plantillas/repositorio.ts` las marcadas como aptas, conservando la firma (`Plantilla[]`) y el
contrato de `elegir()`, y las familias de `campana.ts` se mapean a `plantillas.familia_curso`.

### Dónde vive la bandeja

**En una hoja sobre la app, no en el riel.** El riel es para LUGARES: seis vistas donde se vive
(ADR 0002, ⌘1-6). Esto es una **tarea modal de dos minutos por día**; una séptima vista permanente
diluiría el mapa y dejaría un ícono apagado 23 horas y 58 minutos. La puerta correcta ya existía: el
chip de la cabecera es el que anuncia «12 esperando tu OK», y **el anuncio y la acción tienen que estar
en el mismo lugar** — si no, la vendedora lee el número y sale a buscar dónde se hace algo con él. Se
abre desde cualquier vista (a las 9 de la mañana puede estar parada en cualquiera) con el botón del
chip o con la tecla **A**.

**Agrupada por campaña** porque es como se decide: «los 12 de Inteligencia» se aprueban de un vistazo.
El texto se muestra **una vez por grupo** —es el mismo salvo el nombre— y cada fila es una línea:
quién, cuánto hace que espera, cuánto le queda. Una lista plana de 40 obligaría a leer 40 veces lo
mismo, y a los 10 se aprueba sin leer: peor que el modo automático, porque encima creés que revisaste.
Por eso el botón de lote dice «3 mensajes de 2 campañas» y no solo el número.

> ⚠️ El agrupado se queda; **el botón de lote no** (ADR 0020 §6). El argumento de arriba se dio
> vuelta contra sí mismo: «los 12 de Inteligencia se aprueban de un vistazo» es cierto para el
> TEXTO y falso para todo lo demás —a quién, qué preguntó, si ya se despidió—, que es lo que hay
> que mirar. El grupo que lo demostró se llamaba «Sin campaña».

**El oro aparece en un solo lugar** de toda la pantalla: el «vence en 20 min» de lo que está por
caducar. En Hermes el dorado significa tiempo que se acaba y acá hay algo que literalmente lo es; en
tres filas de cuarenta es información, en las cuarenta sería decoración.

### Que se note siempre

- **El chip de la cabecera** pasa a tres segmentos a la vista, no a un botón que cicla: con tres
  estados, ciclar haría que apagar desde supervisada costara **dos** clicks, y el contrato de ADR 0015
  es que apagar cuesta **uno**. La escala visual crece con la consecuencia: apagada neutra ·
  supervisada delineada (trabaja, no habla) · automática sólida con punto vivo (habla sola).
- **En el hilo**, un mensaje aprobado se ve distinto de uno automático puro: azul sólido con el nombre
  de quien lo aprobó. «Lo mandó la máquina sola» y «lo mandó la máquina porque Ana lo aprobó» son dos
  cosas distintas para quien lee ese chat tres días después.

## Lo que NO cambia

Todo el resto de ADR 0015 sigue en pie, palabra por palabra: **no inicia** conversaciones, **no genera**
texto (catálogo cerrado), **no insiste** (una por conversación por día), **nunca** a quien dijo que no,
**nada de warmup ni anti-ban**, todo por `EnvioControlado`, freno total ante ban / error de envío /
desconexión, dos llaves (`AUTO_RESPUESTA=on` + el interruptor de la base) y el kill-switch sin deploy.

La ruta `PUT /api/autorespuesta/interruptor` de ADR 0015 **sigue viva** con su contrato de booleano
(prender = automática): es el freno que alguien puede tener a mano en un `curl` de emergencia, y
romperlo el día que se necesite sería el peor momento.

## Consecuencias

- **Se puede prender sin cruzar el escalón.** Supervisada le da a la vendedora exactamente lo que hoy
  no tiene: ver qué se le va a mandar a quién y decidir. Si el modo automático nunca se prende, el
  agujero igual se tapa.
- **La medición sale gratis**: `descartada` cuenta cuánto rechaza, `caducada` cuánto se pierde por no
  revisar a tiempo, `editada` qué plantillas conviene reescribir (si la editan todas las noches, la
  plantilla está mal). Con eso, prender el modo automático deja de ser un acto de fe.
- **Hay una ventana de riesgo nueva**: si la vendedora aprueba sin leer, supervisada es automática con
  pasos de más. Mitigado por el diseño de la pantalla (texto una vez por grupo, el botón nombra las
  campañas) y medible por `editada` / `descartada`. No se mitiga con un modal de confirmación: eso solo
  entrena a apretar «sí».

## Esquema

Se agregan **al final** de las tablas existentes (`npm run db:push` manual, como toda esta feature):

- `auto_respuesta_estado.modo` — `apagada | supervisada | automatica`. `encendida` se sigue escribiendo
  derivado (`modo !== 'apagada'`): es lo que lee el código de ADR 0015 y lo que sobrevive a un rollback.
  La verdad es `modo`; el booleano es su sombra, y la dirección no se invierte.
- `auto_respuestas_pendientes.aprobada_por` · `.aprobada_at` · `.editada` · `.campana`.

**Sin el push, la feature DEGRADA, no rompe**: la ruta informa «falta la migración» y el reloj se
comporta como apagada.
