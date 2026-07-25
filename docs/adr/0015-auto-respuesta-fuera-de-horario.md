# ADR 0015 — Auto-respuesta fuera de horario: la excepción acotada a «un envío = una acción humana»

**Fecha:** 2026-07-25 · **Estado:** aceptado · **Issue:** #125

## Contexto: el agujero, medido

De 834 mensajes de leads en 7 días, **365 (44%) llegaron fuera del horario de la vendedora**.
Comparado con lo que pasa cuando ella está:

| | dentro del horario | fuera del horario |
|---|---|---|
| mediana de demora en responder | **10 minutos** | **8,3 horas** |
| se quedaron sin respuesta, nunca | 21% | **44%** |

Entre las 21 h y las 8 h entran ~470 mensajes por semana y salen ~15. No es un problema de
esfuerzo: es que del otro lado no hay nadie, y a las 9 de la mañana la conversación ya se
enfrió (o la persona ya compró en otro lado).

La regla de la casa hasta hoy —`CLAUDE.md` §WhatsApp— era tajante:

> **Nada de automatización**: no envío masivo, no auto-respuesta, no warmup, no anti-ban.
> Un envío = una acción humana.

Esa regla sigue siendo la correcta para el 100% de lo demás. El dueño decidió abrirle **una
excepción, del tamaño exacto del agujero medido** y con los límites escritos como parte del
contrato, no como buena voluntad.

## Decisión

Hermes puede mandar **un acuse de recibo, elegido de un catálogo cerrado de plantillas**, a
una persona que **escribió primero** al negocio, **fuera del horario de atención**, cuando
**nadie le respondió en 30 minutos**.

Y nada más que eso. Lo que la excepción NO habilita, dicho explícitamente porque un día
alguien va a querer estirarla:

- **No inicia conversaciones.** Jamás un primer contacto: solo responde a quien escribió.
- **No hay envío masivo.** Un envío a la vez, y la interfaz del transporte sigue sin tener
  `enviarA(lista)` (ver `whatsapp/transporte.ts`).
- **No genera texto.** Elige entre plantillas registradas; nunca escribe una palabra propia.
- **No insiste.** Una por conversación por día, y a quien dijo que no, nunca.
- **No hace warmup ni anti-ban.** Esa parte de la regla queda intacta — ver «Lo que
  deliberadamente no se hizo».

### Las cinco condiciones para que una conversación califique

Viven en una función pura con el reloj inyectado (`autorespuesta/decidir.ts`):

1. el último mensaje es **de la persona** y lleva **≥ 30 min** sin respuesta humana;
2. estamos **fuera de la franja de atención** (default 09:00–20:00, `America/Lima`);
3. esa conversación **no recibió ya una auto-respuesta hoy**;
4. la persona **no expresó rechazo** («no gracias», «no me interesa», «ya no», «dar de
   baja»…, `autorespuesta/rechazo.ts`);
5. hay una **plantilla aplicable** y renderiza completa (un marcador sin valor ⇒ no se manda
   nada, antes que mandar «{{curso}}»).

### El ritmo, que es el corazón de la decisión

Decidir *a quién* es la mitad fácil. La otra mitad es *cuándo*, y tiene tres razones:

1. **No atropellar al cliente.** Quien escribió a las 3 a. m. no quiere que le suene el
   teléfono a las 3:01. Lo de la madrugada **se acumula** y sale a partir de las **7:30**.
2. **No saturar el canal.** Un envío a la vez, con **60–240 s** entre uno y otro. Vaciar la
   cola de golpe también significa que la vendedora entra a las 9 con 40 conversaciones
   abiertas al mismo tiempo.
3. **Mantener el volumen razonable.** Techos de **20/hora** y **60/día**, por número propio.

Con los defaults, las ventanas efectivas de despacho son **07:30–09:00 y 20:00–21:00** (la
ventana razonable menos el horario de la vendedora): 150 minutos que, a un promedio de 150 s
por envío, dan ~60 mensajes/día — el mismo techo diario. **Lo que no entra, no se manda**: a
las 9 llega la vendedora y responde en 10 minutos, que es mejor que cualquier plantilla.

Todo esto es puro y testeado (`autorespuesta/programar.ts` + `programar.test.ts`): la
madrugada→mañana, el reparto sin ráfaga, el espaciado dentro del rango y los techos.

### Los frenos

| Señal | Qué pasa |
|---|---|
| `temporary_ban` | freno TOTAL: el interruptor se apaga con el motivo escrito, y no vuelve solo |
| error de envío | ídem, y la pendiente queda `fallida` — **nada de reintentos a ciegas** |
| sesión desconectada | ídem |
| la vendedora responde esa conversación | la pendiente se **cancela** (también si contestó desde su teléfono: se mira la conversación, no solo lo que salió por Hermes) |
| empieza el horario de atención | la cola se **cancela entera** |
| la pendiente quedó atrasada > 90 min o es de otro día | se **cancela**: un acuse de anoche a las 3 de la tarde molesta más de lo que ayuda |

### Dos llaves, las dos apagadas por defecto

- `AUTO_RESPUESTA=on` en el entorno (llave de deploy). Ausente ⇒ ni el reloj arranca.
- `auto_respuesta_estado.encendida = true` en la base (llave de operación). Es el
  **kill-switch sin deploy**: `PUT /api/autorespuesta/interruptor` con el Bearer de
  cualquier vendedora. Apagar una máquina que le escribe a tus clientes no puede costar un
  `systemctl restart` — que además le tira la sesión de Cerberus a cada vendedora logueada.

**El interruptor vive en la CABECERA**, pegado al semáforo de WhatsApp
(`src/features/autorespuesta/InterruptorAutoRespuesta.tsx`), y no en una pantalla de
ajustes. Dos razones:

1. Es el mismo tipo de dato que el chip de al lado: el **estado del canal**. «¿El número
   está vivo?» y «¿la máquina está contestando sola?» se miran juntas o no se miran.
2. Un ajuste que se abre una vez por mes no sirve de kill-switch. Acá apagar cuesta **un
   click**, sin modal de confirmación a propósito — frenar tiene que ser más barato que
   dudar.

Y la asimetría es deliberada: **apagada se ve discreta, encendida grita**. El chip
encendido se pinta entero de azul de marca, con punto vivo, y dice cuántas hay en cola y a
qué hora sale la próxima. Nadie la prende sin darse cuenta, y nadie pasa una jornada sin
notar que está prendida. El estado **frenada** (el freno automático) es rojo y muestra el
motivo: no se puede confundir con «apagada» a secas. Si el `db:push` todavía no corrió, el
chip dice «falta la migración» en vez de mostrar un estado falso. Evidencia visual de los
cuatro estados en `docs/evidencia/125-interruptor-*.png`.

### Todo pasa por `EnvioControlado`

La excepción no abre un camino paralelo: usa la **misma puerta** que la vendedora, con las
mismas guardas (corta-corriente, chequeo de ban, auditoría). Lo nuevo es un campo declarado,
`automatico: true`, que se persiste en `envios_wa.automatico`. Sin esa marca, dentro de un
mes nadie podría distinguir qué mandó una persona y qué la máquina — y la vendedora abriría
un chat creyendo que ese saludo lo escribió ella. Por eso también se ve **en la burbuja del
hilo** (`docs/evidencia/125-burbuja-automatica.png`).

## Lo que deliberadamente no se hizo

El issue proponía además dos mecanismos cuyo propósito declarado era que el tráfico no se
**detecte** como automatizado: aleatorizar el intervalo «porque un intervalo constante es
tan detectable como la ráfaga» y rotar variantes «para que no haya N copias byte a byte».
**No se implementaron con ese fin**, y conviene que quede escrito por qué:

- Es lo que `CLAUDE.md` llama **anti-ban**, y esa parte de la regla nadie la levantó.
  Diseñar para evadir la detección de una plataforma es una decisión de otra naturaleza que
  «responderle a quien nos escribió»: la primera nos pone en contra de las reglas de
  WhatsApp; la segunda es lo que hace cualquier negocio con horario de atención.
- No hace falta. El espaciado, la hora decente y los techos **ya existen por razones
  propias** (el cliente y el canal), y se justifican solos. El espaciado tiene un jitter
  dentro del rango configurado porque repartir carga con jitter es la práctica normal, no
  porque queramos parecer humanos.
- Y sobre todo: **las plantillas dicen que son automáticas**. Un mensaje que no finge ser
  una persona no tiene nada que disimular. Es además lo que espera un cliente que escribe a
  las 3 a. m. y recibe un acuse: si cree que habló con alguien y después descubre que no, la
  que pierde es la marca.

Si algún día el dueño quiere volver sobre esto, es un ADR nuevo, no un parámetro.

## Consecuencias

- `CLAUDE.md` §WhatsApp queda actualizado en el mismo PR (regla dura #5): la regla ya no es
  «nada de automatización» a secas, sino «nada de automatización **salvo** esta excepción,
  con estos límites».
- Dos tablas nuevas (`auto_respuestas_pendientes`, `auto_respuesta_estado`) y una columna
  (`envios_wa.automatico`) exigen **`npm run db:push` a mano** en el server: este repo no
  tiene migraciones versionadas. Hasta que se corra, todo lo nuevo **degrada** (el hilo se
  sirve sin marca, la ruta del interruptor responde 503 con el comando exacto) en vez de
  romper una pantalla.
- Antes de prender: **`npm run auto:simulacro`**. Imprime el plan de despacho real —quién,
  qué plantilla, a qué hora, cuántos segundos entre uno y otro— sin mandar nada. Usa la
  misma función que el encolado, así que lo que se revisa es lo que va a pasar.
- El contenido de hoy son tres plantillas mínimas. Cuando entre **#45** (mensajes
  predeterminados de la vendedora), `autorespuesta/plantillas.ts` pasa a leer de ahí las
  marcadas como aptas; el resto del sistema no se toca.

## Riesgos aceptados

- **Es un cliente no oficial** (whatsmeow). Mandar automático desde ahí tiene un riesgo que
  no desaparece con ningún guardarraíl: el mitigante real es el volumen bajo, el freno ante
  la primera señal y el hecho de que solo se responde a quien escribió.
- **Una plantilla nunca va a ser tan buena como la vendedora.** Por eso la auto-respuesta se
  apaga sola en cuanto ella entra, y por eso lo que no entra en la ventana se le deja a ella
  en vez de forzarlo.
- **El «un envío a la vez» es un cerrojo DE PROCESO** (`enVuelo` en el despachador), y alcanza
  porque hoy Hermes corre como un solo servicio de systemd en VPS1. El día que haya dos
  instancias, ese cerrojo deja de valer y hay que tomar la fila con `FOR UPDATE SKIP LOCKED`
  antes de mandar. Queda escrito acá para que no se descubra por accidente.
