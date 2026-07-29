# Los tres planes — Cerberus · Hermes · Ivi, conectados y verificables

> Pedido del dueño (29-jul-2026): *«3 planes: ivi, hermes, cerberus — bien conectados y comprobados
> que todo está siendo data actualizada y bien formateada y buena. Tenemos que ser críticos con el
> RAG / el contexto / las respuestas: tiene que llegar a ser muy útil Ivi y Hermes.»*
>
> Todo lo afirmado acá está medido en las sesiones del 27–29 jul (censo, auditorías, deploys) o
> citado de los docs con medición. La tesis que ordena los tres: **cada sistema es dueño de UNA
> verdad, la exporta por UN contrato con edad declarada, y nada verde sin fecha del dato** — la
> lección que apareció tres veces en dos días (el `/health` de Ivi, el `Up (healthy)` del bot, el
> Grafana sirviendo abril).

---

## 0. El principio de conexión: quién es dueño de qué, y por qué costura viaja

```
   CERBERUS (la verdad del negocio)          HERMES (la conversación y el lazo)
   productos · precios · clientes            piezas · envíos · procedencia · resultados
   ventas · matrículas · medio               señales · telemetría de gestión
        │                                         │
        │ ①contrato tipado (precio/ficha/         │ ③catálogo de piezas (ADR 0023, vivo)
        │  venta/matrícula/medio) + fixtures      │ ④SIN_EVIDENCIA → lista de ingesta
        │ ②webhook fan-out (venta → lazo)         │ ⑤destilación A_MANO → piezas candidatas
        ▼                                         ▼
                          IVI (el cerebro que redacta, jamás inventa)
                          números por SQL vivo · texto por RAG curado
                          responde con tipo + grounding + edad del dato
```

**Las cinco costuras** son el plan de conexión entero. Tres existen a medias, dos no existen. Nada
más cruza: Ivi no le escribe a nadie (devuelve ids, ADR 0023), Hermes no toca la MySQL de Cerberus
más que por el contrato, y ningún dato de conversación cruda entra al índice de Ivi (destilación,
no ingesta).

---

## 1. PLAN CERBERUS — que la verdad sea consumible sin intimidad

Cerberus es correcto como fuente de verdad; el problema es que se consume por scraping de HTML y
webhooks mono-destino. El plan: **rodearlo de contrato, no reescribirlo.**

| # | Qué | Estado / issue | Por qué primero |
|---|---|---|---|
| C1 | **El deploy dice la verdad**: restart incondicional en el workflow | ceberusapp#12 (1 línea) | Sin esto, todo fix de C2–C4 puede quedar 2 días muerto en disco con el run verde (le pasó al PR #3) |
| C2 | **Cerrar las puertas abiertas**: `@login_required` en clientes y despachos | ceberusapp#9 #10 (críticos) | La verdad del negocio hoy la puede leer/mutar un `curl` anónimo |
| C3 | **CI mínimo**: correr los 52 tests que ya existen + `makemigrations --check` en PRs | ceberusapp#13, #11 | Mergear es desplegar; hoy sin un solo gate |
| C4 | **El contrato v0, del lado consumidor**: fixture literal `CUERPO_REAL_DE_CERBERUS` en Hermes para las 5 cosas (producto/precio por familia · ficha por teléfono · venta · matrícula · medio) + test de paridad que se pone rojo si Cerberus renombra un campo | nuevo — el patrón ya existe (`CUERPO_REAL_DE_IVI` + `paridad-front.test.ts`) | Es lo que convierte «Hermes conoce el interior de Cerberus» en una dependencia declarada. **La moneda (#43) entra acá**: hoy la API pública la manda vacía, y eso duerme la rama de moneda de FX-0 y deja al Foro «sin moneda» |
| C5 | **Fan-out del webhook de ventas**: AGREGAR destino Hermes (🚨 jamás repuntar el de icarus/Tejada) | E2 del plan de agosto | Es la costura ② — sin ella el lazo de Hermes depende del puente temporal por icarus |
| C6 | **Matrículas por API** (la tajada mínima) | habilita hermes#159 (los 5 que pagaron hace 4 meses sin acceso) | Primera extensión del contrato C4; goberna-dashboard será su segundo consumidor (la prueba del gate de generalización, E6) |

**El gate de «data buena» de Cerberus**: cada campo que exporta tiene UN consumidor con fixture y
test de paridad. Cuando el dashboard entre como segundo consumidor sin código nuevo del lado de
Cerberus, el contrato está probado.

---

## 2. PLAN HERMES — cerrar el lazo y emitir señal limpia

Hermes ya captura la conversación y la procedencia; lo que falta es que **la consecuencia cierre**
(¿esta pieza vende?) y que su señal alimente a Ivi sin ruido.

| # | Qué | Estado / issue | Nota |
|---|---|---|---|
| M1 | **Semana del 3-ago**: mergear #224 (en re-review) y #223 (listo local) → **UN N5 antes del domingo** → lunes el checklist `MODO=real` por vendedora | PRs en vuelo · `docs/checklist-3ago/` | Con #106 desplegado, un restart ya no desloguea. La adopción es el prerrequisito de TODO: sin vendedoras adentro no hay señal |
| M2 | **E1 restante**: #203 (media autorizada — necesita diseño de nombres opacos) · #94 (CORS) | abiertos | perímetro completo |
| M3 | **FX-0 la compuerta de precio vencido** | #226 (spec completa, 2 PRs) | Protege ingresos YA y es el primer caso de «la imagen dice la verdad» |
| M4 | **E2 — el lazo cierra**: #180 PRIMERO (el `orden` del paso que se recalcula corrompe `12#3`), después #187, #186, y el `WHERE` de `resultados/ventas.ts` cuando C5 entre | abiertos | Es la costura que convierte envíos en CONSECUENCIA medida — el insumo del que Ivi va a aprender qué funciona (con Wilson y `n`, nunca causa prometida) |
| M5 | **La señal para Ivi**: el catálogo de piezas ya se sirve (ADR 0023); sumar la **destilación A_MANO** (los envíos improvisados que obtuvieron respuesta — el semillero de ADR 0022, costura ⑤) y los issues chicos de calidad (#221 #222 #217–#219) | parcial | La destilación NO lee conversaciones: lee los envíos a mano que funcionaron — chico y de altísima señal |

**El gate de «data buena» de Hermes**: los tests de paridad existentes (urgencia · piezas · curso)
más dos nuevos números que se miran cada semana: `piezas:resultados` (¿alguien usa las piezas?) y
el reparto por línea (la consulta de guardia de #185, tiene que dar 0 sin atribuir).

---

## 3. PLAN IVI — de «explica cómo se construyó Ivi» a «responde lo que la vendedora pregunta»

El motor está bien construido (Ley I con backstop real, gates, reranker que degrada). Lo que está
mal es **el corpus (86,6 % ingeniería, 0,8 % procedimientos)** y **la frescura (governa.* congelada
desde el 13-jul con `/health` verde)**. El plan es demanda-primero:

| # | Qué | Depende de | El gate crítico |
|---|---|---|---|
| I1 | **A0 — encender la demanda**: desplegar `POST /api/preguntar` en geografo DESDE `ivi-cerebro` (hoy Hermes come 404) | nada — es lo más barato del frente | La tecla `i` responde; `chat_interacciones` empieza a medir |
| I2 | **P5 — el golden de VENDEDORA, escrito ANTES de ingestar**: «¿el diploma da certificado?» «¿se puede en cuotas?» «¿qué hago si pagó y no entró?» — las preguntas del checklist y de las 1.876 conversaciones | I1 para calibrarlo con demanda real | **Sin este golden, «ingestamos el negocio» no tiene criterio de terminado.** Corre en el gimnasio (`--vendedora`) con umbral, como el `--negocio` del CEO |
| I3 | **P1+P2 — partir el corpus e ingestar el negocio**: dos colecciones (negocio/ingeniería, el router elige — no una penalización con techo); el catálogo de cursos **NO se escribe a mano: se DERIVA del contrato C4** (la misma fuente que Hermes, con edad declarada); objeciones; los 4 hechos de #153; las políticas CON DUEÑO asignado (hoy los 4 procedimientos dicen «pendiente — sin asignar») | C4 · I2 | Cada documento con `dueno` y `vigente_desde` o no entra. La lista de prioridad la dan los `SIN_EVIDENCIA` agrupados (costura ④), no la intuición |
| I4 | **P4 — la frescura deja de mentir**: la Capa 2 declara `edad_del_dato` en CADA hecho, y `governa.*` o recibe dueño+SLO o se reemplaza (la decisión (a)/(b) de hermes#95: el SDK de Hermes detrás de credencial de servicio, o retirar esa ruta) | decisión chica del dueño | **Regla dura nueva: ningún número sin edad.** Hermes ya la aplica del lado cliente («null es NO MEDIDO, no fresco»); falta que el otro extremo la produzca |
| I5 | **FX-2 — geografo↔Bedrock** en el orden medido: transporte (boto3/sidecar) → reranker → store+servicio a VPS1 → embedder con re-ingesta — **con el gimnasio antes y después de cada paso** | pregunta Bedrock del dueño (§6.5; el 99,4 % del corpus ya es no-sensible) | Es AHORA que nadie depende de Ivi — el momento más barato. Al final, un crash de la workstation no deja sin cerebro a las vendedoras |
| I6 | **A1–A5 — el ciclo de aprendizaje**: destilación que PROPONE (molde ADR 0019, aprueba una persona) · episodios a mano (la tabla lleva días vacía) · retención 90/90/30/30 (la política ya está en la base, nadie la corre) · caducidad por resultado (necesita M4) | I1–I3 · M4 | Nada entra al índice sin aprobación humana; el corpus es acotado y curado, el log crece sin límite y el LLM no lo lee |

**Los gates críticos de RAG/contexto/respuestas** (lo que hace que Ivi llegue a «muy útil», medido
y no declarado):

1. **El golden de vendedora en CI** — el gimnasio corre en cada cambio de ivi-cerebro; bajar del
   umbral bloquea el deploy. Cambiar de modelo/embedder exige gimnasio antes y después.
2. **El `dueno-exigente` como auditor mensual**: una vez vivo A0, el agente adversario interroga el
   chat real, verifica cada número contra la base viva, y produce la lista priorizada de gaps. La
   crítica no es una opinión: es una corrida con artefacto (`auditoria.py` ya existe).
3. **El tablero de utilidad**, desde `chat_interacciones` (ya instrumentado): tasa de
   `SIN_EVIDENCIA` (baja = el corpus alcanza) · `grounding_ok` (100 % o hay bug) · `edad_del_dato`
   servida (nada más viejo que su SLO) · costo y latencia por respuesta · **y adopción real: cuántas
   veces por día una vendedora aprieta `i`** — si no la usan, nada de lo anterior importa.
4. **La regla de la casa aplicada al corpus**: un documento sin dueño ni vigencia no se indexa; una
   colección no responde preguntas de la otra; y `SIN_EVIDENCIA` es una respuesta honesta que se
   registra como demanda, jamás un error a esconder.

---

## 4. La secuencia (encaja en el plan de agosto sin moverlo)

| Semana | Cerberus | Hermes | Ivi |
|---|---|---|---|
| **esta (→3-ago)** | C1 (#12, 1 línea) · C2 (#9 #10) | M1: #224+#223 → N5 → checklist lunes | I2 arranca (borrador del golden con las preguntas del checklist) |
| 4–10 ago | C3 (CI) · C4 arranca (fixture de precio/ficha) | M2 (#203 #94) · M3 (FX-0 PR server) | **I1 (A0: el deploy)** · I4 (decisión #95 + edad del dato) |
| 11–24 ago | C4 cierra · C5 (fan-out) · C6 (matrículas) | M3 (FX-0 UI) · M4 (E2: #180 → lazo) | I3 (partir + ingestar con el golden como juez) · I5 arranca |
| 25 ago→ | E6: el dashboard entra al contrato | M5 (destilación A_MANO) | I5 cierra · I6 · primer audit del dueño-exigente |

## 5. Lo que necesita al dueño (sin esto, fases enteras esperan)

1. **¿Bedrock para los documentos de Ivi?** (§6.5) — bloquea el embedder de I5. El 99,4 % del
   corpus ya está marcado no-sensible; los 2 docs sensibles se quedan locales o afuera.
2. **La decisión (a)/(b) de #95** — ¿la Capa 2 de Ivi consume el SDK de Hermes con credencial
   propia, o se retira esa ruta con la mitad de pauta? (10 líneas del lado que sea).
3. **La rotación pendiente** de `GOBERNA_ESCUELA_DB_PASSWORD` (quedó «así nomás por ahora» a tu
   pedido — anotada en el censo).
4. **El resto de la kill-list del censo** (lote 1 tiene 5 veredictos esperando firma; kathy y
   Grafana ya ejecutados por tu firma del 29-jul).
