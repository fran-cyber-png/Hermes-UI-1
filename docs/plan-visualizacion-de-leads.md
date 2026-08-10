# Plan — la data de leads, y con qué se dibuja

**Fecha**: 9-ago-2026 · **Estado**: propuesta. Nada de esto está implementado.
**Pedido del dueño**: *«quiero que revises mi data que ya tenemos de los leads (…) tenemos que ver
la arquitectura del proyecto y cómo usamos componentes visuales reutilizables, patrones de React,
librerías y estrategias que usan estos CRM's para potenciar todo»*

Continúa `docs/plan-pipeline-funcional.md` (que trataba **la pantalla**) y
`docs/plan-pipeline-por-canal.md` (que trataba **el modelo**). Éste trata **la data y el dibujo**:
qué se puede afirmar hoy con lo que ya está guardado, y con qué piezas se muestra sin romper la casa.

Todo lo que sigue está medido en producción el **9-ago-2026** (`36e7693`, sin drift), con SQL por
stdin contra `hermes_db`. Donde hay un número hay una consulta detrás; donde no lo hay, está dicho
que es una opinión.

---

## 1. Qué hay guardado, de verdad

`leads` tiene **26.165 filas** que cubren del **22-nov-2024 al 9-ago-2026** — casi dos años. El
relleno es casi perfecto donde importa:

| nombre | email | teléfono | país | campaña | form_name | custom_fields | **adset / ad** |
|---|---|---|---|---|---|---|---|
| 99,9 % | 100 % | 99,5 % | 99,9 % | 99,9 % | 100 % | 100 % | **2,5 %** |

`adset_name` y `ad_name` están al 2,5 % porque solo los traen los **651 Lead Ads**, muertos desde el
19-may. Todo lo demás —los 25.514 de landing— llega completo.

> 🔴 **Y no lo mira nadie.** `GET /api/leads/stats` está montado (`server/src/index.ts:95`), ya
> calcula por-campaña y por-país, y tiene **cero consumidores en el front** (`grep -rn "api/leads"
> src/` no devuelve nada). Es de la mitad desconectada del repo — CLAUDE.md §DOS MITADES.

Comparado con lo que el Pipeline sí usa:

| fuente | filas | ventana temporal | ¿la usa alguna pantalla? |
|---|---|---|---|
| **`leads`** | **26.165** | **21 meses** | ❌ ninguna |
| `interactions` | 12.904 | 19 días (21-jul → 9-ago) | ✅ el Pipeline entero |
| `conversiones_wa` | 1.464 | 2 años | ✅ la columna Cierre |

El Pipeline ordena la fuente **más chica y más corta** de las tres.

---

## 2. Lo que la data dice y ninguna pantalla muestra

### 2.1 · La conversión real: 348, no 13

Cruzando `leads.phone` con `conversiones_wa.telefono` (sufijo de 9), **y exigiendo que la venta sea
POSTERIOR al formulario** —el mismo criterio que ADR 0044 usa para derivar `cierre`—:

```
26.040 leads con teléfono
   →  348 con una venta POSTERIOR al formulario   (1,34 %)
   →   68 ya eran clientes cuando llenaron
   → 25.624 sin ninguna venta
```

> 🔴 **El Pipeline dice «13 Cierre». La data de leads dice 348.** No se contradicen: el Pipeline
> solo puede ver conversaciones de WhatsApp de los últimos 19 días. **El embudo está midiendo el
> 3,7 % del negocio que efectivamente cerró.**

⚠️ **Lo que estos 348 NO autorizan a decir**: que la landing los causó. Autorizan a decir que
*llenaron un formulario y después compraron*, que es exactamente lo que el nombre dice. La regla de
`resultados/medicion.ts` —los nombres no prometen causa— aplica igual acá.

### 2.2 · País: el 77 % del gasto va a donde no se vende

| país | leads | hablaron | % habló | venta posterior | % vendió |
|---|---|---|---|---|---|
| **Perú** | 6.115 | 510 | **8,3 %** | **311** | **5,1 %** |
| Bolivia | 5.295 | 32 | 0,6 % | 3 | 0,06 % |
| México | 4.504 | 36 | 0,8 % | 6 | 0,13 % |
| Ecuador | 4.266 | 9 | 0,2 % | 1 | 0,02 % |
| Rep. Dominicana | 2.530 | 3 | 0,1 % | **0** | 0 % |
| Estados Unidos | 535 | 23 | 4,3 % | 6 | 1,1 % |
| Guatemala | 374 | 5 | 1,3 % | 0 | 0 % |
| Colombia | 353 | **0** | 0 % | 0 | 0 % |
| Chile | 282 | 2 | 0,7 % | 1 | 0,4 % |
| Honduras | 179 | **0** | 0 % | 0 | 0 % |

Dicho en una línea: **Bolivia + México + Ecuador + Rep. Dominicana suman 16.595 leads y 10 ventas.**
Perú es el 23 % de los leads y **el 89 % de las ventas atribuibles** (311 de 348).

⚠️ **Está confundido, y hay que decirlo antes de que alguien saque la conclusión fácil.** Las tres
líneas de WhatsApp son peruanas y casi solo se le habla a Perú: la columna «% habló» y la columna
«% vendió» se mueven juntas. Esto **no** prueba que un boliviano no compre. Lo que sí prueba —y es
suficiente para actuar— es que **se está pagando por 16.595 leads a los que prácticamente no se les
habla**. Si son malos o si están desatendidos es una pregunta que se contesta hablándoles, no
mirando esta tabla.

### 2.3 · Curso: la diferencia no está en el curso, está en a quién se le habla

| curso | leads | hablaron | venta posterior | % de los leads | **% de los que hablaron** |
|---|---|---|---|---|---|
| Oratoria e Imagen Política | **3.753** | 25 | 15 | 0,40 % | **60 %** |
| Consultor Político | 3.388 | **126** | **66** | 1,95 % | 52 % |
| Asesor Presidencial | 2.997 | 66 | 42 | 1,40 % | **64 %** |
| Inteligencia y Contrainteligencia | 2.696 | 95 | 36 | 1,34 % | 38 % |
| Inteligencia Operativa Policial | 1.407 | 10 | 7 | 0,50 % | 70 % |
| IA y Marketing Político | 1.201 | 26 | 13 | 1,08 % | 50 % |
| Osint & Socmint | 1.190 | 30 | 16 | 1,34 % | 53 % |
| Ciberinteligencia y Ciberdefensa | 1.145 | **5** | 2 | 0,17 % | 40 % |

🔴 **La última columna es el hallazgo.** Sobre el total de leads, Consultor Político convierte
**4,9× mejor** que Oratoria — pero **una vez que alguien habla con la persona, todos los cursos
convierten entre 38 % y 70 %**. La diferencia entre el mejor y el peor curso no está en el producto:
está en que a los 3.753 leads de Oratoria se les habló **25 veces**.

Es la misma forma del hallazgo de país, y las dos apuntan al mismo lugar: **el cuello no es la
calidad del lead, es el contacto.**

### 2.4 · `ocupacion`: el segmentador que existe, está sucio, y nadie usa

`custom_fields` trae **cinco claves en el 100 %** de los 25.514 leads de landing: `contact_id`,
`source`, `source_detail`, `landing_page` y **`ocupacion`**. Las tres primeras son constantes
(`source` = `landing` en las 25.514). `landing_page` está vacío (§3). Queda una, y es la buena:

```
Otros              9.460       Candidato            1.629   ← decide y paga
Estudiantes        4.860       Jefe de Campaña        790   ← decide y paga
Asesor político    2.810       (vacío)                674
Estratega          2.651       estudiante             612   ← duplicado de «Estudiantes»
```

**Está sucio de dos formas**, las dos arreglables sin tocar la base:

1. **Capitalización**: `Estudiantes` 4.860 + `estudiante` 612 · `Otros` 9.460 + `otros` 260 +
   `otro` 536 · `Estratega` 2.651 + `estratega` 292 · `Candidato` 1.629 + `candidato` 71.
2. **Dos vocabularios**: uno humano («Jefe de Campaña») y uno viejo en snake_case
   (`inteligencia_y_seguridad` 265, `miembro_de_fuerzas_armadas_o_policía` 136,
   `funcionario_público` 57, `asesoría_política_/candidatos` 56…).

Normalizado, separa **a quien decide y paga** (Candidato, Jefe de Campaña, Asesor político ≈ 5.229)
**de quien no** (Estudiantes ≈ 5.472). Es el corte comercial más útil que hay en toda la base y hoy
no se puede hacer en ninguna pantalla.

> **Cómo se arregla, y el patrón ya existe**: un diccionario de alias como `cursos/alias.ts`
> (`ALIAS_SEMILLA`, editable sin deploy, `activo = false` en vez de DELETE). **El valor crudo no se
> reescribe** — se traduce al leer. Es la misma decisión que `esDeLanding()` tomó con
> `platform = 'web'`: cambiar el hecho para no cambiar la consulta es al revés.

### 2.5 · Reincidencia: 888 personas insistieron y a 846 no les habló nadie

| llenó el formulario | personas | hablaron | % |
|---|---|---|---|
| 1 vez | 14.652 | 309 | 2,1 % |
| 2 veces | 4.049 | 80 | 2,0 % |
| **3 o más veces** | **888** | **42** | **4,7 %** |

Hay quien llenó **14 veces**. Los únicos reales son ≈ 19.589, no 26.165 — o sea que **uno de cada
cuatro «leads» es la misma persona volviendo**.

Volver tres veces es la señal de intención más barata que hay, y **846 de esas 888 personas nunca
recibieron un mensaje**.

⚠️ No medí si los reincidentes *compran* más — solo que se les habla más (probablemente porque
aparecen en más listas, no porque alguien haya decidido priorizarlos). Es una hipótesis testeable,
no un hecho.

### 2.6 · La serie temporal: 20 meses, no 18 días

```
2025:  feb 3.412 · abr 1.794 · jun 874 · ago 1.984 · oct 1.329 · nov 1.714 · dic 1.399
2026:  ene 2.937 · feb 1.008 · mar 1.570 · abr 343 · may 1.779 · jun 361 · jul 143 · ago 40
```

Es **la curva del negocio**, es dibujable hoy sin tocar el server, y no está en ninguna pantalla. La
caída de mayo a agosto es del **97,8 %**.

---

## 3. Los defectos de la data

| # | qué | tamaño | ¿se arregla? |
|---|---|---|---|
| 1 | **`landing_page` vacío** | 26.128 de 26.165 (99,9 %) | ❌ no sirve. Los 37 con valor son URLs con `fbclid`. **La landing real se saca de `campaign_name`.** |
| 2 | **`status = 'nuevo'` en las 26.165 filas** | 100 % | ❌ nunca se usó. No inventarle un significado: **derivar el estado del cruce con `interactions`**, como hace ADR 0044 |
| 3 | **`campaign_name` sin normalizar** | «Diploma **I**nternacional del Consultor Político» 3.404 + «Diploma **i**nternacional…» 554 | ✅ alias, como `ocupacion` |
| 4 | **`ocupacion` con dos vocabularios** | ~2.000 filas en snake_case | ✅ alias (§2.4) |
| 5 | 🔴 **El pico de las 00:00 es un artefacto** | 2.613 de 3.491 caen en `00:00:00` **exacto** | ⚠️ ver abajo |

**Sobre el #5**, porque es una trampa lista para que alguien caiga: el histograma de «a qué hora
llenan el formulario» muestra un pico enorme a medianoche (3.491, contra ~1.700 en el pico real de
las 21-22 h). **No es real**: 2.613 de esos tienen minuto y segundo en cero, o sea que son filas
importadas con fecha pero sin hora, normalizadas a medianoche. En las otras horas eso pasa **0 o 1
vez**. Son sobre todo de 2026 (2.829 de 3.491).

> **Si se dibuja el histograma horario sin excluirlos, la pantalla va a decir que el mejor momento
> para pautar es la medianoche.** Hay que filtrar `00:00:00` exacto y decir cuántos se excluyeron
> — nunca callarlo.

---

## 4. El número que ordena la prioridad

De los **2.590 leads de los últimos 120 días**, cuánto tardaron en recibir su primer mensaje:

```
< 1 h        2
1-24 h       8
1-7 d       10
> 7 d       99
NUNCA    2.470        ← 95,4 %
```

Todo lo demás de este documento es secundario frente a esto. Un tablero mejor ordena mejor **lo que
se atiende**; acá el 95,4 % no se atiende.

---

## 5. La arquitectura, tal como está

### 5.1 · El patrón de la casa (esto está bien y no hay que romperlo)

**Módulo puro + componente tonto.** `tablero.ts` decide *qué chips se ofrecen y con qué número*;
`VistaEmbudo.tsx` solo los dibuja. Igual `compuertas.ts`, `presentacion.ts`, `estadoContacto.ts`,
`revision.ts`. La política se testea en `node` sin arrastrar React — y el caso que importa (el chip
activo que se quedaría sin conteo y desaparecería, dejando el recorte encendido sin forma de
apagarlo) **no se ve en una captura**.

**Paridad server↔front fijada con test.** `urgencia.ts` ↔ `urgenciaSql.ts`, `limitesMedia.paridad`,
`eventos/paridad`, `ivi/paridad-front`. Es el antídoto de #37 aplicado sistemáticamente.

**Galerías por feature.** Trece `galeria-*.html` que montan la UI sin server ni base. Es
infraestructura de evidencia, no un extra — y ADR 0044 ya dejó escrito que **una galería que no
sirve los valores reales no es evidencia**.

**Degradar, no tumbar.** Todo campo nuevo del server es opcional en el front, porque N4 (front, sin
restart) y N5 (server, a botón) se despliegan separados.

### 5.2 · Lo que ya existe y el Pipeline no usa

`src/components/graficos/` tiene **cuatro primitivas SVG hechas a mano**, con el estilo de la marca
ya resuelto (sin oro, `currentColor`, sin animación, sin grilla):

| primitiva | qué es | líneas | quién la usa |
|---|---|---|---|
| `BarraSegmentada` | el embudo en una línea de 2 px, clickeable | 46 | Dashboard, FormularioVenta |
| `Chispa` | sparkline sin ejes, hereda la tinta | 33 | Dashboard |
| `Columnas` | serie diaria; el hover **reemplaza la línea de resumen** en vez de flotar un tooltip | 93 | Dashboard |
| `LineasHora` | la grande | 247 | PanelNegocio |

> **El Pipeline usa cero de las cuatro.** Y `BarraSegmentada` es, literalmente, «el embudo en una
> línea»: la visualización que falta arriba del tablero **ya está construida y probada**.

### 5.3 · Las cinco deudas que tocan este frente

1. 🔴 **No existe la noción de «vista» o «segmento».** `recortes` es un `useState` local de
   `VistaEmbudo`; se pierde al cambiar de pantalla, no va a la URL, no se puede compartir ni
   guardar. Y cada pantalla reinventó el suyo: los recortes del Pipeline, las facetas del padrón
   (`padron/donde.ts`), los chips de la cola. **Son cuatro implementaciones de la misma idea.**
2. **`TarjetaEmbudo` tiene 409 líneas y 12 props.** Cada variante nueva es otra prop booleana.
3. **Sin virtualización**: paginación de 30 (`canales/conversaciones.ts:186`) con «Ver más». Sobre
   la columna de 2.576 eso son **86 clics** para llegar al fondo.
4. **Drag HTML5 nativo** (`draggable` + `onDragOver`/`onDrop`). Funciona, pero no tiene teclado ni
   lectores de pantalla.
5. **No hay primitiva de lista/tabla.** La vista Lista del Pipeline no tiene de dónde salir.

---

## 6. Con qué se dibuja: las librerías, y el criterio

La app tiene **13 dependencias de runtime**. Ese número es una decisión, no un descuido: cada
librería que entra hay que justificarla contra hacerlo a mano.

| librería | para qué | peso | veredicto |
|---|---|---|---|
| **`@tanstack/react-virtual`** | las columnas de 2.576 y la vista Lista | ~3 kB | ✅ **el único claro** |
| `@tanstack/react-table` | la vista Lista, si se hace en serio (headless, sin estética) | ~14 kB | 🟡 solo cuando la Lista exista |
| `visx` | escalas y ejes de verdad | ~15 kB | 🟡 nada de lo propuesto los pide |
| Recharts | gráficos | ~150 kB | ❌ trae su propia estética a pelear con los tokens |
| Tremor | dashboard completo | ~200 kB | ❌ está construido sobre Recharts y asume shadcn |
| Nivo | gráficos | 500 kB+ | ❌ |
| `dnd-kit` | drag accesible por teclado | ~30 kB | 🟡 gana en accesibilidad; su detección de colisiones se degrada con 1.000+ ítems |

> **Lo que falta no es una librería de gráficos: son dos primitivas más**, con el mismo molde que
> las cuatro que ya andan.
>
> - **`Embudo`** — barras horizontales proporcionales con la caída entre etapas. Es
>   `BarraSegmentada` puesta en vertical; **no necesita SVG**: es `flexGrow`.
> - **`BarrasComparadas`** — el ranking país / curso / ocupación con dos series (leads vs. ventas).
>   Tampoco necesita SVG ni escalas.
>
> Son ~60 líneas cada una. Recharts daría lo mismo pesando 150 kB.

---

## 7. Los patrones de React que faltan (y son gratis)

**1. El segmento como DATO, no como `useState`.** Es lo que hacen Attio y Pipedrive: la vista es un
objeto serializable —`{etapa, recorte, pais, curso, ocupacion}`— y no un estado local. De una sola
decisión salen cuatro cosas: la persistencia entre vistas, el «guardar esta vista», el poder
compartirla, y **poder mandarle a Ivi el mismo objeto** que la pantalla está mirando. Resuelve
además la deuda 5.3.1 unificando las cuatro implementaciones.

**2. Extender el patrón puro a los gráficos.** El módulo puro calcula la geometría (`embudo.ts`
devuelve `{etapa, n, ancho, caida}`) y el componente la dibuja. Así se puede fijar con test que «una
etapa en cero no se dibuja» o que «la caída se calcula contra el peldaño de arriba, no contra el
total» sin montar DOM — que es exactamente el porqué de que `recortesDeColumna` sea puro.

**3. Composición en vez de props booleanas** en `TarjetaEmbudo`. Con 12 props, la #13 (rotting,
píldora de país, badge de reincidencia) empieza a doler. Un slot para las píldoras corta eso.

**4. `select` en las queries.** React Query ya está; `select` deriva sin recalcular en cada render,
que es lo que hoy hace `resumirColumna` en el cuerpo del componente.

---

## 8. Las estrategias de los CRMs, traducidas

| estrategia | quién | cómo cae en Hermes |
|---|---|---|
| **Multi-vista del mismo dato** (kanban / lista / forecast) | Pipedrive, Attio | Toggle `Tablero \| Lista` sobre `useConversaciones` — el hook ya sirve lo mismo |
| **Deal rotting** (color por días sin actividad) | Pipedrive, HubSpot | `etapa_desde` ya viaja; hoy es texto, sería forma. ⚠️ choca con «el oro es tiempo que se acaba» — ver §10 |
| **Segmentos guardados** | Attio, Folk | §7.1 |
| **Activity-based selling** | Pipedrive | Ya está medido y nunca se muestra: **384 primeras respuestas en menos de 1 h** |
| **Conversation-first** (chat pegado al pipeline) | Kommo, respond.io | El hilo dentro de `HojaContacto`, solo lectura |
| **Funnel chart + Sankey** | Amplitude, Mixpanel | `Embudo` + el cruce país/curso → etapa |

---

## 9. El orden propuesto

| # | qué | dónde | depende de | costo |
|---|---|---|---|---|
| 1 | **Virtualizar las columnas** | `VistaEmbudo` + `@tanstack/react-virtual` | nada | chico |
| 2 | **La primitiva `Embudo`** arriba del tablero | `components/graficos/` + `embudo.ts` puro | el `desglose` que el server ya sirve | chico |
| 3 | **Vista de leads con las tres dimensiones** (país · curso · ocupación) | front nuevo + `/api/leads/stats` **que ya existe** | los alias del #4 | medio |
| 4 | **Alias de `ocupacion` y `campaign_name`** | patrón de `cursos/alias.ts` | nada | chico |
| 5 | **El segmento como dato** | unifica las 4 implementaciones | nada | medio |
| 6 | **Vista Lista** del Pipeline | `@tanstack/react-table` | 1 y 5 | medio |

Los cuatro primeros no tocan el server ni la base. El #3 es el que devuelve más por lo que cuesta:
**la API ya está escrita y desplegada.**

---

## 10. Lo que NO hay que hacer

- **No meter una librería de gráficos.** Hay cuatro primitivas propias que ya resuelven la marca, y
  lo que falta son dos más de ~60 líneas. Recharts/Tremor traen su estética y 150-200 kB.
- **No reescribir `ocupacion` ni `campaign_name` en la base.** Se traducen al leer, como hizo
  `esDeLanding()` con `platform = 'web'`. Cambiar 26.165 hechos históricos para no cambiar una
  consulta es al revés.
- **No dibujar el histograma horario sin excluir los `00:00:00`** (§3.5). Diría que se pauta a
  medianoche.
- **No llamar «conversión de la campaña» al cruce lead↔venta.** Son 348 personas que llenaron un
  formulario y después compraron. La causa no está medida (`resultados/medicion.ts`).
- **No pedirle a nadie que declare nada.** El dato del día, otra vez: `gestiones` 39 · `intereses`
  29 · `eventos_contacto` **1** · `notas` 5 · **`status` de `leads`: 26.165 filas y las 26.165
  dicen `'nuevo'`**. Lo que exige un clic humano no se usa. La única excepción viva es
  `conversacion_asignada` (1.092) — y esa no la clickea una persona, la escribe el webhook.
- **No pintar el rotting con oro.** El oro significa **tiempo que se acaba** y `canales/antiguedad.ts`
  decidió explícitamente no usarlo en la tarjeta del Pipeline porque ahí no corre ningún plazo. Si
  se hace rotting, primero hay que decidir si el tiempo-en-etapa *es* un plazo — opinión: sí en
  Cotizados, no en Sin respuesta.

---

## 11. Lo que este plan no resuelve, y hay que decirlo

Igual que los dos planes anteriores, y con más fuerza cada vez que se mide:

- **El caño está casi cerrado.** Entrantes: 9-ago **2** · 8-ago 6 · 7-ago 4. Salientes: **0 desde el
  7-ago**. La línea principal `51986394450` —2.564 personas, dos tercios del tablero— tiene su
  último mensaje el **28-jul**.
- **Los leads cayeron 97,8 % desde mayo** (1.779 → 40). Eso es marketing, no CRM.
- **El 95,4 % de los leads de los últimos 120 días nunca recibió un mensaje** (§4).
- **Hermes generó una (1) venta registrada en toda su historia**: de las 1.464 filas de
  `conversiones_wa`, 1.463 vienen del puente de icarus y **1** tiene `fuente_venta = 'hermes'`.

Ninguna de las cuatro se arregla desde una pantalla. Lo que sí puede hacer una pantalla —y hoy
ninguna hace— es **mostrarlas**: que la primera cosa que se vea al abrir Hermes sea dónde se está
perdiendo la plata, en vez de un tablero lleno de tarjetas sobre datos de hace dos semanas.
