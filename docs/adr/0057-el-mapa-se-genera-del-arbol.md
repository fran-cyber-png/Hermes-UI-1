# ADR 0057 — El mapa se genera del árbol, y el CI verifica que esté al día

**Fecha**: 2026-08-16 · **Estado**: aceptado · **Reemplaza**: el §2 de `docs/arquitectura.md` como
inventario (ese documento sigue vivo, pero deja de contar cosas)

---

## El problema, medido

`docs/arquitectura.md` es el documento que el propio `CLAUDE.md` señala como **«el mapa, leelo antes
de tocar arquitectura»**. Decía, textual:

> | | **La mitad viva** (~39 archivos) | **La mitad heredada** (~45 archivos) |
> | Routers | 13 de 27 | 14 de 27 |

Medido el 16-ago-2026: **680 archivos `.ts` en el server y 49 routers.** Se escribió a mano el
7-ago; nueve días después describía un repo **ocho veces más chico**, y nada se puso rojo porque
nada lo miraba.

No es un descuido de quien lo escribió. Es lo que le pasa a cualquier inventario a mano en un repo
que creció **881 commits en cinco semanas** (11-jul → 16-ago-2026, ~25 por día). A esa velocidad lo
único barato es agregar; consolidar cuesta un frente y no cierra ningún issue.

Lo demás que se midió el mismo día:

| | |
|---|---|
| `bot/` | 2º módulo más grande del server (32 archivos de código, ~8.000 líneas) y **cero menciones en `CLAUDE.md`** |
| Rutas de archivo citadas en docs que no existían | **72** |
| Ciclos entre archivos | **3**, los tres de dos archivos |
| Nudos entre módulos | uno de **18** (casi todo el front) y otro de **22** |
| Imports cruzados del front que entraban a `canales` a buscar el modelo | **58 de 148 (39 %)** |
| Routers con SQL adentro | **16**, de los cuales **4 no los llama nadie** |

---

## La decisión

**El inventario se DERIVA del árbol. Lo único que se escribe a mano es el porqué.**

- `scripts/mapa.mjs` (node puro, sin dependencias) lee el árbol y emite **`docs/mapa.md`**: los
  módulos con su tamaño, su responsabilidad, quién los importa y a quién importan, los ciclos, los
  nudos y el estado de cada regla.
- **`arquitectura.json`** es lo escrito a mano: cinco reglas con su porqué **medido**, y la
  responsabilidad declarada de cada módulo — la línea que sirve para decidir si un archivo nuevo va
  ahí o no.
- **`npm run mapa:verificar`** corre en **N1 del CI** y hace dos cosas:
  1. falla si hay violaciones de las reglas;
  2. **falla si `docs/mapa.md` no es byte a byte idéntico al que se generaría hoy.**

🔴 **Lo segundo es el ADR entero.** Es lo que hace imposible repetir la historia de
`arquitectura.md`: mover un archivo sin regenerar pone el CI en rojo. Un mapa que se escribe
envejece en silencio; uno que se deriva **no puede**.

⚠️ **Corolario que hay que respetar al tocar el generador**: no puede imprimir fechas, contadores de
corrida ni nada que cambie solo, porque rompería la comparación byte a byte.

---

## Las cinco reglas, y por qué son ésas

### `sinCiclosDeArchivo` — dura

Dos archivos que se importan mutuamente no tienen un orden en que leerse, y en ESM uno ve al otro a
medio inicializar: un `undefined` que no aparece al compilar sino al ejecutar, y sólo a veces.

🔴 **La regla NO es «cero ciclos entre módulos», y ésa es la decisión que más se puede malinterpretar.**
El grafo de MÓDULOS daba un nudo de 18 y otro de 22; el de ARCHIVOS, tres pares. **El código ya era
un DAG**: lo que se enredaba eran las fronteras de las carpetas. Exigir cero entre módulos habría
obligado a mudar 18 features para arreglar algo que el código no tiene.

Los nudos de módulos se **reportan** en el mapa como termómetro de si las carpetas están bien
dibujadas. Bajan solos cuando el núcleo compartido va a su capa: el de 18 se partió en 7 · 3 · 2.

**Antes de proponer un reordenamiento por ciclos, medí a nivel de ARCHIVO.** El grafo de módulos
amplifica: una sola arista mal ubicada colapsa decenas de módulos en un componente gigante.

### `capas` — dura

```
src/lib · src/components   capa 0 — no saben de negocio
src/dominio                capa 1 — qué ES una conversación; importa `lib` y nada más
src/features/*             capa 2 — las pantallas
```

`src/dominio/` **nació de la medición**, no de un gusto: el modelo del CRM vivía adentro de
`features/canales`, que es la vista de la cola, y `conversaciones.ts` sola tenía 36 consumidores de
afuera.

⚠️ **El caso que mejor lo explica es `desglose.ts`**: `FilaDesglose` vivía en `vistas/tablero.ts`,
así que el modelo del front tenía que importar una PANTALLA para tipar la respuesta de su propia
consulta.

### `routersSinSqlInline` — dura, con cuatro excepciones medidas

Un router valida, llama a un seam del dominio y serializa. Con SQL adentro, esa consulta no se puede
testear sin levantar Express, y la regla que expresa no se puede compartir — que es como nacieron
las dos implementaciones de la urgencia (#37).

🔴 **CUÁLES ROUTERS ESTÁN MUERTOS SE MIDE, NO SE DEDUCE.** Se buscó en todo `src/` las llamadas a
cada path montado: de los 16 con SQL adentro, cuatro no los llama nadie — `costoPorLead` (que ni
siquiera está montado en `index.ts`), `decisions`, `leads` y `overview`. Ésos quedan exentos con la
medición escrita al lado: reescribir código que nadie ejecuta para satisfacer una regla es riesgo
sin beneficio. La excepción se levanta el día que la mitad heredada se archive de verdad.

### `docsSinRutasMuertas` — dura

Una ruta muerta en un doc no se lee como error: se lee como que el archivo está en otro lado, y
manda a buscar algo que no va a aparecer. El caso que lo volvió urgente:
`docs/plan-lead-orchestrator.md` describe `bot/planner.ts`, `bot/scoring.ts`, `bot/handoff.ts` — el
bot **se construyó**, con otros nombres, y el plan sigue mandando a buscar los viejos.

🔴 **DOS DEFECTOS DE LA PROPIA REGLA, y valen más que la regla.** La primera versión reportó 226
violaciones y ninguna de las dos causas se ve leyendo la lista:

1. **La alternancia de una regex prueba en orden.** Con `\.(?:ts|tsx|…)`, `Avatar.tsx` matchea como
   `Avatar.ts` y la `x` queda afuera: **60 de 118 «rutas muertas» eran archivos `.tsx` citados
   bien**. Va `tsx` antes que `ts`.
2. **El mapa se citaba a sí mismo**: lista las rutas muertas como violaciones, y el chequeo las
   volvía a encontrar ahí. 123 de más.

Y dos clases legítimas que la regla tiene que respetar: una ruta escrita **relativa al server**
(`src/pruebas/base.ts` al lado de un `cd server &&`) no está muerta, y un doc que cita una ruta de
**otro repo** (Centurión, Bravo) tiene que calificarla en vez de borrarla.

**La lección general: una regla nueva reporta su propio bug antes que el del repo.** Antes de mandar
a arreglar 118 cosas, abrí diez y comprobá que están mal de verdad.

### `moduloDeclarado` — dura

Un módulo sin responsabilidad escrita es un módulo del que nadie puede decir si un archivo nuevo le
corresponde. Es la pregunta que decide dónde va cada cosa, y es lo único del mapa que un generador
no puede derivar.

---

## Lo que este ADR NO hace

- **No archiva la mitad heredada.** Sigue montada y desconectada (ADR 0001). Lo único nuevo es que
  ahora está *marcada*: cada módulo suyo lleva 🪦 en su responsabilidad declarada, así que la lista
  se puede verificar sola en vez de creerse.
- **No toca el schema, ni las migraciones, ni ningún contrato HTTP.** Los 54 sitios de SQL que
  salieron de los routers se movieron con el texto idéntico.
- **No resuelve los nudos de módulos que quedan** (7 · 3 · 2 en el front, 22 en el server). Están
  reportados en el mapa; bajarlos es un frente propio.

## Trampa conocida

🔴 **Los tests-candado que LEEN el árbol no los alcanza el compilador.**
`server/src/whatsapp/lid.paridad.test.ts` abre un archivo del front con `new URL(...)` para cruzar
`PREFIJO_LID`. Mover ese archivo fue un **ENOENT en tiempo de ejecución** con el typecheck en verde
de las dos mitades. Al mudar un archivo que algún test cruza por ruta, `grep -rn` de la ruta vieja
en `server/src` y `src` **antes** de dar por buena la mudanza.

## Cómo se usa

```bash
npm run mapa            # regenera docs/mapa.md
npm run mapa:verificar  # lo que corre en N1: falla si hay violaciones o si el mapa quedó viejo
```

Al agregar un módulo, escribí su responsabilidad en `arquitectura.json` o el CI no pasa.
