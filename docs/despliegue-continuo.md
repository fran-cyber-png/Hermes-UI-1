# Despliegue continuo — cómo llega el código a las vendedoras

> Por qué el front se despliega solo y el server no, qué se verificó para que sea seguro, y qué
> hacer cuando algo sale mal. Escrito el **2026-07-22**, cuando descubrimos que producción llevaba
> **26 commits de atraso** — precisamente porque el despliegue era manual.
>
> **Actualizado el 2026-07-24**: el pipeline pasó a tener **cinco niveles** y apareció un
> **staging** entre `main` y las vendedoras (ADR 0022). Las migraciones dejaron de frenarlo
> (ADR 0021). Lo que sigue vigente de la versión original: por qué el front puede ser automático
> y el server no (§2 y §3), y las tres reglas que lo hacen seguro (§4).

---

## 0. El pipeline de un vistazo

```
PR o push          push a main                     botón en Actions
    │                   │                                 │
    ▼                   ▼                                 ▼
 N1 rápido  ──▶  N2 front  ──┬──▶ N3 STAGING ──▶ N4 front a prod    N5 server a prod
 ~45 s            ~2 min     └──▶ N2b base        ~1 min             ~3 min
 secretos         lint            tests SQL       sin restart        con restart
 expand-only      typecheck       PARIDAD del     cero downtime      respalda, migra,
 journal          build           schema                             smoke y revierte
 db:check         tests front     despliega,                         solo si falla
 tests server                     migra y smoke
```

| Nivel | Qué verifica | Cuándo | Dónde |
|---|---|---|---|
| **N1** | ningún secreto en el árbol · migraciones expand-only · journal monótono · `db:check` · typecheck y **los 820 tests puros del server** | toda corrida | `ci.yml` |
| **N2** | lint · typecheck · build · tests del front · `npm audit` | toda corrida | `ci.yml` |
| **N2b** | tests con Postgres efímera — el SQL de la cola y el radar, **y la paridad del schema** | toda corrida | `ci.yml` |
| **N3** | **staging**: verifica el estado de la base, despliega, migra sobre una base con historia, smoke funcional autenticado | push a `main` | `ci.yml` |
| **N4** | front a producción, sin reiniciar el proceso | solo si N3 pasó | `ci.yml` |
| **N5** | server a producción: respalda, verifica, migra, reinicia, smoke, revierte solo si falla | botón | `desplegar-server.yml` |

El orden no es decorativo: **lo barato falla primero**. Nada llega a tocar una base sin haber pasado
por los niveles anteriores.

> **Por qué los jobs se agrupan así.** El runner self-hosted es **uno solo**: se serializan aunque
> el grafo los dibuje en paralelo, y cada job extra paga su propio `npm ci`. Por eso la división es
> por **conjunto de dependencias** (server / front / base) y no por temática: son tres `npm ci` en
> vez de cinco. Efecto lateral bienvenido: los 820 tests del server tardan 3 s, así que caben en el
> nivel «rápido» y la mayor parte de la suite falla en los primeros 45 segundos.

---

## 1. El hallazgo que motivó esto

`docs/estado.md` decía «CRM completo **EN PRODUCCIÓN**». Al verificarlo contra VPS1:

- `git -C /srv/hermes rev-parse HEAD` → `17648e4`, **26 commits atrás de `main`**.
- El sitio vivo servía `assets/index-2_UFlZcN.js`, un build distinto al de `main`.

Las vendedoras no tenían el rediseño «Cierre de edición», ni la urgencia de 6 niveles, ni la ventana
de 30 días de la cola. **Nadie lo había notado.** Un despliegue manual sin CD no falla ruidosamente:
falla en silencio, y el silencio dura meses.

---

## 2. La observación que hace esto posible

**El server lee `dist/` del disco en cada request.** `express.static(DIST)` y el `sendFile` del
fallback SPA (`server/src/index.ts:99-106`); lo único que se evalúa al arrancar es que
`dist/index.html` **exista**.

Consecuencia: **reemplazar el contenido de `/srv/hermes/dist/` actualiza la UI al instante, sin
reiniciar el proceso.**

Y no reiniciar importa más de lo que parece. `systemctl restart hermes`:

- corta el **SSE** (`/api/stream`) de todas las pantallas abiertas;
- obliga a **whatsmeow** a reconectar la sesión de WhatsApp;
- y —lo peor— **tira las sesiones de Cerberus**, que viven en un `Map` de proceso
  (`server/src/cerberus/sesionStore.ts:15`). El token de Hermes dura 14 días, pero la cookie de
  Django no sobrevive el restart: cada vendedora logueada se encuentra un **409 «la sesión de
  Cerberus expiró»** la próxima vez que abra el formulario de venta.

O sea: reiniciar por un cambio de CSS le cuesta a la vendedora una venta a medio registrar.

---

## 3. La postura: automatizar lo barato, decidir lo caro

| | Staging | Front de prod (no toca `server/`) | Server de prod |
|---|---|---|---|
| **Cuándo** | Automático, cada push a `main` | Automático, solo si staging quedó verde | Botón en Actions |
| **Workflow** | `ci.yml` → `n3-staging` | `ci.yml` → `n4-prod-front` | `desplegar-server.yml` → `hermes-deploy.sh` |
| **Costo para la vendedora** | Ninguno: ni sabe que existe | Ninguno. Cero downtime | Pierde la sesión de Cerberus |
| **Migraciones** | Se aplican solas | No corresponde | Se aplican, con respaldo previo |
| **Rollback** | Se pisa en el próximo push | `mv dist dist.roto && mv dist.anterior dist` — segundos | `sudo hermes-deploy --rollback`, y el script ya lo intenta solo |

La automatización se reparte por **costo**, no por conveniencia: lo que no le cuesta nada a nadie se
mantiene solo (y así el drift no vuelve); lo que interrumpe a una persona lo decide una persona.

Lo que agregó staging a esa postura: **antes, «automatizar lo barato» significaba que el front
llegaba a las vendedoras sin que nadie hubiera ejecutado ese código en ningún lado.** Ahora lo barato
se automatiza igual, pero pasando por un lugar donde romperlo no le cuesta nada a nadie (ADR 0022).

### El despliegue del server es un script, no YAML

`deploy/vps1/hermes-deploy.sh`, versionado en el repo. El workflow lo instala desde el checkout en
cada corrida y lo llama; por SSH corre exactamente lo mismo:

```bash
ssh deploy@161.132.39.165 'sudo hermes-deploy --dry-run'   # qué haría, y qué migraciones trae
ssh deploy@161.132.39.165 'sudo hermes-deploy'             # promueve origin/main
ssh deploy@161.132.39.165 'sudo hermes-deploy --rollback'  # vuelve al último SHA sano
```

Cuando «desplegar a mano» y «desplegar por pipeline» son dos códigos distintos, divergen — y la vía
que se usa a las 2 AM termina siendo la que nadie probó.

---

## 4. Las tres reglas que hacen que sea seguro

### 4.1 El diff se calcula sobre el rango completo sin desplegar, nunca commit por commit

```
git diff --name-only <sha-desplegado>..<sha-nuevo> -- server/
```

Si en **todo** ese rango se tocó `server/`, es despliegue con restart — aunque el último commit sea
solo de CSS.

**Por qué importa**: si se clasificara commit por commit, un cambio de front posterior a uno de
server se desplegaría solo y dejaría **el front adelante del server**. Un front que espera campos que
el server viejo no manda se rompe en manos de la vendedora. Con el rango completo, eso es imposible
por construcción.

### 4.2 El SHA desplegado del server no es el del checkout

El proceso corre con el código que había **al último restart**. Actualizar el checkout sin reiniciar
no cambia el server que está corriendo.

Por eso el estado se guarda aparte, en `~deploy/.hermes-despliegue/server`, y **fuera del checkout**
para no ensuciarlo. En un despliegue de front la marca sí se actualiza — y es honesto, porque la
clasificación ya garantizó que los archivos de `server/` son idénticos entre los dos SHAs.

Primera corrida sin marca: cae a `git rev-parse HEAD` del checkout.

### 4.3 El build se arma aparte y se cambia de lugar al final

`vite build` **vacía el directorio de salida antes de escribir**. Hacerlo sobre `dist/` dejaría la
app sirviendo 404 durante todo el build — justo lo contrario de «cero downtime».

```bash
npx vite build --outDir dist.nuevo --emptyOutDir
mv dist dist.anterior && mv dist.nuevo dist    # el cambio real: microsegundos
```

Efecto lateral bienvenido: `dist.anterior` **es el rollback**, y está a un `mv` de distancia.

---

## 5. Lo que se verificó antes de escribir esto

Todo contra VPS1, el 2026-07-22:

| Qué | Resultado |
|---|---|
| Usuario del runner | `deploy` |
| Dueño de `/srv/hermes` | `deploy:deploy` — escribible sin sudo |
| ¿Es un checkout git? | sí |
| `sudo -n systemctl` (sin contraseña) | funciona |
| `dist/index.html` existe | sí |

**El runner ya vive en VPS1** (label `vps1-hermes`, servicio
`actions.runner.Goberna-Lab-hermes.vps1-hermes`). No hace falta SSH, ni claves de despliegue, ni
secretos en GitHub: el workflow escribe en el disco local.

---

## 6. Lo que NO automatiza, a propósito

### ~~El schema de la base~~ — resuelto el 2026-07-24 (ADR 0021)

> Lo que decía acá: «si el rango toca `server/src/db/schema.ts`, **los dos workflows frenan**»,
> porque `db:push` compara contra la base viva y aplica lo que le parece, sin plan y sin backup.
> Era cierto, y significaba que **el caso más común de cambio real era justo el que no se podía
> automatizar**.

Y era peor que eso: **ese gate no se podía satisfacer.** Comparaba el SHA guardado en
`~/.hermes-despliegue/server` contra `main`, así que correr `db:push` a mano no cambiaba el diff —
volvía a frenar, igual. La noche del 26-jul el deploy terminó haciéndose entero por SSH, a mano, por
eso exactamente. Un gate que no se puede satisfacer no protege: enseña a esquivarlo.

Ahora el schema viaja en **migraciones versionadas**: un `.sql` revisable en el PR que lo introduce.
El pipeline las aplica solo, pero nunca a ciegas:

1. **N1** verifica el journal (que el `when` sea monótono — si no, drizzle saltea en silencio) y que
   la migración sea **expand-only**.
2. **N2b** verifica la **paridad**: migrar desde cero tiene que dar el mismo schema que declara
   `src/db/*.ts`. O sea, no se puede cambiar el schema sin traer su migración.
3. **N3** la aplica en **staging**, sobre una base con historia, y corre el smoke funcional. Si
   rompe, rompe ahí.
4. **N5** respalda la base (`/srv/respaldos-hermes/`), verifica con `db:estado` que la base y el
   repo se correspondan, y recién entonces migra producción.

Lo que sigue siendo humano es **el momento**: N5 es un botón, porque reiniciar el server cuesta las
sesiones de Cerberus. Pero ya no hay que ir a correr nada por SSH antes de apretarlo.

El cómo, completo, en **`docs/migraciones.md`**.

### El instalador de Windows

Sigue siendo `workflow_dispatch` (`tauri-windows.yml`). Con OTA casi nunca hace falta: la cáscara
solo abre `https://hermes-api.goberna.us` y muestra lo que el server sirva. El `.exe` se regenera
para **máquinas nuevas** o para refrescar el respaldo offline (ADR 0003 y 0007).

### El deploy desde ramas

Solo `main` despliega. `desplegar-server.yml` acepta un SHA a mano, pero por diseño se usa para
**volver atrás**, no para adelantarse.

---

## 7. Cuando algo sale mal

### El front quedó roto

```bash
ssh deploy@161.132.39.165 'cd /srv/hermes && mv dist dist.roto && mv dist.anterior dist'
```

Sin restart. Segundos. La vendedora ni se entera.

### El server no levanta

`desplegar-server.yml` espera hasta 60 s a que `/health` conteste; si no, falla y escribe el rollback
en el resumen del run, con el SHA anterior ya sustituido.

```bash
ssh deploy@161.132.39.165 'cd /srv/hermes && git checkout --force <sha-anterior> && \
  npm ci && npm run build && sudo systemctl restart hermes'
```

### «/srv/hermes tiene cambios locales sin commitear»

Los dos workflows frenan si el checkout de producción está sucio (regla dura #6: ante drift
prod≠git, avisar antes de tocar). Alguien editó archivos en el servidor. **Mirá qué son antes de
descartarlos** — puede ser un parche de emergencia que nadie commiteó:

```bash
ssh deploy@161.132.39.165 'cd /srv/hermes && git status --short -uno && git diff'
```

El chequeo ignora los archivos sin trackear a propósito (`-uno`): `dist.anterior` y compañía son
artefactos, no drift.

---

## 8. Lo que este CD no arregla

Los cuatro huecos que esta sección declaraba el 2026-07-22 se cerraron el 2026-07-24:

- ~~**No hay staging.**~~ Lo hay: `/srv/hermes-staging`, `:4111`, base propia. Cada push a `main`
  pasa por ahí antes que producción (ADR 0022).
- ~~**No hay smoke test funcional.**~~ `npm run humo` verifica el perímetro de auth ruta por ruta, el
  front servido, el login contra Cerberus y —autenticado— la cola, el radar, la agenda y el SSE.
  Corre en staging con sesión y en producción en modo público.
- ~~**No avisa a nadie.**~~ Un job de resumen consolida los cinco niveles, y un deploy fallido a
  producción **abre un issue** con el estado forense. (Un aviso a Mattermost sigue sin estar: se
  evaluó y se descartó por ahora.)
- **No mide.** Sigue abierto. Si un cambio empeora la latencia, hay que notarlo a ojo.

### Lo que sigue faltando

- **Staging no tiene datos realistas.** Su base arranca vacía y se llena con lo que los tests dejen.
  Una migración que tarde diez minutos sobre dos millones de filas va a parecer instantánea acá.
  Sembrarla con un dump anonimizado de producción es el próximo paso obvio.
- **Staging comparte máquina con producción.** Un staging que se coma la RAM o el disco afecta a las
  vendedoras. Deuda consciente (ADR 0022).
- **La cáscara no entra al pipeline.** Tauri se sigue empaquetando aparte y a mano (`empaquetar:mac`
  local, `tauri-windows.yml` a botón). Y sus tests **tampoco son gate de PR**: `ci.yml` corre entero
  en el runner de VPS1, que no tiene Rust ni las libs de sistema de Tauri (ADR 0040 §6).
- **No hay despliegue por tags ni versionado.** Se despliega el HEAD de `main` o un SHA suelto.
- **CORS sigue en `*`** (issue #94). No es del CD, pero es la deuda de perímetro que queda viva.
