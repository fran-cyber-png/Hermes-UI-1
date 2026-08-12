# Routing — el mapa del flujo y qué hacemos con él

**Fecha**: 12-ago-2026 · **Estado**: plan, nada de esto está construido salvo lo que dice «✅ ya está»
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

### Fase 1 — Un solo modelo de interacción, y que el cable siga al gesto

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

### Fase 2 — La acción masiva, explícita y separada del gesto

Hoy «Aplicar a las 4» compite con el arrastre por el mismo espacio mental.

- El tablero de producto muestra las piezas y **cada una se cablea sola, arrastrando**.
- La acción masiva pasa a ser un botón nombrado: **«Poner este cable en las 4»**, con lo que va a
  pisar nombrado antes (eso ✅ ya está).
- ⚠️ **Se mantiene la decisión del 12-ago**: cablear el producto ESCRIBE en cada pieza, no crea una
  regla que hereden. Esta fase no la toca.

### Fase 3 — Multi-nivel: entrar en un nodo sin perder el flujo

El pedido: *«si quiero entrar en la campaña dentro del flujo»*.

```
  NIVEL 1   producto ──► piezas ──► vendedoras
                            │
                     (entrar en una campaña)
                            ▼
  NIVEL 2   campaña ──► sus anuncios ──► vendedoras
              [AGO] OSINT      4 anuncios, 33 personas
```

- **Una miga de pan arriba** (`Consultor Político › [AGO] OSINT`) y `Esc` para subir. No es un router
  (ADR 0002): es estado local de la vista.
- 🔴 **El nivel del anuncio es de SOLO LECTURA, y hay que decirlo.** El reparto resuelve
  `ad_id → campaña → vendedoras`: **no existe una regla por anuncio**. Dibujar puertos conectables
  ahí prometería un control que el server no tiene. Se muestran para entender de dónde vino el
  volumen, nada más.
- Al entrar se ve lo que el nivel de arriba esconde: qué anuncio trajo las 33 personas, cuál está
  pausado, y **a qué número manda cada adset** — que es el agujero más grande del §1.1.

### Fase 4 — Los agujeros del flujo, a la vista

Hoy hay un cartel de una línea («otras 42 campañas mandan a números que Hermes no atiende»). Es
verdad y es insuficiente.

- Un nodo **«fuera de Hermes»** en el lienzo, con las campañas que mandan a otro teléfono y **a cuál**.
  Es la información que convierte «no se puede rutear» en «reapuntá este adset o levantá esta línea».
- El contador de anuncios sin resolver enlaza a «Actualizar desde Meta» en vez de solo informar.

### Fase 5 — Corregir el producto de una pieza

El falso positivo del alias (§1.3) hoy solo se ve. Falta poder **sacar una pieza de su producto** o
mandarla a otro, que es escribir en `alias_curso`.

- ⚠️ **Es el único punto del plan que edita un diccionario compartido**: `alias_curso` lo leen
  también el chip de curso de la cola y el Dashboard. Cambiar un alias acá cambia lo que la cola
  muestra en otras pantallas. Va con su propia confirmación y su propio ADR.

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

## 5. Orden sugerido

1. **Fase 1** — es la que arregla el «no se entiende», y es independiente de todo lo demás.
2. **Fase 3** — el multi-nivel, que es el otro pedido explícito.
3. **Fase 2** — la masiva, una vez que el gesto principal ya está claro.
4. **Fase 4** — los agujeros; vale por sí sola aunque no se haga nada más.
5. **Fase 5** — el diccionario, con ADR propio.

## 6. Lo que hay que medir después, no antes

- **Cuántos leads cambian de dueño** la primera semana con cables puestos. Si es cero, el ruteo está
  configurado pero no aplicándose, y eso solo se ve contando `conversacion_asignada.motivo='campana'`.
- **Si las campañas del mes siguiente nacen sin regla** y cuánto tarda alguien en notarlo. Es el costo
  conocido de no tener herencia, y hay que saber si duele de verdad.
