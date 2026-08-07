# Estado de Hermes — para retomar (2026-07-22, tras el track de rendimiento)

> **Empezá por acá.** La foto completa: qué funciona, qué falta, y el contexto para seguir sin
> re-descubrir nada. Repo: **github.com/Goberna-Lab/hermes** (privado, `main`). El norte de producto
> es **`plan-crm-definitivo.md`**; la bitácora de cómo se llegó acá:
> **`sesion-2026-07-21-crm-definitivo.md`** (14 features en un día, con sus commits).

## Qué es Hermes (1 frase)

El **CRM de la Escuela de Goberna**: la vendedora atiende todos los canales (WhatsApp, comentarios
FB/IG, Messenger), gestiona el embudo, agenda, llama, manda correos y registra la venta contra
Cerberus — desde UNA app (Tauri/web) cuya UI vive en el server (**OTA**: actualizar = actualizar
el VPS, nadie reinstala).

## ✅ Producción al día (verificado 2026-07-27, madrugada)

VPS1 corre **`db4aa00`**, con front y server construidos del mismo commit y **el schema aplicado**
(`clientes_padron`, `alias_curso.ad_id`, plantillas, auto-respuesta — el detalle en los Gotchas del
`CLAUDE.md`). Verificado por tres vías: `git rev-parse HEAD` en `/srv/hermes`, el chequeo HTTP
(front 200, `/api/*` 401 sin token) y capturas con Playwright contra la app viva.

**Esto envejece rápido: no hay CD.** Antes de leer el código de `main` como «lo que corre»:

```bash
ssh deploy@161.132.39.165 'cd /srv/hermes && git log --oneline -1 && systemctl is-active hermes'
```

### Cómo se despliega hoy

**Por el botón**: Actions → **Desplegar server (con restart)** → escribir `reiniciar`. O
`gh workflow run "Desplegar server (con restart)" --repo Goberna-Lab/hermes -f confirmar=reiniciar`.

Eso corre `deploy/vps1/hermes-deploy.sh`, que hace todo en un solo paso y en el orden correcto:
respalda la base si hay migraciones · verifica que la base y el repo se correspondan (`db:estado`) ·
migra · instala dependencias si cambiaron · construye el front aparte y lo cambia de lugar ·
reinicia · espera `/health` · corre el smoke funcional · y **si algo falla revierte solo y verifica
lo revertido**. Deja el sha en `~/.hermes-despliegue/{server,front,ultimo-sano}`.

Por SSH corre **exactamente la misma pieza** — no es un camino alternativo:

```bash
ssh deploy@161.132.39.165 'sudo hermes-deploy --dry-run'   # el plan, con las variables de la decisión
ssh deploy@161.132.39.165 'sudo hermes-deploy'             # promueve origin/main
ssh deploy@161.132.39.165 'sudo hermes-deploy --rollback'  # vuelve al último sha sano
```

> ⚠️ **El schema ya NO se empuja a mano.** Va en migraciones versionadas (`server/drizzle/`), el
> deploy las aplica solo después de respaldar, y CI verifica que sean expand-only. Lo que decía acá
> —checkout, `ssh -t … db:push` desde una terminal de verdad porque pide TTY, build con swap,
> restart, actualizar el archivo de estado a mano— dejó de aplicar con **ADR 0021**. El gate de
> schema que obligaba a eso tampoco existe más: no se podía satisfacer.
> El cómo, completo: **`docs/migraciones.md`**.

**Solo front, sin restart**: se despliega **automático** al mergear a `main` (N4 de `ci.yml`), pero
solo si el rango sin desplegar no toca `server/`. Cero downtime.

**Reiniciar tiene costo**: `sesionStore` vive en memoria, así que el restart tira las sesiones de
Cerberus y las vendedoras vuelven a loguearse. Por eso el server es un botón y el front es
automático. Va fuera del horario de atención y batcheado.

**Rollback**: `sudo hermes-deploy --rollback` (el script sabe a dónde volver: `ultimo-sano`). Solo
el front, más rápido todavía: `cd /srv/hermes && mv dist dist.roto && mv dist.anterior dist`.
La base **no vuelve**, y está bien: las migraciones son expand-only, así que el código viejo funciona
contra el schema nuevo — es justamente lo que hace seguro el rollback automático.

**En qué estado está la base**: `cd /srv/hermes/server && npm run db:estado` (solo lee).

## Qué hay en `main` (≠ lo que corre en producción)

| Área | Estado |
|---|---|
| **Dashboard** (página principal) | Diseño por panel 3-lentes+juez: banda "Tu mañana" (vencidos/hoy + "Atender a {nombre} →"), radar en vivo (filas 2 líneas, calientes con borde oro, filtros que delatan fuentes muertas), riel (embudo-barra clickeable, top cursos pedidos, equipo Hoy\|7d) |
| **Pipeline** | Kanban con las 5 etapas del dueño (Interesados→Contactados→Cotizados→Cierre·Perdidos), arrastre, y **compuertas server-side**: a Cotizados con ≥1 curso de interés; a Cierre SOLO registrando la venta (la venta lo mueve sola: cotización→cotizado+intereses, venta→cierre+conversión) |
| **Mensajes** (chat) | Cola unificada 4 canales + búsqueda + **chat nuevo** · hilo WhatsApp **con media completa** (ver/mandar imágenes, videos, audios, flyers — clip con leyenda) · Messenger read-only · comentarios privado-antes-que-público · **BarraGestion arriba de todo chat**: etapa 1-clic, etiquetas, intereses, Agendar, **Llamar** (tel: + Copiar de respaldo) |
| **Contactos** | Búsqueda por teléfono → ficha Cerberus 4 estados |
| **Correos** | Composer 1-a-1 auditado + enviados del equipo. **Fail-closed**: falta el SMTP (ver pendientes) |
| **Agenda** | Calendario estilo GCal (mes/semana/día, chips por tipo, crear en día vacío, detalle flotante). Agendar mueve interesado→**contactado** solo. Badge dorado en el riel |
| **Infra** | API pública HTTPS + SSE + UI servida (OTA) · WhatsApp vinculado EN el VPS (51986394450, fix `@lid` con 14.7k mapeos) · webhook de landings listo (Bravo→Hermes) · cáscara **Tauri** 3-5 MB (mac+win, permiso tel:) · **Electron archivado el 7-ago-2026 (ADR 0039)**: la cáscara es una sola |
| **Rendimiento** | Track «Rendimiento 2026-07» (spec #29). **En `main`**: techo de scan del radar (#19) y la cola con **ventana de 30 días** — 3,8 s → 30 ms, y de paso saca de la pantalla mensajes de 2016 (#30) |

Suite: **285 tests del server + 18 del front**. Sidebar: Dashboard · Pipeline · Contactos · Mensajes ·
Correos · Agenda · Entrenar bot · **Libreta** (Tablero fuera por decisión; componente conservado).
La Libreta entró al riel el 4-ago (**ADR 0034**) tras medirse **cero filas** en `notas` en producción:
la herramienta estaba entera y no se descubría.

### El mapa: `docs/arquitectura.md`

Cómo está hecho, los patrones de la casa, los bordes externos y la deuda. **Léelo antes de tocar
arquitectura.** Lo más importante que dice: **este repo tiene dos mitades** —el CRM vivo y el
dashboard de pauta heredado de meta-escuela, que está montado pero desconectado— y hay **cosas
rotas** (auth partida; las otras dos —la cola duplicada y el nivel VENCIDO que no se disparaba— se
resolvieron en #37/#38, ver `arquitectura.md` §8.2–8.3).

## 🔴 Lo que está apagado a propósito (27-jul-2026)

**La auto-respuesta.** Interruptor de base en `apagada` desde las 01:10 del 27-jul. Se prendió esa
madrugada en modo supervisado y se apagó siete minutos después, al revisar con el dueño los 40
borradores que había preparado: estaban mal de **siete formas**, tres graves. **Nada salió** — las
40 quedaron en `preparada`, estado que el despachador no incluye en `EN_COLA_DE_ENVIO`, y caducan
solas sin cruzar el día.

**No la prendas sin leer el issue #166.** El defecto de fondo cabe en una línea
(`autorespuesta/decidir.ts:77`): la condición de la franja preguntaba *«¿estamos nosotros fuera de
horario ahora?»* en vez de *«¿esta persona escribió fuera de horario?»*. A la 1 AM lo primero es
cierto para todos, así que calificaba cualquier conversación sin responder:

| Escribió a las… | Cuántos de los 40 |
|---|---|
| 01–08 h | 15 (correcto) |
| **09–16 h** | **25 — dentro del horario de atención** |

Y ninguno tenía techo de antigüedad: las esperas iban de **57 a 72 horas**. La función se diseñó
para el hueco de la madrugada (ADR 0015), no para vaciar un atraso de días.

Las **dos llaves** siguen valiendo y hay que mirar las dos: `AUTO_RESPUESTA` en el entorno **y** el
interruptor de la base. Estuvieron desincronizadas todo el 25 y 26 de julio — la base decía
`supervisada` y el chip de la cabecera lo mostraba así, pero la variable no existía en el `.env`, y
por eso llegaron leads dos días sin una sola recomendación. Antes de concluir que «está prendida»,
mirá el log del arranque, que lo dice explícito.

**Antes de prenderla, siempre**: `cd server && npm run auto:simulacro`. Con la advertencia que costó
este incidente — **el simulacro imprimió un plan de 33 mensajes que se veía impecable y estaba mal
de siete formas**, porque muestra el resultado y no las variables de la decisión (la hora local en
que escribió cada persona, su antigüedad). Eso se arregla en #166.

## PENDIENTES

### Del operador (minutos, destraban features ya construidas)
1. **SMTP para Correos**: cargar `SMTP_HOST/PORT/USER/PASS/FROM` en `server/.env` del VPS (la
   cuenta sale de mail.goberna.us / VPS2) + `systemctl restart hermes`. La UI se enciende sola.
2. **Landings al Dashboard**: en Bravo, poner `contact_webhook_url` de cada tenant con la URL de
   `ssh deploy@161.132.39.165 'cat /srv/hermes/.landing-webhook-url'` (runbook §9).
3. **Cerrar la sesión de WhatsApp de la laptop** (el teléfono tiene 2 dispositivos vinculados;
   debe atender solo el VPS). Dev local: `WHATSAPP_TRANSPORTE=falso`.
4. **Certificado de code signing Windows** (OV ~US$100-300/año) para matar el aviso de SmartScreen.

### De código (en orden sugerido)
1. ~~**Fase 2 del oficio taste**~~ — **EJECUTADA (2026-07-22)** como rediseño «Cierre de edición»:
   auditoría multi-agente (185 hallazgos) → dirección editorial → implementación completa de las 8
   pantallas + teclado global + puente entre vistas + capa de gráficas (series de 14 días en
   `/api/dashboard`). Spec, auditorías y screenshots antes/después: **`docs/rediseno-2026-07/`**.
   Kickers 33→6 · piso 11px en cero · presupuesto del oro aplicado. Predecesores `Bandeja`/
   `FilaInteraccion`/`useBandeja` archivados (ADR 0004). Pendiente de esa dirección: cablear el
   «modo racha» (`onSiguiente` en ResponderPanel, tono a validar con la vendedora real) y el
   flujo venta-precargada del drop en Cierre (`onRegistrarVenta` del kanban).
2. **Crear cliente en Cerberus para lead nuevo** (H1): hoy la venta exige cliente existente.
3. **S8 — contexto completo** (`plan-panel-contexto.md`): tabla `contexts`, ingesta ampliada,
   curso inferido del anuncio (join local ya posible), imagen de la publicación.
4. Verificación humana pendiente: **foto real entrante** al número y **envío de flyer** desde la UI.
   (Los screenshots de vistas logueadas ya **no** están pendientes: se resolvió firmando un token de
   dev local con `firmarSesion` y sembrándolo en `localStorage` desde Playwright — ver
   `docs/rendimiento-2026-07/`. No hace falta la clave de Cerberus para verificar UI.)
5. ~~Archivar Electron cuando la paridad Tauri esté confirmada en máquinas reales (ADR 0003).~~
   **HECHO el 7-ago-2026 (ADR 0039)**: la paridad la afirmó el dueño, no se midió acá.
6. **Catálogo de cursos para la vendedora** — pedido de Estephano el 22-jul, en grilling, **sin spec
   todavía**. Lo que ya se midió contra la API pública de Cerberus, para no volver a descubrirlo:
   - `GET /productos/api/public/productos-cursos/?estado=1` devuelve **9 campos** y **ninguno es
     contexto**: `codigo_producto · sku_producto · nombre_producto · precio_normal ·
     precio_promocion · categoria · negocio · division · estado`. **No hay** descripción, temario,
     duración, docente, fecha de inicio ni imagen. Cerberus tiene el inventario para **facturar**,
     no el material de **venta**.
   - **111 productos = 68 cursos**: las ediciones son productos separados numerados (*Inteligencia y
     Contrainteligencia* ×12, *Oratoria para Políticos* ×6, *Consultor Político* ×6).
   - Ejes que sí existen: división (Estrategia Política 60 · Inteligencia 46 · General 5) y
     categoría (Curso Online 84 · Virtual 22 · Pack 5). Negocio es «Escuela» en los 111.
   - La lista **ya** se ve en Hermes dos veces (buscador de Intereses y de la venta, mismo
     endpoint): el problema no es acceso.
   - **PERO existe un segundo endpoint que nadie había cableado** y que sí tiene contexto:
     `GET /productos/api/escuela/cursos-docentes/` (**pide sesión de Cerberus**, da 403 sin ella).
     Trae, para **18 ediciones programadas** (2026-02-01 → 2026-08-07): `fecha_inicio`, `fecha_fin`,
     `dias_semana`, `horas_academicas` (120/200), `cantidad_modulos` (7-11) y **`modulos[]` con 155
     módulos**, cada uno con nombre, horario exacto y **docente** (26 distintos, con nombre).
     O sea: **temario, duración, cronograma y docentes YA EXISTEN** — lo que hay que escribir a mano
     se achica a la parte editorial («para quién es», «qué se lleva», objeciones).
   - ⚠️ **Ese endpoint trae dos campos que NO pueden salir de ahí**: `precio_docente_usd` (lo que
     Goberna le paga a cada docente por módulo — USD 11.021 en total) y `correo_docente` (4 correos
     personales). Si se ingesta, **se sanitiza en el borde**: no se copian nunca.
   - **Decisión tomada en el grilling**: el problema real es *«qué le digo a quien pregunta de qué
     trata el curso»*. Consecuencia: la fuente del contexto **no puede ser Cerberus** — alguien de
     Goberna lo escribe una vez por curso y Hermes lo guarda. El trabajo grande es contenido, no
     código. Falta grillar: quién escribe, dónde vive, y qué pasa con las 43 ediciones repetidas.

## Contexto técnico para no re-descubrir

- **Actualizar prod:** Actions → **Desplegar server (con restart)** (N5). Por SSH corre la MISMA
  pieza: `ssh deploy@161.132.39.165 'sudo hermes-deploy --dry-run'` para ver el plan,
  `sudo hermes-deploy` para promover `origin/main`, `sudo hermes-deploy --rollback` para volver.
  Respalda la base, migra, construye, reinicia, hace el smoke y revierte solo si falla.
  El schema **ya no se empuja a mano**: viaja en `server/drizzle/` (ADR 0021, `docs/migraciones.md`).
  Solo front, sin restart: se despliega automático al mergear a `main` (N4).
- **VPS1:** systemd `hermes` (PORT=4110) · Postgres `hermes_db` 127.0.0.1:5438 · nginx
  `hermes-api` (SSE sin buffering, 64 MB adjuntos) · deploy key `github.com-hermes` · sesión WA en
  `/srv/hermes/server/.wa-sessions/` · media en `.wa-media/` · **la app abre también en navegador**.
- **Instaladores** (`/srv/hermes-descargas/` = `https://hermes-api.goberna.us/descargas/`):
  `Hermes-Windows.zip` (Tauri x64 + permiso tel:) · `Hermes_0.2.0_aarch64.dmg`. **Los `.dmg`/`.exe`
  de Electron que están ahí ya no se pueden reconstruir desde `main` (ADR 0039): hay que bajarlos.**
  Rebuild win: `gh workflow run tauri-windows.yml` (mac: `npm run empaquetar:mac`).
- **Local:** `docker start meta_escuela_db` · `cd server && npm run dev` (:4100) · `npm run dev`
  (:5173). Tests: server `cd server && npm test`, front `npm test` (vitest). **Ojo cwd**: el shell
  persiste el directorio entre comandos.
- **Caché persistente** (ADR 0007, en rama): vive en IndexedDB, base `hermes` → tienda `cache` →
  clave `consultas`. Guarda SOLO el radar y la cola, dura 24 h, y el **buster es el commit**
  (`git rev-parse` inyectado como `__ID_DEL_BUILD__`): con OTA la forma del payload puede cambiar
  bajo los pies de un caché guardado. Se borra por tres caminos: Salir, 401, y login con un usuario
  distinto al último. Para depurar un arranque raro: borrar la base desde DevTools equivale a volver
  al comportamiento anterior. Evidencia: `docs/rendimiento-2026-07/cache-*.png` (incluye la cáscara
  Tauri real con la API caída).
- **La sesión se cree el token** (ADR 0007): si hay uno guardado sin vencer, la app pinta ya y
  `/api/auth/yo` valida por detrás. Sin esto el caché quedaba tapado por el skeleton del login
  durante todo el viaje a VPS1. La firma la verifica el server en cada request igual.
- **Ojo con `Date.now()` en el render**: React no re-renderiza si sus deps no cambian, así que
  cualquier cosa medida contra «ahora» se congela. Pasó con el sello del caché (decía «en vivo»
  sobre datos de 14 h, para siempre). El patrón que lo arregla: `useSelloDeViejo` — función pura +
  un `setState` que late.
- **Datos clave:** etapa actual de una conversación = última fila de `gestiones` (append-only,
  legacy nuevo/venta se normalizan) · la clave de conversación es LA identidad transversal
  (`conv:canal:persona:numero` / `int:<id>` / `lead:<id>` / `'general'`) — etiquetas, intereses,
  gestiones, recordatorios y correos cuelgan de ella.

## Decisiones (no re-discutir)

`plan-hermes-mvp.md` §4-5 (D1-D13) + `plan-crm-definitivo.md` + ADR 0002 (espacio con vistas,
enmienda: 5→6 con Agenda; Tablero pausado) + ADR 0003 (Tauri) + ADR 0007 (persistencia web, nunca
plugins de la cáscara: atarse a Tauri rompe el navegador y obliga a un instalador nuevo por cada
cambio) + de esta sesión: OTA como modelo de updates · compuertas del embudo server-side · un
envío/correo = una acción humana · dorado = tiempo (vencido = rojo) · sombra O borde, nunca ambos ·
acciones de sistema (tel:) siempre con respaldo visible (Copiar).
