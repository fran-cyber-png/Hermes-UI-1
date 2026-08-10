# ADR 0050 — El Pipeline solo muestra lo que se trabaja

**Fecha**: 10-ago-2026
**Estado**: aceptado — front puro, sale por N4
**Revierte**: la parte de **#87** que sacó `Interesados` de las columnas.
**Enmienda**: **ADR 0044** §«Sin respuesta como columna» (la etapa queda, la columna no).
**Continúa**: **ADR 0049** (los rótulos dicen el hecho).

---

## El problema

Con los rótulos nuevos el tablero por fin se leía, y ahí se vio la forma real:

```
Nunca contestaron   Contestaron   Saben el precio   Compraron   Dijeron que no
     2.575              217             791             13             0
     ▲ 65 % de la mesa
```

Dos observaciones del dueño, el mismo día:

1. *«ese "te esperan" debería estar a la izquierda de "nunca contestaron", no arriba»*
2. *«vas a quitar "nunca contestaron", siento que para el pipeline es por las puras»*

Las dos apuntan a lo mismo: **el tablero le daba una columna entera al montón que
nadie trabaja, y dejaba fuera de la mesa al único donde la pelota es nuestra.**

---

## La decisión

### 1. «Te esperan» vuelve a ser columna, y va primera

`interesado` era la tira de arriba desde #87, donde se lo había sacado porque
*«una pila que nunca se trabaja es ruido»*.

**Lo que cambió desde entonces**: en #87 esa pila era indistinta —mezclaba a
quien escribió con quien nunca dijo nada—. Hoy el embudo se deriva (ADR 0044) y
sabe separarlas, así que ya no es un cajón: es exactamente *escribieron y nadie
les contestó*. Siendo eso, es lo más accionable de la pantalla y va a la
izquierda de todo.

⚠️ **No hizo falta tocar el server**: `interesado` ya estaba en
`ETAPAS_CONSULTABLES` y el desglose ya emitía sus filas. Lo que había era una
pantalla que no las pedía.

⚠️ **No se puede arrastrar acá**, por lo mismo que a `sin_respuesta`: se deriva
de un hecho y deja de ser cierto solo, en cuanto la vendedora responde.

### 2. «Nunca contestaron» deja de ser columna — pero sigue siendo etapa

🔴 **Es la distinción que hay que no perder.** Se retiró de `COLUMNAS_TRABAJO`,
que es *qué se dibuja*. **NO** se tocó `etapaEfectivaSql`, que es *qué es cierto*.
Consecuencias, todas verificadas:

- Esas 2.575 conversaciones **no vuelven a inflar** «Contestaron» ni «Saben el
  precio» — su etapa efectiva sigue siendo `sin_respuesta`, que es justo lo que
  ADR 0044 vino a arreglar. **Este ADR no lo reabre.**
- Se siguen viendo en **Mensajes**, se siguen pudiendo pedir por `?etapa=`, y
  conservan su rótulo y su chip.
- `repartirColumnas` simplemente no las pinta — exactamente lo que hacía con
  `interesado` hasta hoy.

Candado: `tablero.test.ts` fija que `sin_respuesta` **no** esté en las columnas y
que una tarjeta con esa etapa no se pinte en ninguna.

### 3. «Ventana» NO es columna, y se propuso que lo fuera

La propuesta inicial del dueño incluía una columna «Ventana». **Se midió y se
descartó**, por dos razones que conviene dejar escritas porque la idea va a
volver:

- **Medido**: el chip decía `En ventana 1` en todo el tablero. La ventana se abre
  cuando alguien escribe, y hace días que casi nadie escribe: sería una columna
  vacía la mayor parte del tiempo.
- 🔴 **Y es destructivo, por ADR 0041**: la ventana **no es una etapa, es una
  señal que cruza a todas**. Una conversación tiene UNA etapa, así que mover una
  tarjeta a «Ventana» le borraría «Saben el precio» — y ese cruce
  (*sabe el precio **y** todavía le puedo escribir gratis*) es el caso más
  valioso del tablero. Como chip se puede preguntar; como columna, no.

### 4. Lo que la tira se llevaba, no se perdió

`BandejaDeuda` se borró (no se deja código huérfano — la lección de `PanelNotas`),
pero sus dos aportes bajaron a la cabecera de la columna:

- el desglose **«sin abrir · volvieron a escribir»**, que son dos trabajos
  distintos (uno se abre, el otro se sigue). Va como texto y no como chips a
  propósito: recortar por ahí pediría parámetros nuevos en la cola, y esto es
  front puro. `resumirBandeja` no se tocó.
- el botón **«Responder en Mensajes»**. El trabajo de esta columna no se hace
  arrastrando, se hace respondiendo.

### 5. La cuenta del grid, rehecha

Siguen siendo cinco columnas pero son otras cinco. A 1280 el contenido son
~1.256 px y los cuatro gaps se comen 32; los mínimos suman **1.060**, así que
entra con ~164 de aire. **Si entra una sexta, esta cuenta se vuelve a hacer** —
es lo que va a pasar con «Llenaron el formulario».

---

## Lo que esto NO resuelve

Sigue faltando la primera columna de verdad: **25.386 leads (97,5 %) que nunca
tuvieron una conversación** y que el Pipeline no ve. Ver ADR 0049 y
`docs/plan-pipeline-por-canal.md` §3.1.

## Evidencia

`docs/evidencia/embudo-cinco-columnas.png` — a 1280, sin scroll horizontal, con
«Te esperan» primera, su desglose, su botón y sus chips.

⚠️ En esa captura **«En ventana» no aparece en «Te esperan»**, y no es un olvido:
daría el total de la columna —te escribieron recién, por definición— y la otra
mitad de la regla del cero lo esconde sola. Es la mejor prueba de que esa regla
hace falta.
