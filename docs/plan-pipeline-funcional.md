# Plan — que el Pipeline sirva para MONITOREAR y PLANIFICAR

**Fecha**: 8-ago-2026 · **Estado**: propuesta, sin implementar
**Pedido del dueño**: *«el pipeline lo podríamos mejorar mucho, replantear para poder hacer que
Hermes haga fácil monitorear y planificar estos datos»*

Todo lo que sigue está medido en producción el 8-ago-2026. Donde hay un número, hay una consulta
detrás; donde no lo hay, está dicho que es una opinión.

---

## 1. El punto de partida, y qué se arregló hoy

La pantalla que disparó esto mostraba `3.450 Contactados · 22 Cotizados · 0 Cierre · 0 Perdidos`.
No era un embudo: era una pila y tres columnas vacías.

El diagnóstico fue que **el embudo no medía el negocio, medía cuánto se acordó alguien de tocar un
botón**: `gestiones` tiene **39 filas en toda la base**, y de ahí salían los 22 Cotizados (2 personas,
un solo día). Hoy se cerraron las dos causas de fondo:

| | antes | después |
|---|---|---|
| Ventas que Hermes conoce | 1 | **1.464** (el puente rechazaba el 99,6 % de los payloads) |
| Cotizados | 22 declarados | **~3.064 derivados** de `precio_enviado` |
| Contactados | 3.450 | **~534** («les hablamos y nunca les pasamos el precio») |

**Eso no termina el trabajo: lo empieza.** Movió la pila de columna. Este documento es sobre lo que
falta.

---

## 2. El problema que queda, dicho con precisión

> **Una columna con 3.064 tarjetas no es una lista de trabajo. Es la misma pila con otro rótulo.**

Y hay un problema anterior, que es el que hace que el tablero no sirva para planificar:

> **El Pipeline muestra CONVERSACIONES ordenadas por etapa. La pregunta «¿qué hago hoy?» no se
> responde con una etapa: se responde con un MOTIVO y un PLAZO.**

Dos personas en «Cotizados» pueden ser cosas completamente distintas: una recibió el precio hace
40 minutos y la ventana está abierta; la otra lo recibió hace tres semanas y no contestó nunca. La
etapa las iguala. Lo que las separa —y lo que decide a cuál se le dedica la mañana— hoy vive en
píldoras que hay que leer tarjeta por tarjeta.

### Lo que el tablero NO puede responder hoy

1. **¿A quién le hablo ahora?** — hay 3.064 candidatos y ningún orden que diga por dónde empezar.
2. **¿Cómo va el mes?** — el Pipeline no muestra plata ni tendencia. Muestra cuántas tarjetas hay.
3. **¿Qué se me está por caer?** — la ventana de conversación se cierra sola y solo se ve en una
   píldora por tarjeta.
4. **¿Qué pasó con los que cotizamos la semana pasada?** — no hay noción de cohorte ni de tiempo en
   la etapa.

---

## 3. La propuesta

### 3.1 Cada columna trae su LISTA DE HOY, no su total

El número grande de la columna (`3.064`) responde «cuántos hay», que no es una pregunta que alguien
se haga. Lo que se necesita arriba de cada columna es **cuántos de esos son trabajo de hoy**, con el
total como dato secundario.

```
COTIZADOS
  47 para hoy · de 3.064          ← el recorte manda; el total acompaña
  [ En ventana 47 ] [ Sin respuesta +7d 812 ] [ Todos ]
```

El criterio de «hoy» por columna, propuesto:

| columna | qué es trabajo de hoy | de dónde sale |
|---|---|---|
| Contactados | ventana abierta y sin precio enviado | ya existe (`ventana` + `precio`) |
| Cotizados | ventana abierta · o cotizado hace 3–7 días sin respuesta | `ventana` + antigüedad en etapa |
| Cierre | venta de hoy/ayer sin registrar en Cerberus | requiere el lazo de ventas (ya entra) |
| Perdidos | nada | es archivo, no trabajo |

⚠️ **Hoy el recorte solo existe en Contactados** y su estado es global a la vista
(`VistaEmbudo.tsx`), así que cada columna necesita el suyo. Es el cambio estructural más grande de
esta propuesta y conviene medirlo antes de prometerlo.

### 3.2 El tiempo EN LA ETAPA, que hoy no se guarda ni se deriva

Es el dato que falta para planificar, y no existe en ninguna forma: **cuánto hace que esta
conversación está donde está**. Sin él no se puede decir «llevan 12 días cotizados y no contestan»,
que es exactamente el momento en que un lead se enfría.

- Para las etapas **derivadas** se puede calcular: la fecha del primer mensaje con precio es cuándo
  entró a Cotizados. Es derivable y no pide schema (mismo criterio que ADR 0013/0014/0016).
- Para las **declaradas**, `gestiones.creado_at` ya lo tiene.
- 🔴 **Y hay un caso feo**: una conversación puede volver a Interesados si la persona escribe de
  nuevo. El «tiempo en etapa» tiene que ser del ÚLTIMO ingreso a esa etapa, no del primero.

### 3.3 La plata, que el Pipeline nunca mostró

Con las ventas entrando (1.464 filas hoy, y creciendo por el puente), la columna Cierre puede dejar
de ser un contador de tarjetas:

```
CIERRE            este mes
  18 ventas · S/ 7.240
  ▁▂▃▅▇  ← los últimos 6 meses, para saber si vamos mejor o peor
```

⚠️ **Ojo con la moneda**: hay ventas en PEN, USD, MXN, BOB, DOP y COP. `avg(total)` sin agrupar por
`currency` da 4.680, que mezcla pesos colombianos con dólares — un número que no significa nada.
**La mediana por moneda es ~USD 130 y es lo único citable.** O se muestra por moneda, o se convierte
con un tipo de cambio guardado con la venta (que hoy no existe).

### 3.4 Lo que NO hay que hacer

- **No meter los leads de formulario como quinta columna.** Son otro universo —gente que nunca
  escribió— y mezclarlos haría que el embudo cuente dos cosas incompatibles. Para eso ya existe el
  padrón (ADR 0035), con su tabla, sus facetas y su reparto.
- **No pedirle a nadie que declare nada más.** El dato del día: `gestiones` 39 filas, `notas` 5
  (65 caracteres), `eventos_contacto` 1. **Lo que exige que una persona declare algo, no se usa.**
  Todo lo que el tablero necesite tiene que derivarse de hechos que ya ocurren.
- **No agregar una métrica que dé 0 por construcción.** Pasó hoy con el «subregistro» del Dashboard:
  medía el hueco entre precio enviado y cotizado declarado, y al derivar `cotizado` del precio ese
  hueco daría 0 siempre. Se lo reapuntó a la gestión declarada, que es lo que siempre quiso medir.

---

## 4. El orden propuesto, y por qué

1. **Tiempo en etapa** (§3.2) — es el dato que falta para todo lo demás y es derivable, sin schema.
2. **Recorte por columna** (§3.1) — es lo que convierte cada pila en una lista de hoy. Depende de 1
   para el recorte de Cotizados.
3. **La plata en Cierre** (§3.3) — lo más visible y lo menos urgente: hasta que las vendedoras
   registren ventas por Hermes, mide lo que hizo el ERP.

---

## 5. Lo que este plan NO resuelve, y hay que decirlo

**El Pipeline no es el cuello de botella del negocio.** Medido hoy:

- Los leads de landing pasaron de **8.348 en abril a ~105 en agosto** — una caída del 98 % que no
  tiene nada que ver con Hermes.
- Las **tres líneas whatsmeow están `sin-vincular`** desde hace más de 21 horas: las vendedoras no
  están recibiendo mensajes por sus números.
- De los leads de formulario de los últimos 18 días, **72 de 82 (88 %) no recibieron un solo
  mensaje**.

Un tablero mejor ayuda a trabajar mejor **lo que entra**. Ninguna de las tres cosas de arriba se
arregla desde esta pantalla, y las tres pesan más que cualquier rediseño.
