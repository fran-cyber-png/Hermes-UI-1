# Routing — el mapa del flujo y qué hacemos con él

**Fecha**: 12-ago-2026 · **Estado**: **fases 1, 2, 3 y 5 construidas**. Falta la 4.
**Enmienda 18-ago-2026**: la Fase 5 se hizo y creció en el camino — ver **ADR 0060**.
**Base**: ADR 0053 (el ruteo por campaña) + los tres commits de `feat/routing-cables` (PR #364)

> Este documento existe porque la pantalla que hay hoy **funciona y no se entiende**. El pedido del
> dueño (12-ago): *«debería poder arrastrar el punto para conectar lo que quiera, ahorita no se
> entiende bien cómo se enlazan; tener multi-niveles, si quiero entrar en la campaña dentro del
> flujo»*. Antes de rehacer la UI hay que tener el mapa completo de por dónde pasa un lead, porque
> **cada nodo del dibujo tiene que corresponder a un lugar real donde se decide algo**.

---

## 1. El flujo real, de punta a punta

Todo lo de abajo está verificado leyendo el código y midiendo contra una copia de producción del
12-ago-2026. Los números son reales.

### 1.1 El lead que llega por un anuncio de Meta

```
  Meta: campaña ──► adset ──► anuncio          El adset dice a QUÉ NÚMERO manda
     │                          │              (promoted_object.whatsapp_phone_number)
     │                          │
     │                    click-to-WhatsApp
     │                          ▼
     │              el mensaje llega con `referral.source_id` = el ad_id
     │                          │
     ▼                          ▼
  ¿es un número de Hermes?   POST /webhook/whatsapp
     │  17 adsets activos       │  · guarda events(source='meta_wa_ctwa')
     │  → 8 números distintos   │  · notifica al bot
     │  → 1 lo atiende Hermes   │  · asignarSiHaceFalta(clave, línea, adId)   ← ACÁ SE DECIDE
     │                          ▼
     │            ┌─────────────────────────────────────────┐
     └───────────►│ campana_anuncio:  ad_id → campaña        │  ① lo llena «Actualizar desde Meta»
                  │ campana_ruteo:    campaña → vendedoras   │  ② lo llena ESTA pantalla
                  └─────────────────────────────────────────┘
                                    │
                     ¿la campaña tiene cables?
                       sí ──► round-robin ENTRE ESOS  (motivo='campana')
                       no ──► round-robin en reparto_rueda (motivo='round-robin')
                                    │
                                    ▼
                          conversacion_asignada
```

**Los tres agujeros medidos, en orden de tamaño:**

| Dónde | Qué pasa | Medido |
|---|---|---|
| El número destino | El adset manda a un teléfono que Hermes no levanta | **16 de 17 adsets activos** |
| `campana_anuncio` | El anuncio se estrenó y nadie refrescó: no se sabe de qué campaña es | 0 hoy, pero es el estado natural de todo anuncio nuevo |
| `campana_ruteo` | La campaña no tiene cables | el default de todas |

Los tres terminan igual: **el lead cae a la rueda general**. Ninguno tira un error. Es fail-open a
propósito (un lead mal ruteado está peor atendido; uno sin dueño está perdido), pero significa que
**la pantalla tiene que mostrar los tres**, o el ruteo parece roto sin decir por qué.

### 1.2 El lead que llega por un formulario de icarus

```
  landing ──► icarus ──► leads(platform='web', campaign_name = el nombre del producto)
                            │
                            ▼
                   la cola lo levanta como `lead:<id>`   (ADR 0051, ventana de 30 días)
                            │
                   ¿su curso tiene cables? (curso_ruteo)   ← lo llena ESTA pantalla
                       no ──► lo ve TODO el equipo (la exención de ADR 0051)
                       sí ──► dueño DERIVADO por sufijo de teléfono
                                    │
                                    ▼
                       la cola lo muestra como suyo y «Míos» lo filtra
```

**Por qué acá el dueño se deriva y no se guarda** (ya está construido, `routing/lead.ts`): un lead no
tiene línea, y su clave es `lead:<id>` con un id nuevo por cada reenvío — **154 envíos de 145
personas** en la ventana. Una asignación guardada se perdería justo cuando la persona insiste.

### 1.3 Lo que junta a los dos: el producto

`alias_curso` (familia + alias de texto) resuelto con `familiaDeTexto`. Cobertura medida:

```
formularios   19 / 21   (90 %)   son nombres comerciales: «Diploma Internacional del Consultor Político»
campañas      19 / 44   (43 %)   son nombres de pauta:    «[AGO] OSINT - INTERACCIONES - 11 - 31»
```

Y **el alias tiene falsos positivos reales**: «Programa Premium ChatGPT Pro para consultoría
política» cae en `DIPCPOL` porque el alias dice «consultoría política»; «Master Agente de
Inteligencia Artificial» cae en `DIPICOT` por «inteligencia».

---

## 2. Qué está mal en la pantalla de hoy

Tres cosas, y las tres son de interacción, no de datos.

### 2.1 🔴 Seleccionás y no pasa nada visible

En el tablero de producto, tocar una vendedora la marca pero **no dibuja el cable**: los cables solo
renderizan `pieza.vendedoras`, o sea lo YA GUARDADO. En la captura del dueño, Luz y Tracy están
marcadas y no sale una sola línea hacia ellas.

Es el defecto que hace que «no se entienda cómo se enlazan»: el gesto no produce la cosa que el
dibujo promete.

### 2.2 🔴 Dos tableros con dos modelos de interacción

| Tablero | Qué hace un clic |
|---|---|
| Campaña o formulario suelto | **guarda al instante** |
| Producto | arma una selección y hay que apretar «Aplicar a las 4» |

La misma acción visual —tocar una vendedora— hace dos cosas distintas según qué elegiste en la lista
de la izquierda. Eso no se aprende, se sufre.

### 2.3 ⚠️ No hay forma de arrastrar, y los puertos parecen decir que sí

Los círculos de los nodos son puertos: en cualquier editor de nodos eso invita a arrastrar. Acá no
hacen nada — la conexión es por clic en la tarjeta. El dibujo promete una interacción que no existe.

---

## 3. El plan

### ✅ Fase 1 — Un solo modelo de interacción, y que el cable siga al gesto

**Lo mínimo para que se entienda, y lo que más rinde por línea de código.**

- **Arrastrar del puerto al puerto conecta.** `pointerdown` en un puerto → un cable «fantasma» sigue
  al mouse → `pointerup` sobre un puerto compatible conecta. Con teclado: `Enter` sobre un puerto lo
  arma, `Enter` sobre otro lo cierra (los dos puertos son `button`, no `div`).
- **Tocar un cable lo corta.** Es la operación inversa y hoy no existe: para desconectar hay que
  volver a tocar la tarjeta de la vendedora, que no es donde está el cable.
- **El clic en la tarjeta sigue funcionando** como atajo (conecta/desconecta), porque arrastrar en un
  trackpad con una mano ocupada es peor que un clic.
- 🔴 **Los cables dibujan el estado PENDIENTE, no el guardado.** Es la corrección de §2.1: si tocaste
  y todavía no guardaste, el cable existe y se ve distinto (más fino, o animado). Sin esto cualquier
  interacción sigue sin explicarse sola.
- 🔴 **Un solo modelo: guardar al soltar.** Se elimina el botón «Aplicar» del producto y la acción
  masiva pasa a ser explícita y aparte (§Fase 2). Dos modelos conviviendo es peor que cualquiera de
  los dos.

**Cómo se verifica**: test de DOM (`jsdom`) sobre el arrastre —`pointerdown`/`pointermove`/`pointerup`
sintéticos— y captura de las tres situaciones: sin cables, arrastrando, conectado.

### ✅ Fase 2 — La acción masiva, explícita y separada del gesto

Hoy «Aplicar a las 4» compite con el arrastre por el mismo espacio mental.

- El tablero de producto muestra las piezas y **cada una se cablea sola, arrastrando**.
- La acción masiva pasa a ser un botón nombrado: **«Poner este cable en las 4»**, con lo que va a
  pisar nombrado antes (eso ✅ ya está).
- ⚠️ **Se mantiene la decisión del 12-ago**: cablear el producto ESCRIBE en cada pieza, no crea una
  regla que hereden. Esta fase no la toca.

### ✅ Fase 3 — Entrar en un nodo **sin perder el flujo** (rehecha el 12-ago)

> ⚠️ **Se implementó y estaba mal, y el dueño lo vio en la primera captura**:
> *«sale así pero no sale el producto atrás de todo, tiene que ser más fácil de
> interactuar y vigilar todo»*.

La primera versión **bajaba un nivel**: entrar en una campaña reemplazaba el
lienzo entero por `sus anuncios · la campaña · vendedoras`. O sea que para ver el
detalle de una pieza **había que perder de vista el producto al que pertenece y
las campañas hermanas** — justo el contexto que hace falta para decidir a quién
darle el tráfico.

**Lo que se hizo en su lugar: la campaña se ABRE EN SU LUGAR.** Sus anuncios
salen dentro del nodo (lista de solo lectura, con tope de alto) y todo lo demás
se queda donde estaba. Abrir **suma detalle y no cambia la topología** — hay test
que compara las columnas abierta y cerrada y exige que sean las mismas.

· Los anuncios **no llevan puerto**: no existe una regla por anuncio (el reparto
  resuelve `ad_id → campaña → vendedoras`), y dibujarles uno prometería un
  control que el server no tiene. Eso era, literalmente, uno de los cables
  fantasma que la auditoría encontró.
· `Escape` cierra. La miga de pan se retiró: no hay a dónde volver si nunca te
  fuiste.
· «No se pudo preguntar» ≠ «no hay anuncios»: la apertura tiene **tres** estados.

### ✅ Fase 3b — El producto se cablea derecho a la vendedora (12-ago)

Pedido del dueño: *«si quiero enlazar de frente el producto con la vendedora que
se haga las conexiones automáticamente»*. El puerto del producto ahora **saltea
sus piezas y llega a la vendedora**; al soltar, se escribe el cable en cada una
de sus campañas y formularios (medido: **+4 cables en un gesto**).

· 🔴 **El arrastre manda `agregar`/`quitar`, nunca `reemplazar`.** Un gesto de un
  dedo no puede borrarle a las otras piezas las vendedoras que ya tenían. Para
  eso está el botón, que dice explícitamente qué va a pisar.
· El cable del producto **se deriva**: existe solo si TODAS sus piezas lo tienen.
  Sin tercera tabla que se pueda desincronizar, y sin mentir cuando hay mezcla.

### ✅ Fase 3c — ⌘Z (12-ago)

Guarda la **operación inversa**, no una foto del estado: con fotos, deshacer
pisaría lo que otra supervisora guardó mientras tanto. Viaja por el mismo camino
que un gesto, así que un `409` la revierte sola. Tope de 50.

· ⚠️ **La acción masiva queda afuera del atajo, a propósito**: su inversa
  necesita los conjuntos previos pieza por pieza, y un deshacer que falla en el
  medio deja el producto a mitad de camino sin que nadie lo sepa.
· El atajo **se anuncia** en la cabecera cuando hay algo que deshacer: nadie
  prueba ⌘Z en una pantalla de configuración por las dudas.

### Fase 4 — Los agujeros del flujo, a la vista

Hoy hay un cartel de una línea («otras 42 campañas mandan a números que Hermes no atiende»). Es
verdad y es insuficiente.

- Un nodo **«fuera de Hermes»** en el lienzo, con las campañas que mandan a otro teléfono y **a cuál**.
  Es la información que convierte «no se puede rutear» en «reapuntá este adset o levantá esta línea».
- El contador de anuncios sin resolver enlaza a «Actualizar desde Meta» en vez de solo informar.

### ✅ Fase 5 — Corregir el producto de una pieza (18-ago-2026, **ADR 0060**)

El falso positivo del alias (§1.3) ya no solo se ve: se corrige, desde una hoja a la derecha.

**Y creció en el camino, porque medir primero cambió el plan**: la mitad de los casos no había que
corregirlos a mano, había que **dejar de adivinarlos**. La pauta viene escribiendo el SKU adentro del
nombre (`[MAR] [DIPCIBE004] CIBERDEFENSA`) y nadie lo leía.

| | Antes | Después |
|---|---|---|
| Campañas sin producto | 93 de 153 | **70** |
| Campañas en el producto EQUIVOCADO | 7 | **0** |
| Formularios en el producto equivocado | 4 | **a mano** (no traen SKU) |

- ⚠️ **Es el único punto del plan que edita un diccionario compartido**, y se resolvió al derecho:
  la corrección se guarda en `alias_curso`, así que arregla **también** el chip de curso de la cola,
  el Dashboard y el bot. Decisión del dueño, tomada sabiendo el alcance; la hoja lo dice **antes** de
  que elijas. La alternativa —una tabla de overrides propia de Routing— dejaba a la cola mostrando el
  producto viejo, o sea dos pantallas afirmando cosas distintas del mismo lead (#37).
- 🔴 **Lo que este plan no había previsto**: un override tiene que ganarle **al SKU**, no solo a los
  otros aliases. Sin eso, corregir a mano una campaña con `[DIPMP0001]` adentro contestaba `ok`, la
  pantalla mostraba el producto nuevo y la lectura siguiente lo pisaba — **se veía aplicado sin
  estarlo**, que es la forma de defecto que este frente viene arrastrando desde la auditoría del
  12-ago.

---

## 4. Lo que NO se hace, y por qué

- **Un lienzo libre con nodos arrastrables por posición.** Tentador y equivocado: la posición no
  significa nada acá (no hay topología que el usuario diseñe), así que sería estado que hay que
  guardar, sincronizar entre personas y migrar. Las columnas fijas son la topología.
- **Zoom y paneo.** Con 14 productos y 5 vendedoras no hay nada que no entre en pantalla. El día que
  haya 50 productos, el problema es la lista, no el zoom.
- **Reglas por anuncio.** El reparto no las tiene y agregarlas multiplicaría por 17 las cosas que
  mantener para resolver un caso que nadie pidió.
- **Herencia producto → pieza.** Decidido el 12-ago: la acción masiva escribe en cada una. Este
  documento no lo reabre.

---

## 5. Qué queda, en orden

1. **Fase 4 — los agujeros del flujo, a la vista.** Hoy son un renglón de aviso
   («otras **45** campañas mandan gente a números que Hermes no atiende» — la
   cifra se remidió el 18-ago). Es la más cara de la pantalla y merece ser un
   nodo, no una nota al pie.
2. **Las 70 campañas que siguen sin producto** después de ADR 0060. Son nombres
   de pauta sin SKU ni palabra de curso («[FEB] SEGURIDAD - R»): se corrigen a
   mano una por una desde la hoja nueva, y **agregarles el SKU al nombre en Meta
   las arregla a todas de una** — eso es operación, no código.
3. **Lo chico que la auditoría dejó anotado** y no entró todavía: el arrastre se
   dispara con cualquier botón del mouse; dos dedos a la vez cierran el cable del
   otro; la franja de error se queda pegada y el `??` tapa un error más nuevo; con
   la rueda vacía la columna «Vendedoras» queda muda en vez de explicarse.

⚠️ **Nada de esto va a producción sin N5** (toca `server/`), y el runner de VPS1
serializa: contá ~20 min de cola.

## 6. Lo que hay que medir después, no antes

- **Cuántos leads cambian de dueño** la primera semana con cables puestos. Si es cero, el ruteo está
  configurado pero no aplicándose, y eso solo se ve contando `conversacion_asignada.motivo='campana'`.
- **Si las campañas del mes siguiente nacen sin regla** y cuánto tarda alguien en notarlo. Es el costo
  conocido de no tener herencia, y hay que saber si duele de verdad.


---

## 7. Lo que encontró la auditoría, y que este plan no había previsto

Antes de escribir la Fase 1 se corrió una auditoría de cuatro lentes sobre la rama, con **cada
hallazgo verificado por un agente que intentaba refutarlo** (31 agentes en total). Sobrevivieron
diez, y **cuatro eran graves**. Ninguno lo habría encontrado el typecheck ni los tests que existían.

| Qué | Por qué importaba |
|---|---|
| 🔴 **El PR no podía ponerse verde** | La migración hacía `DROP CONSTRAINT` para ensanchar una PK y la guardia expand-only de N1 la rechaza. **N1 estaba en FAILURE y nadie lo había mirado.** El arreglo es lo que expand-only significa: tabla nueva y backfill. |
| 🔴 **Una cableada fuera de la rueda activa se llevaba la campaña entera** | La carga salía de `leerRueda`, que solo trae a las activas, así que Luz y las inactivas figuraban con carga 0 **para siempre**. Medido: la pantalla ofrece 7 destinos y la rueda activa tiene 4. |
| 🔴 **La cola dejaba de degradar con dos tablas ausentes** | `mencionaTabla` miraba `err.message`, que en drizzle es el SQL entero y nombra todas las tablas. Con dos ausentes el loop se quedaba sin banderas y tiraba **500** — justo en la ventana entre N4 y N5. |
| 🔴 **Un cable podía volverse invisible e imborrable** | Los destinos se comparaban con el `vendedora_id` exacto, y en producción el mismo humano tiene dos grafías (`Luz`/`luz`). |
| 🔴 **Se cableaba con una expresión del curso y se matcheaba con otra** | La pantalla listaba con `cursoDeLeadSql` y la cola matchea con `productoLeadSql`. El PUT contestaba ok, la pieza se veía conectada **y la regla no se aplicaba nunca**. |

**La lección para el resto del plan**: en este frente los defectos no se ven en la pantalla ni los
atrapa el compilador — se ven contando filas y leyendo la cadena entera. Las fases 4 y 5 conviene
auditarlas igual antes de darlas por hechas.
