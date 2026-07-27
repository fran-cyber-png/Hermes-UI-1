# ADR 0022 — Hay un staging entre `main` y las vendedoras

- **Fecha:** 2026-07-24
- **Estado:** aceptado
- **Decide:** el hueco declarado en `docs/despliegue-continuo.md` §8 («No hay staging»)

## Contexto

`docs/despliegue-continuo.md` §8 lo decía sin vueltas: **«No hay staging. `main` va directo a las
vendedoras.»** La red era CI —lint, typecheck, build, 303 tests— y que el front fuera reversible en
segundos.

El problema con esa red es qué clase de fallo atrapa. CI prueba **el código**: que compile, que las
funciones puras hagan lo suyo, que el SQL de la cola devuelva lo esperado contra una base efímera.
No prueba **el despliegue**: que el proceso levante con el `.env` que hay, que la migración se
aplique sobre una base **con datos**, que la cola responda contra la base real, que el perímetro de
auth siga cerrado después del cambio.

Y lo único que el CD verificaba después de desplegar era `/health`, que contesta `{"ok":true}` en
cuanto Express escucha. Con la base a medio migrar, `/health` sigue diciendo que sí y la vendedora
abre una pantalla vacía.

Dicho de otra forma: **el primer entorno que ejecutaba el código nuevo era el de las vendedoras.**

Con migraciones automáticas (ADR 0021) eso pasaba de incómodo a inaceptable: una migración que se
aplica sola sobre producción sin haberse aplicado antes en ningún lado es exactamente el cambio que
no se puede deshacer con un `mv`.

## Decisión

**Un entorno de staging en la misma máquina, con su propia base, que recibe cada push a `main` antes
que producción.**

| | Producción | Staging |
|---|---|---|
| Checkout | `/srv/hermes` | `/srv/hermes-staging` |
| Servicio | `hermes` (`:4110`) | `hermes-staging` (`:4111`) |
| Postgres | `hermes_db` (`:5438`) | `hermes_staging_db` (`:5440`) |
| WhatsApp | `whatsmeow`, número real | `falso` — no sale un mensaje |
| Meta / SMTP / Ivi | configurados | vacíos: fail-closed |
| Expuesto a internet | sí, `hermes-api.goberna.us` | **no**, solo loopback |
| `NODE_ENV` | `production` | `production` — a propósito |

Cinco decisiones que la definen:

### La base de staging PERSISTE

Es la diferencia con la base de tests, que vive en `tmpfs` y muere con cada corrida. Staging existe
para que una migración se aplique sobre una base **que ya tiene historia**, que es el único ensayo
que vale: una migración sobre una base vacía no prueba casi nada (no hay filas que violen un
`NOT NULL`, no hay índice que tarde, no hay dato que no encaje en el tipo nuevo).

### No se expone a internet

No hay nginx, ni DNS, ni certificado. Los smoke tests corren en el runner de Actions, que vive en
VPS1: le pegan a `127.0.0.1:4111` directo. Un subdominio más sería una superficie más que mantener y
proteger, a cambio de nada que hoy se necesite.

### `NODE_ENV=production`, aunque no sea producción

Si staging corriera en modo dev, las rutas de simulación (`/api/whatsapp/_sim`, `_dev`) estarían
abiertas ahí y cerradas en producción — y el ensayo dejaría de ser fiel justo en el eje de seguridad.
El smoke verifica que esas rutas den 401 en staging, igual que en producción.

### WhatsApp es el transporte falso, sin excepción

Staging tiene el código que manda mensajes de WhatsApp. Si tuviera la sesión real, un test
—o un dedo— podría escribirle a una persona de verdad desde un entorno de pruebas. No hay
`.wa-sessions/` en staging y `WHATSAPP_TRANSPORTE=falso`.

Cerberus sí apunta al real, y es deliberado: el smoke prueba que el handshake CSRF sigue vivo
**rechazando credenciales inválidas**. Nunca registra una venta.

### Secretos propios

`HERMES_SESSION_SECRET` y `HERMES_ADMIN_SERVICE_TOKEN` son distintos de los de producción. Un token
firmado en staging no vale en producción. Eso es lo que permite que el smoke firme un token de
prueba y llegue a las rutas de verdad sin abrir un agujero.

## Consecuencias

**A favor**

- Las migraciones se aplican en un lugar donde romperlas no le cuesta nada a nadie.
- El smoke funcional prueba lo que `/health` no puede: la cola, el radar, la agenda, el SSE, el
  perímetro ruta por ruta.
- Ya encontró algo real en su primer uso: `notas_texto_gin_idx` estaba en producción y en ninguna
  base nueva (ADR 0021).

**En contra**

- Un servicio y una base más que mantener en VPS1 (~30 MB de RAM en reposo, el disco de una copia
  del repo).
- **Staging comparte máquina con producción.** Es la deuda consciente de esta decisión: un staging
  que se coma la RAM o el disco afecta a las vendedoras. Se aceptó porque la alternativa —otro
  servidor— cuesta plata y coordinación, y porque el riesgo real de este servicio es bajo (mismo
  perfil de recursos que producción, que hoy usa 10 de 30 GB).
- Cada push a `main` tarda ~3 minutos más antes de llegar a producción.

**Lo que NO resuelve**

- **No hay datos realistas.** La base de staging arranca vacía y se llena con lo que los tests dejen.
  Una migración que tarde sobre 2 millones de filas va a parecer instantánea acá. Sembrar staging con
  un dump anonimizado de producción es el próximo paso obvio, y no está hecho.
- **No mide.** Si un cambio empeora la latencia, staging no lo dice.
- **No prueba la cáscara.** Tauri/Electron siguen sin entrar al pipeline.

## Alternativas descartadas

- **Otro servidor.** Más fiel (aísla el riesgo de recursos) pero cuesta plata y no resuelve nada que
  hoy duela.
- **Docker Compose efímero por corrida.** Barato y aislado, pero la base arrancaría vacía cada vez —
  y perder la historia mata justamente el ensayo que motivó todo esto.
- **Desplegar a producción en horario muerto y mirar.** Es lo que se venía haciendo. Depende de que
  alguien mire, y el incidente de los 26 commits de atraso mostró qué pasa cuando nadie mira.
