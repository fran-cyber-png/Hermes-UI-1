# Plan de obra — el rediseño del Dashboard

**Fecha**: 10-ago-2026 · **Decisión**: [ADR 0047](adr/0047-el-dashboard-se-ordena-por-plazo.md)
**Estado**: propuesta. Nada de esto está implementado.

Continúa `docs/plan-pipeline-funcional.md` (la pantalla), `docs/plan-pipeline-por-canal.md` (el
modelo) y `docs/plan-visualizacion-de-leads.md` (la data y el dibujo). Éste es **la obra**: qué se
toca, en qué orden, y con qué se verifica cada paso.

Todo número que aparece acá está medido en producción entre el 8 y el 10 de agosto de 2026
(`hermes_db` en VPS1, `icarus_db`, `cerberus_db` en VPS2). Donde hay una opinión, está dicho.

---

## 1. El problema, en una tabla

| La pantalla pone al frente | | La base dice del mismo asunto | |
|---|---|---|---|
| «93 personas esperan» | 93 | Leads de 120 días que **nunca** recibieron un mensaje | **2 470** |
| «1397 en el embudo» | 1 397 | Lo que el seam devuelve de verdad | **3 973** |
| «13 cierre» | 13 | Leads con una venta **posterior** a su formulario | **348** |
| Tabla «Por curso» | 34 | Ventas en `tb_venta` de Cerberus | **7 105** |
| — | no existe | **DIPCPOL025 abre en 9 días con 19 matriculados** (las 3 anteriores: 68 · 84 · 80) | 19 |
| — | no existe | Pagaron DIPICOT026 y no están matriculados, con la clase empezando hoy | 8 |

El fundamento y las siete decisiones están en el ADR. Acá va la obra.

---

## 2. La forma que se construye

Tres bandas ordenadas **por plazo**, de arriba abajo:

```
┌──────────────────────────────────────────────────────────────────┐
│ BANDA 1 · EL RELOJ            ¿qué edición está en riesgo?       │
│   DIPCPOL025  ███░░░░░░░  19/77   empieza en 9 días        ORO   │
│   DIPICOT026  ████████░░  72/82   empezó hoy · 8 sin matricular  │
├──────────────────────────────────────────────────────────────────┤
│ BANDA 2 · EL HUECO            ¿a quién no le hablamos?           │
│   26 040 ████████████████████████  100 %                         │
│      ↓ se cayeron 25 376 · 97,4 %                                │
│      664 ▌                          2,6 %                        │
│      ↓ de ésos compró el 52,4 %                                  │
│      348 ▌                          1,3 %                        │
│   por país · por curso · por ocupación                           │
├──────────────────────────────────────────────────────────────────┤
│ BANDA 3 · LA MESA             ¿a quién atiendo ahora?            │
│   ▸ Escribieron y esperan          4   [Atender →]               │
│   ▸ Formulario · Consultor · 11 d  47  [Abrir los 47 →]          │
└──────────────────────────────────────────────────────────────────┘
```

El conmutador `Mi turno | El negocio` **no se toca**: sigue siendo la bisagra, en el mismo lugar,
con la misma altura fija. Lo que cambia es qué hay adentro de cada lectura.

---

## 3. Los tickets

### T0 · El embudo del Dashboard omite 2 576 conversaciones

**Tipo**: `bug` · **Costo**: chico · **Bloquea**: nada

El titular dice `1 397`; el seam devuelve `3 973`. `VistaDashboard.tsx:348` hace
`ETAPAS.reduce(...)` y `src/lib/etapas.ts` excluye `sin_respuesta` de `ETAPAS`. Las cuatro etapas
visibles coinciden **dígito por dígito** con el embudo medido: `3 973 − 2 576 = 1 397`.

ADR 0044 corrigió esta misma mentira en el Pipeline el 9-ago. El Dashboard quedó en la versión
anterior y nadie lo notó, porque el defecto no rompe nada: sirve un número más chico y creíble.

**Qué se hace**
- El total y los segmentos salen de **las claves que el server mandó**, no de una lista del front.
- `sin_respuesta` **no** entra a `ETAPAS` (eso lo volvería declarable y arrastrable, contra 0044).
  Se dibuja como **primer segmento**, en la tinta apagada que `ETAPA_CHIP.sin_respuesta` ya define:
  es un estado de espera, no un peldaño ganado. **Sin oro.**
- `colorSegmento(etapa, i)` hoy indexa por posición en `ETAPAS`; hay que decidir el color por
  **clave**, no por índice, o el nuevo segmento corre los colores de todos los demás.

**Cómo se verifica**
- Test de paridad `dashboard/etapas.paridad.test.ts` que fija la **relación**, no los valores:
  *toda etapa que `contarPorEtapaEfectiva` puede devolver, el Dashboard la tiene que poder dibujar.*
  Se verifica que se pone rojo antes de darlo por hecho.
- `galeria-dashboard.html` sirviendo **los valores reales de producción** (3 973 con sus seis
  etapas), no el caso ideal — enmienda de ADR 0044. Captura en `docs/evidencia/`.

**Archivos**: `src/features/dashboard/VistaDashboard.tsx` · `src/lib/etapas.ts` ·
`src/features/dashboard/galeria.tsx`

---

### T1 · El punto verde dice «en vivo» sobre un canal que no manda nada desde el 7-ago

**Tipo**: `bug` · **Costo**: chico · **Bloquea**: nada

Salientes: **0 desde el 7-ago**. La línea principal `51986394450` —dos tercios del tablero, 2 564
personas— tiene su último mensaje el **28-jul**. El indicador mide la frescura del `fetch`, no la
del caño, y a un metro son indistinguibles. A dos centímetros, «Chats 57 · sin caídas hace 1 día» y
«Captura detenida hace 1 día» lo contradicen: tres indicadores de salud dando tres respuestas.

**Qué se hace**
- El server publica `ultimoSalienteAt` en `GET /api/dashboard` (**campo opcional**: N4 y N5 se
  despliegan separados, así que el front lo lee como ausente sin romperse).
- La lectura vive **pura y aparte**, `src/features/dashboard/frescuraDelCano.ts`, con reloj
  inyectado: qué se dice y con qué tinta según cuánto hace. Un componente no se puede interrogar
  sobre el umbral.
- El «en vivo» se subordina: dice el último movimiento **del negocio**, no del caché.
  `SelloDeAntes` (frescura del caché, ADR 0007) **se queda** y es otra cosa — no se fusionan.

**Decisión abierta que resuelve el ticket**: el umbral. Propuesta a confirmar al implementar: se
dice siempre cuánto hace, en tinta neutra abajo de 24 h y en roja por encima. Nunca verde pulsante.

**Cómo se verifica**: test puro del umbral + galería con las dos puntas (caño vivo / caño de tres
días) y captura.

**Archivos**: `server/src/routes/dashboard.ts` · `src/features/dashboard/frescuraDelCano.ts` ·
`VistaDashboard.tsx`

---

### T2 · No hay con qué dibujar un embudo, y hacen falta dos

**Tipo**: `transversal` · **Costo**: chico · **Bloquea**: T3, T5

`components/graficos/` tiene cuatro primitivas propias (`BarraSegmentada`, `Chispa`, `Columnas`,
`LineasHora`) con la marca ya resuelta. Falta la quinta.

> ⚠️ **`BarraSegmentada` NO se sustituye.** Las etapas de la conversación son estados
> **mutuamente excluyentes** y no anidan: dibujarlas como embudo da `377 → 217 → 790 → 13`, que se
> ensancha en el medio. La barra parte-todo es la gráfica correcta para eso (ADR 0047 §2).

**Qué se hace** — `embudo.ts` puro + `Embudo.tsx` tonto, el molde de la casa. `flexGrow` y
porcentajes: **sin SVG, sin escalas, ~60 líneas**.

| La regla | Por qué |
|---|---|
| **El tipo exige `n ≤ n` del peldaño anterior** | Un embudo dibuja subconjuntos. Si no anida, no es un embudo: el error de la panza lo impide el compilador, no la buena voluntad. **`Embudo` no acepta `ETAPAS`.** |
| **La caída se calcula contra el peldaño de ARRIBA**, nunca contra el total | Contra el total, el 52,4 % del último paso se reporta como 1,3 % y desaparece el único peldaño sano. Es el hallazgo entero. |
| **Ancho mínimo, y se dice** | Con 2,6 % el peldaño se vuelve invisible. El piso es honesto solo si se sabe que existe: abajo del mínimo el ancho deja de ser proporcional y manda el número. |
| **Un peldaño en cero no se dibuja** | Mismo criterio que los chips del bot y el `automaticos: null` del cuadro Equipo. |
| **Sin oro** | Acá no corre ningún plazo. Caída en rojo, retención sana en verde: la paleta semántica que el repo ya usa. |

**Cómo se verifica**: tests puros sobre `embudo.ts` (las cinco reglas) + `/galeria-embudo.html`
con los valores reales y captura.

**Archivos**: `src/components/graficos/Embudo.tsx` · `src/components/graficos/embudo.ts`

---

### T3 · Banda 2, el hueco: 26 165 leads y ninguna pantalla los mira

**Tipo**: `vista:dashboard` `datos` `rediseño` · **Costo**: medio · **Bloqueado por**: T2

`leads` tiene **26 165 filas y 21 meses**, el relleno es casi perfecto donde importa (nombre 99,9 %
· email 100 % · teléfono 99,5 % · país 99,9 % · campaña 99,9 %) y **`GET /api/leads/stats` está
montado y desplegado con cero consumidores en el front** (`server/src/index.ts:95`, mitad
desconectada). Mientras tanto el Pipeline ordena `interactions`: la fuente más chica (12 904) y más
corta (19 días) de las tres.

**El embudo que se dibuja**

```
Llenaron un formulario (con teléfono)   26 040   100 %
   se cayeron 25 376 · el 97,4 % nunca recibió un mensaje
Alguien les habló                          664     2,6 %
   de los 664, compró el 52,4 %
Compraron después                          348     1,3 %
```

**2,6 % contra 52,4 %** es el argumento del rediseño entero: el embudo tiene **un solo peldaño
roto**. Aparece igual por curso (38 % a 70 % de los hablados, en todos) y por país (Perú 8,3 %
hablado, Ecuador 0,2 %).

**Qué se hace**
- **Primer paso, antes de diseñar nada**: leer qué devuelve hoy `/api/leads/stats` y decidir si
  alcanza. Si no, se extiende ese endpoint — no se escribe uno nuevo al lado.
- Los tres cortes: **país · curso · ocupación**, cada uno con leads / hablados / compraron después.
- **Alias de `ocupacion` y `campaign_name`**, con el patrón de `cursos/alias.ts`: diccionario en
  base, editable sin deploy, `activo = false` en vez de DELETE. **El valor crudo no se reescribe**,
  se traduce al leer — la misma decisión que tomó `esDeLanding()` con `platform = 'web'`.
  - `ocupacion` está sucio de dos formas: capitalización (`Estudiantes` 4 860 + `estudiante` 612) y
    dos vocabularios (uno humano, uno viejo en snake_case). Normalizado separa **a quien decide y
    paga** (Candidato 1 629 + Jefe de Campaña 790 + Asesor político 2 810) **de quien no**
    (Estudiantes ≈ 5 472). Es el corte comercial más útil de toda la base.
  - `campaign_name`: «Diploma **I**nternacional del Consultor Político» 3 404 + «Diploma
    **i**nternacional…» 554 son el mismo curso.

**Lo que NO se hace, y es parte del ticket**
- ⚠️ **No se llama «conversión de la campaña» al cruce lead↔venta.** Son 348 personas que llenaron
  un formulario y después compraron; la causa no está medida (`resultados/medicion.ts`).
- ⚠️ **La tabla por país no autoriza «los bolivianos no compran».** Está confundido: las tres líneas
  de WhatsApp son peruanas y casi solo se le habla a Perú, así que «% habló» y «% vendió» se mueven
  juntas. Lo que sí prueba es que **se paga por 16 595 leads a los que no se les habla**. La
  pantalla tiene que decirlo con esas palabras.
- ⚠️ **Los 26 040 son formularios, no personas**: hay ≈19 589 detrás y 888 llenaron 3 veces o más.
  Otros 68 ya eran clientes cuando llenaron. Se dice al pie, no se esconde.

**Cómo se verifica**: la galería sirviendo valores reales de producción + captura, y el conteo de
cada faceta cruzado contra la lista que después devuelve (el candado que ya usa el padrón).

**Archivos**: `src/features/dashboard/` (banda nueva) · `server/src/leads/` · `cursos/alias.ts`
(patrón) · migración del diccionario de `ocupacion`

---

### T4 · Once de catorce filas del radar dicen exactamente lo mismo

**Tipo**: `vista:dashboard` `rediseño` · **Costo**: medio · **Bloquea**: nada

Medido sobre la captura del 10-ago: 12 filas dicen `Landing`, 12 dicen `Interesado`, **11 dicen
«Diploma Internacional del Consultor Político»** y 9 dicen `hace 11 días`. Cuatro columnas con
entropía cercana a cero ocupando el 40 % del ancho. La única fila con información real —James,
WhatsApp, `vencido`, `Cotizado`, un mensaje humano— está en la posición 5 con el mismo peso visual
que las trece que la rodean.

`marca.ts` ya escribió el argumento correcto («una marca en TODAS las filas no distingue ninguna»,
el defecto de «sesenta filas que dicen todas lo mismo») y se aplicó a la marca, no al contenido.

**Qué se hace**
- **Lo repetido pasa a encabezado de grupo**, no a contenido de fila:
  `Consultor Político · Landing · 11 días · 47 personas` con una acción de grupo.
- **Se separan los dos trabajos.** Contestarle a alguien que escribió **no es lo mismo** que abrir a
  alguien que llenó un formulario hace once días. Hoy están mezclados en una sola lista ordenada por
  una urgencia que no distingue entre las dos cosas.
- **Fila densa**: una línea, ~38 px. A 74 px se ven 14 de 117; a 38 se ven 28. La app no scrollea.
- **Una codificación por variable.** Hoy la banda de temperatura, el punto dorado y el «hace 11
  días» en rojo dicen los tres lo mismo, sobre la variable menos informativa de la pantalla.
- **El `+` de etiquetas vive en el hover**, como el botón de reaccionar del hilo. Hoy aparece 14
  veces por pantalla invitando a algo que nadie hace: `gestiones` 39 · `intereses` 29 ·
  `eventos_contacto` **1** · `notas` 5 · y las 26 165 filas de `leads.status` dicen `'nuevo'`.

⚠️ **El orden lo sigue decidiendo el server** (`cola/urgencia.ts`). El agrupado es presentación: no
se reimplementa la urgencia en el navegador (#37).

**Cómo se verifica**: la lógica de agrupado vive pura y con test (qué agrupa, qué no, y qué pasa
cuando un grupo queda en uno); galería con los datos reales de producción y captura.

**Archivos**: `src/features/dashboard/VistaDashboard.tsx` · módulo puro de agrupado nuevo

---

### T5 · La cohorte que abre en 9 días al 24 % de su matrícula no está en ninguna pantalla

**Tipo**: `vista:dashboard` `datos` · **Costo**: medio ·
**Bloqueado por**: T2 **y por un cambio en Cerberus**

```
DIPCPOL022  27-feb   68 matriculados
DIPCPOL023  29-abr   84
DIPCPOL024  06-jul   80
DIPCPOL025  19-ago   19   ← EMPIEZA EN 9 DÍAS
```

Y **8 pagaron DIPICOT026 y no están matriculados**, con la clase empezando hoy. Eso es plata ya
cobrada, en riesgo, invisible.

**La dependencia externa, que es diminuta**

Hermes ya consume `GET /productos/api/public/productos-cursos/?estado=1` —**público, sin sesión**,
109 productos, `server/src/cerberus/productos.ts`—. Hoy devuelve `codigo_producto · sku_producto ·
nombre_producto · precio_normal · precio_promocion · categoria · negocio · division · estado`.

**Faltan tres campos**: `fecha_inicio`, `fecha_fin` y `matriculados` (count de `tb_matricula` con
`estado <> 5`). Es un cambio de serializer en Django. `mapearProducto` **ya tolera campos nuevos**.

> 🚨 **No leer la MySQL de Cerberus desde Hermes.** Son VPS distintos y acoplaría Hermes al schema
> de otro producto. El seam correcto es el endpoint HTTP que ya existe.

**Qué se hace**
- El carril temporal por edición: días a la primera clase, matriculados, y la mediana de las
  ediciones anteriores de esa familia como referencia.
- **Acá va el oro** y en ninguna otra banda (ADR 0047 §6): es el único plazo duro del negocio.
- **La ventana abre ~42 días antes de la primera clase y NO cierra el día de inicio** — medido:
  DIPCPOL023 empezó el 29-abr y vendió hasta el 6-ago. El carril tiene que poder dibujar eso.
- **Degrada**: sin los tres campos, la banda **no se dibuja**. No dice «cargando» ni inventa.

**Cómo se verifica**: `curl` al endpoint público de Cerberus mostrando los tres campos, y galería
con los datos reales de las dos ediciones abiertas + captura.

**Archivos**: `server/src/cerberus/productos.ts` · `src/features/dashboard/` (banda nueva)

---

### T6 · «El negocio» mide 34 conversaciones sobre un negocio de 7 105 ventas

**Tipo**: `vista:dashboard` `datos` `rediseño` · **Costo**: grande · **Bloqueado por**: T5

El panel mide *conversaciones nacidas en el período*: 34 filas, ocho de las nueve con `llegaron` en
1 o 2, la columna «Cerrados» entera en cero, «Precio dicho» vacía, y **«Sin curso identificado» con
23 de 34 (68 %)** puesto último y en gris itálica — la fila más poblada por un factor de ocho, en la
posición reservada a lo menos importante. Debajo de la tabla, dos tercios de viewport en blanco.

**Qué se hace**
- **La fila pasa a ser la EDICIÓN**, no el curso: `DIPCPOL025` no es lo mismo que `DIPCPOL024`.
  Columnas: leads · hablados · matriculados · días a la primera clase.
- ⚠️ **El saldo pendiente se muestra por moneda y NUNCA sumado.** El total crudo da **1 843 588** y
  el **87 % de eso son pesos colombianos de siete ventas** (PEN 83 175 · DOP 69 389 · MXN 55 077 ·
  BOB 22 389 · USD 8 209 · COP 1 605 349). Es la misma trampa del `avg(total)` = 4 680.
- **La cobertura horaria se arregla**: hoy «salen» pica en 238 y «entran» en ~18 sobre el mismo eje,
  así que la serie que el gráfico existe para mostrar es una línea plana en el piso y el agujero de
  la noche hay que explicarlo en prosa. Dos ejes, o dos mini-gráficos apilados compartiendo el eje
  horizontal.
- **Entra el cross-sell**, que hoy no está en ninguna pantalla: **28,9 %** compra un segundo
  programa y el **46 %** de esas recompras pasa en **menos de un mes**, casi siempre de *otra*
  familia. El que compró Consultor Político compra Inteligencia, no la edición 27 de Consultor.
- ⚠️ **Si se dibuja el histograma horario de leads, hay que excluir los `00:00:00` exactos**: 2 613
  de 3 491 son filas importadas con fecha y sin hora. Sin filtrarlos, la pantalla diría que conviene
  pautar a medianoche. **Y hay que decir cuántos se excluyeron.**

**Archivos**: `server/src/dashboard/negocio.ts` · `src/features/dashboard/PanelNegocio.tsx`

---

## 4. El orden y las dependencias

| | Ticket | Bloqueado por | Costo | Toca la base |
|---|---|---|---|---|
| T0 | El embudo cuenta las seis etapas | — | chico | no |
| T1 | El sello dice la frescura del caño | — | chico | no |
| T2 | La primitiva `Embudo` | — | chico | no |
| T3 | Banda 2 · El hueco | T2 | medio | sí (alias) |
| T4 | Banda 3 · La mesa | — | medio | no |
| T5 | Banda 1 · El reloj | T2 + **Cerberus** | medio | no |
| T6 | «El negocio» por edición | T5 | grande | no |

**T0 y T1 son de una tarde y arreglan defectos que hoy están mintiendo en producción.** Van
primero, y no dependen del rediseño: se pueden mergear aunque el resto se cancele.

**T5 tiene una dependencia que no es de código.** El pedido a Cerberus (tres campos en un
serializer) hay que hacerlo ya, en paralelo con T0-T4, porque el tiempo de ida y vuelta es de otro
equipo. Mientras no llegue, T5 y T6 esperan y las bandas 2 y 3 avanzan solas.

---

## 5. Lo que no se toca

- **ADR 0036 entero**: la frontera del supervisor, el 403 de `/negocio`, el recorte personal y el
  `?? true` del front quedan exactamente igual. `dashboard/personal.ts` no se abre.
- **El conmutador** `Mi turno | El negocio`, su lugar y su altura fija.
- **Módulo puro + componente tonto.** La política se testea en `node` sin arrastrar React.
- **Paridad server↔front con test.** Es el antídoto de #37 y hay ocho instancias.
- **Degradar, no tumbar.** Todo campo nuevo llega opcional al front: N4 (front, sin restart) y N5
  (server, a botón) se despliegan separados.
- **Las galerías**, con la enmienda de ADR 0044: sirviendo valores reales de producción, nunca el
  caso ideal.
- **`BarraSegmentada`**, que es la gráfica correcta para estados excluyentes.
- **Sin librería de gráficos.** Faltan dos primitivas de ~60 líneas; Recharts pesa 150 kB y trae su
  estética a pelear con los tokens.

---

## 6. Los riesgos, nombrados

1. **`/api/leads/stats` puede no devolver lo que T3 necesita.** Está montado y nunca se consumió, así
   que nadie sabe si el contrato alcanza. Por eso el primer paso del ticket es leerlo, no diseñarlo.
2. **El pedido a Cerberus puede tardar o no llegar.** T5 y T6 quedan bloqueados; el resto no. La
   banda degrada a no dibujarse, así que un T5 a medias no rompe la pantalla.
3. **Los alias de `ocupacion` son un juicio, no un hecho.** Normalizar «Estudiantes» y `estudiante`
   es obvio; decidir que `inteligencia_y_seguridad` es o no «Asesor político» es una opinión
   comercial. El diccionario es editable sin deploy justamente para que la opinión se pueda cambiar.
4. **El agrupado de T4 puede esconder una urgencia real** si un chat vivo cae dentro de un grupo de
   formularios. Por eso los dos trabajos se separan **antes** de agrupar, no después.
5. **Nada de esto abre el caño.** Ver §7.

---

## 7. Lo que este plan no arregla, y hay que decirlo

- **El caño está casi cerrado.** Entrantes: 9-ago 2 · 8-ago 6 · 7-ago 4. **Salientes: 0 desde el
  7-ago.** La línea principal `51986394450` tiene su último mensaje el 28-jul.
- **Los leads cayeron 97,8 % desde mayo** (1 779 → 40). Eso es marketing, no CRM.
- **El 95,4 % de los leads de los últimos 120 días nunca recibió un mensaje** (2 470 de 2 590).
- **Hermes generó una (1) venta registrada en toda su historia**: de las 1 464 filas de
  `conversiones_wa`, 1 463 vienen del puente de icarus.

Ninguna de las cuatro se arregla desde una pantalla. Lo que sí puede hacer una pantalla, y hoy
ninguna hace, es **mostrarlas**.
