# Checklist del 3-ago — las tres vendedoras pasan a trabajar SOLO en Hermes

**Quién lo corre**: el dueño (o sistemas), una vez por vendedora, el lunes 3-ago a primera hora.
**Con qué**: el script `checklist.mjs` de esta carpeta (`MODO=real`) + los pasos manuales marcados 🖐.
**Credenciales**: las pone el dueño en el entorno al correr. Jamás en un archivo, jamás en este doc.

> Ensayado en local el 28-jul con transporte falso y Cerberus apuntado a un puerto muerto:
> 9/9 pasos automatizables en verde. Evidencia en `evidencia/` (detalle al final).

---

## 0 · Antes de que llegue nadie (una sola vez, el dueño o sistemas)

| # | Verificación | OK si… | Cómo |
|---|---|---|---|
| 0.1 | Prod sirve el front y el perímetro está cerrado | `/` da 200 · `/health` da `{"ok":true}` · `/api/conversaciones` sin token da **401** | `curl -s https://hermes-api.goberna.us/health` etc. (verificado 28-jul: los tres OK) |
| 0.2 | Qué sha corre VPS1 | Decisión consciente: al 28-jul corre `f1d092c` y `main` está en `7191c01` — **el fix #106 (la sesión de Cerberus sobrevive al reinicio) NO está en prod**. Si se quiere para el lunes: botón N5 en Actions **antes** del 3-ago, nunca esa mañana | `ssh deploy@161.132.39.165 'cd /srv/hermes && git log --oneline -1'` |
| 0.3 | Las TRES líneas viven y tienen rótulo | `GET /api/whatsapp/lineas` (ya logueada una vendedora, o desde la app) lista las tres con `estado: conectado` | En la app: el segmentado de la cola muestra «Todas · Ventas Perú · Walter Ventas · Venta Peru» |
| 0.4 | 🖐 El mapa etiqueta ↔ vendedora está confirmado | El dueño confirma qué etiqueta es de quién. Supuesto a validar: Luz → **Ventas Perú** · Walter → **Walter Ventas** · Sindy → **Venta Peru** | De palabra + anotarlo acá |
| 0.5 | La auto-respuesta sigue APAGADA | El chip de la cabecera dice **Apagada** (decisión del 27-jul, issue #166: no se prende sin leerlo) | A la vista en la cabecera |

---

## 1 · Por vendedora — Luz · Walter · Sindy (tres corridas del script + 3 pasos manuales)

Correr el script una vez por vendedora, con su credencial y SU línea:

```bash
cd <esta carpeta>
MODO=real HERMES_URL=https://hermes-api.goberna.us \
  USUARIO=<usuario de Cerberus> CLAVE=<su clave> \
  LINEA='Walter Ventas' SALIDA=./evidencia-3ago/walter \
  node checklist.mjs
```

(`LINEA` = la etiqueta confirmada en 0.4. `CONTACTO='Nombre'` opcional para abrir una conversación
específica.) El script deja un screenshot por paso y un `resumen.json` con OK/FALLA.

| Paso | Qué hace / qué clickear | OK si… | FALLA si… | Evidencia |
|---|---|---|---|---|
| 1. Login | Su usuario y clave de Cerberus (los mismos del ERP), botón **Entrar** | Entra y se pinta la app con el riel de vistas | «Usuario o contraseña incorrectos» (revisar credencial) · «Cerberus no responde» (avisar a sistemas: es Cerberus, no Hermes) | `01-login.png` · `02-login-ok.png` |
| 2. La cola, todas las líneas | Riel → **Mensajes**. Mirar la barra de filtros | El segmentado muestra **Todas · Ventas Perú · Walter Ventas · Venta Peru** con «Todas» activa, y la cola trae conversaciones de las tres | Falta una línea (esa línea no arrancó en el server — 0.3) o el segmentado no está (solo hay 1 línea viva) | `04-mensajes-todas.png` |
| 3. SU línea | Click en el chip de SU etiqueta | El chip queda azul y la cola se recorta a sus conversaciones; el contador «N en cola» baja | El recorte no cambia nada o muestra conversaciones de otra línea | `05-cola-linea-*.png` |
| 4. Abrir una conversación | Click en una fila de su cola | Hilo al centro, ficha del contacto a la derecha, composer abajo con su nombre | Hilo vacío estando la fila con texto · ficha eternamente en «Buscando…» (tiene techo de 12 s: después dice el error) | `06-conversacion.png` |
| 5. Registrar venta — hasta el modal | 🖐 Filtrar con el chip **«Ya compraron»**, abrir una con banda verde **Cliente**, pie del panel → **Registrar venta** | El modal «Registrar venta» abre; si la persona tiene interés registrado, **el curso ya viene puesto**. Salir con **Esc** — acá NO se confirma | El pie dice «Sin la ficha no se puede registrar una venta» con Cerberus vivo (revisar el teléfono en Cerberus: causas A/B/C del #196) | `07-venta-modal.png` |
| 6. Cabecera | Mirar arriba a la derecha | Semáforo de WhatsApp con SU número en verde (`conectado`) + chip de auto-respuesta **Apagada · Supervisada** a la vista | Semáforo en «desconectado»/«suspendido» (parar y avisar) · chip en rojo «modo RETIRADO» o «falta la migración» | `08-cabecera.png` |

**El cierre de la mañana** 🖐: una sola vez (no por vendedora), el dueño elige UNA venta real del día
y la confirma de punta a punta desde el modal — esa es la prueba de que el circuito
Hermes → Cerberus → webhook → embudo cierra de verdad. Todas las demás ventas del día ya se
registran acá: ese es justamente el cambio del lunes.

**Caso «Cerberus caído» del login**: NO se provoca en prod (habría que tirar Cerberus). Quedó
ensayado en local con la evidencia `02-login-cerberus-caido.png`: el error tipado dice «Cerberus no
responde. Esperá un minuto…», no un genérico. Si el lunes aparece ese cartel, el problema es
Cerberus y no la credencial — eso es exactamente lo que el cartel distingue.

---

## 2 · Qué se ensayó HOY en local (28-jul) y cómo reproducirlo

Stack de ensayo — **sin tocar prod, sin WhatsApp real, sin la base dev del repo**:

```bash
# 1. Postgres local (el contenedor de siempre) + una base FRESCA solo para esto
docker compose up -d --wait
docker exec meta_escuela_db psql -U meta_escuela -d meta_escuela \
  -c "CREATE DATABASE hermes_ensayo OWNER meta_escuela;"
cd server && env DATABASE_URL='postgresql://meta_escuela:meta_escuela_dev@127.0.0.1:5434/hermes_ensayo' \
  npm run db:migrate

# 2. Rotular las tres líneas (lo que en prod empuja Cerberus por /api/admin)
docker exec meta_escuela_db psql -U meta_escuela -d hermes_ensayo -c \
  "INSERT INTO numeros_wa (numero, etiqueta, proposito) VALUES
   ('51900000001','Ventas Perú','escuela'),
   ('51900000002','Walter Ventas','vendedora'),
   ('51900000003','Venta Peru','vendedora');"

# 3. El server de ensayo: transporte FALSO, tres líneas falsas, Cerberus a un puerto MUERTO
#    (:4199 porque el dev del usuario ya ocupa :4100 — no tocarlo)
cd server && env PORT=4199 \
  DATABASE_URL='postgresql://meta_escuela:meta_escuela_dev@127.0.0.1:5434/hermes_ensayo' \
  WHATSAPP_TRANSPORTE=falso \
  WHATSAPP_NUMEROS_FALSOS=51900000001,51900000002,51900000003 \
  CERBERUS_BASE_URL=http://127.0.0.1:9908 \
  AUTO_RESPUESTA=off LAZO_RELOJ= META_ACCESS_TOKEN= META_APP_ID= \
  npm run dev

# 4. Sembrar 4 conversaciones repartidas en las 3 líneas (ruta de dev, solo existe con el falso)
curl -X POST localhost:4199/api/whatsapp/_dev/simular -H 'content-type: application/json' \
  -d '{"telefono":"51933333333","texto":"Hola Walter, quiero información","nombre":"Carla Núñez","numeroPropio":"51900000002"}'
# (ídem para las otras líneas)

# 5. El front + el token de ensayo (firmado con el secreto LOCAL — no hay login sin Cerberus)
env VITE_API_URL=http://localhost:4199 npx vite --port 5173 --strictPort
cd server && npx tsx -e "import('dotenv/config').then(() => import('./src/auth/sesion.ts')).then(m => process.stdout.write(m.firmarSesion('ensayo')))" > ../.token-ensayo

# 6. La corrida
HERMES_URL=http://localhost:5173 HERMES_TOKEN_FILE=.token-ensayo \
  LINEA='Walter Ventas' CONTACTO='Carla Núñez' node checklist.mjs
```

Resultado: **9/9 pasos OK** (`evidencia/resumen.json`). Los screenshots:

| Archivo | Qué muestra |
|---|---|
| `01-login.png` | El formulario de login (escudo, usuario, contraseña) |
| `02-login-cerberus-caido.png` | **El error tipado con Cerberus caído** — «Cerberus no responde…», en rojo, no un genérico |
| `03-app-abierta.png` | La app pintada ya con el token guardado (ADR 0007) |
| `04-mensajes-todas.png` | La cola con «Todas»: 4 conversaciones de las 3 líneas + segmentado completo |
| `05-cola-linea-walter-ventas.png` | «Walter Ventas» activo: la cola recortada a 1 (solo Carla Núñez) |
| `06-conversacion.png` | Hilo abierto + panel derecho con su estado honesto («No se pudo saber — Cerberus no respondió») |
| `07-venta-estado-del-pie.png` | Sin ficha de Cerberus no hay botón de venta — el pie lo dice, no se queda mudo |
| `08-cabecera.png` | Semáforo verde de la línea + chip **Apagada · Supervisada** |
| `09-final.png` | La mesa completa al cierre |
| `10-popover-reconectar-cerberus.png` | (bonus) El popover del #106: «Hermes perdió tu sesión de Cerberus» con el campo para reconectar |

---

## 3 · El gap entre el ensayo y la corrida real (leer antes del lunes)

| Qué | En el ensayo (28-jul) | El 3-ago |
|---|---|---|
| Login | No hay: Cerberus apuntado a un puerto muerto (probó el error tipado); se entró con token firmado local | Login real de cada vendedora contra Cerberus — **primera vez que se prueba con sus credenciales** |
| Modal de venta | No se llegó: sin Cerberus no hay ficha ⇒ no hay botón (y eso se verificó como estado honesto) | Con ficha viva: banda **Cliente** → botón → modal → **curso preseleccionado**. Es el paso con más incógnita del lunes |
| Curso preseleccionado | No verificable sin el catálogo vivo de Cerberus | Verificar en el screenshot `07-venta-modal.png` de cada corrida |
| Líneas | 3 transportes falsos con los rótulos sembrados a mano | whatsmeow real; los rótulos los empuja Cerberus. Si falta una línea en el segmentado, esa línea no arrancó (paso 0.3) |
| Datos | 4 conversaciones sembradas | Las ~2.000 reales — el conteo del chip y los tiempos de carga son otros |
| Panel derecho | El rediseño de `main` (`77997ac`: timeline + enviar rápido) | Lo que corra prod ese día — si no se deploya (0.2), el panel se ve distinto que en estos screenshots |
| Sesión de Cerberus tras reinicio | El popover de reconexión se fotografió | Con `f1d092c` en prod, un reinicio del server pide reconectar para vender; el fix (#106) está en `main` sin deployar |

## 4 · Verificación de prod, solo lectura (28-jul)

- `https://hermes-api.goberna.us/` → **200** (front servido) · `/health` → `{"ok":true}`
- `/api/conversaciones` sin token → **401** limpio («sesión inválida o expirada…») — perímetro OK
- `POST /api/auth/login` con body vacío → **400** (valida antes de tocar Cerberus)
- VPS1 corre **`f1d092c`** («fix(#50): una línea que no arranca ya no se lleva puesto el proceso entero») —
  ancestro de `main`; `main` local está en **`7191c01`** con 3 commits encima:
  `73eb82d` (docs) · `3110adf` (maqueta del panel, mirable sin nada vivo) · `7191c01` (**fix #106**:
  la sesión de Cerberus sobrevive al deploy). El filtro por línea (#50/#207) **sí está** en prod.
