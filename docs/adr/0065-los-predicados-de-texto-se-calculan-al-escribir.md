# ADR 0065 — Los predicados de texto se calculan al escribir, no en cada lectura

**Fecha**: 19-ago-2026
**Estado**: aceptado — server, **necesita N5** y un paso de backfill después del N5.
**Sale de** `docs/plan-mensajes-en-paralelo.md` §A4 (medición del 19-ago contra producción).
**Aplica el molde de** #185 (`interactions.numero_propio`): lo que se deriva del contenido de una
fila se materializa **en** la fila.
**No toca** ninguna regla de negocio: `cola/precio.ts` y `cola/pregunta.ts` siguen siendo la única
definición. Lo único que cambia es **cuándo** corren.

---

## Lo medido, y es el número que justifica todo

`GET /api/conversaciones` tarda ~2,3 s en producción y **el 64 % es armar el universo**: un
`CREATE TEMP TABLE todo` de **21.024 caracteres con 19 regex y 17 agregados** sobre 16.254 filas,
que produce 5.645 grupos.

Plan real del 19-ago-2026 (VPS1, load 1,4–1,9, cuatro corridas):

```
GroupAggregate  (actual time=290..1520 … 381..1862, rows=5645)
  └─ Sort       (actual time=278..311  … 380..414,  rows=16254)
```

**El `GroupAggregate` solo quema 1.205–1.449 ms de CPU propia** (mediana ~1.386), o sea el **58 %
del pedido entero**.

Contrafáctico read-only, con el **mismo SQL capturado** y la misma base, neutralizando **sólo** las
19 aplicaciones de regex:

| | GroupAggregate propio | exec de la tabla temporal |
|---|---:|---:|
| con regex (hoy) | 1.339 · 1.435 · 1.541 ms | 1.718 · 1.831 · 1.980 ms |
| sin regex (techo) | **70 · 74 · 79 ms** | **466 · 492 · 491 ms** |

**Los regex son el 95 % de ese nodo.** No es una intuición: es el mismo texto de consulta corrido
dos veces con una sola diferencia.

Y lo que esos regex contestan son **preguntas sobre el texto de un mensaje, que no cambia nunca**:
¿mencionó precio? ¿preguntó por plata? ¿fue sólo el clic del anuncio? Se recalculaban **13.152
veces por día** para **220 mensajes que se escriben una vez**.

## La decisión

Cuatro columnas nullables en `interactions` (migración **0038**, expand-only), llenadas por los
escritores, y el gemelo SQL pasa de **calcular** a **leer**:

| columna | función pura | módulo |
|---|---|---|
| `menciona_precio` | `mencionaPrecio` | `cola/precio.ts` |
| `pregunta_precio` | `preguntoPrecio` | `cola/pregunta.ts` |
| `pide_datos` | `pidioDatos` | `cola/pregunta.ts` |
| `es_texto_de_anuncio` | `esTextoDeAnuncio` | `cola/pregunta.ts` |

### 🔴 La regla no se mueve ni se copia — cambia cuándo corre

`cola/precio.ts` y `cola/pregunta.ts` siguen siendo la única definición. `cola/predicadosDelTexto.ts`
no decide nada: junta las cuatro funciones puras que ya existían y las corre al escribir. El
backfill **llama a esa misma función**, no a un `UPDATE ... ~*`, para que una fila vieja y una fila
nueva no puedan salir distintas.

Materializar agrega una **tercera** forma de decir lo mismo (pura · SQL · columna), y las tres
tienen que coincidir. `predicadosMaterializados.paridad.test.db.ts` las cruza sobre el corpus de
producción y, sobre todo, corre **la cola entera dos veces** —con las columnas en `NULL` y llenas—
y exige que la respuesta sea idéntica hasta el `deepEqual`.

### 🔴 El fallback es parte del diseño, no un andamio

Cada lectura es `COALESCE(columna, <el regex de siempre>)`. La migración es expand-only: entre el
N5 y el backfill toda la tabla está en `NULL`, y sin el `COALESCE` la cola contestaría «nadie
preguntó nada» — que no es degradar hacia lo de hoy, es **otra respuesta**.

`NULL` significa **una sola cosa**: «esta fila es anterior al backfill». Un audio o una foto se
guardan con los cuatro en `false`, porque eso es lo que contestan las funciones puras. Si `NULL`
significara también «sin texto», esas filas pagarían regex para siempre.

**Se evalúa por fila y no por grupo**, y eso es deliberado. El fallback a nivel de grupo pediría
agregar por separado el veredicto y el texto con el mismo `ORDER BY`; dos ordenamientos distintos
pueden desempatar distinto y quedaría el predicado de una fila con el texto de otra. Medido, la
diferencia de costo del fallback por fila es **+7 %**, y dura lo que tarda el backfill (1,2 s).

### 🔴 «El único escritor» eran DOS

El plan decía que había uno (`meta/proyectarInteraccion.ts`). Son dos, y el que importa es el otro:
**`whatsapp/repositorioDrizzle.ts`** escribe el 100 % de las filas que la cola agrupa. Llenar sólo
el primero habría dejado el frente **sin efecto y verde en todos los tests**: el regex de respaldo
cubre lo que falte, así que el síntoma no habría sido un error sino que la cola siguiera costando
lo mismo. `escritoresDePredicados.paridad.test.ts` lee el árbol y exige que **cualquier**
`.insert(interactions)` de producción corra `predicadosDelTexto`.

### 🔴 Tocar el regex deja las columnas viejas mintiendo

Es la contracara de materializar, y es la deuda que este ADR crea: `cola/precio.ts` y
`cola/pregunta.ts` dejaron de ser «la regla que corre siempre» para ser «la regla que corrió cuando
se escribió la fila». Cambiar una palabra del regex y no re-correr el backfill con `--todo` deja el
predicado viejo congelado en las 16.494 filas existentes, **sin error y sin log** — el modo exacto
de fallar que este repo ya pagó con `info\b`.

## Lo medido después — pareado, misma máquina, mismos datos

Copia de producción restaurada en local (16.494 `interactions`, 43.833 `events`, 26.235 `leads`),
`VACUUM (ANALYZE)` antes de cada mitad, cinco corridas ya calientes
(`server/scratchpad/medir-predicados.mts`):

| | GroupAggregate propio | `consultarCola` entera |
|---|---:|---:|
| **antes** (`origin/main`) | 502–518 ms | 821–896 ms |
| ventana N5 → backfill (columnas en `NULL`) | 536–549 ms | 854–884 ms |
| **después** (backfill corrido) | **30–33 ms** | **358–388 ms** |

**−94 % en el nodo y −57 % en el pedido entero.** El backfill de las 16.494 filas tarda **1,2 s**.

## Lo que este ADR NO hace

- **No esconde ni una conversación.** Es el mismo predicado, calculado antes. El candado que lo
  prueba es la comparación `deepEqual` de la cola entera por los dos caminos.
- **No toca `preguntoSql(columna)` / `preguntoPrecioSql` / `soloClicSql`**, los que corren sobre un
  texto suelto (comentarios de FB/IG, `/api/interactions`, `/api/overview`). Siguen siendo regex:
  no están en el camino caliente —la rama de comentarios devuelve 0 filas en la cola— y cambiarles
  la firma tocaría cuatro archivos de otros frentes. La definición sigue siendo una sola.
- **No toca `dashboard/negocio.ts`**, que arma su propio `precio_enviado` con el mismo
  `PRECIO_REGEX_FUENTE`. Es otro endpoint y otro `FROM`; queda anotado como lo próximo que se
  beneficia gratis.
- **No agrega un índice.** Las columnas se leen en el `SELECT`, nunca en un `WHERE`: un índice sería
  costo de escritura sin lector.

## Cómo se despliega

1. **N5** — aplica la migración 0038 y reinicia. Desde acá la cola contesta lo de siempre y cuesta
   lo de siempre (+7 %).
2. **El backfill, enseguida** (~1,2 s):
   ```
   ssh deploy@161.132.39.165 'cd /srv/hermes/server && npm run predicados:backfill -- --aplicar'
   ```
   Dry-run por default; sin `--aplicar` sólo cuenta.
3. Verificar **contando filas**, nunca por el color del workflow:
   `SELECT count(*) FROM interactions WHERE menciona_precio IS NULL` tiene que dar **0**.
