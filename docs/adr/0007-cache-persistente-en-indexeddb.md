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
disco, el radar reemplaza su «en vivo» por **«hace 14 horas · actualizando»**, y la cola muestra el
mismo sello en lugar del total. El sello se borra solo cuando llega lo fresco.

### Caducidad y buster

Lo persistido dura **24 h**: el caso que existe es «cierra a la noche, abre a la mañana», y una
ventana más corta lo dejaría afuera. Más allá de un día la cola ya no describe nada — los leads se
movieron, las ventanas de Meta se cerraron.

El **buster es la identidad del build** (`import.meta.env.VITE_BUILD_ID`, inyectado en
`vite.config.ts`). Con OTA la UI se actualiza sin que nadie instale nada, así que una vendedora
puede tener guardado el `/api/dashboard` de la forma vieja y abrir la UI nueva un minuto después;
rehidratar eso revienta al pintar. Atarlo al build lo vuelve imposible por construcción, y cuesta
un spinner por deploy.

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
- Cerrar sesión borra lo persistido: con dos vendedoras en la misma máquina, la que entra no puede
  ver el radar de la que se fue.
