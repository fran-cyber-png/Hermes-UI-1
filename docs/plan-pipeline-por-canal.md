# Plan — replantear la ESTRUCTURA del Pipeline a partir de los canales

**Fecha**: 8-ago-2026 · **Estado**: propuesta, sin implementar
**Pedido del dueño**: *«si analizamos bien la data de los diferentes canales en donde nos llegan los
datos podemos agarrar ese pipeline y mejorar la estructura, agregar estados y así, para que sea
fácil dar seguimiento a todo»*

Continúa `docs/plan-pipeline-funcional.md`, que trataba la PANTALLA. Éste trata el MODELO: qué
estados existen y por qué. Todo lo que sigue está medido en producción el 8-ago-2026; donde hay un
número hay una consulta detrás, y donde no lo hay está dicho que es una opinión.

---

## 1. Por dónde llegan los datos, de verdad

| canal | volumen | último dato | ¿llega al Pipeline? |
|---|---|---|---|
| **Formulario de landing** (`icarus_landing`) | **25.510** eventos · 25.226 con teléfono | **hoy** | ❌ **no** |
| WhatsApp — 3 líneas | 12.896 mensajes · 3.125 entrantes | 7-ago | ✅ es lo único que llega |
| Padrón de contactos (icarus) | 72.923 | — | ❌ (vive en Contactos, no en el embudo) |
| Lead Ads (`meta_lead_ad`) | 651 | **19-may** (muerto hace 81 días) | ❌ no |
| Facebook · Instagram | **0 filas** | — | ❌ (webhook recién enchufado, ADR 0042) |

> 🔴 **`interactions` es 100 % WhatsApp.** Un solo canal, un solo tipo de fila. El «CRM multicanal»
> hoy tiene un caño conectado de cinco.

**Y el canal más grande es el que no se ve.** De los 25.226 leads de formulario con teléfono,
**650 (2,6 %) llegaron alguna vez a hablar por WhatsApp**. En los últimos 30 días: 143 leads, 22
hablaron (15,4 %).

> **El Pipeline ordena el 2,6 % del embudo.** Agregarle estados sin traer el otro 97 % es refinar la
> medición de la parte más chica.

Las tres líneas de WhatsApp, con su último movimiento — dos de las tres están frenadas:

| línea | mensajes | personas | último |
|---|---|---|---|
| `51986394450` (la principal) | 8.704 | 2.564 | **28-jul** (11 días) |
| `51984429504` (Cloud API / bot) | 2.134 | 1.096 | 7-ago |
| `51941654039` | 2.058 | 311 | 5-ago |

Y el caudal de leads de landing por mes: **ene 2.937 · mar 1.570 · may 1.166 · jun 361 · jul 143 ·
ago 36**. Una caída del 98,8 % que no tiene nada que ver con Hermes y que ninguna pantalla muestra.

---

## 2. El hallazgo que reordena todo: el tablero mezcla tres poblaciones

Anatomía de las 3.973 conversaciones, por quién habló:

| forma | conversaciones | % |
|---|---|---|
| **A · le escribimos y NUNCA contestó** | **2.580** | **64,9 %** |
| C · conversación de ida y vuelta | 1.155 | 29,1 % |
| B · escribió y nadie le contestó | 238 | 6,0 % |

Y cruzando con las ventas, mirando **si la venta fue antes o después del primer mensaje**:

| forma | ya era cliente | compró **después** | «con venta» |
|---|---|---|---|
| A · nunca contestó | **947** | **1** | 948 |
| C · conversó | 67 | **12** | 79 |

🔴 **Dos conclusiones, y las dos cambian el modelo:**

1. **Las conversaciones tipo A son POST-VENTA, no venta en curso.** 947 de 948 ya eran clientes antes
   del primer mensaje. No contestan porque no es una conversación: es una difusión a la base de
   compradores. Hoy caen en `contactado` —y si el envío llevaba precio, en **`cotizado`**— y son
   **dos tercios del tablero**.
2. **«Ventas atribuidas» no significa lo que parece.** Las 1.464 filas de `conversiones_wa` son
   `telefono_e164` en 1.448 casos, con ventas que arrancan en **marzo de 2024**, contra un
   `interactions` que solo cubre del **21-jul al 7-ago de 2026** (18 días). El match dice «esta
   persona compró alguna vez», no «esta conversación vendió». **En toda la base hay 13 ventas
   posteriores al primer mensaje.**

⚠️ **Lo que esos 13 NO autorizan a decir**: que conversar no vende. Con 18 días de mensajes contra un
histórico de ventas de dos años, el solapamiento es demasiado chico para medir causa. Lo que sí
autorizan a decir es que **hoy Hermes no puede medirla**, y que cualquier tablero que prometa
«Cierre» sobre este dato está dibujando.

### El defecto concreto que esto deja a la vista

**`precio_enviado` promueve a Cotizado a gente que nunca dijo una palabra.** El 5-ago salieron 1.139
mensajes contra 49 entrantes: un envío masivo. Si ese envío llevaba precio —y las plantillas de
Goberna lo llevan—, esas conversaciones subieron a Cotizados. Por eso la columna tiene 3.051.

> Es un efecto del arreglo del 8-ago (`c079bcd`), no de su ausencia: derivar la etapa del hecho fue
> lo correcto, pero **«le llegó un precio» no es lo mismo que «está cotizado»** cuando del otro lado
> nunca hubo nadie.

---

## 3. La estructura propuesta

### 3.1 El embudo pasa a tener DOS puertas antes de la primera columna

Los dos estados que faltan son los dos primeros, y hoy no existen en ninguna forma:

| estado nuevo | qué es | de dónde sale | medido |
|---|---|---|---|
| **Sin contactar** | levantó la mano y **nadie le escribió** | `events` de `icarus_landing` sin conversación | **24.576** hist. · **121** en 30 d |
| **Sin respuesta** | le escribimos y **nunca contestó** | conversación con 0 entrantes | **2.580** (65 % del tablero) |

Las dos son listas de trabajo de verdad, y son las dos más grandes del negocio:

- «Sin contactar» es el 97,4 % de los leads que pagamos por conseguir.
- «Sin respuesta» hoy está **escondido adentro de Contactados y Cotizados**, inflándolos.

El embudo queda:

```
Sin contactar → Sin respuesta → Conversando → Cotizado → Cierre
   (24.576)       (2.580)         (1.155)      (real)     (13)
                                                          ↘ Perdido
```

⚠️ **«Interesados» deja de ser la bandeja de arriba y pasa a ser «Conversando»**: hoy la bandeja
mezcla «nadie le contestó» (238, deuda real) con «volvió a escribir» (que es lo mismo que
conversar). La deuda sigue siendo la bandeja; el resto es una columna.

### 3.2 Cotizado exige que la persona haya HABLADO

Un renglón en `cola/etapaEfectivaSql.ts`: la derivación a `cotizado` pide `precio_enviado` **y** al
menos un entrante. Con eso, un blast deja de promover a 1.139 personas de una.

- Lo declarado a mano no se toca: si una vendedora marca Cotizado, gana igual (sigue siendo un piso).
- **Y no se pierde nada**: esas conversaciones no desaparecen, bajan a «Sin respuesta», que es una
  lista de trabajo con su propia acción (cambiar el mensaje o el canal, no insistir con el precio).

### 3.3 El ORIGEN entra como dimensión, no como columna

Por dónde llegó cada persona hoy se sabe a medias (742 con `origen.fuente = anuncio`, 1.001 sin
origen) y **no se puede filtrar en el Pipeline**. Es el eje que responde «¿qué canal me está
trayendo gente que compra?», y hoy esa pregunta no tiene dónde hacerse.

Va como **recorte** (el mecanismo que ya existe desde hoy), no como columna: el origen no es una
etapa, es de dónde vino — cruzarlo con las etapas daría 25 columnas.

### 3.4 Cliente y lead se separan, porque no son el mismo trabajo

La marca de ex-cliente ya existe en la fila (#133). Falta que el tablero pueda **sacarlos de la vista
de venta**: 947 conversaciones de clientes existentes conviven con 1.155 leads reales, y la vendedora
no tiene forma de mirar solo uno de los dos.

### 3.5 Lo que NO hay que hacer

- **No agregar estados que alguien tenga que declarar.** El dato del día, otra vez: `gestiones` 39
  filas · `intereses` 29 · `eventos_contacto` **1** · `contacto_habilitado` **0**. Todo lo que exige
  un clic humano, no se usa. Los cinco estados propuestos se derivan de hechos que ya ocurren.
- **No prometer «Cierre» hasta que las ventas se puedan atribuir.** Con 13 ventas posteriores a una
  conversación, esa columna mide el ERP, no el trabajo. Ver `docs/atribucion-de-ventas.md`.
- **No mezclar el padrón (72.923) con el embudo.** Es otro universo y ya tiene su vista (ADR 0035).

---

## 4. El orden propuesto, y qué cuesta cada cosa

| # | qué | dónde | cuesta |
|---|---|---|---|
| 1 | **Cotizado exige un entrante** | `cola/etapaEfectivaSql.ts` + paridad | un renglón y su test |
| 2 | **«Sin respuesta» como columna** | derivado de 0 entrantes, sin schema | chico |
| 3 | **Origen como recorte** | reusa el mecanismo de recorte por columna de hoy | medio |
| 4 | **«Sin contactar»: traer los leads de landing** | proyector nuevo `icarus_landing` → cola | **el grande** |

Los tres primeros son derivación pura sobre datos que ya están. El cuarto es el que mueve la aguja
del negocio y el único que toca la ingesta.

---

## 5. Lo que este plan no resuelve, y hay que decirlo

Igual que el plan anterior, y con más fuerza ahora que está medido:

- **Dos de las tres líneas de WhatsApp están frenadas** (la principal hace 11 días) y **hoy no entró
  un solo mensaje**. Ninguna columna nueva se llena si el caño está cerrado.
- **Los leads de landing cayeron 98,8 % desde enero** (2.937 → 36). Eso es marketing, no CRM.
- **El 97,4 % de los leads que sí llegaron nunca recibió un mensaje.** El estado «Sin contactar» los
  hace visibles; contactarlos es una decisión de operación, y a 24.576 no se los contacta a mano.

Un tablero mejor ayuda a trabajar mejor lo que entra. Las tres cosas de arriba pesan más que
cualquier rediseño, y las tres se ven desde afuera de esta pantalla.
