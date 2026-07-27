# Los cinco sistemas de Goberna — qué sabe cada uno y cómo se unen

> Foto del **2026-07-27**. Todo lo que dice un número está medido contra producción
> (lectura, sin PII). Lo que es hipótesis, se dice como hipótesis.
>
> Este documento es el mapa: **qué sabe cada sistema por separado, qué llave los une,
> dónde están rotos los eslabones y en qué orden conviene arreglarlos.**

---

## 0. El recorrido de una persona, y dónde se corta

Una persona real atraviesa los cinco sistemas en este orden:

```
   ve un anuncio            escribe            le venden          paga            estudia
   ─────────────            ────────           ─────────          ─────           ────────
      META         →         HERMES      →     CERBERUS    →    CERBERUS    →     MOODLE
   (campaña, ad)          (WhatsApp)          (cotización)      (venta)          (campus)
        │                     │                    │               │                │
        └── ctwaClid ─────────┘                    │               │                │
                              └── teléfono ────────┘               │                │
                                                   └── folio GOB ──┴── matrícula ───┘

   ICARUS corre en paralelo: las landings web capturan al mismo humano ANTES o DESPUÉS
   del chat, y guarda su historial de compras.
```

**El corte está en la tercera flecha.** Hermes ve el principio de la relación
(alguien escribió) pero no el final (compró, se matriculó, volvió a comprar).
La tabla `conversiones_wa` de Hermes tiene **0 filas** mientras Cerberus registra
**6.798 ventas por US$ 768.657**.

---

## 1. Los cinco sistemas, uno por uno

### 1.1 HERMES — la conversación

**Qué es**: el CRM de la Escuela. App de escritorio (Tauri/Electron, UI servida OTA)
donde las vendedoras atienden WhatsApp. Postgres propio en VPS1 (`hermes_db`,
127.0.0.1:5438), event store append-only + proyecciones.

**Qué sabe** (medido 2026-07-26/27):

| Dato | Volumen | Nota |
|---|---|---|
| Conversaciones de WhatsApp | **1.997** | ventana viva desde que se vinculó el número |
| Mensajes entrantes / salientes | 1.156 / 2.359 | 45% de los entrantes es multimedia sin texto (notas de voz) |
| `leads` (formularios) | **26.075** | 651 de Meta + 25.424 de landings vía icarus |
| `alias_curso` | 30 | anuncio/campaña → familia de curso |
| `envios_wa` (quién mandó) | **16** | ⚠️ ver §3.4 |
| `conversiones_wa` (ventas) | **0** | ⚠️ ver §3.1 |
| `intereses` | ~1 | ⚠️ ver §3.3 |
| schema `ontologia` | tablas creadas, **0 filas** | maquinaria de identidad lista, sin poblar |

**Es fuente de verdad de**: la conversación (qué se dijo, cuándo, en qué canal),
la gestión de la vendedora (etapa, notas, recordatorios, categorías), y el envío
hecho *desde Hermes*.

**No es fuente de verdad de**: nada de lo que pasa después de la venta.

---

### 1.2 CERBERUS — el negocio

**Qué es**: el ERP de Goberna. Django + MySQL (repo `ceberusapp`, apps `products`,
`sales`, `enrollment`, `events`, `movimientos`, `contact`, `users`). Es donde vive la
plata.

**Qué sabe**:

| Dato | Volumen |
|---|---|
| **Ventas** | **6.798 · US$ 768.657** (6.648 pagadas, 150 pendientes) |
| Ventas de Escuela | 5.142 unidades · US$ 545.825 |
| **Clientes activos** | **10.620** (99,4% con teléfono, 99,3% con correo) |
| Productos | 338 (245 disponibles) en **58 familias** |
| Cuotas | 7.309 pagadas · 161 pendientes · 27 en reintento |
| Matrículas | ciclo prematrícula → registrado → matriculado |
| Movimientos de inventario | 1.347 (feb–jul 2026), 779 atados a una venta |

**Dos cosas que Cerberus ya tiene y Hermes estaba por reinventar**:

1. **El campo «medio» por venta** — la atribución ya existe:
   | Medio | Ventas | % |
   |---|---|---|
   | Pagado (anuncios) | 2.630 | 38,7% |
   | **Postventa** | **2.621** | **38,6%** |
   | Orgánico | 746 | 11,0% |
   | Referente | 449 | 6,6% |
   | Remarketing | 352 | 5,2% |

2. **La identidad del producto**: `codigo_producto` + `sku_producto`. El SKU es
   `<PREFIJO><NNN>` (`DIPICOT014`) y el prefijo es la familia — **con una excepción
   peligrosa**: los `GEN*` (`GEN5C4BE8` Bicameral, `GEN15527B` Cartografía,
   `GENCDE6AE` Dir. Corporativa) son cursos **distintos** con el mismo prefijo.

**Es fuente de verdad de**: producto, precio, cliente, venta, cuota, matrícula,
inventario, y el medio de la venta.

**Lo que hoy NO expone hacia afuera**: la API pública `productos-cursos/` filtraba a
tres categorías de curso y dejaba fuera los **eventos** (el Foro de Estado). Ya se
arregló por PR en `ceberusapp` (#3, mergeado) — **falta desplegar ese repo**.
Matrículas y el campo «medio» **siguen sin endpoint público**.

---

### 1.3 ICARUS — las landings y, sin que nadie lo usara, **el espejo de Cerberus**

**Qué es**: hub de contactos y campañas (React + Postgres, schema `icarus`, en VPS1).
Recibe los formularios de las landings web… **y mucho más**.

**Qué sabe**:

| Dato | Volumen |
|---|---|
| `contact_form_submissions` | **25.424** |
| `contacts` | **72.803** (con `stage`, `buyer_tier`, `total_usd_spent`, `n_purchases`) |
| Contactos **con alguna compra** | **10.480** |
| **`ventas`** | **6.973** ← ⚡ |
| **items de venta** | **9.572** |
| **productos** | **339** |
| **enrollments** | 1.313 (⚠️ última fila el **26-may**: ¿parado?) |
| **`cerberus_events`** | **7.566**, el último de hoy |

> ⚡ **EL HALLAZGO QUE CAMBIA EL PLAN**: icarus **ya es un espejo vivo de Cerberus** —
> tiene las ventas, los items, los productos y los eventos, actualizándose hoy. Y
> Hermes, que ya tiene `ICARUS_DATABASE_URL` en modo read-only, **lee 1 de sus 30
> tablas**. La plata que «no se puede atribuir» (§3.1) está a una consulta de
> distancia, sin depender de que nadie despliegue nada.

**Cómo se conecta hoy**: Hermes lo lee **read-only** (`ICARUS_DATABASE_URL`) y ya
ingirió sus 25.424 submissions a la tabla `leads` (`npm run ingest:icarus`,
idempotente, `lead_id = 'icarus:'+id`). Nada más.

**⚠️ Nota de seguridad abierta**: el Postgres de icarus escucha en `0.0.0.0:5434`
(expuesto a internet). Reportado en `Goberna-Lab/icarus#63`.

**Es fuente de verdad de**: la submission del formulario web (qué curso eligió la
persona, con qué correo y teléfono).

---

### 1.4 META — el origen del tráfico

**Qué es**: Facebook/Instagram Ads. Trae la gente por dos vías:
- **Lead-forms** → 651 leads con nombre, correo, teléfono y campaña.
- **Click-to-WhatsApp (CTWA)** → la persona escribe directo al WhatsApp; el mensaje
  trae `origen: { adId, titulo, ctwaClid, fuente }`.

**Qué sabe Hermes de Meta hoy**: 312 orígenes de anuncio almacenados. El anuncio
«Inteligencia Estratégica» explica **372 personas** (con 10 `adId` distintos: es un
anuncio con 10 creativos, no diez anuncios).

**⚠️ El nombre de la campaña NO se guarda** — `origen.campana` viene `null` en los 312.
Lo que se ve en la UI sale de una llamada viva a la Graph API.

**Es fuente de verdad de**: campaña, adset, anuncio, y el `ctwaClid` que permite
devolverle la conversión a Meta (CAPI).

---

### 1.5 MOODLE — el campus

**Qué es**: la plataforma donde el alumno estudia. Aparece en Hermes solo como
`Moodle User ID` dentro de la matrícula de Cerberus.

**Qué sabe Hermes de Moodle**: nada, hoy. La matrícula de Cerberus es el puente.

**Es fuente de verdad de**: el acceso real del alumno y su avance en el curso.

---

## 2. Las llaves que unen todo

| Llave | Une | Confiabilidad |
|---|---|---|
| **Teléfono** | Hermes ↔ Cerberus ↔ icarus ↔ leads | Alta. 99,4% de los clientes lo tienen. ⚠️ el match por **sufijo de 9 dígitos** cruza códigos de país (Perú 9 dígitos, Guatemala 8) — con 1.987 clientes mexicanos y 393 guatemaltecos, el falso positivo es real (issue #119) |
| **Correo** | leads ↔ Cerberus ↔ icarus | Alta (99,3%) |
| **Folio `GOB-xxxxx`** | venta ↔ matrícula ↔ despacho de inventario | Exacta |
| **`codigo_producto` / SKU** | curso ↔ interés ↔ venta ↔ matrícula | Exacta. La *familia* se deriva del prefijo del SKU (ojo con los `GEN*`) |
| **`adId`** | conversación ↔ anuncio ↔ campaña | Exacta cuando está (solo 7% de las conversaciones) |
| **`ctwaClid`** | conversación ↔ clic del anuncio ↔ CAPI | Exacta cuando está |
| **DNI** | — | **Inútil**: solo el 13,8% de los clientes lo tiene |

**Consecuencia de diseño**: como el DNI no sirve y el teléfono puede ser compartido
(la cabina, el familiar), la unificación de personas **se afirma a mano**, no se
deduce (ADR 0017 / issue #58). El teléfono entra como identidad *débil*.

---

## 3. Los eslabones rotos, ordenados por plata

### 3.1 🔴 La venta nunca vuelve a la conversación — **y la cañería ya está construida**
`conversiones_wa` tiene **0 filas**. Cerberus registra 6.798 ventas. **Ningún peso de
esos US$ 768.657 se puede atribuir a la conversación que lo originó.**

Pero el problema **no es que falte construir**: es que tres piezas hechas no están
enchufadas entre sí.

1. **El webhook Cerberus→Hermes existe, está testeado y montado** (`webhook/ruta.ts:35`)
   y **jamás recibió un evento**: el emisor de Cerberus es **mono-destino**
   (`sales/icarus_payload.py:471` — una env que acepta un solo valor, y hoy apunta a
   icarus). Falta un *fan-out*, no un desarrollo.
2. **La llave de atribución determinista está a dos líneas de existir**: Hermes ya crea
   la venta en Cerberus (`cerberus/venta.ts:151`) mandando un `venta_request_key`, y
   Cerberus lo devuelve en el webhook. Poner ahí la clave de conversación cierra la
   atribución **en el origen**, sin matching probabilístico (que hoy solo llega al 6,5%
   contra `leads` y 17% contra `icarus.contacts`).
3. ⚠️ **Trampa**: el receptor actual deposita en `ontologia.conversiones` — un schema
   con **0 filas y nadie leyéndolo**, no en `conversiones_wa`. Enchufar el webhook sin
   redirigir la proyección da un sistema que **recibe todo y no muestra nada**.

Y hay un camino aún más corto que no depende de nadie: **leer las 6.973 ventas que
icarus ya tiene** (§1.3).

Sin esto no hay: conversión por curso, ROI por anuncio, valor por vendedora, ni evento
`Purchase` para mandarle a Meta. Es el prerrequisito de casi todo lo demás.

### 3.1-bis 🔴 El techo duro: solo el 11% de las ventas tiene conversación en Hermes
De las **65 ventas de los últimos 7 días, solo 7 (11%)** corresponden a un cliente con
conversación en Hermes. La causa más probable: **el equipo usa más de un número de
WhatsApp** y Hermes ve uno solo, con 6 días de historia.

**Ese 11% es el techo de todo lo demás**: por más que se arregle la atribución, solo se
puede atribuir lo que se ve. El multi-número (#50) tiene el código escrito de los dos
lados y en `ceberusapp` **faltan tres variables de entorno**.

### 3.2 🔴 La postventa es el 38,6% de las ventas y el producto no la contempla
2.621 ventas vienen de gente que ya había comprado — casi lo mismo que la pauta
(2.630). Hermes está construido **100% alrededor del lead nuevo**. Hay 10.620 clientes
activos (3.018 altas en 2025 → 7.602 en 2026) y **140 de ellos están en la cola ahora
mismo, indistinguibles de un desconocido** (issue #133, en construcción).

### 3.3 🟡 El interés no se registra, así que el embudo miente
611 conversaciones con precio enviado, **1 interés registrado en toda la base**. La
compuerta de «Cotizado» exige tipear el curso a mano, y el dato ya estaba en el
formulario o en el anuncio. Se está resolviendo: interés derivado con confirmación de
un clic (#102/#155) y familias de curso (#129).

### 3.4 🟡 No se sabe quién atendió
`envios_wa` tiene **16 envíos** contra 2.359 salientes reales: las vendedoras mandan
desde el teléfono, donde el número es compartido y WhatsApp no dice quién escribió.
**Decisión tomada: el 3 de agosto de 2026 todas pasan a trabajar solo en Hermes.**
Antes de esa fecha el timeline dice «desde el celular · fuera de Hermes»; después,
atribución completa (#148).

### 3.5 🟡 La atribución de anuncio cubre el 7%
Solo 312 de ~1.997 conversaciones traen `adId`, y el nombre de campaña no se guarda.
El Dashboard por curso queda describiendo una fracción (#128).

### 3.6 🟡 Pagó y no entró
12 matrículas pagadas en «Pendiente de Registro»; **5 llevan más de 4 meses** sin
acceso al campus, con `Intentos = 0` (no falló nada: nadie lo intentó). Hermes no
puede ver el estado de matrícula, así que la vendedora no sabe qué contestar cuando
esa persona escribe (#159).

### 3.7 🟢 Los eventos no existen para Hermes
El Foro de Estado es un producto de categoría 13 que la API pública filtraba. **Fix ya
mergeado en `ceberusapp` (PR #3), pendiente de desplegar ese repo** (#145).

---

## 4. Cómo juntarlos: el modelo de integración

Tres formas de traer un dato externo, con su criterio:

| Forma | Cuándo | Ejemplos |
|---|---|---|
| **Consultar en vivo** | El dato cambia seguido, se necesita exacto, y el volumen es de a uno | Ficha del cliente y precios al cotizar (Cerberus). ⚠️ con **techo de tiempo**: esa llamada se cuelga (>20 s medidos) y hay que degradar, no esperar |
| **Sincronizar a tabla local** | Se necesita para **filtrar u ordenar muchas filas a la vez** | Leads (ya hecho: `ingest:leads`, `ingest:icarus`), padrón de clientes (para marcar 140 en una cola de 1.997 sin 1.997 llamadas HTTP) |
| **Derivar en consulta** | Se puede calcular de lo que ya está | Etapa efectiva (ADR 0013), urgencia (ADR 0009), curso del lead, «esperan respuesta», enfriamiento |

**Las tres reglas que hacen que esto no se pudra:**

1. **Una sola fuente de verdad por entidad.** Cerberus manda en producto, precio,
   cliente, venta y matrícula. Hermes manda en conversación y gestión. Meta manda en
   campaña. Nadie más los define.
2. **Nunca definir lo mismo dos veces.** Ya pasó tres veces: la urgencia (ADR 0009), el
   curso del lead (`CURSO_DE_LEAD` duplicado entre cola y Dashboard) y `pide_info`
   (tres copias). Cuando dos pantallas necesitan lo mismo, **se extiende el fragmento
   compartido**, no se copia.
3. **Derivar lo derivable.** Una métrica materializada es una segunda copia, y las
   segundas copias divergen.

**Qué NO debe vivir en Hermes**: precios y catálogo (se consultan), historial de
compras completo (se consulta; solo se sincroniza lo mínimo para filtrar), notas y
avance del campus (es de Moodle), inventario. Hermes guarda la **conversación** y la
**decisión de la vendedora**; el resto lo pregunta.

---

## 5. Lo que hay que pedirle a Cerberus

Cerberus es el repo `ceberusapp` y ya se le hizo un PR (el de eventos, mergeado). Lo
que falta exponer:

| Necesidad | Para qué | Estado |
|---|---|---|
| Desplegar el PR de **eventos** | Que el Foro entre al buscador de interés | ✅ mergeado, ⏳ sin desplegar |
| Endpoint de **matrículas** por cliente/teléfono | Ver «pagó y no entró» en la ficha (#159) | ❌ no existe |
| El campo **«medio»** de la venta, consultable | No reinventar la atribución en Hermes | ❌ no expuesto |
| **Webhook o endpoint de ventas** por teléfono/folio | Cerrar `conversiones_wa` (§3.1) | ❌ no existe |

---

## 6. El plan, por orden de valor

> ### ⚠️ DECISIÓN DEL DUEÑO (2026-07-27): **Cerberus será todo; icarus desaparece.**
> Todo termina en Cerberus. Eso cambia el orden: **no se construye nada permanente
> sobre icarus.** Leer sus ventas sigue siendo válido como **puente temporal** (es lo
> único disponible hoy sin depender de un despliegue), pero el destino es el webhook
> Cerberus→Hermes, y ahí hay que invertir.
>
> **Y sobre los números**: el panel de Cerberus ya administra «Números de WhatsApp» con
> etiqueta, propósito, vendedoras y vinculación a Hermes — hoy con **uno solo**
> (`51986394450` · Ventas Perú · escuela · Conectado · Sincronizado). **Se irán
> agregando.** O sea que el techo del 11% (§3.1-bis) **sube solo** a medida que se
> vinculen, y todo lo que se construya debe asumir N números desde el día uno.

**Fase 0 — puente temporal, con fecha de vencimiento** ⚡
0. **Leer las ventas de icarus** (6.973 ventas, 9.572 items, 7.566 eventos ya
   conectados read-only) **solo como puente**: cierra la atribución hoy, sin esperar a
   nadie. Debe quedar **detrás de un seam** para que el día que Cerberus mande el
   webhook se cambie la fuente sin tocar nada más. Nada de lógica de negocio de icarus
   filtrándose al resto del sistema.

**Fase 1 — cerrar el círculo de la plata** (desbloquea todo lo demás)
1. Que la venta vuelva a la conversación (`conversiones_wa`). Tres caminos, de menor a
   mayor dependencia: **(a)** leer icarus (Fase 0), **(b)** poner la clave de
   conversación en el `venta_request_key` que Hermes ya manda —atribución determinista,
   dos líneas—, **(c)** *fan-out* del webhook en `ceberusapp` (una env mono-destino)
   ⚠️ redirigiendo la proyección a `conversiones_wa` y no a `ontologia.conversiones`,
   que está muerto.
2. **Multi-número (#50)**: sin esto el techo es 11%. Código escrito de los dos lados,
   faltan tres variables de entorno en `ceberusapp`.
3. Con eso: conversión real por curso y por anuncio en el Dashboard (#128), y el
   evento `Purchase` a Meta vía CAPI — las dos mitades ya existen en el repo
   (`origen.ctwaClid` + `lazo/capi.ts`), faltan tres campos.

**Fase 2 — abrir la postventa** (38,6% de las ventas, hoy invisible)
3. Marcar a los 140 ex-clientes en la cola y poder filtrarlos (#133, en construcción).
4. Con el padrón sincronizado, decidir si la postventa merece su propia vista.

**Fase 3 — que el embudo deje de mentir**
5. Interés derivado con un clic (#102/#155) + familias de curso sin gaps (#129).
6. Atribución de anuncio completa: alias por `adId` para los creativos genéricos, y
   resolver el nombre de campaña vía Graph API (#128-T1/T2).

**Fase 4 — el servicio después de la venta**
7. Estado de matrícula en la ficha y alerta de «pagó y no entró» (#159).

**Transversal, con fecha**: el **3 de agosto de 2026** todas las vendedoras pasan a
Hermes ⇒ desde ahí `envios_wa` es el registro completo de quién atendió, y las
métricas por vendedora dejan de ser una muestra de 16.

---

## 7. Cómo sabremos que está integrado

Métricas concretas, medibles hoy y comparables después:

| Señal | Hoy | Objetivo |
|---|---|---|
| Ventas atribuidas a una conversación | **0** de 6.798 | > 80% de las ventas por WhatsApp |
| Conversaciones con curso identificado | ~7% (Dashboard) | > 90% |
| Ex-clientes visibles en la cola | 0 de 140 | 140 |
| Mensajes salientes con vendedora conocida | 16 de 2.359 | 100% desde el 3-ago |
| Matrículas pendientes sin que nadie se entere | 12 (5 con +4 meses) | 0 sin alerta |
| Eventos `Purchase` enviados a Meta | 0 | los que correspondan |

---

## 8. Preguntas abiertas para el dueño

1. **¿Cuántos números de WhatsApp usa el equipo?** Es la pregunta que más mueve el
   plan: define el tamaño de #50 y el techo del 11% (§3.1-bis).
2. **¿El Foro se cobra por Stripe, fuera de Cerberus?** Si es así, hay ingreso que por
   diseño nunca entra al libro mayor ni al embudo. ¿Debe terminar igual en Cerberus?
3. **¿`icarus.enrollments` está parado a propósito?** Última fila el 26-may. Define si
   la alerta de «pagó y no entró» (#159) lee de icarus o de `tb_matricula`.
4. **¿icarus es un producto vivo o un tramo de tubería?** Todo el plan lo trata como
   espejo de lectura; si va a desaparecer, la Fase 0 tiene que leer Cerberus directo.
5. **¿Cómo se llena el campo «medio»** de la venta — a mano o automático? De eso
   depende si Hermes lo consume o lo alimenta.
6. **¿La postventa merece una vista propia** en Hermes, o alcanza con marcar a los
   ex-clientes en la cola?
7. **¿Quién puede desplegar `ceberusapp`** (el fix de eventos espera) y agregarle las
   tres variables de entorno del multi-número?
8. **Las 5 matrículas de +4 meses**: ¿se resuelven a mano ahora, o esperan a que Hermes
   las muestre?

---

## 9. Dos cosas que aparecieron en el camino y no son parte del mapa

1. **Cada deploy de Hermes deja a las vendedoras sin poder registrar una venta** hasta
   que vuelvan a loguearse: la sesión de Cerberus vive en un `Map` en memoria
   (`cerberus/sesionStore.ts:14`). Trackeado.
2. **En `ceberusapp` hay endpoints que mutan correo y teléfono de cualquier cliente sin
   sesión ni CSRF** (`users/views.py:825,845`). No es de este mapa, pero merece un
   issue propio en ese repo.

---

*Fuentes: mediciones read-only contra la base de producción de Hermes e icarus
(2026-07-25/27), el código de `ceberusapp`, y los exports de Cerberus que compartió el
dueño (productos, clientes, movimientos, matrículas y el dashboard de ventas).
Los issues citados viven en `Goberna-Lab/hermes`.*
