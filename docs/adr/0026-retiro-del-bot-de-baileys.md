# ADR 0026 — Se retira `goberna_bot` (Baileys), y qué aprendimos de tenerlo prendido 25 días

**Fecha**: 2026-07-28 · **Estado**: aceptado, ejecutado parcialmente (detenido; borrado pendiente de
§5) · **Decide**: el dueño · **Reemplaza a**: nada — retira un servicio sin sucesor, porque su
función la cubre Hermes con otra tecnología y otras reglas.

## Contexto

`goberna_bot` (repo `Goberna-Lab/bot-wspp`) corría en VPS1 desde el **21-jun**, `Up 5 weeks
(healthy)`, con `@whiskeysockets/baileys@7.0.0-rc.9` — el cliente **no oficial** de WhatsApp que la
**política del 2026-07-03 prohíbe para clientes**.

Lo que había adentro, medido el 28-jul (read-only, antes de tocar nada):

| | |
|---|---|
| Tenants | **4**: `icarus` · `leads-crm` · `qr-temp-peru5` · **`tejada`** |
| Instancias | 6: `peru1`…`peru5` + `tejada` |
| Contactos | **16.918** |
| Labels | 45 |
| **`send_log`** | **0 filas** |
| Límites configurados | 120 / 60 / 60 / 120 por hora, por tenant |
| Reconexiones + QR en 24 h | **7.716** (≈ 5 por minuto) |
| Tráfico HTTP en `bot.goberna.us` | 13 hits en 2 días |
| Volúmenes | 13 M sesiones · 11 M base · 1,1 M media |

## Los cuatro hallazgos

### 1. 🔴 Era un riesgo activo para las ventas, no un servicio dormido

Las sesiones estaban **caídas** (`QR code generated — scan from phone`, `Disconnected (code 408) —
reconnecting in 90s`) y el proceso reintentaba **7.716 veces en 24 horas**. Todo eso salía por la
**misma IP pública de VPS1** desde la que Hermes atiende **las tres líneas de venta reales** con
whatsmeow.

Una tormenta de reconexiones de un cliente no oficial es exactamente el comportamiento que hace que
WhatsApp marque una IP. **El bot muerto podía tumbar las líneas vivas**, y arrancó a hacerlo el día
después de que las tres líneas entraran a producción. Ése —y no la deprecación— es el motivo por el
que se detuvo hoy y no en el censo.

### 2. 🔴 Había un tenant de CLIENTE (`tejada`), contra la política escrita

La política del 2026-07-03 prohíbe Baileys **para clientes**. Existía, estaba escrita, y el servicio
que la violaba siguió corriendo **25 días**. Nadie la desobedeció: nadie fue a buscar dónde ya se
estaba incumpliendo.

> **La lección que vale más que el bot**: una prohibición nueva necesita un **barrido de inventario**
> el día que se escribe. Una política sin barrido es documentación, y la casa ya tiene el hábito de
> confundir las dos cosas. *(Regla nueva: toda política que prohíbe una tecnología se acompaña de la
> lista de dónde está corriendo hoy, o no está terminada.)*

### 3. `send_log = 0` — la buena noticia, y por qué se dice con precisión

**No hay evidencia de que se haya enviado nada por este bot.** Eso acota la exposición y hay que
decirlo con el mismo cuidado con el que se dice lo malo. Lo que sí hubo fue **capacidad instalada**:
cuatro tenants con techos de 60–120 mensajes/hora configurados, o sea una herramienta **diseñada
para envío masivo** — justo lo que `EnvioControlado` existe para impedir.

**El bot es la contrafactual de Hermes.** Vale conservar este ADR como el registro de *por qué*
Hermes está hecho como está: un envío = una acción humana, una sola puerta, el `temporary_ban`
siempre a la vista, y nada de anti-ban. El bot es el camino que no se tomó, y tenerlo escrito es más
útil que el código.

### 4. `Up (healthy)` mintiendo durante cinco semanas

El healthcheck miraba el **puerto HTTP**, que respondía perfecto, mientras la **función central**
—estar conectado a WhatsApp— llevaba semanas caída. Docker informaba salud y el servicio no servía.

> **Lección transversal**: un healthcheck que no comprueba la función central es peor que no tener
> ninguno, porque produce confianza. Aplicable ya a Hermes: el semáforo de WhatsApp mira la sesión
> —bien—; el próximo servicio que se monte tiene que declarar *qué falla si el healthcheck pasa*.

## Decisión

1. **Se retira `goberna_bot` y `icarus_bot`.** No se reemplazan: WhatsApp de la Escuela es Hermes
   (whatsmeow, operación propia de Goberna, riesgo propio); WhatsApp de **clientes** será **Cloud
   API oficial** cuando exista (plano B de [`../dos-planos.md`](../dos-planos.md) §3.5).
2. **`bot-wspp` se archiva como repo**, con este ADR como su epitafio. El código no se borra: es la
   evidencia de la decisión.
3. **Las credenciales de sesión NO se archivan: se destruyen.** Un archivo de credenciales de
   WhatsApp es un pasivo, no un respaldo. (Incluye `peru4_session_*.tgz` y `peru5_qr.png`, que
   estaban sueltos dentro del volumen de datos.)
4. **Los 16.918 contactos SÍ se conservan** y tienen dueño que no somos nosotros: `tejada` es un
   cliente de consultoría y `icarus`/`leads-crm` son sistemas propios. Antes del borrado hay que
   decir **de quién es cada tenant** (§5).

## Ejecutado el 2026-07-28

- ✅ Archivo en `/srv/backups/archivo/goberna-bot-20260728/` — `srv-goberna-bot.tgz` (código y
  compose) · `bot.db` + `bot.sql` (**verificados: 16.918 contactos, 45 labels**) · `media.tgz` ·
  `inspect.json` · `nginx-bot-goberna.conf` · `ultimos-logs.txt`.
- ✅ `docker update --restart=no` en los dos, y `docker stop goberna_bot`. **Se cortó la tormenta de
  reconexiones.**
- ✅ Verificado después: `hermes.service` activo, `hermes-api.goberna.us` respondiendo (401 = el
  perímetro exige Bearer, que es lo correcto).

## Pendiente (§5) — necesita al dueño antes de ser irreversible

1. **¿De quién son los 16.918 contactos?** Repartirlos por tenant y devolver/retener según
   corresponda. `tejada` es de un cliente.
2. Recién ahí: `docker rm` + `docker volume rm` de los tres volúmenes, **shred** de las sesiones.
3. Bajar `bot.goberna.us` (nginx + DNS Cloudflare) — 13 hits en 2 días, casi todo escáner.
4. Archivar el repo en GitHub con el link a este ADR.

> ⚠️ **No se tocó ninguna regla de firewall ni ningún puerto** en esta operación: hay devs
> trabajando contra esas superficies y el dueño lo congeló el 28-jul. Detener un contenedor propio
> deprecado no es tocar el perímetro.

## Consecuencias

- Un servicio menos, ~25 M de volúmenes a liberar, y un dominio a dar de baja.
- **Cero impacto en producción**: no enviaba (`send_log` vacío) y su HTTP no lo consumía nadie.
- Queda escrito el patrón de retiro que el censo de servidores va a repetir ~15 veces:
  **censar → archivar con verificación → detener (reversible) → decidir el borrado (irreversible) →
  ADR**. Éste es el caso 1 y el molde.
