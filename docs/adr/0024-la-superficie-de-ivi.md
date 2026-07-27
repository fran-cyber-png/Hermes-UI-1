# ADR 0024 — La superficie de Ivi: una capa aparte, y tres respuestas que no se parecen

- **Fecha**: 2026-07-27
- **Estado**: aceptada
- **Issue**: #169 · tarea **H3** del plan de ejecución de Ivi
  (`ivi-cerebro/docs/plan-ejecucion-hermes.md`)
- **Reemplaza**: nada. Es la primera superficie de Ivi en la app.

## Contexto

El puente al cerebro RAG existía **entero del lado del server** desde el issue #61: proxy
(`routes/ivi.ts`), cliente (`ivi/cliente.ts`), ocho códigos de error tipados, fail-closed. Y
la vendedora **no tenía por dónde usarlo**: `grep` de `api/ivi` en `src/` no daba resultados,
`src/features/ivi/` no existía.

El plan de Ivi describía H3 como «ramificar la UI por `tipo`». Verificado contra el código,
la tarea era otra: **no había UI que ramificar.** Se lo devolvimos al equipo de Ivi como
corrección al plan, y la conclusión de fondo no cambia — se refuerza:

> El 2026-07-25 se midió en vivo que Ivi reportaba datos de **12 días** como `HECHO`. Toda su
> capa de honestidad —los tres tipos, `grounding_ok`, `edad_del_dato`— existe por ese
> incidente. Si la UI aplana `HECHO` y `SIN_EVIDENCIA` al mismo componente, esa capa **no
> protege a nadie: solo hace sentir que sí.** Y si la UI no existe, tampoco.

## Decisión 1 — Ivi vive en una capa encima de la mesa, no en el panel derecho

**Preguntarle a Ivi es CONSULTAR**, así que por la regla del panel (ADR 0017: *una pestaña
guarda lo que se consulta, nunca lo que se decide*) una quinta pestaña calificaba. Se
descartó por tres razones, y ninguna es de gusto:

1. **El panel derecho es de ESTA persona, de arriba abajo**: quién es · qué quiere · qué le
   mando · su detalle · qué hago con ella. «¿El diploma de OSINT tiene cuotas en México?» no
   es una pregunta sobre la persona: es sobre el negocio. Meterla ahí sería la primera cosa
   del panel que no habla del contacto abierto.
2. **La ataría a tener una conversación abierta.** El panel solo se monta con `abierta`. La
   vendedora también pregunta desde el Dashboard, desde el Pipeline y desde la Agenda; ahí
   adentro, Ivi sería invisible en cuatro de las seis vistas.
3. **Son 360 px con el pie clavado.** El reparto del panel ya se rompió una vez por esto: con
   dos respuestas cargadas, el flex empujaba «Registrar venta» fuera de pantalla. Un hilo de
   preguntas y respuestas compite por alto con la acción que cierra la venta. **Como capa
   aparte no compite con nada**: el panel no cambia un píxel y el pie sigue donde estaba.

El molde ya existía en la app y se copia a propósito en vez de inventar otro:
**`LibretaPersonal`** (#47) es exactamente esto —una hoja a la derecha, global, con una
tecla—. Se abre con **`i`** o desde el botón de la barra, y se cierra con el contrato de
Escape de la casa (`useEscape`, en captura, para no llevarse puesta la conversación de
atrás).

**Objeción anticipada:** ADR 0018 archivó la bandeja de revisión justamente por ser «una hoja
encima de la app». No es contradictorio: ahí se **decide**, y decidir tapando la conversación
que hay que mirar era el error. Consultar no tapa nada que haga falta ver.

## Decisión 2 — Los tres tipos cambian de FORMA, no de color

Un color se aprende; una forma se reconoce sin leer. Lo que cambia entre los tres no es el
relleno: es la anatomía de la caja.

| `tipo` | Anatomía | Por qué esa |
|---|---|---|
| `HECHO` | filete **sólido** de 3 px + fondo **blanco** | El plano que decide. Sale de una consulta determinista y **cita su fuente — o lo confiesa** (un HECHO sin fuente sale marcado en ámbar). |
| `CONTEXTO` | filete **punteado** + fondo **hundido** (`bg-muted`) | La misma bandeja hundida del panel (ADR 0017): en Hermes, hundido ya significa «esto se mira, no se decide». Es texto citado, **no una cifra**. |
| `SIN_EVIDENCIA` | **sin relleno**, borde entero **punteado** | Se ve vacío porque está vacío. Y dice explícito que **no es una falla**: Ivi funcionó y no sabe. |
| cualquier otro | se dibuja como `CONTEXTO` **y se declara** | Lo conservador. Nunca como `HECHO`, nunca un throw. |

**Sin oro en ninguna.** El oro en Hermes significa una sola cosa —tiempo que se acaba— y una
respuesta de Ivi no es urgencia. El ámbar que sí aparece es `--warning`, el mismo del «no se
pudo saber» del panel, y solo sobre lo que no se pudo verificar.

Las dos banderas:

- **`grounding_ok: false`** → se marcan **las cifras señaladas** por
  `numeros_no_verificados`, en su lugar dentro del texto, con una franja arriba que las
  lista. **No se descarta la respuesta entera**: el resto puede estar perfecto, y tirarlo
  sería exagerar en la dirección opuesta al incidente.
- **`edad_del_dato: null`** → «no se puede confirmar cuán fresco es este dato». **Nunca
  silencio.** En un `HECHO` va en ámbar (ahí la edad decide si el número sirve); en una cita,
  como nota al pie. En un `SIN_EVIDENCIA` **no se muestra**: no hay dato cuya antigüedad
  pueda importar, y una advertencia que aparece cuando no hace falta es la que después nadie
  lee cuando sí hace falta.

## Decisión 3 — La regla de ruteo es pura y vive fuera del JSX

`src/features/ivi/presentacion.ts`, con su test. Un `switch` adentro de un componente **no se
puede interrogar sobre el caso que importa**: qué hace con un tipo que todavía no existe. Y
ese caso no es hipotético — Ivi hace crecer su enum sin coordinar releases con Hermes (por
eso su schema es `z.object()` y no `.strict()`, y está bien que lo sea). La contraparte de
esa libertad es que el consumidor tolere el valor nuevo **sin ascenderlo de categoría**.

Lo mismo con los ocho códigos de error (`errores.ts`): un test recorre los ocho y verifica
que **ninguna lectura se pueda confundir con «Ivi no encontró datos»**, que es la regla dura
escrita del repo.

## Decisión 4 — No hay puente entre el texto de Ivi y el composer de un lead

Deliberado, y es la decisión con más consecuencias del ADR.

Lo que sale hacia una persona **viene del catálogo** (ADR 0015: nada de generar texto libre).
El texto de Ivi lo redacta un LLM. Un botón «poner en la caja» —el gesto que los datos
recomendados (#153) y las plantillas sí tienen— dejaría prosa generada **a un clic** de una
conversación real, y ese es exactamente el incidente que toda la disciplina de este repo
viene evitando. Copiar existe (la vendedora puede seleccionar el texto igual); el puente no
se construye. La pantalla lo dice en voz alta, para que no parezca un olvido.

## Consecuencias

- La superficie es aditiva **en archivos**, y eso no alcanzó: `App.tsx` suma un estado, un
  atajo, un botón y un componente al pie, y ningún archivo del panel derecho, de la cola ni
  del chat se tocó. **Aun así le rompió una tecla al chat.** La primera versión de este ADR
  decía «es aditiva» a secas, y era falso en efecto.

  `App.tsx` monta esta hoja **siempre** (abierta o cerrada, como la libreta), pero adentro
  llamaba a `useEscape(onCerrar)` **antes** del `if (!abierta) return null`. Ese hook
  registra en CAPTURA sobre `window` y hace `stopPropagation()` —así es como un popover se
  cierra sin arrastrar la conversación de atrás—, así que con Ivi **cerrado**, que es casi
  todo el tiempo, el Escape moría ahí y no llegaba nunca al listener del shell. Dejaron de
  andar tres atajos documentados que no tienen nada que ver con Ivi: cerrar la conversación
  en Mensajes, cerrar la Cabina y cerrar la `LibretaPersonal`.

  El molde que este ADR dice copiar **no tiene el problema, y por la parte que no se
  copió**: `LibretaPersonal` tiene el `if (!abierta) return null` y **ningún listener
  global**. Esta hoja sí quiere el listener; el precio es la condición explícita.

  La lección no es «acordate de la guarda». `useEscape` documentaba su invariante —«solo se
  monta abierto»— como un comentario que nadie podía verificar. Ahora es un argumento
  (`useEscape(onCerrar, abierta)`), y el que lo prueba es un test que monta el componente
  **cerrado** con un listener de burbuja imitando al shell. Eso obligó a abrir el primer
  entorno con DOM del front (`src/pruebas/dom.tsx`, `// @vitest-environment jsdom` por
  archivo): una regresión de teclado no la puede ver ningún test puro, porque el defecto no
  está en la decisión —`escapeDePopover.ts` está testeado hasta el hueso— sino en el
  cableado.
- **Las dos puertas de «mandar» consultan el mismo criterio** (`motivoParaNoPreguntar`, puro
  y con test). No empezaron así: el botón miraba el tope de 4000 caracteres y el `⌘↵` —el
  atajo que la propia pantalla publicita abajo del composer— no. Pegando 4500 caracteres, el
  botón quedaba apagado y el acorde mandaba igual; el server contestaba **400 sin `codigo`**,
  `lecturaDeError` no encontraba ninguno y caía en `desconocido`, así que la app decía «se
  rompió algo que nadie previó, avisale a sistemas» **teniendo el diagnóstico correcto a dos
  líneas de distancia** («500 caracteres de más»). Mentir en el diagnóstico es justo lo que
  el estado de error de acá arriba vino a evitar, y una sola cabeza es la única forma de que
  las dos puertas no vuelvan a divergir (la lección de #37).
- **Hoy esto se ve roto, y está bien.** `POST /api/preguntar` de Ivi devuelve 404 en
  producción, así que la primera experiencia real va a ser el 502 `http_inesperado`. Por eso
  el estado de error se diseñó como estado de primera clase y no como un `catch`: dice qué
  pasó, de quién es y si reintentar sirve. Cuando Ivi cierre su paridad de deploy, el cambio
  se ve del lado de Hermes **en el acto, sin coordinar release**.
- El contrato del server sumó `numerosNoVerificados` (ver el commit que lo agrega): sin esa
  lista, «marcá las cifras que no se verificaron» era una instrucción inaplicable.
- Queda **afuera** y trackeado: `traza_id` (la llave del lazo de aprendizaje de Ivi, §4.4 de
  su plan) todavía no se manda; el ensamblado (`POST /api/ensamblar`) es otra superficie y
  otro contrato.

## Evidencia

`docs/evidencia/169-ivi-*.png`, reproducibles con `npx vite --port 5199` →
`http://localhost:5199/galeria-ivi.html` (entry aparte, fuera del bundle de la app).

**El banco de teclado** —`…/galeria-ivi.html?teclado=1`— es la reproducción de los dos
defectos en un navegador de verdad: la hoja **cerrada** con un listener de burbuja sobre
`window` imitando al shell, y un contador de Escapes que llegaron. Medido en Chromium con
el arreglo puesto:

| Qué se hizo | Antes | Ahora |
|---|---|---|
| `Esc` con la hoja **cerrada** | el shell no recibía nada | contador **1** — el shell se enteró |
| `Esc` con la hoja **abierta**, foco fuera de un campo | cierra, contador queda en 1 | igual (el contrato de no arrastrar lo de atrás **no** se tocó) |
| `⌘↵` con 4500 caracteres | salía el `POST` → 400 sin código → «se rompió algo que nadie previó» | **no sale nada**, el texto queda intacto y se lee «500 caracteres de más» |
| `⌘↵` dentro del tope | salía | sigue saliendo (`POST /api/ivi/preguntar`) |

Captura: `docs/evidencia/169-ivi-tope-4500-no-sale.png`. En tests, lo mismo lo fijan
`src/features/ivi/ConsultaIvi.test.tsx` y `src/lib/teclado/useEscape.test.tsx`; los dos se
ponen en rojo si se revierte el arreglo correspondiente.
