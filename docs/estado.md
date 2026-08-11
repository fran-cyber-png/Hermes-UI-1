# Estado de Hermes — para retomar (2026-07-22, tras el track de rendimiento · **retocado el 11-ago-2026**: las líneas que corren y la barra de Mensajes)

> **Empezá por acá.** La foto completa: qué funciona, qué falta, y el contexto para seguir sin
> re-descubrir nada. Repo: **github.com/Goberna-Lab/hermes** (privado, `main`). El norte de producto
> es **`plan-crm-definitivo.md`**; la bitácora de cómo se llegó acá:
> **`sesion-2026-07-21-crm-definitivo.md`** (14 features en un día, con sus commits).

## Qué es Hermes (1 frase)

El **CRM de la Escuela de Goberna**: la vendedora atiende todos los canales (WhatsApp, comentarios
FB/IG, Messenger), gestiona el embudo, agenda, llama, manda correos y registra la venta contra
Cerberus — desde UNA app (Tauri/web) cuya UI vive en el server (**OTA**: actualizar = actualizar
el VPS, nadie reinstala).

## ✅ Producción al día (verificado 2026-08-09, tras el frente del embudo)

VPS1 corre **`043544f`** con el servicio `active` (N5 del 9-ago 14:57 Lima). Antes de este frente
corría `fab8b3f`.

### El EMBUDO cambió de forma, y es lo primero que se nota al abrir el Pipeline (**ADR 0044**)

Verificado **midiendo contra la base**, no por el status del workflow:

| etapa | antes | ahora |
|---|---|---|
| **Sin respuesta** (nueva) | — | **2.576** |
| Interesados | 378 | 377 |
| Contactados | 545 | **217** |
| Cotizados | **3.051** | **790** |
| **Cierre** | **0** | **13** |

El motivo: sin ningún entrante `respondida` da `true`, así que **2.252 de los 3.050 Cotizados nunca
habían dicho una palabra** (un envío masivo con precio los promovía a todos). Ahora cada peldaño
exige una acción del comprador. Nada se perdió: bajaron a una columna con su propia acción.

Además: **el recorte es por columna** (chips «Para seguir», «Se callaron con el precio», «En
ventana», cada uno con su número), **cada tarjeta dice cuánto lleva en su columna**, y **los leads de
formulario del radar** dejaron de decir «icarus:landing»/«Lead Ad» y ahora abren su ficha al costado.

⚠️ **Y lo que este frente NO resolvió, dicho con el número**: el Pipeline **ordena el 2,6 % del
embudo**. `interactions` es 100 % WhatsApp; los **25.510 leads de formulario** (con datos de hoy) no
llegan a ninguna columna, y de sus 25.226 con teléfono sólo **650** llegaron alguna vez a hablar.
El plan está en `docs/plan-pipeline-por-canal.md` (punto #4, el único que toca la ingesta).

---

**Del frente anterior (el navegador), sin cambios:** Verificado **midiendo, no por el status**: el
bundle servido es `assets/index-CtTZg27M.js` con `content-type: application/javascript` y 954 KB —
que es la única forma de saberlo, porque **el fallback SPA de Express devuelve `index.html` con 200
para cualquier ruta**, así que un `curl -f` a un archivo inexistente PASA. Además se verificó que
ese bundle **contiene el código nuevo** (`grep navegador_montar`) y que los commits del último
frente son ancestros del SHA desplegado.

> ⚠️ Acá decía «**no hay CD**» y hace rato que es falso: hay **cinco niveles** (N1…N5) en
> `ci.yml` + `desplegar-server.yml`. Ver `docs/despliegue-continuo.md` y el cuadro del `CLAUDE.md`.

Antes de leer el código de `main` como «lo que corre»:

```bash
ssh deploy@161.132.39.165 'cd /srv/hermes && git log --oneline -1 && systemctl is-active hermes'
```

> 🔴 **Y si el CI de `main` está rojo con SOLO N4 rojo, no es un bug: es DRIFT.** N4 implementa la
> regla dura #6 y se niega a tocar `/srv/hermes` si tiene cambios locales sin commitear. Pasó el
> 8-ago-2026 y **bloqueó dos merges seguidos sin que nadie lo notara**, porque N4 solo corre en push
> a `main` y **el PR se ve verde igual**. Se mira con
> `ssh deploy@161.132.39.165 'cd /srv/hermes && git status --porcelain -uno'`; se arregla con
> `git checkout -- <rutas>` **después** de verificar que esos archivos existen en `main` y que
> ningún commit los borró. Nunca `reset --hard` a ciegas: eso pisaría una edición hecha a mano, que
> es justo lo que la regla #6 protege.

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

**Reiniciar ya NO desloguea a nadie** (ADR 0027): la sesión de Cerberus se persiste en
`sesiones_cerberus`, con el `Map` como caché del proceso. Acá decía que el restart las tiraba y
dejó de ser cierto. Sigue siendo un **botón** por prudencia —un restart en horario de venta merece
un humano mirando— pero el costo que justificaba esperar a la noche ya no existe.

⚠️ **Y el front no siempre puede ir solo**: N4 despliega front sin restart **solo si el rango sin
desplegar no toca `server/`**. Si alguien mergeó server desde el último N5, el front queda esperando
también — o sea que **un cambio 100 % de front puede necesitar N5 igual**.

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
| **Mensajes** (chat) | Cola unificada 4 canales + búsqueda + **chat nuevo** · **barra de 3 chips que se ganan el lugar (ADR 0052, 11-ago-2026): «Preguntaron precio» · «Te escribieron» · «Puedo escribirle»** — se retiraron «Piden info» (medía el texto que prellena Meta, no una pregunta), «Sin responder» (505 filas con el 93 % de +7 días) y «Ya compraron» (27 % de la mesa) · el preview ya no finge una pregunta donde hubo un clic de anuncio · avisa cuándo una conversación contestada bajó de lugar · hilo WhatsApp **con media completa** (ver/mandar imágenes, videos, audios, flyers — clip con leyenda) · Messenger read-only · comentarios privado-antes-que-público · **BarraGestion arriba de todo chat**: etapa 1-clic, etiquetas, intereses, Agendar, **Llamar** (tel: + Copiar de respaldo) |
| **Contactos** | Búsqueda por teléfono → ficha Cerberus 4 estados |
| **Correos** | Composer 1-a-1 auditado + enviados del equipo. **Fail-closed**: falta el SMTP (ver pendientes) |
| **Agenda** | Calendario estilo GCal (mes/semana/día, chips por tipo, crear en día vacío, detalle flotante). Agendar mueve interesado→**contactado** solo. Badge dorado en el riel |
| **Infra** | API pública HTTPS + SSE + UI servida (OTA) · WhatsApp vinculado EN el VPS (**desde el 11-ago-2026 corren DOS líneas: `51984429504` Cloud API + `51963139984` whatsmeow**; las otras tres se retiraron por estar caídas — fix `@lid` con 14.7k mapeos) · webhook de landings listo (Bravo→Hermes) · cáscara **Tauri** 3-5 MB (mac+win, permiso tel:) · **Electron archivado el 7-ago-2026 (ADR 0039)**: la cáscara es una sola |
| **Navegador** (⌘9) | Vive **adentro de la mesa** como webview hijo (**ADR 0043**, enmienda 0040): barra con atrás/adelante/recargar y dirección, y la sesión de trabajo separada del Chrome personal. Medido el 8-ago: **ChatGPT carga y Google NO bloquea el login** en el webview embebido (macOS/WKWebView). Se esconde cuando se abre Ivi o la cabina — es una capa del SO encima del DOM |

### 🔴 La cáscara va por otro camino que la UI, y hoy están desparejas

La UI viaja por **OTA** y ya está en las cuatro máquinas. La **cáscara** es un `.dmg`/`.exe` que se
reinstala **a mano**, así que hasta que se reparta, el navegador embebido **no se ve**: la escalera
de respaldo cae a la ventana aparte de ADR 0040, que es exactamente lo que la vendedora sigue viendo.

| | estado (9-ago-2026) |
|---|---|
| **macOS** | ✅ `Hermes_0.3.0_aarch64.dmg` compilado. Verificado que el binario lleva `navegador_montar` y `allow-navegador-embebido`. ⚠️ Es **aarch64**: no corre en Mac Intel |
| **Windows** | ❌ **NO hay `.exe`**. `tauri-windows.yml` falla en «Tests de la cáscara» con `STATUS_ENTRYPOINT_NOT_FOUND` (`0xc0000139`): el binario de test compila y no arranca, así que el build ni corre. **Es de ADR 0040, no de 0043** — verificado disparando el workflow sobre `6803145`, que falla idéntico |

**La versión es cómo se sabe cuál está instalada**: la cáscara nueva es **0.3.0**, la vieja 0.2.0.
Sin eso no había forma de contestarlo, porque el síntoma de tener la vieja —el navegador abre en
ventana aparte— es el comportamiento *correcto* de ADR 0040.
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

### 🚨 Lo que pesa más que cualquier pantalla (medido el 8/9-ago-2026)

Está primero a propósito: **ninguna de las tres se arregla desde el código**, y las tres valen más
que cualquier rediseño del tablero.

1. ~~**Las líneas de WhatsApp no reciben.**~~ **RESUELTO COMO DECISIÓN, no como arreglo
   (11-ago-2026).** Era cierto: `51986394450` (el 62 % del universo, 8.704 mensajes) sin un entrante
   desde el **28-jul**, `51941654039` desde el **5-ago**, `51944531711` nunca. Las tres estaban
   `sin-vincular` — sin archivo de sesión. **El dueño decidió retirarlas** en vez de re-vincularlas:
   se trabaja con **`51984429504` «Ventas Meta»** (Cloud API, la que trae los leads) y
   **`51963139984` «Betto»** (campaña).
   · ⚠️ **Lo que NO se resolvió**: sus **2.875 conversaciones siguen en la cola** hasta que venzan la
     ventana de 30 días (Ventas Perú ~27-ago, Walter ~4-sep). Sacarlas antes es un frente de código.
   · 🔴 **Cómo se retiró, porque la forma natural no funciona**: NO con `activo = false` (esa columna
     no tiene lectores), sino editando `WHATSAPP_NUMEROS` **y `BOT_LINEAS`** en el `.env` de VPS1 y
     **reiniciando a mano** — N5 sale verde y no reinicia si el SHA ya está desplegado. Detalle en
     `CLAUDE.md` §«Administración de números».
2. **Los leads de landing cayeron 98,8 % desde enero**: 2.937 (ene) → 1.570 (mar) → 1.166 (may) →
   361 (jun) → 143 (jul) → **36 (ago)**. Es marketing, no CRM.
3. **El 97,4 % de los leads que sí llegaron nunca recibió un mensaje**: de 25.226 con teléfono,
   sólo **650** llegaron a hablar por WhatsApp. En 30 días: 143 leads → 22 hablaron (15,4 %).

Y una de operación que ya tiene mecanismo: **223 personas muestran un chip de curso que no nombra
ningún curso** («¿Estás listo para ganar esta elección?» 148, «Chatea con nosotros» 26, «Adquiérelo
ahora» 25…). Se mapean por `adId` con `cd server && npm run cursos:gaps` (ADR 0019) — no hace falta
tocar código.

### Del operador (minutos, destraban features ya construidas)
1. **SMTP para Correos**: cargar `SMTP_HOST/PORT/USER/PASS/FROM` en `server/.env` del VPS (la
   cuenta sale de mail.goberna.us / VPS2) + `systemctl restart hermes`. La UI se enciende sola.
2. **Landings al Dashboard**: en Bravo, poner `contact_webhook_url` de cada tenant con la URL de
   `ssh deploy@161.132.39.165 'cat /srv/hermes/.landing-webhook-url'` (runbook §9).
3. **Cerrar la sesión de WhatsApp de la laptop** (el teléfono tiene 2 dispositivos vinculados;
   debe atender solo el VPS). Dev local: `WHATSAPP_TRANSPORTE=falso`.
   ⚠️ Esto era por `51986394450`, que se retiró el 11-ago. Sigue valiendo como higiene: la credencial
   de una línea no va en una laptop, y esa sesión sigue existiendo en el teléfono.
4. **Certificado de code signing Windows** (OV ~US$100-300/año) para matar el aviso de SmartScreen.

### De código (en orden sugerido)
0. 🔴 **Traer los leads de landing al Pipeline** — el estado «Sin contactar» (24.576 históricos, 121
   en 30 días). Es el punto **#4** de `docs/plan-pipeline-por-canal.md`, el **único que toca la
   ingesta** y el único que mueve la aguja del negocio: hoy el Pipeline ordena el **2,6 %** del
   embudo. Los datos ya están en `events` (`source='icarus_landing'`, 25.510 filas con dato de hoy);
   falta el proyector hacia la cola. ⚠️ **No mezclar con el padrón** (ADR 0035): son otro universo y
   ya tienen su vista.
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
  de Electron que están ahí ya no se pueden reconstruir desde `main` (ADR 0039): sacarlos de la
  carpeta de descargas, o alguien va a instalar una app que nadie puede volver a compilar.**
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
