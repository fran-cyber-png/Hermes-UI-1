# El mapa de Hermes

> 🤖 **GENERADO — no se edita a mano.** Se regenera con `npm run mapa`, y `npm run mapa:verificar`
> (que corre en **N1 del CI**) falla si este archivo no coincide con el árbol de hoy.
> Lo único escrito a mano es `arquitectura.json`: las reglas y la responsabilidad de cada módulo.
>
> **Existe porque `docs/arquitectura.md` describía un repo 8 veces más chico a los nueve días**
> de escrito. Un mapa que se escribe, envejece; uno que se deriva, no puede.

## Cuánto es

| Zona | Módulos | Archivos | Líneas de código | Líneas de test |
|---|--:|--:|--:|--:|
| front | 34 | 486 | 67,961 | 23,096 |
| server | 68 | 812 | 85,771 | 53,395 |
| **total** | **102** | **1,298** | **153,732** | **76,491** |

## Front — `src/`

| Módulo | De qué es responsable | Arch. | Líneas | Tests | Lo usan | Usa |
|---|---|--:|--:|--:|--:|--:|
| `notas` | La Libreta: páginas, espacios compartidos, autoguardado y el link público. | 67 | 12,006 | 21 | 5 | 2 |
| `whatsapp` | La conversación nativa: el hilo, el composer, los adjuntos, las citas y la compresión de video. | 47 | 5,565 | 25 | 9 | 5 |
| `canales` | La cola unificada, y sólo eso: la lista de conversaciones, su fila, la barra de filtros y el panel de contexto. El modelo que dibuja NO vive acá — vive en `dominio/`. | 35 | 4,685 | 8 | 1 | 11 |
| `panel` | La ficha al costado del chat, en el orden de las preguntas que decide una venta: quién es, qué quiere, qué mandarle, qué hacer. | 28 | 3,751 | 10 | 5 | 10 |
| `correos` | El correo 1-a-1, auditado. Sin listas ni campañas. | 11 | 3,500 | 5 | 1 | 4 |
| `agenda` | Los seguimientos que una vendedora se agendó: cuándo vuelve a tocar a quién. | 28 | 3,056 | 5 | 5 | 4 |
| `vistas` | El Pipeline: el tablero por etapas, sus tarjetas y las compuertas para mover una. | 15 | 3,027 | 6 | 1 | 10 |
| `lib` | Lo que no sabe de negocio: el cliente HTTP con su caché en IndexedDB, el SSE, el teclado, formato y notificaciones. Capa 0 — no puede importar ninguna feature. | 56 | 2,668 | 20 | 31 | 0 |
| `dashboard` | Los números en pantalla: el radar, el embudo y qué recorte ve quien mira. | 9 | 2,520 | 3 | 3 | 7 |
| `routing` | Qué campaña de Meta le cae a qué vendedora. | 10 | 2,511 | 4 | 1 | 1 |
| `gestion` | Lo que la vendedora asienta sobre una conversación: etapa, categorías, intereses y sus herramientas. | 12 | 2,258 | 2 | 5 | 9 |
| `campana` | Armar y mirar una campaña por plantilla aprobada de Meta: listas, corridas e historial. | 11 | 2,100 | 1 | 1 | 2 |
| `dominio` | El vocabulario del CRM que más de una vista necesita: qué ES una conversación, las queries que la traen, y las derivaciones puras sobre ella — canal, curso, ventana, antigüedad, cliente, dueño, líneas, la paleta de categorías y el desglose del embudo. Capa 1: importa `lib` y nada más. 🔴 Nació sacando esto de adentro de `features/canales`, donde 58 de los 148 imports cruzados del front entraban a una feature para pedirle el modelo. | 24 | 1,989 | 11 | 20 | 1 |
| `padron` | Los contactos que nunca escribieron: filtrarlos por facetas y repartirlos. | 8 | 1,878 | 2 | 2 | 4 |
| `autorespuesta` | El acuse fuera de horario visto desde la app: el interruptor, la cola de revisión y el modo supervisado. | 13 | 1,711 | 4 | 2 | 3 |
| `entrenamiento` | Entrenar el bot: sus corridas, sus lecciones y los agujeros que deja. | 9 | 1,604 | 2 | 1 | 2 |
| `venta` | Registrar la venta contra Cerberus sin salir del chat. | 6 | 1,512 | 1 | 2 | 6 |
| `plantillas` | Las secuencias de venta: editarlas, aprobar una propuesta y mandarlas paso a paso. | 7 | 1,429 | 1 | 2 | 2 |
| `ivi` | La consulta al cerebro RAG y cómo se presenta lo que contesta: los tres tipos y los ocho errores. | 10 | 1,395 | 4 | 1 | 1 |
| `auth` | Entrar y salir: login contra Cerberus, el SSO de Centurión, y el token que el cliente cree antes de preguntar. | 18 | 1,299 | 9 | 3 | 4 |
| `app` | El armazón: qué vista está abierta, los ⌘N y qué capa se monta encima de la mesa. Compone features; no tiene regla de negocio propia. | 2 | 1,175 | 0 | 0 | 18 |
| `hechos` | Los datos recomendados — la munición de una línea. Tocar uno lo pone en el composer; no envía. | 7 | 1,055 | 2 | 3 | 3 |
| `navegador` | El navegador embebido: qué peldaño de la escalera corre esta máquina y a dónde se puede ir. | 9 | 843 | 3 | 1 | 1 |
| `bot` | El interruptor del bot de primera línea visto desde la app: en qué modo está, de dónde sale ese modo (la base o el entorno) y cómo apagarlo sin un deploy. | 5 | 724 | 2 | 1 | 1 |
| `eventos` | Registrar lo que la vendedora ESCUCHÓ, tipado, en el timeline del contacto. | 4 | 687 | 2 | 2 | 1 |
| `componentes` | Átomos visuales que usa medio árbol y no son de ninguna feature: la marca, los gráficos, el avatar y la píldora de canal. Capa 0 — no puede importar una feature ni el dominio. | 10 | 667 | 0 | 10 | 1 |
| `cerberus` | La ficha del contacto: la que trae el ERP y la que dejó el formulario de landing. | 7 | 592 | 2 | 5 | 4 |
| `reparto` | De quién es cada conversación, visto desde la app. | 3 | 565 | 0 | 2 | 2 |
| `identidad` | «Es la misma persona que…»: buscar contactos y unificar fichas. | 5 | 524 | 1 | 2 | 3 |
| `sugerencias` | Las dos respuestas listas del panel derecho. | 2 | 333 | 0 | 0 | 4 |
| `territorio` | Dónde vota cada contacto de una campaña: el selector de distrito del panel y su lectura. | 3 | 187 | 1 | 1 | 1 |
| `senales` | Las etiquetas derivadas —cotizado, se enfrió— que no se guardan en ningún lado. | 2 | 119 | 0 | 1 | 3 |
| `leads` | Qué tan caliente está un lead. | 1 | 26 | 0 | 1 | 0 |
| `pruebas` | El andamio de los tests con DOM: `montar`, `teclear`, `reposar`. | 2 | 0 | 2 | 0 | 0 |

## Server — `server/src/`

| Módulo | De qué es responsable | Arch. | Líneas | Tests | Lo usan | Usa |
|---|---|--:|--:|--:|--:|--:|
| `routes` | La capa HTTP: valida con Zod, llama a un seam del dominio y serializa. No escribe SQL. Capa 3 — nadie la importa: un archivo que otro módulo necesita no es un router y no va acá (fue el caso de `costoPorLead`). | 64 | 11,196 | 12 | 1 | 49 |
| `bot` | El bot de primera línea que atiende solo: su agente, sus guardrails, sus frenos y el reenganche. | 56 | 7,997 | 24 | 7 | 13 |
| `cola` | La consulta que ordena la deuda: a quién se atiende primero y por qué. Cada regla vive pura y con su gemelo SQL. | 72 | 6,371 | 48 | 11 | 7 |
| `scripts` | Los comandos de operación, dry-run por default. Ninguno es parte del proceso que corre en producción. Capa 3. | 38 | 6,352 | 0 | 0 | 37 |
| `db` | El schema y la conexión. Capa 0: no conoce ninguna regla de negocio y no puede importar a nadie. | 23 | 4,465 | 2 | 54 | 0 |
| `whatsapp` | La costura con WhatsApp: la interfaz de transporte y sus implementaciones, el hilo, y la única puerta por la que sale un envío. | 49 | 4,269 | 23 | 13 | 11 |
| `autorespuesta` | El acuse fuera de horario del lado del server: a quién corresponde, con qué plantilla y a qué ritmo. Nunca manda solo. | 30 | 2,993 | 13 | 7 | 5 |
| `campana` | Mandar una campaña por plantilla aprobada de Meta: el público, los vetos, el ritmo y los reintentos. | 27 | 2,907 | 12 | 3 | 6 |
| `cerberus` | Hablarle al ERP: login, ficha, productos, ventas — y el latin1 que revienta con emojis. | 17 | 1,698 | 8 | 10 | 3 |
| `correos` | El correo 1-a-1 y su rastro. Sin listas ni campañas. | 24 | 1,684 | 15 | 2 | 2 |
| `routing` | Qué campaña de Meta le cae a qué vendedora, y resolver el anuncio contra la Graph API. | 13 | 1,587 | 6 | 3 | 6 |
| `dashboard` | Los números: radar, embudo, series, y el recorte según quién los pide. Es una frontera. | 19 | 1,551 | 10 | 3 | 8 |
| `espacios` | Dónde vive cada página de la Libreta y quién la puede ver o escribir. Es una frontera, no un filtro. | 18 | 1,490 | 8 | 2 | 2 |
| `sdk` | 🪦 Heredado de meta-escuela — el SDK de consulta del dashboard de pauta. | 9 | 1,420 | 1 | 1 | 6 |
| `pauta` | 🪦 Heredado de meta-escuela — recolectar gasto, fatiga y engagement de la pauta publicitaria, y el costo REAL por lead (leads capturados contra lo que Meta dice que costó traerlos, todo en dólares). | 14 | 1,349 | 4 | 4 | 5 |
| `cursos` | Traducir el texto con el que llegó una persona a una familia de curso. | 15 | 1,223 | 7 | 8 | 3 |
| `numeros` | Los números de WhatsApp de Goberna: su estado de vinculación y de quién es cada uno. | 15 | 1,184 | 7 | 8 | 5 |
| `webhook` | Todo lo que entra de afuera: Meta, WhatsApp, Cerberus y las landings. Ack primero, firma siempre. Capa 3 — es una entrada, nadie lo importa. | 12 | 1,178 | 4 | 1 | 10 |
| `analisis` | 🪦 Heredado de meta-escuela — los análisis del dashboard de pauta (ROAS, cartera, geo). | 15 | 1,173 | 6 | 5 | 2 |
| `notas` | Las páginas de la Libreta y su texto plano. | 11 | 1,159 | 7 | 1 | 3 |
| `plantillas` | Las secuencias de venta: catálogo, expansión de `{variables}` y aprobación de una propuesta minada. | 12 | 1,126 | 6 | 4 | 4 |
| `ontologia` | 🪦 Heredado de meta-escuela — las proyecciones ontológicas. ⚠️ `ontologia.conversiones` NO está muerto: `lazo/worker.ts` lo consulta. | 7 | 1,040 | 2 | 2 | 4 |
| `padron` | Los contactos de icarus que nunca escribieron: el WHERE que los recorta, sus facetas, y a quién se le habilitan. Es una frontera. | 15 | 1,023 | 6 | 4 | 2 |
| `canales` | 🪦 Heredado de meta-escuela — las consultas de salud y tesorería del dashboard de pauta. ⚠️ No confundir con `front/canales`, que es la cola y sí se usa. | 6 | 1,021 | 0 | 2 | 4 |
| `atribucion` | Que una venta encuentre su conversación: la llave determinista y la cascada etiquetada de respaldo. | 10 | 996 | 4 | 4 | 5 |
| `meta` | Traer de Meta lo que pasó —interacciones, leads, anuncios— por los dos caminos (polling y webhook), que escriben igual. | 8 | 848 | 2 | 5 | 2 |
| `resultados` | Qué pasó DESPUÉS de mandar una pieza. Deriva el veredicto; los nombres no prometen causa. | 9 | 840 | 4 | 3 | 5 |
| `equipo` | Quién es quién: los tres roles, de dónde sale el de quien pide, y con qué degrada cuando la tabla no está o la base no contesta. | 12 | 772 | 6 | 5 | 5 |
| `lazo` | 🪦 Heredado de meta-escuela — el outbox que le contaría las conversiones a Meta por CAPI. Apagado (`LAZO_RELOJ`). | 7 | 747 | 2 | 6 | 3 |
| `identidad` | El puente clave-de-conversación ↔ persona: enlazar, revocar, unificar. | 7 | 736 | 3 | 2 | 1 |
| `catalogo` | El catálogo de piezas que Ivi lee para ELEGIR sin inventar. Solo lectura, y nunca sirve medio catálogo. | 9 | 650 | 4 | 3 | 4 |
| `senales` | «Cotizado» y «se enfrió»: se derivan en cada consulta, nunca se guardan. | 8 | 642 | 4 | 4 | 2 |
| `auth` | Quién entra: Cerberus, Centurión, el token HMAC y el perímetro cerrado por default. | 13 | 628 | 7 | 7 | 2 |
| `procedencia` | De qué pieza salió cada envío, estampado en la ORDEN de envío y no en un update posterior. | 6 | 625 | 3 | 6 | 3 |
| `telefono` | Partir y comparar un teléfono E.164. La llave canónica del repo: vive una sola vez. Capa 0. | 6 | 608 | 3 | 6 | 0 |
| `reparto` | De quién es cada conversación cuando varias comparten una línea. Round-robin por carga, fail-open. | 6 | 590 | 3 | 8 | 2 |
| `gestiones` | La bitácora comercial: lo que una persona AFIRMA sobre una conversación. | 8 | 588 | 4 | 5 | 5 |
| `ivi` | El proxy al cerebro RAG: traduce su dialecto y falla ruidoso — nunca disfraza una caída de «no encontró datos». | 3 | 519 | 2 | 1 | 0 |
| `piezas` | Cómo se direcciona una pieza y cómo se calcula su versión. Un solo lugar — con dos recetas, el join da cero filas en silencio. | 6 | 513 | 3 | 5 | 0 |
| `sugerencias` | En qué momento de la venta está y qué dos respuestas corresponden. El vocabulario que comparten el panel y la auto-respuesta. | 6 | 492 | 2 | 6 | 4 |
| `eventos` | Los eventos tipados del timeline y el interés que asientan de paso. | 5 | 471 | 3 | 1 | 4 |
| `entrega` | Los ✓✓: la escala monótona de un recibo y su avance, arbitrado por la base. | 7 | 430 | 4 | 3 | 1 |
| `gente` | La persona canónica del grafo y cómo se la encuentra por teléfono. | 5 | 426 | 2 | 7 | 3 |
| `fuentes` | 🪦 Heredado de meta-escuela — los volcados de origen del dashboard de pauta. | 3 | 420 | 1 | 1 | 1 |
| `clientes` | Quién ya compró, en copia local, con su nivel congelado en la tabla. | 5 | 402 | 2 | 2 | 3 |
| `hechos` | El catálogo de datos recomendados y cuáles llegan a verse en cada momento de venta. | 6 | 396 | 2 | 3 | 2 |
| `decisions` | 🪦 Heredado de meta-escuela — el feed de «qué requiere atención» del dashboard de pauta. | 3 | 368 | 1 | 3 | 1 |
| `index` | El pegamento: monta los routers y arranca los relojes. ⚠️ Sus comentarios describen la arquitectura de meta-escuela y engañan (ver `docs/arquitectura.md` §2). | 1 | 343 | 0 | 0 | 13 |
| `reacciones` | El 👍 al flyer: una señal que cuelga de un mensaje, en los dos dialectos y con una sola forma. | 5 | 336 | 2 | 3 | 2 |
| `migraciones` | Verificar que una migración sea expand-only y que el journal sea monótono. | 4 | 321 | 2 | 1 | 0 |
| `corridas` | Las corridas de entrenamiento del bot y los agujeros que dejan. | 4 | 319 | 2 | 1 | 3 |
| `realtime` | El bus que empuja los cambios a la app por SSE. | 4 | 295 | 1 | 3 | 2 |
| `centurion` | Las credenciales del SSO de Centurión. | 2 | 288 | 1 | 1 | 1 |
| `modulos` | Los dos módulos de CRM (ventas y campañas): de cuál es cada persona y de cuál es cada superficie de la API. | 5 | 280 | 3 | 2 | 3 |
| `categorias` | Las categorías con color que cada vendedora se arma. | 4 | 247 | 2 | 3 | 1 |
| `lib` | Utilidades sin dominio: hora de Lima, rangos y por qué falló una consulta. Capa 0. | 9 | 246 | 3 | 12 | 0 |
| `territorio` | El territorio de una campaña: el catálogo de distritos de una candidatura y dónde vota cada contacto. | 3 | 239 | 1 | 2 | 1 |
| `interacciones` | Las interacciones crudas de `interactions` como las consulta la app: el listado, los canales y la frescura de la ingesta. | 1 | 224 | 0 | 1 | 3 |
| `icarus` | Leer la base de icarus, siempre read-only. | 4 | 223 | 2 | 1 | 1 |
| `negocio` | Las líneas de negocio y el embudo de consultoría. | 4 | 186 | 2 | 2 | 0 |
| `agenda` | Los recordatorios que una vendedora se agendó sobre una conversación. | 1 | 175 | 0 | 1 | 1 |
| `contactos` | Lo que se escribe sobre un contacto desde su ficha, empezando por la venta registrada contra Cerberus. | 3 | 168 | 1 | 1 | 3 |
| `ediciones` | Editar un mensaje ya enviado. Sólo donde el transporte lo permite. | 4 | 164 | 2 | 1 | 3 |
| `atencion` | Cuánto se tarda en contestar. | 2 | 161 | 1 | 1 | 0 |
| `responder` | Responder un comentario de Meta: lo que hay que leer de la base para armar y registrar esa respuesta. | 1 | 136 | 0 | 1 | 1 |
| `entrenamiento` | Las corridas de entrenamiento del bot, sus lecciones y los agujeros que dejan, tal como los lee la pantalla. | 1 | 132 | 0 | 1 | 1 |
| `dominio` | 🪦 Heredado de meta-escuela — la máquina de estados de venta. | 2 | 125 | 1 | 3 | 0 |
| `pruebas` | El andamio de los tests: base efímera, sembrado y humo end-to-end. | 9 | 0 | 9 | 1 | 0 |

## Quién depende de quién

Los módulos con más entradas son los que no se pueden tocar sin mirar a todo el resto.

| Módulo | Lo importan | Quiénes |
|---|--:|---|
| `server/db` | 54 | `agenda` · `analisis` · `atribucion` · `autorespuesta` · `bot` · `campana` · `canales` · `catalogo` · `categorias` · `cerberus` · `clientes` · `cola` · `contactos` · `correos` · `corridas` · `cursos` · `dashboard` · `ediciones` · `entrega` · `entrenamiento` · `equipo` · `espacios` · `eventos` · `fuentes` · `gente` · `gestiones` · `hechos` · `icarus` · `identidad` · `index` · `interacciones` · `lazo` · `meta` · `notas` · `numeros` · `ontologia` · `padron` · `pauta` · `plantillas` · `procedencia` · `reacciones` · `realtime` · `reparto` · `responder` · `resultados` · `routes` · `routing` · `scripts` · `sdk` · `senales` · `sugerencias` · `territorio` · `webhook` · `whatsapp` |
| `front/lib` | 31 | `agenda` · `app` · `auth` · `autorespuesta` · `bot` · `campana` · `canales` · `cerberus` · `componentes` · `correos` · `dashboard` · `dominio` · `entrenamiento` · `eventos` · `gestion` · `hechos` · `identidad` · `ivi` · `navegador` · `notas` · `padron` · `panel` · `plantillas` · `reparto` · `routing` · `senales` · `sugerencias` · `territorio` · `venta` · `vistas` · `whatsapp` |
| `front/dominio` | 20 | `agenda` · `app` · `auth` · `autorespuesta` · `canales` · `cerberus` · `correos` · `dashboard` · `entrenamiento` · `gestion` · `hechos` · `padron` · `panel` · `plantillas` · `reparto` · `senales` · `sugerencias` · `venta` · `vistas` · `whatsapp` |
| `server/whatsapp` | 13 | `atribucion` · `autorespuesta` · `bot` · `clientes` · `corridas` · `ediciones` · `gente` · `index` · `numeros` · `reacciones` · `routes` · `scripts` · `webhook` |
| `server/lib` | 12 | `canales` · `correos` · `dashboard` · `equipo` · `interacciones` · `modulos` · `numeros` · `pauta` · `realtime` · `routes` · `webhook` · `whatsapp` |
| `server/cola` | 11 | `canales` · `dashboard` · `equipo` · `gestiones` · `interacciones` · `meta` · `resultados` · `routes` · `routing` · `scripts` · `whatsapp` |
| `front/componentes` | 10 | `agenda` · `app` · `auth` · `canales` · `cerberus` · `dashboard` · `identidad` · `venta` · `vistas` · `whatsapp` |
| `server/cerberus` | 10 | `auth` · `bot` · `contactos` · `cursos` · `eventos` · `gestiones` · `plantillas` · `routes` · `routing` · `scripts` |
| `front/whatsapp` | 9 | `agenda` · `app` · `auth` · `autorespuesta` · `canales` · `dashboard` · `hechos` · `padron` · `sugerencias` |
| `server/cursos` | 8 | `bot` · `dashboard` · `gestiones` · `index` · `plantillas` · `routes` · `routing` · `scripts` |
| `server/numeros` | 8 | `cola` · `dashboard` · `gente` · `index` · `modulos` · `routes` · `scripts` · `whatsapp` |
| `server/reparto` | 8 | `espacios` · `eventos` · `notas` · `numeros` · `padron` · `routes` · `scripts` · `webhook` |
| `server/auth` | 7 | `centurion` · `equipo` · `index` · `modulos` · `numeros` · `routes` · `scripts` |
| `server/autorespuesta` | 7 | `bot` · `campana` · `catalogo` · `index` · `routes` · `scripts` · `whatsapp` |
| `server/bot` | 7 | `corridas` · `dashboard` · `index` · `routes` · `scripts` · `webhook` · `whatsapp` |

## Los nudos entre módulos (informativo, no es una regla)

Un grupo acá NO quiere decir que haya una dependencia circular en el código: el grafo de
ARCHIVOS es un DAG salvo por lo que liste `sinCiclosDeArchivo`. Quiere decir que **las
fronteras de las carpetas no siguen la forma de las dependencias** — que hay archivos
agrupados bajo un módulo que en realidad pertenecen a otra capa. Es el termómetro de si
los módulos están bien dibujados, y baja sacando el núcleo compartido a su propia capa.

**Qué queda afuera del grafo** (acá y en «Quién depende de quién»): los tests, y las
**22 galerías** `src/features/*/galeria*.tsx`. Las dos cosas por el mismo
motivo: miran a cualquiera a propósito y ninguna la importa la app — cada galería se sirve por
su propio `galeria-*.html` y existe para poder fotografiar los casos feos. Contarlas inventaba
dependencias entre features que el producto no tiene: sacarlas bajó este nudo de 7 a 3.
Siguen contando en `Líneas`: no son tests, son código del módulo.

- **3 módulos**: `front/autorespuesta` ↔ `front/hechos` ↔ `front/whatsapp`
- **2 módulos**: `front/cerberus` ↔ `front/identidad`
- **5 módulos**: `front/dashboard` ↔ `front/gestion` ↔ `front/panel` ↔ `front/senales` ↔ `front/venta`
- **2 módulos**: `server/analisis` ↔ `server/decisions`
- **28 módulos**: `server/atribucion` ↔ `server/auth` ↔ `server/autorespuesta` ↔ `server/bot` ↔ `server/campana` ↔ `server/catalogo` ↔ `server/centurion` ↔ `server/cerberus` ↔ `server/clientes` ↔ `server/cola` ↔ `server/cursos` ↔ `server/dashboard` ↔ `server/equipo` ↔ `server/gente` ↔ `server/gestiones` ↔ `server/hechos` ↔ `server/meta` ↔ `server/modulos` ↔ `server/numeros` ↔ `server/padron` ↔ `server/plantillas` ↔ `server/procedencia` ↔ `server/reacciones` ↔ `server/reparto` ↔ `server/resultados` ↔ `server/routing` ↔ `server/sugerencias` ↔ `server/whatsapp`
- **2 módulos**: `server/lazo` ↔ `server/ontologia`

## Módulos que no importan a nadie y nadie importa

No significa que estén muertos —pueden ser puntos de entrada o scripts—, pero es la lista donde mirar primero.

- `front/pruebas` — 2 archivos, 0 líneas

## Las reglas y cómo están hoy

### ✅ `sinCiclosDeArchivo` — sin violaciones

> Dos archivos que se importan mutuamente no tienen un orden en que leerse, y en ESM uno de los dos ve el módulo del otro a medio inicializar — un `undefined` que no aparece al compilar sino al ejecutar, y sólo a veces. Medido el 16-ago-2026 sobre 641 archivos: TRES, todos de dos archivos. Por eso el candado puede ser duro desde el día uno.

### ✅ `handlersEnvueltos` — sin violaciones

> Express 4 NO atrapa el rechazo de un handler `async`: se vuelve `unhandledRejection` y el proceso se cae — no un 500, el server abajo. Ya ocurrió (`routes/auth.falloDeBase.test.ts`: dejó a las cinco vendedoras sin Hermes). Todo handler async de `server/src/routes/` tiene que estar envuelto en `ruta()` (`server/src/lib/ruta.ts`), que atrapa, loguea con `porQueFallo` y contesta un 500 genérico.

### ✅ `routersSinSqlInline` — sin violaciones

> Un router valida, llama a un seam del dominio y serializa. Con SQL adentro, esa consulta no se puede testear sin levantar Express, y la regla que expresa no se puede compartir con el resto — que es como nacieron las dos implementaciones de la urgencia (#37).

**No se revisan** (el porqué está en `arquitectura.json`): `server/src/routes/decisions.ts` · `server/src/routes/leads.ts` · `server/src/routes/overview.ts`

### ✅ `docsSinRutasMuertas` — sin violaciones

> Medido el 16-ago-2026: 68 de 221 rutas de archivo citadas en los docs no existían (31 %), 18 de ellas de `bot/`. Una ruta muerta en un doc no se ve como error: se lee como que el archivo está en otro lado.

**No se revisan** (el porqué está en `arquitectura.json`): `docs/mapa.md` · `docs/heredado-meta-escuela` · `docs/claude-md-2026-08-09-completo.md`

### ✅ `moduloDeclarado` — sin violaciones

> Un módulo sin responsabilidad escrita es un módulo del que nadie puede decir si un archivo nuevo le corresponde. Es la pregunta que decide dónde va cada cosa.

### ✅ `capas` — sin violaciones

> Un módulo no puede importar de una capa más alta que la suya: el núcleo compartido no puede depender de una pantalla. Declaradas: `front/lib`=0 · `front/componentes`=0 · `front/dominio`=1 · `front/app`=3 · `server/db`=0 · `server/lib`=0 · `server/telefono`=0 · `server/routes`=3 · `server/webhook`=3 · `server/scripts`=3 · `server/index`=4. Y por zona, el piso de lo no declarado: `server`=2 — sin eso un módulo sin nivel queda sin restricción, y la regla vigilaría los extremos sin poder ponerse roja nunca.

