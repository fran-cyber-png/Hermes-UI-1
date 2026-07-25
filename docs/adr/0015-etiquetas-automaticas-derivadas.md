# ADR 0015 — Las etiquetas automáticas se DERIVAN; no son categorías con un flag

**Fecha**: 2026-07-25 · **Estado**: aceptada · **Issues**: #91, #101 · deriva del pedido del dueño del 2026-07-25

## El contexto

El Pipeline muestra **3 cotizados**. La minería de producción del 25-jul encontró
**696 conversaciones con un precio enviado**, **590 mudas después del precio (85%)** y
**82 con más de 3 días de silencio**. La diferencia no es que el embudo esté vacío: es que
«cotizado» hoy exige que alguien tipee el interés a mano, y en toda la base hay **1 interés
registrado**. El trabajo real de las vendedoras no llega a la pantalla.

El dueño pidió: *«los patrones de cotización que tienen las vendedoras —revisalos en los logs—
para detectar bien cuándo se está cotizando y detectar los que se enfrían, automáticamente
tenerlos por etiqueta; y las etiquetas con colores, que todo sea más visual»*.

Eso abre una pregunta de modelo: **¿«Cotizado» y «Se enfrió» son categorías (#48) con un flag
`automatica`, o son otro concepto?**

## La decisión

**Otro concepto.** Las etiquetas automáticas **no tienen fila**: se calculan en cada consulta
a partir del hilo (`server/src/senales/`), y se muestran junto a las categorías manuales sin
ser una de ellas.

| | Categoría (#48) | Etiqueta automática (esta ADR) |
|---|---|---|
| Dónde vive | `categorias` (catálogo por vendedora) + `etiquetas` (asignación compartida) | en ningún lado — se deriva |
| Quién la pone | la vendedora | el hilo |
| Se edita / borra | sí | no |
| Se recalcula | nunca (es una opinión) | en cada consulta (es un hecho con fecha) |
| Se ve | píldora de **borde** de color | píldora de **fondo** tenue |
| Color | paleta cerrada `--cat-*`, sin oro | la **misma** paleta, sin oro |

## Por qué no el flag `automatica` en `categorias`

1. **Habría que guardar algo que es una función del reloj.** «Se enfrió» depende de `now()`.
   Guardarlo obliga a un job que lo recalcule, y una conversación que cruza el umbral a las
   3 de la mañana queda con la etiqueta vieja hasta la próxima corrida. Un estado guardado que
   nadie recalcula *miente*.
2. **La casa ya decidió lo contrario tres veces.** La etapa efectiva se deriva de la última
   gestión (ADR 0013); `no_leido` se deriva del cursor de lectura, y el ADR 0014 lo dice con
   todas las letras («DERIVAR LO DERIVABLE»); la urgencia se calcula (ADR 0009). Guardar esto
   sería la excepción sin motivo.
3. **`etiquetas` es del equipo y la vendedora puede borrar cualquier asignación.** Si «Cotizado»
   fuera una fila ahí, borrarla sería borrar un hecho — y volvería sola a la corrida siguiente,
   que es la peor experiencia posible: un botón que no hace nada.
4. **El unique de `categorias` es `(vendedora_id, nombre)`.** Una vendedora que ya tenga una
   categoría llamada «precio» o «cotizado» chocaría contra la automática. Separando los
   conceptos, el choque no puede pasar; un test fija que ningún rótulo automático colisione con
   los defaults sembrados.

## Consecuencias

- **A favor**: cero escrituras, cero jobs, cero desincronización. La señal es correcta al
  milisegundo en que se pinta. El umbral se cambia con una variable de entorno
  (`SENALES_DIAS_ENFRIAMIENTO`, default 3) y toda la app cambia de opinión sin migrar nada.
- **En contra**: **no se puede filtrar la cola por «enfriado» con un `WHERE` barato** — habría
  que derivar la señal para todo el universo, no para las 20 conversaciones visibles. Si el
  filtro se pide, la salida correcta es una **vista materializada** o un fragmento SQL espejo,
  y ahí sí hará falta un test de paridad como el de la urgencia (`urgencia.paridad.test.db.ts`).
  Se anota como deuda consciente, no como olvido.
- **En contra**: la señal cuesta una consulta extra por pantalla. Está acotada por lote
  (`?claves=`, máximo 200) y por ventana (90 días).

## El detector, y qué tan preciso es

`server/src/senales/cotizacion.ts` — puro, sin base ni red. **Hay cotización cuando hay un
monto con moneda explícita y plausible, salvo que sea una instrucción de pago.**

- **Exige la moneda.** El criterio ingenuo (cualquier número) cuenta «son 11 módulos»,
  «120 horas académicas», «te escribo al 986394450» y «mi DNI es 45678912». La moneda es lo que
  separa una cifra de un precio.
- **Exige plausibilidad**: entre 10 y 100.000, máximo 7 dígitos. Un número más largo es una
  cuenta, un CCI o un teléfono.
- **Rechaza el pegote**: una cifra pegada a `-` o `/` es parte de un código
  (`191-1234567-0-52`), no un precio.
- **Veta la instrucción de pago**: si el texto habla de una *cuenta* y no enmarca la cifra como
  precio, no es una cotización. Es el falso positivo que el dueño nombró: **«tenemos cuenta
  bancaria en soles»**.
- **Corrobora con la secuencia**: la señal viaja con `corroborada` = *antes hubo flyer
  (multimedia) o temario*, la secuencia de venta canónica medida en prod. Una cotización
  corroborada se muestra como «Cotizado»; una cifra suelta sin nada alrededor, como
  «Cotizado (sin confirmar)». No se esconde: se gradúa.

Cómo medirlo sobre datos reales, sin adivinar: `npm run medir:cotizaciones [días]` —
read-only, imprime **ingenuo vs. detector vs. corroboradas** y una muestra de los textos que el
ingenuo contaba y el detector descarta.

## Alternativas descartadas

- **Un job nocturno que escriba las etiquetas** — el problema de arriba, más un job que mantener.
- **Un flag en `interactions` (`es_cotizacion`)** — congela el veredicto en el momento de la
  ingesta: mejorar el detector no arreglaría el pasado, y el pasado es todo lo que hay.
- **Marcar la cotización solo desde la plantilla** (el `es_cotizacion` de #91) — es correcto y
  complementario, pero solo sirve *hacia adelante*: no explica las 696 conversaciones que ya
  existen. Las dos cosas conviven; esta ADR cubre el histórico y el texto libre.
