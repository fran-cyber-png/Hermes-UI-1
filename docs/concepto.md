# Hermes — la mesa del vendedor

> **Reemplaza a** `goberna-crm-wsp/plan-implementacion.md` (2026-07-20), cuyo alcance era una extensión
> de Chrome solo para WhatsApp. Ese plan asumía que Cerberus no tenía API y que los canales de Meta
> estaban por construirse. Las dos cosas resultaron falsas al revisar el código.

## 1. Qué es

Una app de escritorio donde un vendedor atiende **toda** la gente que levantó la mano, sin saltar
entre ventanas. A la izquierda la cola (Facebook, Instagram, Messenger). A la derecha, WhatsApp Web
vivo. La ficha del contacto al lado del chat, no en otra pantalla.

## 2. Lo que cambió respecto del plan anterior

| Suposición del plan viejo | Lo que se verificó en el código (21-jul-2026) |
|---|---|
| "Hay que construir la captura de canales" | Ya existía: `interactionsIngestor.ts` captura comentarios FB/IG y DMs de Messenger por Graph API v25.0 |
| "Solo WhatsApp por ahora" | IG y Messenger ya entran por API **oficial**, y además traen los **comentarios** |
| "La extensión es lo primero" | La primera pantalla es la **bandeja de comentarios**: 94.371 interacciones ya capturadas, ~17.000 pidiendo info, cero atendidas |
| "Un kiosco impide robar data" | Descartado: lo derrota una cámara de celular. Ver §6 |

## 3. Arquitectura

```
  FUENTES (adaptadores)                    HERMES                       CERBERUS
  ─────────────────────                    ──────                       ────────
  Graph API oficial ─┐
   · comentarios FB  │                 ┌──────────────┐
   · comentarios IG  ├───────────────► │ event store  │            ┌──────────────┐
   · DMs Messenger   │                 │  (append-    │            │  ERP: ventas │
                     │                 │   only)      │──────────► │  cuotas      │
  WhatsApp Web DOM ──┘                 │      ↓       │  registrar │  tesorería   │
   (interino, hasta                    │ interactions │   venta    │  matrícula   │
    la Cloud API)                      └──────────────┘            └──────────────┘
                                              ↓
                                       la cola del vendedor
```

**Dos asimetrías, a propósito:**

1. ~~**Meta entra por API; WhatsApp entra por DOM.**~~ **YA NO.** WhatsApp entra por
   `@whatsmeow-node/whatsmeow-node` detrás de la interfaz `TransporteWhatsapp`
   (`server/src/whatsapp/transporte.ts`), y la mitad que recibe de la Cloud API también existe
   (`server/src/webhook/whatsapp.ts`). No queda lectura de DOM en ninguna parte.
   > La apuesta salió bien y conviene dejarla escrita: la lectura del DOM estaba encerrada en un
   > solo archivo (`electron/whatsapp-preload.cjs`), y cambiar de canal costó **borrar ese archivo**
   > sin que el resto de Hermes se enterara. El archivo se fue con **ADR 0039**.
2. **Hermes es la cara; Cerberus es el núcleo.** Hermes no reimplementa ventas, cuotas ni matrícula.
   Registra contra la API de Cerberus, que sigue siendo dueño de `tb_cliente`/`tb_venta`.

## 4. Identidad entre canales — la decisión que hay que tomar YA

El plan viejo decía "match por teléfono normalizado". Eso es pensamiento WhatsApp-only: **Instagram y
Messenger no tienen teléfono**, tienen `IGSID` y `PSID`.

Hace falta una tabla de identidad por canal:

```
tb_contacto_canal (contacto_id, canal, identificador_externo, UNIQUE(canal, identificador_externo))
```

El teléfono normalizado (dígitos + `51`) pasa a ser **una fila** ahí, no *la* clave. Es una migración
chica hoy y una reescritura fea dentro de seis meses con datos adentro. **Es coordinación con
Andreecito**: su dedup de la consolidación asume teléfono.

## 5. Sesiones de WhatsApp

> ⚠️ **Esta sección describe el diseño VIEJO y ya no aplica** (D13 + ADR 0039). Las particiones de
> Electron por cuenta (`persist:wa:<id>`, `src/features/whatsapp/cuentas.ts`) se borraron con la
> cáscara. Hoy la sesión vive **server-side, en VPS1**: un `.db` por número en
> `server/.wa-sessions/`, vinculado con `npm run wa:vincular` — **la app de la vendedora no vincula,
> solo ve**. Lo que sigue en pie de este párrafo es la última frase.

Una **partición de Electron por cuenta** (`persist:wa:<id>`): almacenamiento aislado donde WhatsApp
guarda sus llaves. El QR se escanea una vez por cuenta y la sesión sobrevive al cierre de la app.
**Hermes nunca ve ni guarda credenciales** — el código lo dibuja WhatsApp y lo escanea un humano.

Límites que impone WhatsApp (no nosotros):

- **4 dispositivos vinculados por número.** Cinco vendedores compartiendo un número no entran.
- Si el teléfono principal queda offline ~14 días, se desvincula todo.
- **Un número registrado en la Cloud API deja de funcionar en WhatsApp Web.** El cutover es un
  cambio, no una convivencia.

## 6. Sobre impedir que se robe la data

El kiosco (bloquear el apagado, impedir salir del entorno) **se descartó**: lo derrota una cámara de
celular, el botón físico gana, y bloquear el apagado pelea con el sistema operativo. Lo que sí sirve,
en orden de impacto:

1. **Números de WhatsApp de la empresa**, no del vendedor. Cuando se va, el número y el historial se
   quedan. Es el 70% del problema.
2. **API de menor privilegio**: sin listado, sin export, sin búsqueda masiva. Solo la ficha del
   contacto del chat abierto.
3. **Log de cada consulta + alerta de anomalía.** Es lo único que también atrapa al de la cámara,
   porque igual tiene que consultar.
4. **Marca de agua dinámica** con el nombre del vendedor. Disuade la foto y la vuelve atribuible.

## 7. Estado (21-jul-2026)

**Hecho y verificado corriendo:**
- Bandeja con datos reales, orden por urgencia, y responder público + privado (heredado).
- Barra de frescura: distingue "estás al día" de "la captura está muerta". Endpoint nuevo
  `/api/interactions/frescura`.
- ~~Caparazón Electron con panel de WhatsApp Web, particiones por cuenta, selector de cuentas.~~
  **Archivado** (D13 lo dejó sin uso, ADR 0039 lo borró). La cáscara es Tauri.
- Adaptador de DOM con los selectores verificados del spike + **kill-switch**: si no reconoce la
  interfaz lo dice, nunca inventa un teléfono.

**Lo que sigue, en orden:**
1. Que el chat abierto de WhatsApp **busque el contacto en Cerberus** y muestre su ficha.
2. `tb_contacto_canal` en Cerberus (§4) — coordinar con Andreecito antes de que consolide.
3. Que los chats de WhatsApp **entren a la misma cola** que los comentarios.
4. El formulario de registrar venta contra la API de Cerberus.
5. CI/CD y migraciones versionadas (la deuda heredada del ADR 0001).
