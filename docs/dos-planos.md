# Los dos planos de Goberna — documento de posición

> **Qué es esto.** No es un roadmap ni una arquitectura de implementación. Es el **marco conceptual**
> que decide qué se construye, dónde vive, y qué jamás debe tocarse entre sí. Escrito el
> **2026-07-27**.
>
> **Qué NO reemplaza.** [`sistemas-goberna.md`](sistemas-goberna.md) sigue siendo la foto de **cómo
> están conectados hoy** (medida contra producción). Este documento está **arriba** de ese: dice
> **cómo deben plantearse**. Si los dos se contradicen sobre un hecho, gana `sistemas-goberna.md`;
> si se contradicen sobre una intención, gana este.
>
> **Cómo leerlo.** Lo que dice un número está medido. Lo que es propuesta dice **PROPUESTA**. Lo que
> es decisión pendiente del dueño está en §11 y en ningún otro lado.

---

## 0. La tesis en una frase

Goberna no está construyendo una plataforma. Está construyendo **dos máquinas con la misma
maquinaria adentro y ninguna tubería entre ellas**:

| | **Plano A — ESCUELA** | **Plano B — CONSULTORÍA** |
|---|---|---|
| Quién opera | **Goberna** | **El cliente** (candidato / gobierno) |
| Qué se vende | Cursos a alumnos | **Las herramientas + el criterio** |
| Sistema de verdad | **Cerberus** | El nodo del cliente. **Jamás Cerberus** |
| Superficie | **Hermes** | **Centurión** (+ territorio, geovisor) |
| Tenancy | Uno solo: Goberna | **N, y algunos son adversarios entre sí** |
| Feedback | Continuo, monetario, **días** | Discreto, político, **años** |
| Rol estratégico | **El laboratorio** | **La flota** |

> ⚠️ **Corrección (27-jul, misma noche): el eje NO es «Escuela vs. Consultoría» — es QUIÉN OPERA.**
> Hermes ya atiende dos negocios de Goberna (escuela **y** la venta de consultoría — la línea de
> Walter; commits `4767561` «Hermes aprende que hay DOS negocios» y `b99efaf` «una plantilla no se
> propone fuera de su negocio»). **Los dos son plano A, porque los opera Goberna.** El plano B
> empieza donde **el cliente** opera un nodo propio. «Escuela» y «Consultoría» en las columnas son
> los nombres cortos de los casos dominantes, no la definición — y usarlos como definición induce
> exactamente el error que esta nota corrige.

**La consecuencia que ordena todo el trabajo**: la maquinaria se prueba en el plano A —donde el lazo
se cierra en días y con plata— y se despliega en el plano B, donde cerrarlo cuesta una elección.
Construir primero para el plano B es construir un instrumento de medición que no se puede calibrar.

---

## 1. La unidad de valor no es el módulo: es la decisión

Una lista de módulos («Estrategia · Marketing · Redes · Multimedia · CRM · WhatsApp · Territorio ·
Geografía · BI · Analítica · Documentos · Automatizaciones · Agentes · Contexto · Memorias ·
Conocimiento») **no es una arquitectura**. Mezcla cuatro categorías incompatibles —dominios de
negocio, canales de E/S, genéricos de empresa y sustrato de runtime— y ninguno de esos nombres
declara qué invariante preserva ni qué pasa cuando falla.

La prueba: comparar «Marketing» con `catalogo/repositorio.ts` — *«si el catálogo no se puede servir:
ERROR, jamás una lista vacía»*. Lo segundo es un módulo. Lo primero es una etiqueta de menú.

**La unidad atómica es la DECISIÓN**: alguien eligió decir X, a Y, en el momento T, por la razón Z —
y esto pasó después.

Bajo esa lente los 16 módulos se disuelven en tres roles, y ninguno es el centro:

- **Sensores** — producen evidencia (Territorio, Redes, Escucha, Geografía, CRM, BI)
- **Efectores** — ejecutan una decisión (WhatsApp, Multimedia, Automatizaciones)
- **Instrumentación** — miden la consecuencia (Analítica, Evaluación)

Y en el centro, lo que hoy **no está** en ninguna lista: **el libro de decisiones**.

> **Por qué esto es el foso y no una preferencia estética.** Todo lo que sea forma-de-modelo se
> commoditiza: el prompt, la generación, el resumen, la placa. El registro de decisiones con su
> consecuencia es lo único que **vale más con cada release de modelo**, porque el modelo mejora la
> generación y no puede sintetizar tu historia.

En Hermes esto ya existe y se llama `procedencia/` + `resultados/` (ADR 0022). **Es el código más
importante del repo** y todavía no está reconocido como tal.

---

## 2. PLANO A — Escuela: Cerberus + Hermes (+ Ivi)

### 2.1 Quién posee qué (y esto no se negocia)

| Pieza | **Posee** | **No posee** |
|---|---|---|
| **Cerberus** | Producto, precio, cliente, venta, cuota, matrícula, inventario, el «medio» de la venta | La conversación |
| **Hermes** | La conversación, la gestión de la vendedora, el **envío hecho desde Hermes** y su procedencia | Cualquier cosa posterior a la venta |
| **Moodle** | El acceso real del alumno y su avance | Todo lo demás. Cerberus lo maneja a él |
| **Ivi** | **Nada.** Consume `governa.*` + documentos | — |
| **meta-escuela** | **Nada.** Proyecta a Cerberus. *«Si se borra entero, se rehace»* | — |
| **icarus** | Los clientes de **consultoría** (Tejada) | Nada de Escuela. Hoy tiene ventas por un webhook mal apuntado |

**La ley** (ADR 0002 de meta-escuela): *Cerberus es la dueña de la data; todo lo demás son
herramientas sobre ella.* Ninguna pieza se vuelve fuente de verdad por tener base propia.

### 2.2 Cerberus — la verdad, y la deuda que la hace frágil

Cerberus es correcto como fuente de verdad y **debe seguir siéndolo**. El problema no es su rol: es
que hoy Hermes no tiene un **contrato** con él, tiene una **intimidad**.

Evidencia: el login es un handshake CSRF + `POST /ingresar/` (`cerberus/auth.ts`); el precio se saca
por prefijo de SKU contra el catálogo vivo; la ficha se busca con `buscar/?q=` →
`telefonos__numero__icontains`. Eso no es una API: es Hermes conociendo el interior de Cerberus. Y
ya produjo el bug de #196 con **tres causas que en pantalla se ven igual**.

**PROPUESTA — tres movimientos, en este orden:**

1. **Un contrato tipado y versionado, propiedad de Cerberus**, para las cinco cosas que Hermes
   necesita: producto/precio por familia, ficha de cliente por teléfono, venta (crear + consultar),
   matrícula por cliente, y el campo **«medio»**. No hace falta REST elegante: hace falta que esté
   **declarado, versionado, y con un fixture literal del cuerpo real** del lado del consumidor.
   El patrón ya existe en la casa: `CUERPO_REAL_DE_IVI` + `paridad-front.test.ts`. Se copia tal cual.
2. **Fan-out, jamás redirigir.** El webhook de ventas hoy apunta a icarus y **icarus sirve a un
   cliente real**. Repuntarlo rompe producción de un tercero. Esto ya está escrito como regla; queda
   elevado a invariante del plano A.
3. **La proyección `governa.*` necesita dueño y SLO de frescura.** Está congelada desde el
   **13-jul**. Un catálogo analítico sin edad declarada no es una fuente: es una trampa. La regla de
   `edad_del_dato` (*«`null` es NO MEDIDO, no fresco»*) tiene que aplicarse **al catálogo entero**,
   no a un campo.

⚠️ **Deuda conocida de Cerberus que este documento no resuelve pero registra**: migraciones que
corren solas al pushear; endpoints que mutan correo y teléfono de cualquier cliente sin sesión ni
CSRF (`users/views.py:825,845`); el latín-1 que revienta con emojis; y la sesión de Cerberus viviendo
en un `Map` de proceso de Hermes, que hace que **cada deploy tire a las vendedoras**.

### 2.3 Hermes — hay que nombrar la extracción AHORA, no cuando duela

Hermes hoy es **un motor genérico y un adaptador de Escuela, sin la línea dibujada entre los dos.**

| Es **motor** (sirve a los dos planos) | Es **adaptador de Escuela** (jamás sale de acá) |
|---|---|
| `TransporteWhatsapp` (habla teléfonos, nunca JIDs) | `cerberus/auth.ts`, `cerberus/ficha.ts`, `cerberus/venta.ts` |
| `EnvioControlado` — la única puerta al envío | `{precio}` por prefijo de SKU |
| `piezas/` — direccionamiento + receta de versión | `cursos/` — familias y alias de la Escuela |
| `procedencia/` + `resultados/` — el libro de decisiones | `clientes/padron` — el padrón de icarus |
| `catalogo/` — lo decible, enumerado y versionado | `hechos/catalogo.ts` — las frases de la Escuela |
| `autorespuesta/` — la máquina de estados y el ritmo | Las plantillas concretas |
| Cola, realtime, adjudicación, cache persistido | El vocabulario `MOMENTOS_DE_VENTA` |

**PROPUESTA**: no extraer un paquete todavía —sería refactor prematuro— pero **prohibir por test que
el motor importe del adaptador**. Una regla de dependencia en CI cuesta un día y compra la opción de
extraer cuando haga falta. Sin ella, en seis meses `EnvioControlado` va a saber qué es una venta de
Cerberus y la extracción va a costar un trimestre.

> ⚠️ **La otra mitad.** Los ~39 archivos de `sdk/` `analisis/` `ontologia/` `canales/` `fuentes/`
> son una copia byte-idéntica del SDK de meta-escuela. **No son motor ni adaptador: son deuda.**
> No entran en esta partición; se archivan.

### 2.4 El lazo — dónde está y qué le falta

Construido: `atribucion/` con **un solo proyector** (`proyectarVenta`) y tres caminos —webhook de
Cerberus, venta registrada desde el chat, y el **puente temporal** por `icarus.cerberus_events`—.
La llave es determinista (`venta_request_key`), no un match, con cascada etiquetada
`llave › telefono_e164 › telefono_sufijo`.

Lo que falta para que el lazo **cierre de verdad**:

1. **El fan-out en Cerberus.** Mientras el puente sea icarus, el lazo depende de un sistema que
   sirve a un tercero y que la decisión del dueño dice que va a desaparecer.
2. **`resultados/ventas.ts` conectado.** Hoy responde `null` = «no lo sabemos», que es lo correcto,
   pero significa que la pregunta *«¿esta pieza vende?»* todavía no tiene respuesta.
3. **Resolución de identidad de verdad.** El match es sufijo de 9 dígitos + guarda de país. Es una
   heurística, y ya sabemos que produce falsos positivos entre Perú y México y falsos negativos con
   locales de 8 dígitos. **Esto es la capa cero de todo el sistema y hoy es una adivinanza educada.**

### 2.5 Lo que NO debe entrar al plano A

Precios y catálogo (se consultan), historial de compras completo (se consulta; solo se sincroniza el
mínimo para poder filtrar), avance del campus (es de Moodle), inventario. Y —lo nuevo de este
documento— **nada de consultoría**. Ni un cliente de Tejada, ni una candidatura, ni un brigadista.

---

## 3. PLANO B — Consultoría: Centurión (+ apolo, territorio, cartografía)

### 3.1 La forma

```
                    apolo / deck-form  ── plano de CONTROL ──
                    activa productos por candidatura
                    (fase_3.subservicios). NUNCA ve dato de tenant.
                              │ provisiona · habilita · da de baja
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
   ┌─────────┐          ┌─────────┐           ┌─────────┐
   │ NODO A  │          │ NODO B  │           │ NODO C  │   ← el cliente opera
   │ cand. 1 │          │ cand. 2 │           │ gobierno│
   └─────────┘          └─────────┘           └─────────┘
        ▲                     ▲                     ▲
        └──── DOCTRINA (una vía, de Goberna al nodo) ────┘
              repertorio versionado · criterio · plantillas de flujo
              ▲
              └── CONSECUENCIA abstraída (nunca dato crudo)
```

**El candidato 1 y el candidato 2 pueden ser rivales en la misma elección.** Todo lo demás en esta
sección es consecuencia de esa frase.

### 3.2 El aislamiento es LA decisión existencial, y hoy está en su grado más débil

Centurión hoy: base compartida `goberna_web_dev`, tenancy por `id_candidatura` a nivel de
aplicación, cada módulo dueño de su schema `<codigo>.*`, core read-only migrado por deck-form.

**Un `WHERE id_candidatura = …` que falta filtra datos de una campaña a su rival.** No es una fuga de
datos: es el fin de la empresa, y en un negocio donde el cliente *espera* que espíes al otro, es
además indefendible ante la sospecha.

**PROPUESTA — declarar grado de aislamiento POR CLASE DE DATO, no por sistema:**

| Clase de dato | Grado mínimo | Por qué |
|---|---|---|
| Identificable de ciudadano (padrón, territorio, formularios, conversaciones) | **Base o nodo por tenant** | Una fuga acá es legal *y* existencial |
| Estrategia, mensajes, calendario, documentos del cliente | **Base o nodo por tenant** | Es el activo por el que pagan |
| Cartografía y datos públicos (INEI, ONPE, geografía) | **Compartido, read-only** | Es público; duplicarlo es puro costo |
| Doctrina de Goberna (repertorio, criterio) | **Compartido, read-only, versionado** | Es lo que vendemos |
| Telemetría de uso y salud | **Compartido, sin PII** | Necesario para operar la flota |

El costo honesto de un nodo por cliente: aprovisionamiento, migraciones sobre N nodes, observabilidad
que hay que juntar, y **distribución de doctrina** a N lugares. Con N chico y contratos grandes, ese
costo es barato comparado con el escenario que evita. **Con N grande, se vuelve el problema
principal, y por eso la maquinaria de flota (§3.6) es parte del producto y no una tarea de infra.**

⚠️ **El schema-per-tenant en base compartida es el peor de los dos mundos** si se elige por
comodidad: paga la complejidad de N y conserva el riesgo de 1 (una credencial, un motor, un backup).
Solo es correcto si además hay RLS y credencial por tenant.

### 3.3 apolo es plano de control. **Jamás plano de dato**

apolo da de alta, activa módulos y aprovisiona. En el momento en que apolo pueda *leer* dato de dos
candidaturas para «hacer un reporte», el aislamiento de §3.2 se vuelve decorativo: existiría un lugar
donde los datos de dos rivales se encuentran.

**Invariante**: apolo escribe entitlements y lee telemetría sin PII. Nada más. Si hace falta un
reporte cruzado, se construye sobre **agregados abstraídos por el nodo**, no sobre acceso al nodo.

### 3.4 La IA también tiene frontera de tenant — y es la que más fácil se olvida

Ivi hoy es un activo **del plano A**: consume `governa.*`, que es la proyección de Cerberus. No se
«apunta» a Centurión.

**Ivi no es un cerebro: es un patrón**, y el patrón es la Ley I —los números salen siempre de SQL, el
RAG solo para texto, toda respuesta declara `HECHO` / `CONTEXTO` / `SIN_EVIDENCIA`, el LLM solo
redacta hechos ya calculados—. Ese patrón se **instancia por ontología**.

**Invariantes del plano B** (PROPUESTA, y hay que escribirlos antes de la primera línea de código):

- **Un índice por tenant.** Ningún embedding, ningún corpus, ninguna memoria compartida entre nodos.
- **Ningún modelo afinado con datos de un tenant sirve a otro.** Nunca. Ni «anonimizado».
- **El contexto se ensambla dentro del nodo**, no en un servicio central que recibe de todos.
- **La GPU compartida (geografo) es una frontera.** Si un nodo de cliente la usa, dos tenants
  comparten un proceso y una VRAM. O se aísla el runtime, o el plano B no usa geografo para nada de
  cliente. **Esta decisión no está tomada** (→ §11).

### 3.5 WhatsApp del cliente: Cloud API, y no es una preferencia

La política del **2026-07-03** prohíbe Baileys y stacks no oficiales **para clientes**. Escuela usa
whatsmeow porque es la propia operación de Goberna asumiendo su propio riesgo; **un cliente no puede
heredar ese riesgo**, y un candidato con la cuenta bloqueada a dos semanas de la elección es un
juicio, no un ticket.

Por eso la tercera implementación de `TransporteWhatsapp` —`cloud-api`— **no es previsión: es el
único cimiento legal del plano B.** Y es, además, el mismo camino que la ambición de Meta Partner.

**Consecuencia de diseño**: la costura `TransporteWhatsapp` (que habla teléfonos, nunca JIDs) es la
pieza de Hermes con más valor estratégico fuera de la Escuela, y hay que tratarla como contrato
público del motor.

### 3.6 La salida es una feature, no un incidente

Una campaña termina. **PROPUESTA**: todo nodo nace con tres cosas escritas — export completo en
formato abierto, borrado verificable con constancia, y la respuesta a *«¿de quién es el dato del
ciudadano que el brigadista cargó?»*. En Perú esto es materia de protección de datos personales y de
normativa electoral; llegar a esa conversación sin respuesta preparada es perder el contrato o
perderlo después, peor.

### 3.7 Lo que Centurión todavía no tiene y bloquea todo lo demás

- **No existe el brigadista.** Hoy `1 usuario = 1 político = 1 candidatura`. La opción (A) del propio
  análisis —`territorio.brigadista` con JWT de `aud` propio, auth independiente del core— es la
  correcta, **y generaliza**: es el mismo mecanismo que va a necesitar el día que un *agente* actúe
  bajo una candidatura. Los principals no-humanos entran por esa puerta.
- **El core lo migra deck-form.** Es correcto hoy y es un cuello de botella mañana; hay que medir
  cuántas veces un módulo espera a deck-form antes de decidir si duele.
- **La app de territorio apunta a `electoral.goberna.club`** y su fallback hardcodeado apunta a otro
  lado. Hay datos reales ahí. El corte se planifica; no se descubre.

---

## 4. La membrana — qué cruza entre planos y qué jamás

Esta es la sección más importante del documento.

### Cruza (una sola dirección, Goberna → nodo)

**La DOCTRINA**: el repertorio enumerado, versionado y evaluado de movimientos — qué se puede decir o
hacer, bajo qué condiciones, con qué evidencia, y qué pasó las últimas N veces. `catalogo/piezas` es
la semilla de esto y hoy solo sirve a la Escuela.

**El KERNEL**: librerías versionadas, no un servicio corriendo.

### Vuelve (abstraído, nunca crudo)

**La CONSECUENCIA**: la *forma* del resultado, jamás el dato. «La secuencia de tres pasos con flyer
primero tiene mejor tasa de respuesta que la de un paso, n=340, base=envíos» — sí. El mensaje, el
teléfono, el nombre, el distrito — **no**, ni agregados de baja cardinalidad de los que se pueda
reconstruir un individuo.

### 🔴 Jamás cruza

- Dato crudo entre tenants. Ni con permiso. Ni «para entrenar».
- **Cerberus ↔ cualquier nodo de cliente.** Cerberus tiene el negocio entero de Goberna: 10.620
  clientes, US$ 768k en ventas. Un nodo de cliente que puede alcanzarlo es una catástrofe con dos
  nombres (fuga de negocio propio + fuga a un tercero).
- Índices, embeddings o memoria compartida.
- Un servicio corriendo compartido entre planos. **La tentación va a ser hacer «el servicio de
  WhatsApp de Goberna» que sirva a la Escuela y a los candidatos. Es la peor idea disponible**: un
  bloqueo de Meta, un bug de ruteo o un incidente de seguridad cruzaría los dos negocios y todos los
  tenants a la vez.

### Cómo se comparte, entonces

**Librería versionada + ADR, no servicio.** Cada plano corre su propia instancia del mismo código. Es
más caro en disciplina y más barato en radio de explosión. Y ya es el estilo de la casa: `piezas/` es
exactamente eso — un módulo que **dos frentes importan** y que fija los vectores literales que los
dos afirman desde su lado (`piezas/vectores.ts` + los tests de paridad).

---

## 5. El kernel compartido — qué es, concretamente

Lo que hoy existe en Hermes y merece vivir como kernel de los dos planos:

| Pieza | Qué garantiza |
|---|---|
| `piezas/direccion.ts` + `version.ts` | Una pieza se nombra igual en todos lados, y su versión es `sha256` del contenido **autoral** (entra el archivo; no entra el rótulo). Receta única, con test que falla si aparece un `createHash` nuevo |
| `procedencia/` | La procedencia viaja **en la orden**, no en un `update`. Un envío bloqueado también deja escrito de qué pieza iba a salir |
| `resultados/` | El veredicto se **deriva**, el SQL solo trae hechos crudos. `Medicion` no se puede serializar sin `n` ni `base`. **Los nombres no prometen causa** — y hay un test que falla si alguien mete una palabra causal |
| `TransporteWhatsapp` | La frontera habla teléfonos, nunca JIDs. Tres implementaciones, elegidas por entorno |
| `EnvioControlado` | Una sola puerta al envío. Contención de radio de explosión fuera del razonamiento de quien decide |
| El patrón de degradación | Error explícito con código, **jamás una lista vacía**. Un 404 no es «no hay respuesta clara» |
| El patrón de paridad | Cuando una regla existe dos veces (función pura + SQL), un test falla si divergen |
| El arnés de evaluación de Ivi | `gimnasio` (corre el golden) + `correccion` (quién decide que estuvo bien) + `auditoria` (el artefacto de la corrida) |

**Esto es la doctrina de ingeniería de Goberna y vale más que cualquier módulo de la lista.** Está
disperso en dos repos y sin nombre. Ponerle nombre es la mitad del trabajo.

---

## 6. Los siete planos (reemplazan a la lista de capas)

`Identity · Knowledge · Memory · Context · Intent · Specifications · Workflow · Evaluation ·
Observability · Governance · Economics · Security · Runtime · Model Routing` **no es una arquitectura
de capas**: no es ortogonal (Knowledge/Memory/Context se solapan; Intent/Specifications también;
Governance/Security también), no es una pila (son planos que cortan todo), y **le faltan las tres que
más importan**.

**PROPUESTA — siete planos, cada uno con un invariante que se puede violar.** Si no se puede violar,
no es un plano: es una palabra.

| Plano | Invariante | Estado A (Escuela) | Estado B (Consultoría) |
|---|---|---|---|
| **Referente** | Toda entidad tiene identidad estable y custodio. Nada razona sobre un nombre sin resolver | 🔴 heurística por sufijo | 🔴 no existe |
| **Registro** | Lo que pasó es inmutable, con procedencia y bitemporal. El derivado se reconstruye | 🟢 event store + `procedencia` | 🔴 no existe |
| **Intención** | Lo que queremos está escrito verificable por máquina, versionado, separado del cómo | 🟡 los ADR lo son en prosa | ❌ |
| **Capacidad** | Toda acción es tipada, permisada, idempotente, con reversibilidad declarada y presupuesto | 🟢 `EnvioControlado`, `catalogo` | 🟡 entitlements sí, lo demás no |
| **Juicio** | Cada decisión es objeto durable: quién, con qué evidencia, qué alternativas, qué se descartó | 🟡 `campana_fuente` es el primer caso | ❌ |
| **Consecuencia** | Todo efecto tiene retorno medible, con su `n` y su base, **sin prometer causa** | 🟡 construido, sin cerrar | ❌ |
| **Restricción** | Lo prohibido se evalúa en tiempo de llamada **como dato**, no como `if` | 🟡 `autorespuesta/` lo hace bien | 🟡 entitlements |

Atravesando los siete: **Economía** (medidor de tokens, de dinero y de **segundos de humano** — esta
última es la métrica de adopción real y nadie la mide) y **Tiempo** (`as-of` en todo; en una elección
*«¿qué creíamos el 3 de marzo?»* es una pregunta legal).

---

## 7. Lo que falta en los dos planos y no está en ninguna lista

1. **No hay adversario.** Ni modelo del oponente, ni red team, ni pre-mortem. En política eso es una
   omisión estructural: **un patrón deja de funcionar precisamente porque funcionó**, y un motor que
   aprende de resultados sin modelar la adaptación del rival decae rápido y en silencio. Es un
   sistema de trading sin motor de riesgo.
2. **No hay contrafáctico.** Ni holdouts, ni experimentos geográficos, ni incrementalidad. Sin eso,
   todo el BI es narrativa con decimales. La semilla ya está escrita en el repo —*«LOS NOMBRES NO
   PROMETEN CAUSA»*— pero es una prohibición, no todavía una capacidad.
3. **No hay verificación.** En la era del media sintético, poder establecer y defender qué es verdad
   es defensa necesaria **y** producto vendible.
4. **No hay simulación.** El final de este dominio no es «chateá con tus datos»: es **«corré esta
   decisión 10.000 veces contra un modelo del mundo»**.
5. **No hay adjudicación como infraestructura.** Hoy la cola de revisión es una pantalla. Debería ser
   un plano: qué decisión necesita qué humano, con qué SLA, y qué pasa si nadie responde. Hermes ya
   tiene la pieza correcta y no la reconoce como tal (`caducidad.ts`: lo que nadie aprueba caduca
   solo).

> **El marco intelectual correcto no es «plataforma SaaS». Es una organización de doctrina
> militar**: doctrina, TTPs, after-action review, wargaming, red team, y autoridad de mando humana.
> Ese marco maneja exactamente lo que el marco SaaS no maneja: adversario adaptativo, campañas
> cortas, aprendizaje entre campañas y auditabilidad ante un tercero hostil.

---

## 8. Capacidades invisibles — inventario con estado

El usuario nunca las ve y son las que hacen superior a la plataforma. Varias **ya existen** en la
casa; el problema no es construirlas, es **no haberlas reconocido como el producto**.

| Capacidad | Escuela | Consultoría |
|---|---|---|
| Calidad del «no sé» — taxonomía del no-saber, distinguible de la falla | 🟢 `SIN_EVIDENCIA` vs los 8 códigos | ❌ |
| Tests de paridad entre dos implementaciones de la misma regla | 🟢 `urgencia` · `piezas` · `curso` | ❌ |
| Honestidad de muestra fría — saber y **mostrar** cuándo no podés hablar | 🟢 Wilson + `MUESTRA_MINIMA` | ❌ |
| Contratos de degradación por dependencia | 🟢 excepcional | ❌ |
| Contención de radio de explosión fuera del razonamiento del agente | 🟢 `EnvioControlado` + el ritmo | ❌ |
| Idempotencia y compensación de todo efecto | 🟡 | ❌ |
| **Versionado de la *semántica*** (no del código) | 🔴 | 🔴 |
| Replay / backfill de todo estado derivado | 🟡 event store sí, política no | ❌ |
| **Taint de frontera de confianza** — qué tokens vinieron de afuera y qué capacidades quedan cerradas mientras | 🔴 | 🔴 |
| Ruteo de adjudicación con SLA | 🔴 hoy es pantalla | ❌ |
| Vida media + custodio por hecho | 🟡 `edad_del_dato` existe, la disciplina no | ❌ |
| Clasificación de reversibilidad que maneja el gate sola | 🔴 | 🔴 |
| Contabilidad de **segundos de humano** por decisión | 🔴 | 🔴 |
| Latencia de onboarding-a-competencia como propiedad medida | 🔴 | 🔴 |

Las dos filas 🔴 en ambas columnas que más van a doler: **versionado de la semántica** (cuando cambie
la definición de «cliente activo» o de «votante contactado», todos los gráficos históricos van a
mentir en silencio) y **taint de frontera de confianza** (el día que un agente lea un comentario de
Facebook y ese texto llegue al mismo contexto que sus instrucciones, la inyección de prompt deja de
ser teórica).

---

## 9. Mapa de madurez — el orden es al revés del que se vende

| Nivel | Disciplina | Por qué acá |
|---|---|---|
| **0** | **Ontología + resolución de entidades** | Todo lo de abajo es ruido sin esto. El sufijo de 9 dígitos es el nivel 0 sin hacer |
| **1** | **Cierre del lazo / instrumentación de consecuencia** | Sin esto solo se puede opinar, nunca mejorar |
| **2** | **Evaluation engineering** | Es lo único que deja cambiar de modelo sin miedo — y el modelo es la fuerza externa que más nos va a mover |
| **3** | **Specification engineering** | Cuando generar cuesta cero, el cuello de botella es decir qué querés con precisión verificable |
| **4** | **Context engineering** | Es la consecuencia en runtime de 0–3. Antes de 0–3, es adivinar |
| **5** | Platform / workflow / memory | Empaquetado |
| **6** | **Agent engineering** | Último. Un agente es un estilo de control de flujo, no una disciplina fundacional |
| **—** | ~~Prompt engineering~~ | **Nunca fue una disciplina.** Es una habilidad, y se deprecia con cada release |

Faltaban cinco en la lista original y las cinco pesan más que la mitad de las que estaban:
**ontología/resolución de entidades**, **inferencia causal y diseño experimental**, **seguridad de
contenido no confiable**, **contratos de datos**, e **ingeniería de adopción** —esta última es el
límite real de Goberna: 3 vendedoras, ~52 repos, y una auto-respuesta que se prendió y se apagó a los
siete minutos porque las precondiciones organizacionales no estaban.

---

## 10. El techo, visto como VC técnico

**El techo actual es la capacidad de absorción, no la ambición.**

Lo que impide crecer 100×:

1. **La identidad es una heurística.** Nivel 0 sin resolver, y ya produce bugs que en pantalla se ven
   iguales entre sí.
2. **No hay primitiva de multi-tenancy en el plano A**, y la del plano B es la más débil posible para
   tenants que pueden ser adversarios.
3. **La verdad vive en un sistema cuyo ciclo de release no se controla del todo**, con migraciones
   automáticas y endpoints sin auth.
4. **No hay infraestructura de evaluación fuera de Ivi.**
5. **El más grave: el ingreso de la consultoría no depende de que la plataforma generalice.** No hay
   función forzante. Sin un **gate de generalización** explícito —*nada entra al kernel hasta que
   sirvió a ≥2 clientes, y el segundo sin código nuevo*— se construyen 40 verticales de un cliente
   cada una. Eso ya se ve en la forma del árbol de repos.

Decisiones tempranas que pueden condenar la arquitectura, en orden de daño:

1. **No decidir hoy el aislamiento entre tenants adversarios.** (§3.2, §3.4)
2. Que cada producto defina su propio modelo de entidad. **Ya está pasando**: `clientes_padron` vs
   clientes de Cerberus vs `contacts` de icarus — tres respuestas a «quién es esta persona».
3. Compartir un servicio corriendo entre planos «para no duplicar». (§4)
4. No versionar la semántica.
5. Tratar módulos como unidad de arquitectura en vez de decisiones.

---

## 11. Decisiones abiertas — necesitan al dueño, no al arquitecto

1. **¿Nodo por cliente, base por cliente, o schema por cliente?** Es la decisión de §3.2 y define
   costo operativo, precio de venta y postura de seguridad. **Ninguna otra decisión de este documento
   se puede tomar antes.**
2. **¿El plano B usa geografo?** Si un nodo de cliente usa la GPU compartida, dos tenants comparten
   VRAM y proceso. Sí (con qué aislamiento) o no (con qué costo).
3. **¿Goberna puede trabajar para dos candidatos de la misma elección?** La respuesta comercial
   determina la arquitectura, no al revés. Si es «sí», el aislamiento duro deja de ser opcional en
   todos los niveles y hay que poder demostrarlo, no solo afirmarlo.
4. **¿De quién es el dato del ciudadano** que carga un brigadista? Del cliente, de Goberna, o
   compartido — y qué pasa el día después de la elección.
5. **¿Cuál es el gate de generalización?** Cuántos clientes y qué prueba hacen falta para que algo
   pase de un cliente al kernel.
6. **¿La Escuela financia el plano B explícitamente?** Si sí, el plano A tiene prioridad de recursos
   sobre la visión, y hay que decirlo en voz alta para que no se decida por omisión cada semana.

---

## 12. Cómo se falsifica este documento

Un documento de posición que no se puede refutar es propaganda. Este se cae si:

- **El aislamiento duro resulta más caro que el valor del plano B.** Si N clientes nunca pasa de 3 y
  cada uno paga poco, la flota no se justifica y consultoría vuelve a ser servicio con herramientas
  internas, sin plataforma. *Prueba: costo de aprovisionar y mantener un nodo vs. ticket promedio.*
- **La doctrina no generaliza.** Si al segundo cliente el 80 % del repertorio hay que reescribirlo,
  no hay activo transversal: hay consultoría con buen tooling, que es un negocio distinto y digno.
  *Prueba: % de piezas reutilizadas del cliente 1 al 2, sin código nuevo.*
- **El lazo del plano A no cierra ni con el fan-out.** Si con la atribución completa las mediciones
  siguen sin muestra decidible, la tesis del libro de decisiones no aplica a este volumen y hay que
  bajarla a un tamaño más chico. *Prueba: cuántas piezas llegan a `n = 30` en 90 días.*
- **La adopción no se mueve.** Si a los tres meses los segundos-de-humano por decisión no bajan, todo
  esto es arquitectura sin usuario. *Prueba: medirlo, cosa que hoy no se hace.*

---

*Documento de posición, no de implementación. Los hechos y volúmenes citados están medidos entre el
2026-07-25 y el 27 contra producción y están detallados en [`sistemas-goberna.md`](sistemas-goberna.md)
y en `ivi-cerebro/docs/los-cinco-sistemas.md`. Lo que dice **PROPUESTA** no está decidido. Las
descripciones de Centurión, apolo y territorio provienen de `GOBERNA-ECOSISTEMA.md` y
`GOBERNA-OS-ARQUITECTURA.md`, ambos del **2026-07-02** — casi un mes viejos: verificar contra el repo
antes de actuar sobre ellos.*
