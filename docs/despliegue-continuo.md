# Despliegue continuo — cómo llega el código a las vendedoras

> Por qué el front se despliega solo y el server no, qué se verificó para que sea seguro, y qué
> hacer cuando algo sale mal. Escrito el **2026-07-22**, cuando descubrimos que producción llevaba
> **26 commits de atraso** — precisamente porque el despliegue era manual.

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

| | Front (no toca `server/`) | Server |
|---|---|---|
| **Cuándo** | Automático al mergear a `main`, después de CI verde | Botón en Actions |
| **Workflow** | `ci.yml` → job `desplegar-front` | `desplegar-server.yml` |
| **Costo para la vendedora** | Ninguno. Cero downtime | Pierde la sesión de Cerberus |
| **Rollback** | `mv dist dist.roto && mv dist.anterior dist` — segundos | `git checkout <sha> && build && restart` |

La automatización se reparte por **costo**, no por conveniencia: lo que no le cuesta nada a nadie se
mantiene solo (y así el drift no vuelve); lo que interrumpe a una persona lo decide una persona.

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

### El schema de la base

Si el rango toca `server/src/db/schema.ts`, **los dos workflows frenan**.

Drizzle no tiene migraciones versionadas en este repo (deuda declarada en ADR 0001): `db:push`
compara el schema contra la base viva y aplica lo que le parece —incluyendo **borrar una columna**—
sin plan y sin backup. Automatizar eso contra producción es de las pocas cosas que pueden perder
datos de verdad.

El camino es mirar lo que propone y decidir:

```bash
ssh deploy@161.132.39.165 'cd /srv/hermes/server && npm run db:push'
```

Y después disparar el despliegue.

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

- **No hay staging.** `main` va directo a las vendedoras. La red es CI (lint · typecheck · build ·
  303 tests) y que el front sea reversible en segundos.
- **No hay smoke test funcional**: se verifica que el sitio sirva el build nuevo y que `/health`
  conteste, no que la cola cargue o que se pueda responder un WhatsApp.
- **No avisa a nadie.** El resultado vive en el resumen del run de Actions; nadie recibe un mensaje.
- **No mide.** Si el deploy empeora la latencia, hay que notarlo a ojo.

Los cuatro son mejoras posibles. Ninguno es razón para no tener CD: hoy la alternativa es lo que ya
pasó — 26 commits de atraso que nadie vio.
