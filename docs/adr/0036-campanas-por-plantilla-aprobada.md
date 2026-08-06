# ADR 0036 — Campañas por plantilla aprobada: la segunda excepción a «un envío = una acción humana»

**Fecha:** 5-ago-2026 · **Estado:** aceptado · **Decide:** Estephano (dueño)

## El contexto, sin adornos

ADR 0015 escribió una regla y la cumplimos por seis meses:

> *Nada de automatización: no envío masivo, no warmup, no anti-ban. **Un envío = una
> acción humana**, por `EnvioControlado`, que es la única puerta hacia `enviarTexto`.*

Tuvo **una sola excepción**, la auto-respuesta nocturna, y le costó cuatro ADRs
ganársela (0015 · 0016 · 0018 · 0020).

El 4 y 5 de agosto de 2026 salieron dos campañas reales —88 y 628 mensajes— con
un script, por SSH, corridas por un ingeniero. **Eso ya rompió la regla**, sin
ADR y sin frenos: la primera corrida le escribió a dos personas que habían dicho
que no, porque el filtro de rechazo miraba un solo mensaje.

Este ADR no autoriza algo nuevo. **Autoriza, con condiciones, algo que ya está
pasando** — y traslada el disparador de un script sin guardas a una pantalla con
cinco frenos.

## La decisión

Se permite que Hermes despache un **lote de plantillas aprobadas por Meta** desde
la app, y **sólo si se cumplen las cinco condiciones** de la sección siguiente.
Sin cualquiera de ellas, no hay excepción y el lote no sale.

### Qué revierte, exactamente

De ADR 0015, **sólo para `server/src/campana/` y `routes/campana.ts`**:

- **§«no hay envío masivo»** — se revierte, acotado a plantillas aprobadas.
- **§«no insiste»** — se revierte, acotado por el techo de frecuencia (condición 5).

**NO se revierte §«el público escribió primero».** Esa parte de 0015 hablaba del
acuse nocturno. Acá el público puede no haber escrito nunca —la campaña del 5-ago
salió a 444 personas que jamás escribieron— y eso es **outbound en frío**, que es
legal en la Cloud API con plantilla aprobada. Se dice en voz alta porque cambia
el riesgo: en frío, el bloqueo y el reporte pesan mucho más.

### Qué enmienda de ADR 0020

ADR 0020 retiró el «aprobar en lote» de la auto-respuesta, y su argumento fue
correcto: **a quién, qué preguntó y si se despidió cambian de fila en fila**, así
que aprobar 32 de un clic es no mirar ninguna.

Este ADR **no dice que ese argumento estuviera mal**. Dice que *eso que hay que
mirar por fila **se mira por fila*** — en el simulacro, con una tabla de
condiciones (cuándo escribió, qué preguntó, quién es su dueña) y **cada fila
destildable**. Lo que se aprueba una vez es el LOTE ya revisado, no 628 mensajes
sin leer.

Y lo que un humano no puede mirar tres horas después, **lo mira la máquina**:
esa es la condición 1, y es la que compra la excepción.

## Las cinco condiciones

Sin cualquiera de ellas, no hay excepción.

### 1 · El veto se re-pregunta antes de CADA envío

`campana/vetoAlSalir.ts`. Un lote de mil dura horas; el público se decide al
principio y la gente sigue viva. Antes de cada mensaje se vuelve a preguntar:
¿dijo que no? ¿se despidió? ¿ya se le mandó? ¿hay conversación viva? ¿una
vendedora ya le escribió? Se cancela esa fila **con su motivo** y sigue el resto.

> **La regla general que sale de acá, y vale para cualquier cola con
> destinatarios humanos:** si entre la decisión y el envío puede pasar más de un
> minuto, el veto se vuelve a preguntar.

### 2 · Ritmo, ventana y techo del NÚMERO

Espaciado con jitter, dentro de una ventana horaria, y con el techo leído de
`envios_wa` — **del número, no de la feature**. Dos features leyendo cada una su
tabla habilitan dos presupuestos completos sobre el mismo número, y ninguna ve al
bot, que manda por ahí todo el día.

### 3 · Kill-switch sin deploy

Cualquiera de las cinco ve el chip y frena el lote de un clic. Hoy eso sólo se
para con Ctrl-C en un SSH — o sea que sólo lo puede hacer un ingeniero despierto.
**Quién frenó queda escrito** (`corridas_campana.frenada_por`).

### 4 · Fail-closed ante Meta

La plantilla se verifica contra Meta **antes de cada campaña**: si no está
`APPROVED`, o no se puede preguntar, **no sale**. Una copia local puede decir
«aprobada» sobre algo que Meta pausó hace dos horas, y actuar sobre eso cuesta un
`132015` por destinatario con la calidad del número cayendo con cada uno.

Un estado que no reconocemos **no habilita**: lista blanca, nunca lista negra.

### 5 · Sólo supervisores, y con firma que sobrevive

- Detrás de `esSupervisor` (`HERMES_SUPERVISORES`), **fail-closed**: sin la
  variable, nadie.
- **Cada corrida deja una fila** en `corridas_campana` con quién autorizó, qué
  plantilla, qué filtro (congelado), cuántos, y quién la frenó.
- **Techo de frecuencia**: una campaña por persona cada 30 días, sea cual sea la
  plantilla. Sin esto, «no insistimos» no queda en pie de ninguna forma.

## Lo que queda en pie, enumerado

Lo que no se enumera se pierde:

- `EnvioControlado` sigue siendo **la única puerta**, y sigue siendo **de a uno**.
  `TransporteWhatsapp` no tiene ni tendrá `enviarA(lista)`.
- **Nada de warmup ni anti-ban.** Ningún mecanismo cuyo fin sea que el tráfico no
  se detecte.
- **Nada de texto libre en un lote**: sólo HSM verificada contra Meta.
- **La auto-respuesta no cambia**: sigue en modo supervisado, con su propio ritmo
  y su propio interruptor.
- **El padrón sigue sin mandar nada** (ADR 0035). Repartir y mandar son dos actos
  distintos, y la pantalla de campañas es la que manda — el padrón no.
- **`envios_wa.vendedora_id = 'campana'`**, un actor de sistema. Poner a la
  persona le sumaría cientos de envíos a su ranking en `dashboard/porVendedora.ts`
  por haber apretado un botón.

## Por qué la firma va en una tabla y no en un log

El pedido del dueño fue «que se vigile quién mandó la campaña».

Un `console.log` lo dice hoy y lo pierde en la próxima rotación de journald. No
se puede cruzar con `envios_wa`, ni contar, ni mostrar en pantalla, ni responder
«¿quién mandó esto en marzo?».

Los logs estructurados se escriben igual, en cada paso — pero como
**observabilidad**, no como el registro. El registro es `corridas_campana`.

Y el filtro se **congela** al autorizar aunque la lista sea un filtro vivo: dentro
de tres meses hay que poder responder «¿a quiénes les mandamos el 5 de agosto?», y
una lista que sigue creciendo ya no lo sabe. La lista dice qué es hoy; la corrida
dice qué fue ese día.

## Lo que este ADR NO autoriza

- **Mandar desde las líneas de las vendedoras.** Son whatsmeow y no pueden mandar
  plantillas; abrir en frío por ahí es el camino corto al ban.
- **Un botón «mandale esta HSM» dentro de una conversación abierta.** Es la puerta
  por la que la excepción se estira sola.
- **Que el script siga vivo con `--enviar` una vez que la pantalla exista.** La
  segunda puerta se queda sin los cinco frenos, y el ADR estaría jurando garantías
  que una de las dos puertas no cumple — y es justamente la que ya mandó.

## Consecuencias que aceptamos

- **Una campaña puede molestar a alguien.** Los frenos bajan la probabilidad; no
  la llevan a cero. La contrapartida es que hoy ya se manda, sin ninguno.
- **La calidad del número es el activo en juego.** `132015` y `132016` se leen
  como alarma roja en la pantalla, no como un error más.
- **El techo de 30 días va a estorbar** alguna vez. Es el punto.
