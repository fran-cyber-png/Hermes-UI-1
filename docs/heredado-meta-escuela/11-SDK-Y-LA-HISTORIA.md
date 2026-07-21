# El SDK Governa, la capa 1 y la historia real

> Estado al 2026-07-16. Commits: `8f3ce68` (SDK), `07c7962` (cuarentena de CQs), `ee3c35b`
> (capa 1 + backfill), `2418879` (fuente única de estados).

---

## Qué hay ahora que no había ayer

| | antes | ahora |
|---|---|---|
| Historia de Meta | **3,1 días** | **37 meses** (96.131 filas diarias) |
| Eje del tiempo del negocio | no existía | **15.998 hechos**, 2024-01-06 → 2026-07-13 |
| Capacidades introspectables | 0 | **10 Tools** con JSON Schema |
| CQs exportables a LoRA sin verificar | 105 de 105 | **0** |
| Lugares que definen los estados de venta | 4 | 1 |

---

## 1. El SDK Governa — `server/src/sdk/`

**El problema que resuelve.** La única forma de llegar a la lógica de negocio era por endpoints con
forma de **pantalla**. `/api/overview` devuelve **62 KB** —24 creativos con su copy, 15 filas crudas
de la bandeja— porque eso necesita la home. Ivi se lo traga entero para preguntar "¿cuánto vendimos
en junio?", con un `num_ctx` de 8k.

```
GET  /api/sdk/catalogo          qué puede responder el sistema + JSON Schema de cada entrada
POST /api/sdk/invocar/:nombre
```

### Las Tools

```
governa.lazo.ventanaCapi        governa.tesoreria.latencia    governa.historia.deVenta
governa.lazo.estado             governa.tesoreria.reloj       governa.historia.resumen
governa.lazo.detalle            governa.ventas.estados        governa.pauta.serie
governa.atribucion.roasPorPais
```

### La regla que las mantiene sanas

**Una Herramienta DECLARA lógica que ya existe; no la implementa.** Si escribiendo una Tool aparece
un cálculo, ese cálculo va a `dominio/`, `analisis/` o `canales/` — donde se testea puro y donde el
resto del sistema ya lo puede usar. El SDK es una fachada, no una capa de negocio.

Eso es lo que mantiene al modelo **reemplazable**: la inteligencia vive en el código y en los datos,
nunca en el prompt ni en los pesos.

Cada Tool declara `cqIds` (qué preguntas responde) y `fuentes` (`file:line` de dónde sale su verdad).
El JSON Schema sale de `z.toJSONSchema()` (Zod 4): **una sola declaración** valida en runtime, tipa
en compilación y documenta para el modelo. Tres cosas que, escritas aparte, divergen.

### Consumidores, por orden de llegada

1. `kos cq verify` — hoy
2. **Ivi** — pendiente. Hoy sigue leyendo el BFF de las pantallas y su catálogo vive escrito a mano
   en Python, en otro host (`goberna-kos/ivi/data_planner.py:12-52`)
3. Un servidor **MCP** — es un adaptador sobre `catalogo()`
4. **Tool calling** — cuando Qwen lo soporte bien. El contrato ya está

---

## 2. La capa 1 — `ontologia.hechos`

`docs/specs/2026-07-12-ontologia-goberna-design.md:172` define tres capas y llama a la separación
*"no negociable"*:

| capa | qué | regla |
|---|---|---|
| 0 — Bitácora | el JSON crudo | inmutable, solo para auditar y re-derivar |
| **1 — Hechos** | **lo que pasó** | **inmutable, SIN OPINIÓN** |
| 2 — Inferencias | lo que un modelo cree | tabla aparte, **con versión de modelo** |

> *"Si se mezclan, en seis meses nadie puede distinguir qué pasó de lo que un modelo creyó que
> pasaba."*

**La capa 2 (`inferencias`) todavía no existe.** Es lo que va a permitir enrutar entre Qwen local
(geógrafo) y Gemini firmando cada inferencia con `modelo` + `modelo_version` + `confianza`, para
poder compararlos, re-inferir sin tocar un hecho, y reemplazar el modelo sin perder nada.

### Los tres tipos de hecho, y por qué son solo tres

```
PagoRegistrado   7.255    fecha_pago          — un asesor DIJO que se pagó (autoreportada)
VentaCreada      6.727    fecha_venta
PagoConfirmado   2.016    fecha_confirmacion  — Tesorería VIO el voucher
                ──────
                15.998    2024-01-06 → 2026-07-13
```

**La regla: un hecho necesita un momento REAL, no uno plausible.**

**No existen `VentaAnulada` ni `VentaReembolsada`**, y no es un olvido. Hay 129 ventas terminales
(estados 4, 5, 7, 8) y **nadie sabe cuándo se volvieron terminales**: Cerberus guarda el estado
final, no la transición. El único candidato era `fecha_edicion`, y se midió: **4.849 de las 6.448
ventas SANAS también la tienen posterior**. Significa "alguien tocó esto", no "se anuló acá".

Que la venta esté anulada sigue siendo cierto y sigue en `ontologia.venta.estadoSemantico`. Lo que
no existe es su **momento**. Un hecho sin cuándo es una fila con una fecha inventada esperando a que
alguien la cite. **Es un gap de Cerberus: el ERP no tiene bitácora de cambios de estado.**

**`PagoRegistrado` y `PagoConfirmado` son dos hechos y no uno** porque el hueco entre ellos ES el
negocio. Y fue exactamente esa separación la que destapó que el lazo disparaba con el primero
(ver `10-EL-LAZO-Y-TESORERIA.md` §3).

```bash
npm run cerberus:hechos    # re-proyectable: se puede borrar la tabla y rehacerla
```

---

## 3. La historia de Meta — `pauta_serie`

**Meta retiene 37 meses de insights diarios y nunca se los pedimos.** `recolectar.ts:71` pide
insights **sin** `time_increment`, así que Meta devuelve una fila agregada del período. El reloj
guardaba esa foto cada 6 h. Resultado: **3,1 días** de historia.

La serie estaba del otro lado de un parámetro.

### Lo que se midió contra la API real

**Retención: 37 meses.** Más atrás: `ERROR(3018) "The start date of the time range cannot be beyond
37 months"`.

**Y no se le pueden pedir de una.** A nivel `ad`, 37 meses da HTTP **400**; a nivel `campaign`, HTTP
**500**. **No es rate limit** (Meta reportaba `call_count=1%`) ni permisos: es el **tamaño de la
consulta**.

```
14 días → ✓   125 filas ·  1,0 s        6 meses → ✓ 1.039 filas · 13,9 s
 1 mes  → ✓    96 filas ·  0,6 s       37 meses → ✗ HTTP 400
 3 meses→ ✓   447 filas ·  2,6 s
```

> **Un HTTP 500 de la Graph API casi nunca es "Meta está caído": es "la consulta es muy grande".**

Por eso `pauta/ventanas.ts` trocea en **3 meses** — el punto dulce, medido.

### El resultado

```
nivel     | filas  | entidades | cuentas | ventana
account   |  6.119 |        15 |      15 | 2023-06-18 → 2026-07-15
campaign  | 30.393 |     1.567 |      14 | 2023-06-18 → 2026-07-15
ad        | 59.619 |     4.677 |      15 | 2023-06-18 → 2026-07-15
          ────────
            96.131 filas · 39 min · 22 trozos fallidos de ~540 (4%, 500s transitorios)
```

### Dos decisiones de diseño

**El backfill mira TODAS las cuentas del token (24), no las 19 de config.** Son trabajos distintos:
el **reloj** vigila el **presente** (una cuenta cerrada no tiene presente), el **backfill** rescata
el **pasado** (una cuenta cerrada sí tuvo pasado, y fue plata real). Chile lo justifica: **toda su
historia de 2024 (1.096.021 CLP) vive en la cuenta deshabilitada**; la activa es otra. Excluirla
dejaba un agujero justo donde la cuenta migró.

**Filtra por gasto antes de trocear.** De las 24, solo **15 gastaron** en la ventana. Sin el filtro
se pedían 36 trozos a cada cuenta vacía: ~324 llamadas garantizadas estériles.

**La serie NO convierte monedas.** Hornear una tasa en un hecho es una mentira futura: las tasas
cambian, y una fila de 2023 convertida con la tasa de hoy es falsa con formato de dato. La
conversión es análisis y se aplica al leer (`analisis/tasas.ts`).

```bash
npm run backfill                        # los 37 meses, los 3 niveles (~40 min)
npm run backfill -- --niveles=account   # rápido, para probar
```

---

## 4. La cuarentena del Capability Registry

**Las 105 CQs del CQ Engine se inventaron y nunca se contrastaron con el código.** Todas con
`source: 'domain_analysis'`, `contentHash: ''`, sin `validatedAt` — pero marcadas `status: 'active'`,
y los producers dejaban salir `active` hacia **LoRA** y **benchmarks**.

Dos ejemplos verificados:

| CQ | afirmaba | la verdad |
|---|---|---|
| `cq-ventas-002` (critical, **0.98**) | 4=en_curso, 5=retirado, 7=anulado | **4=Anulado, 5=Cotización, 7=Retirado**. Y son **8** estados, no 7 |
| `cq-tesoreria-010` (critical, **0.97**) | "Tesorería tiene 7 días hábiles" | **no existe tal SLA** — su ausencia es la tesis de esa pantalla |

En geógrafo ya existía `lora-ventas.jsonl` y `train-ventas-lora.py`. **Lo único que impidió entrenar
sobre datos falsos fue un conflicto de dependencias de torch.** Suerte, no diseño.

**El arreglo**: `verificada.ts` invierte el default — nada sale sin `status='validated'` **Y**
`validatedAt`. `answeredBy` liga cada CQ a una Tool; `kos cq verify` ejecuta la Tool y muestra **las
dos versiones**, la del registro y la del código. **No decide quién miente**: `--aprobar` es un acto
humano con nombre y fecha, porque el código también puede estar mal — verificar `cq-ventas-002` fue
lo que destapó que la doc omitía el estado 8 y que `proyectar.ts` manejaba un estado 9 inexistente.

```
exportable a LoRA:  105 de 105 (0 verificadas)  →  4 de 105 (4 verificadas)
cobertura:          100% (medía "está escrita")  →  3,8% (mide "verificada contra su Tool")
```

Aplica la regla que el proyecto ya se había dado y no se aplicaba a sí mismo
(`04-REALITY-GAPS.md:27`): **"El modelo solo acepta entidades en estado VERIFIED."**

```bash
cd goberna-kos
npx tsx src/cli/index.ts cq verify --cq=cq-ventas-002
npx tsx src/cli/index.ts cq verify --aprobar=cq-ventas-002 --quien=tu-nombre
```

---

## 5. Lo que quedó pendiente

| | |
|---|---|
| ~~La home muestra el ROAS sobre un snapshot vacío~~ | **Arreglado el 16/07** (`9b0bedf`): `ultimoSnapshot` solo sirve recolectas limpias. Ver `10-EL-LAZO-Y-TESORERIA.md` §6 |
| **Ivi sigue leyendo el BFF de las pantallas** | Su catálogo vive a mano en Python, en otro host |
| **`inferencias` (capa 2) no existe** | Es lo que habilita el router Qwen/Gemini con trazabilidad |
| ~101 CQs en cuarentena sin auditar | **Contenidas**, no resueltas |
| Qwen3 **8B** desplegado, la Constitución asume **14B** | `Modelfile.ventas:1` |
| Producción corre en un portátil | `ivi/config.py:4` → `BACKEND=http://100.98.60.92:4100` |
| Ivi sin systemd | `nohup` suelto; no sobrevive un reinicio de geógrafo |
| `META_TEST_EVENT_CODE` ausente | Un envío real entra al modelo de Meta. Por eso `LAZO_RELOJ` arranca apagado |

---

## El método que funcionó (repetirlo)

1. **Medir el piso de ruido antes de medir el cambio.** Capturar el endpoint dos veces seguidas para
   saber qué se mueve solo. Volátiles conocidos de `/api/overview`: `pauta.edadMinutos` y
   `accionable.horasRestantesMasUrgente` (cuenta regresiva contra `now()`), más los conteos de
   ventanas móviles (`rango=30d`).
2. **Probar "no rompí X" con `git stash`**, capturando con y sin el cambio con segundos de
   diferencia, y comparando sha256. Comparar contra un baseline de hace una hora mide el reloj, no
   el código.
3. **Un 0 nunca es una respuesta: es una pregunta.** El sondeo de retención de Meta dio 0 filas y
   casi concluyo que no había historia — era una cuenta sin gasto. El Reloj de Tesorería mostraba 0
   pagos y era un JOIN roto. `Listas para Meta: 0` significaba "Meta ya las tiene todas".
4. **Preguntarle a la base, no al código.** Los estados de venta estaban mal en tres documentos y en
   una CQ crítica. Los datos los tenían bien.
5. **Cuando un comentario declara una regla, verificar que el código la aplique.** Cuatro de los
   cinco hallazgos del día son comentarios correctos junto a código que hace otra cosa.
