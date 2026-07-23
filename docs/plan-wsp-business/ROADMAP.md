# Roadmap — Hermes como WhatsApp Business potenciado

> El mapa maestro para atacar esto en una sesión nueva sin perder nada. Los documentos hermanos:
> **`PLAN.md`** (la síntesis de 5 diseños, con el modelo de datos completo) · **`FLUJO.md`** (las
> decisiones tomadas con Estephano, que mandan). Milestone en GitHub: **«WhatsApp Business
> potenciado»** (#3).

## El norte

**«Que no tengan que salir de la plataforma para vender: tendrán todo ahí.»** Hermes pasa de una cola
de WhatsApp con la ficha al lado, a la mesa de trabajo completa de la vendedora: responde con texto
guardado (`/`), manda el correo desde el chat, anota como en Notion, prioriza con una cola estilo
WhatsApp Business, y consulta el catálogo — sin soltar el hilo.

Y **con red debajo**: cada funcionalidad nueva nace con su test (lo que pidió Estephano). Por eso la
Fase 0 es el piso, no una herramienta.

## Progreso de ejecución (2026-07-23)

Primera sesión de ejecución (matt tdd + taste). **Mergeado a `main`:**

- **#33 — Harness de tests con base** (PR #56, ADR 0008). El piso: cada consulta SQL nueva nace con
  su `*.test.db.ts`. Verde en el runner de VPS1. Ver `CLAUDE.md` §«Tests con base».
- **#54 — El chat previsualiza el formato de WhatsApp** (PR #62). `*negrita*`/`_cursiva_`/enlaces
  dejan de verse crudos; parser puro reusable que además destraba el preview de #45. Front → CD.

**Issues nuevas del feedback del dueño** (todas en el milestone salvo #61, que es del puente Ivi):

| # | Qué | Frente |
|---|---|---|
| #55 | Mapear no-texto (📷/🎤/📄) + tarjeta del anuncio Click-to-WhatsApp | Chat |
| #57 | Timeline de intereses en la ficha (ya hay `intereses.creadoAt`) | Contacto |
| #58 | Unificación de contactos multi-cuenta (**ÉPICA — necesita spec**; maquinaria dormida `gente`/`lazo`) | Contacto |
| #59 | Foto de perfil del contacto (whatsmeow, cacheada, fallback iniciales) | Chat |
| #60 | Pipeline: compuertas como **modales** (el drag-drop ya persiste; hoy rebota) | Pipeline |
| #61 | Puente Ivi↔Hermes Pieza 1 (`/api/ivi/preguntar`) — ver `ivi-cerebro/docs/puente-hermes-pendiente.md` | Ivi |

**Frente elegido para seguir: «Chat como WhatsApp real».** Orden: **#59** foto → **#55** mapeo →
luego el piso invisible (**#36** auth, **#43** moneda, **#38/#37** VENCIDO+paridad, ya testeables con
el harness). **#58** pide grilling→spec antes de codear; **#60** reusa `Intereses`/`FormularioVenta`.

## Cómo se despliega cada cosa (importa para el orden)

Hay CD (ver `docs/despliegue-continuo.md`): **lo front-only se despliega solo** al mergear a `main`;
**lo que toca `server/` va por botón** (reinicia y tira la sesión de Cerberus de las vendedoras). En
la tabla, la columna «Sale» lo dice.

---

## Las fases

### Fase 0 — El piso (sin tocar la UI de la vendedora)

Nada de esto se ve, pero desbloquea todo lo demás y mata bugs reales.

| Issue | Qué | Sale |
|---|---|---|
| **#33** | Harness de tests con base de datos (Postgres en Docker en el runner, guardia anti-prod, base por corrida). *Ya existía.* | botón (CI) |
| **#36** | Cerrar la auth partida en las 4 rutas públicas (`/api/conversaciones`, `/api/whatsapp/conversacion`, `/api/whatsapp/media`, `/api/persona`). *Ya existía.* | botón |
| **#37** | La urgencia duplicada: test de paridad de los 6 niveles (opción B del PLAN, no unificar aún). *Ya existía.* | botón |
| **#38 / #23** | El nivel VENCIDO: JOIN a `recordatorios` + `seguimientoEn` en `FilaRadar`. El primer test rojo→verde. *Ya existían.* | botón |
| **#43** | `/api/venta/productos` devuelve la **moneda**, y se verifica que las fichas traigan `correo`. Precondición de los templates y el correo. | botón |

**Por qué primero**: #36 desbloquea el pin/no-leído por vendedora (Fase 3) y el ingestor de FB/IG
(Fase 5). #37 es precondición del ORDER BY del pin. El harness (#33) hace que todo lo que sigue nazca
con test. #43 es la bomba de la moneda: sin ella, `{precio}` y el correo son inseguros.

### Fase 1 — El composer potenciado (el golpe más directo a «todo ahí para vender»)

| Issue | Qué | Sale |
|---|---|---|
| **#44** | El menú **`···`** de herramientas en la BarraGestion — el contenedor donde cuelgan las 5. | front |
| **#45** | **Mensajes predeterminados**: insertar con `/` en el composer + su pantalla de edición. Por vendedora. `{precio}` se expande en el server. | botón |

Depende de: #43 (moneda, para `{precio}`).

### Fase 2 — Anotar y el correo

| Issue | Qué | Sale |
|---|---|---|
| **#47** | **Listas / notas**: el «Notion» a una tecla, en el aside de Mensajes. Editables, con búsqueda. | botón |
| **#46** | **Correo rápido** de cotización/confirmación desde el chat. La cotización reusa el armado de venta (precio real de Cerberus). | botón |

Depende de: #44 (el menú), #43 (moneda, para la cotización).

### Fase 3 — La cola potenciada

| Issue | Qué | Sale |
|---|---|---|
| **#48** | **Etiquetas con color** elegible: suben a categorías, por vendedora. | botón |
| **#49** | **La cola potenciada**: tabs `Todo · No leídos · Favoritos`, pin, no-leído (cursor de lectura nuevo), filtro por categorías. | botón |
| **#22** | La Ventana como días restantes (alimenta el smart-filter «Por vencer»). *Ya existía.* | botón |
| **#21** | Deuda/Silencio partido en dos bloques. *Ya existía.* | botón |

Depende de: **#36** (expone estado por vendedora) y **#37** (el pin ordena sobre los 6 niveles). Por
eso la Fase 0 va antes.

### Fase 4 — Multi-número

| Issue | Qué | Sale |
|---|---|---|
| **#50** | **Multi-número**: un `GestorWhatsapp` que reemplaza el singleton, tabla `numeros_wa`, guarda #0 en `EnvioControlado`, arreglo del bug de mezcla de hilos. Propósito por-vendedora **OFF** en v1. | botón |

### Fase 5 — Los otros canales y el catálogo con contexto

| Issue | Qué | Sale |
|---|---|---|
| **#52** | **FB/IG visibles**: ingestor incremental, reloj apagado por default, backfill medido una vez, la ventana de 24h de Messenger, webhook con firma. | botón + operador |
| **#27** | Capturar los DMs de Instagram (la 4ª superficie de Meta). *Ya existía.* | botón + operador |
| **#51** | **Catálogo con contexto**: ingerir de Cerberus (`cursos-docentes`) sanitizado — fechas, módulos, docentes; **nunca** el pago a docentes ni correos personales. Engancha con las fichas de curso empezadas. | botón + contenido |

Depende de: **#36** (auth, antes de ingerir 327k filas con datos personales).

---

## El grafo de dependencias, en una línea

```
#33 ─┐
#36 ─┼─→ #37 ─→ #38/#23         (Fase 0: el piso)
#43 ─┘
                #44 ─→ #45       (Fase 1: composer)
                 └──→ #46, #47   (Fase 2: correo, notas)
#36 + #37 ─────────→ #48, #49    (Fase 3: cola)   + #22, #21
                     #50         (Fase 4: multi-número)
#36 ──────────────→ #52 ─→ #27, #51   (Fase 5: canales + catálogo)
```

## Reglas que gobiernan todo (de FLUJO.md y las reglas duras)

- **Un envío = una acción humana.** Nada masivo, nada automático. Los templates y el correo salen de
  a uno, siempre editados antes de mandar. `EnvioControlado` es la única puerta.
- **El `{precio}` sale de Cerberus en el instante** — nunca cacheado, nunca escrito a mano, nunca del
  front (el caché se rehidrata de IndexedDB con precio de ayer).
- **El correo NO vuelve multicanal el hilo.** La Conversación sigue siendo por-canal (CONTEXT.md
  intacto). El correo es una acción, no un mensaje del hilo.
- **Mensajes y etiquetas son por vendedora**; el catálogo es compartido (es de Cerberus). Costo
  aceptado: la 2ª vendedora arranca con la libreta vacía.
- **El oro es tiempo que se acaba** — las categorías, el pin y las notas usan color neutro, nunca oro.
- **Verificación antes de «listo»**: screenshot (desktop + Tauri + angosto) o `curl` a la URL viva.

## Lo que NO se hace (las trampas, de PLAN.md §6)

- Nada que itere destinatarios o transportes: no «mandá a los de la etiqueta X», no selección
  múltiple, no secuencias/drips/autorespuesta.
- No `recordatorios.respuesta_id` («al vencer deja la respuesta lista») — un texto a un Enter de salir
  deja de ser una decisión.
- No número por vendedora en v1 (mete reparto de leads por la puerta de atrás).
- No backfill de FB/IG antes de cerrar #36 ni antes de modelar la ventana de 24h de Messenger.
- No cachear notas en IndexedDB. Los emojis SÍ pasan en notas (nunca van a Cerberus; la regla latin1
  #4 no aplica).

## El primer día de la próxima sesión

De PLAN.md §7, sin tocar la UI:

1. Levantar el harness (#33) + el primer test **rojo→verde de #38** (VENCIDO). Con screenshot.
2. Cerrar #36 en las 4 rutas. Verificable con `curl` (401 sin token).
3. Los dos chequeos baratos de #43: la moneda en `productos-cursos`, y `Ficha.correo` poblado en prod.

Al cerrar el día: un bug de producción muerto con evidencia, la auth cerrada, el harness que asegura
lo que venga, y la Fase 1 con vía libre.
