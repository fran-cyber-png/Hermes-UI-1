# El lazo y Tesorería — qué se midió y qué resultó falso

> Análisis del 2026-07-16. Todo lo de acá se midió contra la base de producción y la API de Meta.
> Cada afirmación lleva cómo verificarla. Si algo no se pudo medir, dice que no se pudo.
>
> Commits: `65e44c6` (respaldo del lazo), `04ac3a7` (el cron), `ee3c35b` (la capa 1 que lo destapó).

---

## Resumen para quien tiene 30 segundos

1. **Tesorería no es el cuello.** Su p90 es **4 días**, no 10. El 94,3% confirma dentro de la
   ventana de Meta.
2. **El cuello era un cron que no existía.** 273 ventas / **$32.926 USD** confirmadas entre el
   16/06 y el 04/07 que Meta nunca vio. Confirmadas hace menos de 8 días: **cero**.
3. **Tres eventos salieron a Meta con una fecha que tipeó un asesor**, no con la confirmación de
   Tesorería.
4. **Un cron diario sin filtro habría sido peor que no tener cron**: habría mandado 44 compras
   duplicadas por día.
5. **La home muestra el ROAS sobre un snapshot vacío.** Sin resolver (ver §6).

---

## 1. El p90 de Tesorería es 4 días, no 10

Toda la documentación previa repite *"el p90 de confirmación de Tesorería es 10 días"*
(`04-REALITY-GAPS.md`, `01-MUNDO.md`, `lazo/worker.ts:21`). **Es falso.**

| | valor |
|---|---|
| p50 | **2 días** |
| p90 | **4 días** |
| p95 | 9 días |
| p99 | 41 días |
| peor | 292 días |
| dentro de la ventana de Meta (≤7 d) | **1.902 de 2.016 — 94,3%** |

Verificado por dos caminos independientes que coinciden: `ontologia.hechos` (tipo
`PagoConfirmado`) y `analisis/comercial.ts:latenciaTesoreria` (que lee `ontologia.pago`).

```bash
curl -s -XPOST localhost:4100/api/sdk/invocar/governa.tesoreria.latencia | jq .salida
```

**Advertencia que va con el número:** los percentiles salen de 2.016 pagos con
`fecha_confirmacion`. Hay **5.239 pagos válidos sin esa fecha** que no entran en ningún
percentil. El p90 puede ser optimista justamente por eso: los que nunca se confirmaron son, por
definición, los peores.

**Y solo hay 5 meses de datos.** `PagoConfirmado` va del **2026-02-16** al 2026-07-12, contra los
2,5 años de `PagoRegistrado`. Cerberus empezó a registrar `fecha_confirmacion` en febrero de 2026.
Cualquier afirmación sobre la latencia histórica de Tesorería antes de esa fecha **no tiene datos
que la sostengan**.

---

## 2. `fuera_de_ventana` no mide a Tesorería. Nos mide a nosotros.

Esto es lo más importante del documento.

`lazo/evento.ts:128` calcula:

```ts
const atrasoMs = ahora.getTime() - venta.confirmadaAt.getTime();
if (atrasoMs > VENTANA_CAPI_DIAS * 86_400_000) return { ok: false, motivo: "fuera_de_ventana" };
...
event_time: Math.floor(venta.confirmadaAt.getTime() / 1000),
```

El `atraso` es **`ahora − confirmadaAt`**: el tiempo entre que Tesorería confirmó y **nosotros
enviamos**. Y como `event_time = confirmadaAt`, con el lazo corriendo a diario el atraso es ≤ 1 día
siempre — **Tesorería puede tardar 30 días y el evento igual entra en la ventana de Meta**.

`worker.ts:21-23` afirmaba lo contrario: *"Ese 17% no se arregla con código: se arregla confirmando
más rápido."* **Es exactamente al revés.**

### La prueba

```
fuera_de_ventana                    273
confirmación más vieja       2026-06-16
confirmación más nueva       2026-07-04
días prom. desde la confirmación     20
confirmadas hace menos de 8 días      0   ←
                                   $32.926 USD
```

Ninguna se perdió por lentitud de Tesorería. Se perdieron porque el lazo corrió **una vez**, el
13/07, y `correrLazo` solo se invocaba desde `scripts/cerberus.ts`, a mano.

### El costo que la latencia de Tesorería sí tiene

No es rechazo por ventana: es **atribución**. Si el clic fue el día 0 y el `event_time` es el día
30, la ventana de atribución de Meta (7 días de clic por defecto) no los conecta — el evento se
acepta pero queda huérfano.

⚠️ **Esto es una hipótesis sobre el comportamiento de Meta, no verificada contra su API.** El
rechazo por ventana sí está verificado.

---

## 3. El lazo mandaba con la fecha que tipea el asesor

`ontologia/ventas.ts:76-79` caía a `fecha_pago` para **cualquier** pago sin confirmar:

```sql
min(coalesce(
  (p.payload->>'fecha_confirmacion')::timestamptz,   -- Tesorería, verificada
  (p.payload->>'fecha_pago')::timestamptz            -- ← el asesor, AUTOREPORTADA
))
```

El razonamiento era defendible (cubrir los 5.228 pagos migrados del Excel, que son de 2024 y caen
en "histórico"), pero **asume que todo pago sin confirmar es viejo**. No lo es.

De las 107 conversiones que Meta ya recibió: **104 con confirmación real, 3 con solo la palabra del
asesor** — GOB-13740, GOB-13745 y GOB-13746, exactamente las 3 que estaban en la bandeja de
Tesorería sin verificar. Y 2 de las 107 tienen algún pago **rechazado** (estado 4; hay 33 en total).

Si Tesorería rechaza uno de esos vouchers, **Meta ya aprendió que esa persona compró y no hay forma
limpia de retractarlo** (`evento.ts:50`).

**Arreglado** (`65e44c6`): el respaldo solo aplica a pagos de más de `HISTORICO_DIAS` (30).
Impacto medido sobre las 6.675 ventas con pago: **6.671 sin cambio, 4 pasan a esperar a Tesorería,
0 cambian de fecha**. Las 4 son de julio 2026. Cero impacto sobre los pagos del Excel.

> **La lección**: `evento.ts:74-75` ya prohibía esto por escrito. El `coalesce` violaba en silencio
> la regla que el módulo de al lado declaraba. **Declarar una regla en un comentario no la aplica.**

---

## 4. El cron diario habría duplicado las conversiones

`correrLazo` **no miraba si una venta ya se había mandado**. Corriendo a mano no se notaba. Con un
cron diario sí: una venta queda enviable durante los 7 días posteriores a su confirmación.

```
día 1 → se envía venta:GOB-X
día 2 → se reenvía → Meta deduplica (< 48 h)   ok
día 3 → se reenvía → pasaron 48 h → DUPLICADO
...   → cuatro duplicados más
```

Medido antes de encender nada:

```
ventas dentro de la ventana hoy    44
  → ya están en Meta               44   (enviadas el 13/07)
  → realmente nuevas                0
horas desde el envío               85   (el dedup de Meta dura 48)
```

El cron sin filtro habría mandado **44 Purchase duplicados hoy**, y otros tantos cada día. Le habría
enseñado al algoritmo que cada cliente compra cinco veces.

**Arreglado** (`04ac3a7`): `yaEnMeta()` lee `conversiones.enviado_at` y filtra.

> **La lección**: el docstring decía *"Idempotente: reenviar no crea una conversión nueva ni en
> nuestra base ni en Meta (dedup de 48 h)"*. La primera mitad es cierta; la segunda **solo vale
> dentro de esas 48 h**. Apoyarse en el dedup de un tercero para no duplicar es apostar contra su
> letra chica — el estado de qué ya mandamos lo tenemos nosotros.

---

## 5. Dónde sí está el problema de Tesorería (y es chico)

Un método de pago está estructuralmente roto:

| método | pagos | p50 | p90 | % tarde |
|---|---|---|---|---|
| **Tran Banco BCP Bolivia (Escuela)** | 26 | **30,0** | 36,0 | **76,9%** |
| Transferencia Reservas RD (Johana) | 51 | 3,0 | 33,0 | 21,6% |
| Transferencia BBVA México | 298 | 2,0 | 4,0 | 6,4% |
| Monedero Yape | 396 | 1,0 | 3,0 | 4,8% |
| OpenPay | 300 | 2,0 | 3,0 | 3,3% |
| *el resto (~1.900)* | | 1-2 | 3-5 | 3-6% |

**La mediana de "BCP Bolivia (Escuela)" es 30 días.** No el p90: la mediana. Y hay **cinco** métodos
distintos solo para Bolivia (BCP Escuela, Union Escuela, BCP Miroslava, Credinet Escuela, Union
Tuco) — el que no tiene dueño claro es el que tarda un mes. **Eso no lo arregla un programador.**

El otro 3-6% es la cola: pagos que caen en un pozo y salen a los 30-44 días. Es lo que describe
`canales/tesoreria.ts` (*"queda enterrado en la página 8 y no vuelve a subir nunca"*, porque Cerberus
ordena por `-fecha_pago`). **El Reloj de Tesorería es el antídoto — y estuvo vacío desde el día uno**
por 5 JOIN contra claves inexistentes (`0419011`).

---

## 6. SIN RESOLVER — la home muestra el ROAS sobre un snapshot vacío

```
creado                | campanas | paises | errores
2026-07-16 13:34:24   |        0 |      4 |   26   ← ESTE sirve la home
2026-07-16 08:12:00   |        1 |      4 |   25
2026-07-15 18:59:22   |      116 |     28 |    0   ← el último bueno
2026-07-14 16:26:25   |        0 |      0 |   34
2026-07-13 20:48:27   |      102 |     26 |    0
```

Los snapshots alternan entre buenos y rotos (`fetch failed` en 26-34 cuentas). Dos bugs se suman:

1. **`refrescarPauta` guarda el snapshot aunque fallen todas las cuentas.** Un cero que parece un
   dato.
2. **`ultimoSnapshot()` toma el más reciente por fecha, sin mirar si sirve.** Una corrida fallida
   pisa a una buena.

Consecuencia: la home muestra **Bolivia · ROAS 10,08× · "subí el presupuesto"** con **$698** de
gasto, cuando `pauta_serie` dice que el gasto real de esos 90 días fue **$16.587**. El ROAS está
inflado ~20× y la recomendación es de grado decisión.

**La defensa ya existe y no se usa**: `snapshot.ts:94` tiene `ultimoSnapshotConCampanas()` con el
comentario *"Los snapshots vacíos (falló la recolecta) se ignoran"*. Solo la usa `pautaMaestro.ts`.
`overview.ts`, `decisions.ts` y `atribucion.ts` usan la insegura.

---

## Cómo verificar todo esto

```bash
# La latencia real de Tesorería (dos caminos)
curl -s -XPOST localhost:4100/api/sdk/invocar/governa.tesoreria.latencia | jq .salida
docker compose exec -T db psql -U meta_escuela -d meta_escuela -c "
  SELECT round(percentile_cont(0.9) WITHIN GROUP (ORDER BY (payload->>'latenciaDias')::int)::numeric,1) AS p90
  FROM ontologia.hechos WHERE tipo='PagoConfirmado';"

# Qué se le mandó a Meta y qué no
docker compose exec -T db psql -U meta_escuela -d meta_escuela -c "
  SELECT coalesce(descarte,'(enviado)'), count(*) FROM ontologia.conversiones GROUP BY 1 ORDER BY 2 DESC;"

# El lazo, sin mandarle nada a Meta
cd server && npm run lazo -- --simular

# Los snapshots: cuáles sirven
docker compose exec -T db psql -U meta_escuela -d meta_escuela -c "
  SELECT creado_at::timestamp(0), jsonb_array_length(campanas) AS campanas,
         jsonb_array_length(errores) AS errores
  FROM pauta_snapshots WHERE rango='90d' ORDER BY creado_at DESC;"
```

---

## El patrón que se repite

Cuatro de los cinco hallazgos tienen la misma forma:

| | la regla estaba escrita | el código hacía otra cosa |
|---|---|---|
| §3 | `evento.ts:74`: "no es fecha_pago, es autoreportada" | un `coalesce` caía a `fecha_pago` |
| §4 | "Idempotente: reenviar no duplica" | no filtraba lo ya enviado |
| §5 | `tesoreria.ts`: "lo más viejo arriba" | 5 JOIN rotos → lista siempre vacía |
| §6 | `snapshot.ts:94`: "los vacíos se ignoran" | solo lo usa `pautaMaestro` |

**Un comentario no aplica una regla. Un test sí.** Los cuatro sobrevivieron porque nada los
ejecutaba: `canales/` y `routes/` no tienen un solo test, y son justo donde vive el I/O.

**El corolario**: cuando un número de este sistema sorprenda, el primer reflejo no debe ser
explicarlo — debe ser preguntarle a la base si es cierto. Los cinco hallazgos salieron de hacer eso.
