# ADR 0014 — El estado personal de la conversación: pin, favorita y «no leído»

**Fecha:** 2026-07-24 · **Estado:** aceptado · **Issue:** #49 · **PR:** #123

> Numeración: el 0013 lo tomó el frente de la etapa efectiva (#120), que va en paralelo.
> Este ADR es el 0014 por coordinación del orquestador.

## Contexto

La cola de Mensajes llegó a **1.819 conversaciones**. Con ese volumen dejó de ser una mesa
de trabajo: «No gracias» se veía igual que un lead caliente, el chip «Pide info» estaba
pegado a todas, y no había forma de que una vendedora dijera «estas tres son las mías hoy».
Ordenar por urgencia (ADR 0009) resuelve *qué es lo más urgente*, pero no *qué me importa a
mí* — y son dos preguntas distintas.

Lo que faltaba era estado **de la vendedora sobre la conversación**, no de la conversación:
fijar tres, marcar favoritas, y saber qué no leyó.

## Decisión

Una tabla `estado_conversacion` con PK `(vendedora_id, clave)` — una fila por vendedora y
conversación. Tres decisiones dentro de esa:

### 1. «No leído» se DERIVA de un cursor; no se guarda

Se persiste `leido_hasta` (**cuándo abrió**) y `no_leido` se calcula en la consulta:
`último entrante > leido_hasta`. Es la regla de la casa (lo derivable no se guarda, ver
`lib/datos/cliente.ts`), y acá además evita el estado zombi: un flag `no_leido` guardado
habría que apagarlo y prenderlo en cada evento, y cualquier camino que se olvide lo deja
mintiendo para siempre.

Es **distinto de `respondida`**: se puede leer sin responder, y responder sin leer lo último.

**El cursor NO es `now()`.** Es el `occurred_at` del último mensaje **ya proyectado**. La
ingesta de Meta es por polling: un mensaje que ocurrió hace 3 minutos puede aterrizar dentro
de 10. Con el cursor en `now()`, ese mensaje nace marcado como leído sin que nadie lo haya
visto — la conversación nunca vuelve a «No leídos» y la vendedora pierde el lead sin
enterarse. Con el cursor en «lo último que se pudo ver», el mensaje que llega tarde entra
como no leído, que es la verdad.

Simétricamente, «marcar sin leer» pone el cursor **un microsegundo antes del último
entrante**, no en NULL: NULL borraría que ya se había leído todo lo anterior.

### 2. La banda de pin va SOBRE la urgencia, sin reemplazarla

`ORDER BY fijada DESC, fijada_at ASC, nivel ASC, orden ASC`. Las fijadas suben a una banda
arriba de todo, pero **dentro de la banda sigue mandando la urgencia de seis niveles**. El
pin no compite con la urgencia: la antepone para tres casos y respeta el resto — la
alternativa (un nivel más en la escala) habría metido criterio de producto adentro del
módulo de urgencia, que es justo lo que el ADR 0009 vino a cerrar.

**Una conversación fijada ignora la ventana de 30 días.** Si no, fijar tres y dejarlas
envejecer las volvía invisibles pero seguían ocupando el tope: la vendedora quedaba sin
poder fijar nada nuevo y sin forma de soltar las viejas. Fijar significa «quiero verlo
siempre»; la ventana no puede romper esa promesa.

### 3. Tope de 3 pines, con lock

Tres es «lo que estoy trabajando hoy», no una carpeta. El cuarto pin devuelve **409** con
el motivo, que la UI muestra (no lo esconde). La cuenta va **dentro de una transacción con
`pg_advisory_xact_lock` por vendedora**: sin el lock, dos pestañas fijando a la vez leen
«2» las dos y guardan la cuarta.

### 4. Un solo «pide info» para toda la casa

Se derivaba con `bool_or` histórico: quien preguntó el precio una vez lo llevaba para
siempre. Con 1.800 conversaciones el chip dejó de distinguir nada. Pasa a ser **el último
entrante con texto** (`pideInfoAgrupadoSql`), y la **misma** función la usan la cola y el
radar del Dashboard — el chip del radar hereda la semántica nueva. Un audio posterior no
apaga el pedido: la última palabra es el último mensaje que *tiene* palabras.

## Consecuencias

- La cola gana tres ejes (tab, filtro secundario, categoría) sin tocar la urgencia.
- **La cola degrada, no revienta**: la tabla se aplica con `db:push` manual, y entre que el
  código sale y alguien corre el push la cola respondería 500 — o sea, la vendedora sin
  mesa de trabajo por una tabla de comodidad. `consultarCola` detecta el `42P01`, reintenta
  sin estado personal y devuelve `sinEstado: true`; la UI lo dice en voz alta.
- El estado es **por vendedora**: el pin de A es invisible para B. La cola sigue siendo
  compartida (ADR 0010: la cola no se filtra por vendedora) — lo personal es la *marca*,
  no el acceso.
- Deuda conocida: el tope de 3 es un número elegido, no medido. Si las vendedoras piden
  más, se sube; el 409 ya explica el límite en vez de fallar en silencio.

## Alternativas descartadas

- **Guardar `no_leido` como booleano**: más simple de consultar, pero hay que mantenerlo en
  cada camino de escritura y queda mintiendo apenas uno se olvide.
- **El pin como nivel 0 de la urgencia**: mezclaba criterio personal con el módulo
  compartido; el radar habría heredado los pines de una vendedora.
- **Sin tope de pines**: la banda deja de ser una banda y se vuelve otra cola.
