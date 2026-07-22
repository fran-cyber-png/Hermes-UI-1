# ADR 0007 — El caché de consultas sobrevive al cierre, y lo hace en IndexedDB

- **Fecha:** 2026-07-22
- **Estado:** aceptado
- **Decide:** spec #29 (milestone «Rendimiento 2026-07»), ticket #31

## Contexto

Cada vez que la vendedora abre Hermes ve una pantalla en blanco con spinner, aunque el día
anterior haya tenido todo cargado: el caché de consultas de TanStack Query es **solo memoria** y
muere con el proceso.

Es la primera impresión de la app, todos los días, y no depende de que el server sea rápido: por
más que la cola ahora conteste en 30 ms (ticket #30), el arranque igual empieza sin nada que
pintar.

Persistir el caché hace que la app **pinte el último estado conocido al instante** y revalide por
detrás. Pero *dónde* persistirlo no es un detalle: la cáscara Tauri carga la UI **remota** (OTA,
ADR 0003), y esa decisión condiciona esta.

## Decisión

**Se persiste con IndexedDB — persistencia web estándar — y se restaura ANTES del primer render.**

Tres consecuencias concretas:

1. **Nada de plugins nativos de Tauri.** Si la UI dependiera de APIs de la cáscara: (a) dejaría de
   andar en el navegador, donde hoy se desarrolla y se verifica; y (b) **cada cambio de
   persistencia exigiría un instalador nuevo para cada vendedora** — que es exactamente lo que el
   OTA vino a evitar. La persistencia web anda igual en los dos lados y no ata nada.

2. **Nada de `localStorage`.** Los payloads son de decenas de KB y `localStorage` es síncrono:
   guardarlo obligaría a un `JSON.stringify` del caché entero en el hilo de la UI, justo en el
   arranque, que es el momento que este trabajo vino a arreglar. IndexedDB guarda estructuras
   directamente (structured clone), sin serializar a texto.

3. **La restauración va antes del primer render** (`src/main.tsx`). Si React montara primero, las
   vistas leerían `isPending` y pintarían el skeleton — el spinner que veníamos a sacar. Esperar la
   lectura de IndexedDB cuesta milisegundos y es lo que hace que la primera pintura tenga datos.

   Con un techo de **500 ms** para abrir la base (`almacenIdb.ts`). Es la contracara de esperar
   antes de pintar: si el `open` no contesta nunca —y hay navegadores que en modo privado no
   disparan ni éxito ni error— la app quedaría en blanco para siempre, mucho peor que el spinner.
   Agotado el techo, esa sesión va sin disco.

4. **La sesión se cree el token antes de preguntar** (`features/auth/sesion.ts`). Esto no estaba en
   el ticket y apareció revisando: `App.tsx` tapaba la app con un skeleton hasta que `/api/auth/yo`
   contestara, así que el caché ganaba milisegundos contra IndexedDB y los perdía contra un viaje de
   ida y vuelta a VPS1 — el AC «sin spinner» no se cumplía de verdad. Ahora, si hay un token que no
   venció (la expiración viaja dentro), la vendedora entra de una y la validación va por detrás.

   La firma la sigue verificando el server en cada request y un 401 real echa igual: lo único que se
   adelanta es la pantalla, y lo que se ve mientras tanto es el caché de esa misma vendedora en su
   propia máquina.

### Lo que se guarda, y lo que no

Lista **blanca** de dos consultas: el **radar** (`dashboard`) y la **cola** (`conversaciones`).
Son las dos pantallas por las que se entra. Que la lista sea corta y explícita es lo que hace que
«ninguna credencial toca el disco» no necesite auditoría: se lee de un vistazo.

Queda afuera lo que ya es en vivo por SSE (`wa/sesion`, `wa/conversacion`) — un estado guardado
puede afirmar «conectado» sobre un número que se cayó — y `frescura`, que es justamente la consulta
que vigila que no mintamos sobre la edad de los datos.

### Lo viejo se muestra marcado

Mostrar datos de ayer como si fueran de ahora es peor que un spinner: el spinner te hace esperar,
el dato viejo sin marcar te hace llamar a alguien que ya compró. Mientras lo que se ve venga del
disco, el radar reemplaza su «en vivo» por **«hace 14 horas»**, y la cola muestra el mismo sello en
lugar del total. El sello se borra solo cuando llega lo fresco: `dataUpdatedAt` pasa a ser ahora.

El «actualizando» lo dice el ícono que late, no una palabra. Escrita no entra en el encabezado de
la cola sin empujar los filtros —el control principal— a una segunda línea.

**El sello necesita que el reloj corra** (`useSelloDeViejo`). La primera versión calculaba
`Date.now()` durante el render, y mientras `dataUpdatedAt` no cambiara React no tenía motivo para
volver a renderizar: el resultado quedaba congelado. Medido con el server caído y la app abierta:
el radar seguía diciendo «en vivo» sobre datos de 14 horas a los 90 segundos y para siempre — la
misma mentira, en la forma que más dura, porque la vendedora deja Hermes abierto todo el día. Un
latido de 30 s lo arregla.

### Caducidad y buster

Lo persistido dura **24 h**: el caso que existe es «cierra a la noche, abre a la mañana», y una
ventana más corta lo dejaría afuera. Más allá de un día la cola ya no describe nada — los leads se
movieron, las ventanas de Meta se cerraron.

El **buster es el commit** (`__ID_DEL_BUILD__`, inyectado en `vite.config.ts` desde `git rev-parse`).
Con OTA la UI se actualiza sin que nadie instale nada, así que una vendedora puede tener guardado el
`/api/dashboard` de la forma vieja y abrir la UI nueva un minuto después; rehidratar eso revienta al
pintar. Atarlo a la revisión lo vuelve imposible por construcción y no depende de que alguien
recuerde subir un número a mano.

Es el commit y no el reloj del build a propósito: el deploy es `git pull && npm run build`, así que
el sello cambia exactamente cuando cambió el código, y recompilar lo mismo no le cuesta a nadie un
arranque frío. Sin git a mano cae al reloj — peor sello, pero nunca uno repetido, que es lo único
que no puede pasar.

## Alternativas consideradas

- **Plugin de almacenamiento de Tauri.** Descartada: rompe el OTA y el desarrollo en navegador
  (ver arriba). Es la razón por la que esta decisión se escribió en vez de tomarse sola.
- **`localStorage`.** Descartada por síncrono y por el `JSON.stringify` en el arranque.
- **`PersistQueryClientProvider`** de `@tanstack/react-query-persist-client`. Descartada como
  envoltorio: **no** demora el primer render — monta los hijos con `isRestoring` en `true`, así que
  las vistas alcanzan a pintar el skeleton y se ve el parpadeo. Del paquete se usan las funciones
  (`persistQueryClientRestore` / `Subscribe`), que son las que permiten poner el orden correcto.
- **Un persistidor de `localStorage`/`AsyncStorage` de la propia librería.** Descartada: serializa a
  texto. Escribimos un `Persister` de ~30 líneas contra IndexedDB, que además agrupa las escrituras
  (una por segundo como mucho, siempre la última).

## Consecuencias

- Aparece un runner de tests en el **front** (`vitest`, entorno `node`) y un paso nuevo en CI. La
  política —qué se guarda, cuánto dura, cómo se marca lo viejo— se testea sin navegador porque
  `persistencia.ts` habla con un `AlmacenAsync`, no con IndexedDB.
- Si IndexedDB no está (modo privado, cuota, base bloqueada por otra ventana), **nada falla**: la
  app queda como antes de este trabajo, con caché en memoria y spinner al abrir. Persistir es un
  lujo, nunca un requisito.
- Lo persistido se borra en los **tres** caminos por los que cambia quién está sentada: cerrar
  sesión, token vencido (401), y entrar con un usuario distinto al último. Los dos últimos
  aparecieron revisando: sin ellos, a la vendedora A se le vence el token, entra B, y B abre con el
  radar y la cola de A — exactamente lo que este ADR dice evitar.

## Verificación

Contra la base local con datos reales (60 conversaciones), con la API demorada o caída a propósito
para ver **qué pinta la app mientras revalida**. Screenshots en `docs/rendimiento-2026-07/`:

| | Qué prueba |
|---|---|
| `cache-01-arranque-frio` | El antes: sin caché, a los 900 ms, skeleton en todo |
| `cache-02-arranque-tibio` | Con el caché envejecido 14 h y la API demorada 8 s: a los 1,4 s el radar completo y «hace 14 horas» donde decía «en vivo» |
| `cache-03-ya-actualizado` | Llegó lo fresco: vuelve «en vivo», el sello se borró solo |
| `cache-04-cola-tibia` | La cola llena con su sello, filtros en una sola línea |
| `cache-05-tras-cerrar-sesion` | IndexedDB pasa de `["dashboard","conversaciones"]` a vacío |
| `cache-06-cascara-tauri` | **La cáscara Tauri (WKWebView, no Chromium) con la API caída**: dashboard completo y «hace 2 min». Sin server, eso solo puede venir del disco |
| `cache-07-sin-server` | Lo mismo en el navegador, y logueada sin que `/api/auth/yo` conteste |
| `cache-08-sin-recargar` | El reloj del sello corriendo: «en vivo» → (45 s) → «hace 1 min», sin recargar nada |

En la cáscara se verificó además, con una sonda temporal, que IndexedDB **guarda y devuelve** en
WKWebView — es lo único que podía diferir del navegador, porque el resto del código no sabe en qué
motor corre.
