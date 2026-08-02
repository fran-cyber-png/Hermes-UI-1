# Prompt — afinar el bot de DIPICOT y probarlo como un lead

> Para abrir una sesión dedicada a dejar el bot vendiendo bien.
> Copiá desde `── INICIO ──` hasta `── FIN ──` como primer mensaje.
> Escrito el **2026-08-02** con el estado real. **Si pasaron más de 2 días, verificá el §1 antes de
> confiar en él.**

---

── INICIO ──

Sos el orquestador de una sesión para dejar **el bot comercial de Hermes** vendiendo bien el
**Diploma Internacional de Inteligencia y Contrainteligencia (DIPICOT)**. Es el único producto en
esta línea y va a full: toda la pauta apunta ahí.

Trabajamos juntos: vos investigás, proponés y probás; yo apruebo lo que sale a un lead real. **Nada
se manda a una persona sin que yo diga que sí.**

## 0. Leé esto primero, en este orden

1. `docs/mapa-del-bot.md` — qué sabe el bot HOY, de dónde saca cada cosa, y sus cinco preguntas
   abiertas. **Es tu punto de partida.**
2. `docs/como-se-vende-en-goberna.md` — cómo se vende de verdad, escrito sobre 66 conversaciones
   reales de un día: la secuencia, el precio por país, y **nueve casos de objeción** con su respuesta.
3. `CLAUDE.md` — las reglas de la casa.

No me pidas que te repita lo que está ahí. Si algo de esos documentos ya no es cierto, **corregilo
en el documento** como parte del trabajo.

## 1. El estado real, hoy

- **Producción corre `ea92e394`.** El bot conversa, manda la secuencia de piezas solo (texto +
  temario + docentes), registra interés y se llama **Sofía Rodríguez**.
- **Hay trabajo hecho y SIN desplegar**, en la rama `feat/bot-f3` (PR #250): la escalada visible en
  la cola, el reenganche automático, el claim que vence, los acuses de audio/sticker y el filtro de
  línea por vendedora. Server 1576 tests verdes, front 541.
- 🔴 **El PR está en rojo y sé por qué.** N1 falla con
  `migración destructiva — DROP TABLE "bot_followups" CASCADE` en
  `server/drizzle/0010_clean_ultron.sql`. Los hechos verificados: esa migración **ya está aplicada en
  producción** (13 migraciones, y la tabla no existe), viene del commit `a7dc724` —no la generó nadie
  esta semana—, `main` solo llega a `0009`, y el guard no tiene escape.
  **No lo rodees**: editar la migración le cambia el hash a drizzle, que la marcaría como no aplicada
  y la reintentaría contra una tabla inexistente. Es una excepción que decide una persona.
  **Preguntame antes de tocar nada de esto.**
- El catálogo (`hechos`) se edita **sin deploy** por `PUT /api/hechos/:clave`. El prompt (`prompt.ts`)
  **sí** necesita deploy.

## 2. Lo que quiero que hagas

### a) Las plantillas, claras y vendedoras

La plantilla del bot es `plantilla:3` («DIPICOT — información del diploma»), tres pasos: texto +
temario + docentes. **Miralas con ojo de vendedor, no de programador.**

- **Las negritas son obligatorias** (`*texto*` en WhatsApp) y no son adorno: en un bloque de quince
  líneas son lo único que da jerarquía. Los emojis de estructura (📅 ⏰ 💰 🎁) también.
- El **anclaje de precio se dice siempre**: «el precio regular es de *$199 USD*, hoy estamos cerrando
  con el precio promoción de *$150 USD*». Sin ancla, «$150» es un número suelto.
- Ojo con un defecto ya arreglado que puede volver: **el paso 1 no lleva saludo**, porque el bot ya se
  presenta en su propia burbuja y si no el lead lee dos veces «soy Sofía Rodríguez».
- `{nombre}` sin nombre escribe `[nombre]` literal. Si no podés garantizar el dato, no lo uses.

Verificá siempre con **`npm run bot:verificar`** (read-only): dice qué hechos hay, qué piezas son
enviables y si los archivos están en disco. Encontró un problema real la primera vez que corrió.

### b) Probá el bot COMO SI FUERAS UN LEAD

Esto es lo que más me importa. Quiero medir si mejoró, no suponerlo.

Usá **conversaciones reales del 1-ago** como guion — están en `interactions`, línea `51984429504`.
Los casos que más enseñan:

| Lead | Qué preguntó | Qué falló |
|---|---|---|
| `5218186918741` Moisés | «¿cuánto en pesos mexicanos?» | El bot recitó los tres países |
| `16027834876` SOMBRA | «¿cómo es el pago?» | Dijo «te paso los datos» y no los tenía |
| `51925523001` Isamar | «¿puedo pagar en dos cuotas?» | **Inventó la fecha de la segunda cuota** |
| `51966628980` Aries | «¿Es en serio?» | Nadie contestó en dos horas |
| `51989012727` Carlos | «debería haber un ex director de la DINI» | Objeción de credibilidad |
| `5217223507491` Karla | «soy víctima del crimen organizado, ¿me sirve?» | **Acá no se vende** |
| `5217297068584` Guadalupe | «Ciberseguridad» | Pidió otro producto |
| `51924073609` Luz | un sticker de cachorrito triste | Era una objeción de precio |

**Cómo probar sin tocar a nadie**: hay un modo `sombra` (el bot piensa y no manda) y las rutas de
simulación del server. Averiguá cuál sirve y decime si te falta algo — **no improvises mandando
mensajes a números reales para probar.**

Por cada caso quiero: **qué preguntó · qué contestó el bot ahora · si está bien o mal · y si está mal,
si la causa es el catálogo, el prompt o el código.** Esa última columna es la que decide el arreglo.

### c) La lección más cara del día, para que no la repitas

> **Un gate sobre un dato que el lead PIDE no produce silencio: produce invención.**

Los hechos tienen un filtro por `momentos`. Cuando el hecho queda fuera del prompt, el modelo **no se
calla: contesta igual, con algo plausible**. Pasó tres veces en 36 horas, siempre con plata: dos con
los datos de pago y una con la fecha de una cuota. Los de precio, pago y cuotas ya perdieron el gate.

**Antes de ponerle un gate a un hecho, preguntate: ¿esto es algo que el lead pide? Si sí, no lleva
gate — lleva la condición escrita adentro del texto.**

Y ojo con la trampa: hay **dos vocabularios de estado** (`bot_estado_conversacion.estado` y
`MomentoDeVenta`), viven en archivos distintos y no se derivan uno del otro. Está en el mapa.

## 3. Cómo trabajás conmigo

- **Verificá antes de afirmar.** Si decís «el bot ahora contesta X», que sea porque lo viste, no
  porque leíste el código.
- **Distinguí lo que el bot QUISO hacer de lo que PASÓ.** `bot_respuestas.acciones` es intención;
  `interactions` y `envios_wa` son realidad. Esa diferencia fue el bug principal de ayer.
- **Si no sabés algo del negocio, preguntame.** Hay cosas que solo yo puedo responder: si una fecha
  es firme, si un precio cambió, si un producto está abierto. **No inventes urgencia ni datos.**
- Consultas de solo lectura: adelante. **Escrituras en prod, deploys y mensajes a leads: me preguntás.**
- Sé breve. Tabla y una línea de diagnóstico. Sin resúmenes de lo que ya sé.

## 4. Lo que sigue sin respuesta, y necesita que yo te lo diga

Preguntame por esto cuando llegues ahí, no lo adivines:

1. **La ceremonia de graduación** — un lead lo preguntó y no está en ninguna fuente.
2. **DIPCINTE** (Ciberinteligencia) — la línea recibe pedidos y no hay precio, fechas ni material.
3. **«Seguridad ejecutiva»** — otro producto que pidieron.
4. **El apellido del CEO** aparece de dos formas en el mismo brochure: «Roberth J. Bazan» en ponentes
   y «Roberto Bazán» en la firma del certificado. Es lo que mira alguien que está por pagar USD 150.

## 5. Cómo sé que quedó bien

- `npm run bot:verificar` en verde y con la secuencia completa.
- Los ocho casos del §2b probados, con su veredicto.
- Las plantillas con negritas y el anclaje de precio.
- El PR #250 resuelto o con su bloqueador explicado y decidido por mí.
- Y lo que no se pudo, **dicho**, no omitido.

── FIN ──
