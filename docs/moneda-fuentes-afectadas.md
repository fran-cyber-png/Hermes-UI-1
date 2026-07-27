# H11 — Qué fuentes y qué campos toca el divisor roto de `tb_moneda`

> **Para el equipo de Ivi.** El entregable que pidieron en
> [`plan-ejecucion-hermes.md` §H11](https://github.com/Goberna-Lab/ivi-cerebro/blob/main/docs/plan-ejecucion-hermes.md):
> la lista de fuentes/campos afectados, para poner el gate acotado y no apagar de más.
>
> **Investigación read-only.** No cambia comportamiento, no toca Cerberus, no toca producción.
> Código leído: `Goberna-Lab/ceberusapp` en `c83adbf` (2026-07-25) y `Goberna-Lab/hermes` en `main`
> (`934122a`). Refs #169.
>
> **v2 (2026-07-27)** — corrige dos defectos de la v1 (ver el bloque de abajo) y agrega **medición
> sobre datos reales**: el volcado histórico versionado en `ceberusapp/csv/extracted_from_xlsx/`
> (4.892 ventas, 6.611 líneas de detalle), con el script `docs/evidencia/medir-moneda-catalogo.py`.
> Sigue sin tocarse producción.

---

## ⚠️ Qué cambió en la **v2** (2026-07-27) — leer esto si ya leíste la v1

Una revisión adversaria encontró dos defectos materiales en la primera versión. **Uno aflojaba el
gate en la dirección peligrosa.** Los dos están corregidos, y esta vez con medición sobre datos
reales, no con inferencia por nombre de campo.

| # | Qué decía la v1 | Qué dice la v2 | Por qué cambió |
|---|---|---|---|
| **1** | «Todos los precios del catálogo están en USD» — apoyado en **tres indicios de NOMBRE**, los tres sobre `precio_normal` | **Sigue siendo USD, ahora MEDIDO** sobre 4.428 líneas de venta reales — **y el catálogo se muestra rotulado `S/` en dos pantallas vivas de Cerberus**, que la v1 no reportaba | La v1 no mencionaba la evidencia en contra (`products/views.py:1233-1234`, `templates/lista_productos.html:323-326`). La contradicción es real y ahora está escrita, con la medición que la resuelve — ver **§2.4** |
| **2** | La tabla del gate listaba **solo campos `*_usd`**, y ponía `canales/tesoreria.ts` entre ellos | Se agregan **los campos en moneda local**, que es lo que el agujero B contamina, y se corrige la fila de `tesoreria.ts`: **no tiene un solo campo USD** | Un gate armado con la tabla v1 quedaba abierto justo donde está el problema. Ahora hay un **inventario machine-readable** (§0.1) con un test que falla si el código agrega un campo de plata que el documento no lista |

**Novedades que salieron de rehacer el trabajo con datos:**

- La incoherencia divisor↔multiplicador **está medida en filas reales**: 1.813 de 3.174 ventas con
  los dos radios congelados tienen `divisor × multiplicador ≠ 1` (§1.2.1).
- El **«36 % sin radio» es casi todo ventas en USD** (1.713 de 1.718), que no necesitan tasa. El
  agujero A es **más chico** de lo que la v1 sugería (§2.1).
- El rótulo `S/` del catálogo es un **agujero nuevo, del lado humano**: la vendedora que cotiza
  mirando la lista de productos lee «S/ 80» de un curso de **US$ 80** (§2.4).

---

## 0. La respuesta corta, para el gate

**El diagnóstico de Ivi es correcto pero apunta a un solo agujero, y hay tres.** Un gate que solo
tape «cifras convertidas con `tb_moneda`» deja pasar las dos contaminaciones que más plata mueven.

| # | El agujero | Efecto | Lo vio Ivi |
|---|---|---|---|
| **A** | `radioDivisor` y `radioMultiplicador` no son inversos | hasta **26,5 %** (BOB) al convertir a USD | ✅ sí |
| **B** | Cerberus **no convierte moneda en el servidor**: la conversión vive en el **JavaScript del navegador**. Un cliente que no sea ese navegador —**Hermes**— escribe montos en USD con etiqueta de moneda local | hasta **4.138×** (COP) en el monto mismo, no en su conversión | ❌ no |
| **C** | `tb_pago.codigo_moneda` puede diferir de `tb_venta.codigo_moneda` (excepción PayPal/USD, escrita en Cerberus), y la proyección de Hermes **pisa la moneda del pago con la de la venta** | el pago en USD se etiqueta PEN y se divide por 3,49 | ❌ no |

**B es peor que A**, y por una razón que le importa directo a la Ley I: **A ensucia una cifra
derivada** (`monto_usd`), que Ivi puede negarse a servir. **B ensucia la cifra original con su
moneda al lado** — `monto_total = 150`, `moneda = PEN` — y eso pasa cualquier chequeo de coherencia
que se le ocurra a un motor de grounding. Es exactamente el punto de Ivi («un detector de plagio, no
de verdad»), un nivel más abajo de donde lo puso.

### La lista para el gate, en una tabla

Convención: **🔴 no servir como `HECHO`** · **🟡 servir con salvedad** · **🟢 limpio**.

> **Criterio, y es el que la v1 aplicó mal:** un campo entra a esta lista **por ser un monto**, no por
> estar en USD. **El agujero B contamina la cifra en moneda local**, no su conversión. Una tabla que
> solo enumere campos `*_usd` pone el gate donde el problema no está y lo deja abierto donde sí.

| Fuente | Campo | Estado | Por qué |
|---|---|---|---|
| `tb_moneda` | `radio_divisor` | 🔴 | El campo del descuadre. No derivar nada de él (Ivi ya lo decidió en `governa-tesoreria.md` §0.3 — se confirma) |
| `tb_moneda` | `radio_multiplicador` | 🟡 | Es el campo bueno, pero **sin fecha de vigencia**: no aplica a importes históricos |
| `tb_venta` | `monto_total` | 🔴 | Agujero **B**: la magnitud puede no corresponder a `codigo_moneda` |
| `tb_venta` | `codigo_moneda` | 🟢 | La etiqueta es fiel a lo que eligió la vendedora; lo que miente es el número al lado |
| `tb_venta` | `radio_divisor_usado` | 🔴 | Copia congelada del campo roto (`models.py:279-280`) |
| `tb_venta` | `radio_multiplicador_usado` | 🟡 | Copia congelada del campo bueno, pero congelada **al primer `save()` con moneda**, no a la fecha de la venta |
| `tb_detalleVenta` | `precio_regular` · `precio_venta` · `precio_total` | 🔴 | Agujero **B**, y **no tienen moneda propia**: la heredan de la venta |
| `tb_cuotas` | `monto_total` | 🔴 | Se reparte desde `venta.monto_total` (`views.py:1143`); hereda B y **no tiene moneda propia** |
| `tb_pago` | `monto_pagado` | 🟡 | El número es el que se cobró de verdad; el riesgo es leerlo con la moneda equivocada (agujero **C**) |
| `tb_pago` | `codigo_moneda` | 🟢 en Cerberus · 🔴 **en la proyección de Hermes** | Agujero **C**: la proyección lo pisa con la moneda de la venta. Ver §2.3 (la v1 apuntaba a un §5.4 que no existe) |
| `tb_producto` | `precio_normal` · `precio_promocion` | 🟡 | **No pasan por `tb_moneda` y no están afectados por A.** Están en **USD — medido** sobre 4.428 líneas de venta reales (§2.4), no inferido del nombre. Pero el modelo **no tiene columna de moneda** y **Cerberus los muestra rotulados `S/` en dos pantallas vivas**: se sirve declarando USD *y* declarando que el rótulo de la app dice otra cosa |
| `ontologia.producto` (Hermes) | `precio_normal` | 🟡 | La copia del anterior en la capa canónica (`db/canonico.ts:59`) — **tampoco tiene columna de moneda**. Mismo estado, mismo motivo |
| `ontologia.venta` (Hermes) | `monto_usd` | 🔴 | Derivada: `monto_total / radio_multiplicador_usado` con fallback a `tb_moneda` (`proyectar.ts:150`). Hereda A y B |
| `ontologia.venta` | **`monto_total`** · `moneda_iso` | 🔴 | **El monto en moneda local, y es el que rompe el agujero B** (`canonico.ts:79-80`). La v1 lo omitió: listaba `tb_venta.monto_total` pero no su copia canónica, que es la que sirve Hermes |
| `ontologia.detalle_venta` | `precio_usd` | 🔴 | Ídem (`proyectar.ts:176`) |
| `ontologia.detalle_venta` | **`precio_venta`** · **`precio_total`** | 🔴 | Moneda local heredada de la venta, sin columna propia (`canonico.ts:126-127`). Agujero B |
| `ontologia.cuota` | `monto_usd` | 🔴 | Ídem (`proyectar.ts:191`) |
| `ontologia.cuota` | **`monto_total`** | 🔴 | Moneda local heredada de la venta (`canonico.ts:152`). Agujero B |
| `ontologia.pago` | `monto_usd` · `moneda_iso` | 🔴 | Ídem + agujero **C** (`proyectar.ts:219-221`) |
| `ontologia.pago` | **`monto`** | 🟡 | El número que se cobró de verdad, en moneda local (`canonico.ts:174`). Se lee bien **solo si se lee con la moneda del pago**, no con la de la venta — y `moneda_iso` de esa misma fila trae la de la venta (agujero C) |
| `governa.ventas.*` (SDK de Hermes) | todo campo `usd` / `ticket` | 🔴 | Suman `monto_usd` / `precio_usd` (`sdk/herramientas/ventas.ts:116, 191-192, 245, 303, 317, 328, 384, 426, 439, 522, 530, 537, 544`) |
| `governa.atribucion.*` | `usd` | 🔴 | `sdk/herramientas/atribucion.ts:239, 247` |
| **`governa.tesoreria.reloj`** (SDK) | **`esperando[].monto`** + `.moneda` | 🔴 | **La única herramienta del SDK que sirve plata en moneda local** (`sdk/herramientas/tesoreria.ts:68` → `canales/tesoreria.ts:65, 92, 149`). La v1 la listaba como «sumas y promedios en USD»: es falso, `grep -c "usd\|Usd\|USD" server/src/canales/tesoreria.ts` → **0** |
| `governa.tesoreria.latencia` | p50, p90, conteos | 🟢 | Puro reloj (`analisis/comercial.ts:121`). Sin plata |
| `ontologia.venta` | `estado`, `cobrada`, `fecha_venta`, `pais_cliente`, conteos | 🟢 | **Los conteos no se tocan.** «Cuántas ventas», «en qué país», «qué producto se vendió más por unidades» siguen siendo `HECHO` |
| `tb_pago` | `fecha_pago`, `fecha_confirmacion`, latencias | 🟢 | El reloj de Tesorería no depende de ninguna moneda |

**En una línea para el gate:** *«todo campo que sea un monto —o que derive de uno— es 🔴, esté en USD
o en moneda local; los conteos, fechas, estados y dimensiones son 🟢».* Es más ancho que «cifras en
moneda local» **y** que «cifras convertidas»: el agujero A rompe las conversiones, el agujero B rompe
los originales. Los dos lados están sucios, por motivos distintos.

### 0.1 El inventario, machine-readable

Esta es **la lista canónica**: el resto del documento la explica, pero si hay que codificar el gate
en algún lado, se codifica desde acá. Está fijada por `server/src/db/inventarioDePlata.test.ts`, que
**falla en CI** en las tres formas de volver a abrir el agujero de la v1:

1. **por omisión** — `db/canonico.ts` gana una columna numérica que este bloque no lista. Es
   *toda* columna numérica, no las que «suenan» a plata: la carga de la prueba está en la lista de
   excepciones `NO_SON_PLATA` del test, donde hoy hay una sola (`pago.latencia_dias`) y con su
   razón escrita. Filtrar por el nombre del campo era reproducir en chiquito el defecto de la v1;
2. **por flip de veredicto** — un importe de la capa canónica pasa a 🟢. Mientras `tb_moneda` no
   tenga historial de tasas, ningún importe está limpio: el monto local lo ensucia el agujero B y
   su conversión arrastra el divisor. Solo las etiquetas de moneda pueden ser 🟢;
3. **por incoherencia entre capas** — `governa.tesoreria.reloj.monto` y `canales/tesoreria.ts.monto`
   son el mismo número y tienen que decir lo mismo, o el gate se pone en el canal y queda abierto
   en la tool por la que Ivi realmente entra.

Lo que el test **no** guarda: el veredicto exacto (🔴 vs 🟡) de cada fila. Fijarlos uno por uno sería
la segunda lista divergente de #37; lo que se fija es la invariante de la que salen.

```
# fuente.campo = estado   (🔴 no servir como HECHO · 🟡 con salvedad · 🟢 limpio)

# --- Cerberus, la fuente ---
tb_moneda.radio_divisor                  = 🔴
tb_moneda.radio_multiplicador            = 🟡
tb_venta.monto_total                     = 🔴
tb_venta.codigo_moneda                   = 🟢
tb_venta.radio_divisor_usado             = 🔴
tb_venta.radio_multiplicador_usado       = 🟡
tb_detalleVenta.precio_regular           = 🔴
tb_detalleVenta.precio_venta             = 🔴
tb_detalleVenta.precio_total             = 🔴
tb_cuotas.monto_total                    = 🔴
tb_pago.monto_pagado                     = 🟡
tb_pago.codigo_moneda                    = 🟢
tb_producto.precio_normal                = 🟡
tb_producto.precio_promocion             = 🟡

# --- la capa canónica de Hermes (db/canonico.ts) ---
ontologia.producto.precio_normal         = 🟡
ontologia.venta.monto_total              = 🔴
ontologia.venta.moneda_iso               = 🟢
ontologia.venta.monto_usd                = 🔴
ontologia.detalle_venta.precio_venta     = 🔴
ontologia.detalle_venta.precio_total     = 🔴
ontologia.detalle_venta.precio_usd       = 🔴
ontologia.cuota.monto_total              = 🔴
ontologia.cuota.monto_usd                = 🔴
ontologia.pago.monto                     = 🟡
ontologia.pago.moneda_iso                = 🔴
ontologia.pago.monto_usd                 = 🔴

# --- lo que Ivi ve por el SDK y por los canales ---
canales/tesoreria.ts.monto               = 🔴
canales/tesoreria.ts.moneda              = 🟢
governa.ventas.*.usd                     = 🔴
governa.ventas.*.ticket                  = 🔴
governa.atribucion.*.usd                 = 🔴
governa.tesoreria.reloj.monto            = 🔴
lazo/evento.ts.custom_data.value         = 🔴
```

> `ontologia.venta.moneda_iso` es 🟢 y `ontologia.pago.moneda_iso` es 🔴 **a propósito**: la de la
> venta es fiel a lo que eligió la vendedora; la del pago está **pisada** con la de la venta
> (agujero C, §2.3). Mismo nombre de columna, distinta confianza.

---

## 1. Qué está roto exactamente en `tb_moneda`

### 1.1 La tabla tiene cuatro campos y ninguno es una fecha

`ceberusapp/sales/models.py:62-86`:

```python
class Moneda(models.Model):
    id = models.AutoField(primary_key=True, db_column='codigo_moneda')      # :63
    nombre = models.CharField(max_length=100, db_column='nombre_moneda')     # :64
    radioDivisor = models.DecimalField(..., db_column='radio_divisor', null=True, blank=True)          # :65-68
    radioMultiplicador = models.DecimalField(..., db_column='radio_multiplicador', null=True, blank=True)  # :69-72
```

`nombre_moneda` ya viene en ISO-4217 (lo aprovecha `hermes/server/src/ontologia/ventas.ts:70`). No
hay `vigencia_desde`, no hay historial, no hay `fuente`. Eso es lo que Ivi ya documentó y se
confirma.

### 1.2 El modelo promete coherencia — y la tabla no la cumple

`models.py:80-86`:

```python
def save(self, *args, **kwargs):
    if self.radioDivisor and self.radioDivisor != 0:
        self.radioMultiplicador = round(1 / self.radioDivisor, 6)
    elif self.radioMultiplicador and self.radioMultiplicador != 0:
        self.radioDivisor = round(1 / self.radioMultiplicador, 6)
    super().save(*args, **kwargs)
```

**Este `save()` hace que el par BOB medido sea imposible de producir.** Si alguien hubiera guardado
`radioDivisor = 0,15`, el multiplicador habría quedado en `6,666667` — no en `9,07`. Si hubiera
guardado `radioMultiplicador = 9,07`, el divisor habría quedado en `0,110254` — no en `0,15`.

> **La conclusión que cambia el arreglo:** el descuadre **no es un redondeo**, como sugiere
> `governa-tesoreria.md` («`radioDivisor` está redondeado a 2 cifras significativas»). Es que las dos
> columnas son de **épocas distintas**: el divisor quedó fijo de cuando el boliviano estaba a ~6,7 y
> nadie lo tocó, y el multiplicador se actualizó por otra vía. Ningún `round()` produce 26,5 % de
> diferencia.
>
> Un redondeo se arregla recalculando. Dos épocas no: **hay que decidir cuál de los dos números es la
> tasa buena.** (Es el multiplicador: es el que factura, §1.4.)

### 1.2.1 Y no es teoría: está medido en 3.174 filas reales *(nuevo en la v2)*

El volcado histórico versionado en `ceberusapp/csv/extracted_from_xlsx/` (la exportación del sistema
pre-Django, 4.892 ventas) trae **los dos radios congelados en cada venta**. Ahí se puede medir el
descuadre sin tocar producción:

```
== agujero A, en filas reales: los radios CONGELADOS en cada venta ==
  ventas con los dos radios congelados: 3174
  desvío |divisor × multiplicador − 1|  > 1 %: 1813   > 2 %: 1221   > 5 %: 88
  peor caso: folio GOB-09526 (MXN) divisor=0.054 multiplicador=20.43 → 10.32 %
```

**El 57 % de las ventas ya tiene guardado un par que no es inverso.** No es un caso de laboratorio ni
una moneda exótica: es la mayoría de las filas.

Y el mismo volcado explica **de qué época es el divisor**, para la única moneda de la que hay una
medición de hoy — BOB, la que midió Ivi el 2026-07-26 (`radioDivisor = 0,15`,
`radioMultiplicador = 9,07`):

| BOB | valor | como tasa BOB/USD |
|---|---|---|
| multiplicador de HOY (`tb_moneda`) | 9,07 | **9,07** |
| divisor de HOY (`tb_moneda`) | 0,15 | **6,67** |
| lo que las ventas realmente usaron (mediana de 788 ventas BOB del volcado) | 6,91 | **6,91** |
| el par en el volcado histórico | 0,1111 / 9,0 | coherente entre sí (desvío 0,01 %) |

Tres cosas se leen ahí, y ninguna es «redondeo»:

1. **En el volcado el par BOB era coherente** (0,1111 × 9,0 = 1,0001). El descuadre de hoy **no viene
   de origen: lo introdujo una edición posterior**, hecha a mano por SQL — que es exactamente lo que
   §1.3 predice cuando el único formulario que aplicaría la coherencia es código muerto.
2. **Las dos columnas de hoy corresponden a tasas distintas y las dos existieron**: 9,07 es la de
   hoy, y `1 / 0,15 = 6,67` cae sobre la tasa que las ventas viejas efectivamente usaron (6,91). El
   divisor no es un multiplicador mal redondeado; es **otra tasa, de otra época**.
3. **Ningún `round()` produce eso.** El `save()` de `models.py:80-86` habría dejado 0,110254 junto a
   9,07. El 0,15 solo puede haber entrado por fuera del modelo.

Del resto de las monedas no hay medición de hoy: no se afirma nada sobre ellas.

> **Salvedad honesta:** este volcado es la exportación del sistema anterior, no la base de hoy.
> Sirve para probar que el descuadre **existe en filas reales** y de qué forma; **no** para contar
> cuántas filas de producción están así hoy. Esa cuenta sigue en §5.

### 1.3 Y no se cumple porque **el único formulario que edita la tasa es código muerto**

`sales/forms.py:281-313` define `MonedaTipoCambioForm` con su regla («ingresá SOLO uno de los dos, el
`save()` calcula el otro»). Es correcta. Y **no la usa nadie**:

```
grep -rn "MonedaTipoCambioForm" ceberusapp/   → sales/forms.py:281   (la definición, y nada más)
grep -n  "moneda" ceberusapp/sales/urls.py    → solo api_moneda_multiplicador (:132)
grep -rn "Moneda" ceberusapp/sales/admin.py   → sin resultados (no está registrada en el admin)
```

No hay vista, no hay URL, no hay admin. **En todo `ceberusapp` no existe un camino que escriba una
fila de `tb_moneda` pasando por `Moneda.save()`** (los únicos `Moneda.objects.create` viven en
`sales/tests.py:44-45, 680`). Las filas de producción son de antes de Django —`tb_*` es el prefijo
del sistema anterior— y se editan por SQL a mano.

Esto es lo que convierte el bug en **estructural en vez de accidental**: la lógica de coherencia
existe, está bien escrita, y **no se ejecuta nunca**.

### 1.4 Los dos consumidores, y el viaje de ida y vuelta dentro de la misma app

| Sentido | Quién | Campo | Dónde |
|---|---|---|---|
| **USD → local** (al crear/editar una venta) | el navegador | `radioMultiplicador` | `views.py:2255-2258` sirve `{"multiplicador": ...}`; lo consumen `static/js2/_crear_venta_v2.js:210, 254, 616`, `static/js2/_editar_venta.js:113, 131` y `templates/modals/modal_buscar_producto.html:335-337` |
| **local → USD** (al filtrar por monto mínimo) | el servidor | `radioDivisor` | `views.py:1600-1613`, `Coalesce(F("radio_divisor_usado"), F("moneda__radioDivisor"), CASE USD→1)` |

```python
# views.py:1589-1590 — el comentario que documenta el supuesto que la tabla no cumple
# radioDivisor = factor "moneda_local -> USD" (verificado: el frontend usa
# radioMultiplicador para USD->local, y radioDivisor = 1/radioMultiplicador).
```

**«verificado: … radioDivisor = 1/radioMultiplicador» es falso en la tabla viva.** Y el
resultado es un round-trip que no cierra, **dentro de la misma aplicación**:

```
Un curso de US$ 110,25 vendido en Bolivia
  ida   (navegador)  110,25 × 9,07  = 1.000 BOB        ← lo que se guarda en tb_venta.monto_total
  vuelta (servidor)  1.000  × 0,15  =   150 USD        ← lo que el filtro de "monto mínimo USD" cree
                                        +36 %
```

Un filtro «ventas de más de US$ 120» **incluye** esa venta de US$ 110,25. Es un solo consumidor y de
bajo impacto (un filtro de listado), pero es la prueba ejecutable de que las dos columnas no son la
misma tasa.

**El multiplicador es el bueno**: es el que produjo el número que efectivamente se cobró. El divisor
nunca facturó nada.

### 1.5 Hay un tercer consumidor, y es el que más engaña

`views.py:2021-2023`, el export a Excel de ventas:

```python
"Moneda": v.moneda.nombre ...,
"Radio Divisor": float(getattr(v.moneda, "radioDivisor", 0) or 0) ...,
"Radio Multiplicador": float(getattr(v.moneda, "radioMultiplicador", 0) or 0) ...,
```

Exporta **los dos campos, de `tb_moneda`, con el valor de HOY** — no los `radio_*_usado` congelados
en la venta. Una planilla de ventas de marzo trae las tasas de hoy en la misma fila que un monto de
marzo, sin decirlo. Quien sume esa columna en Excel obtiene un número sin nombre.

Y `sales/management/commands/comparar_ventas_csv_app.py:550, 563` usa **los dos campos
indistintamente** para identificar de qué moneda era una venta importada (`match_moneda(div,
"radioDivisor") or match_moneda(mul, "radioMultiplicador")`). Con las dos columnas divergentes, ese
matcheo puede resolver a monedas distintas según cuál de los dos campos traiga el CSV.

---

## 2. Corrección al diagnóstico: cuatro cosas que faltaban o estaban al revés

Esto es la parte que pidieron explícitamente («si el diagnóstico resulta incompleto, decilo con
evidencia»). Va con la misma vara que Ivi usó consigo mismo en su §H1.

### 2.1 ✅ «`Venta` no guarda la tasa que se usó» — **es falso desde el 2025-10-23**

`mapa-cerberus.md` §5.3 dice:

> «La tabla no tiene fecha ni historial, **y `Venta` no guarda la tasa que se usó.**»

La primera mitad es correcta. La segunda no:

```python
# sales/models.py:178-187
radio_divisor_usado      = models.DecimalField(..., db_column='radio_divisor_usado')
radio_multiplicador_usado = models.DecimalField(..., db_column='radio_multiplicador_usado')
```

Agregadas por `sales/migrations/0013_venta_radio_divisor_usado_and_more.py`, generada el **2025-10-23**,
y estampadas en `Venta.save()` (`models.py:279-282` en el camino de folio nuevo, `:295-298` en el de
update). Hermes ya las usa: `proyectar.ts:150` convierte con `radio_multiplicador_usado` y
`analisis/geo.ts:37-45` dice literal «*NO recalcula con la tasa de hoy*».

**Por qué importa para el gate:** la mitigación de Ivi puede ser **más chica** de lo que planeó. Las
ventas con `radio_multiplicador_usado` no nulo tienen una tasa congelada de su época; no dependen de
que alguien edite `tb_moneda` mañana.

**Pero con tres asteriscos, todos verificables en el código:**

1. **La copia congelada hereda el descuadre.** `models.py:279-282` copia **los dos** campos de la
   misma fila inconsistente. `radio_divisor_usado` es tan malo como su origen.
2. **No se congela en la fecha de la venta, sino en el primer `save()` que encuentre el campo
   vacío.** La guarda es `if not self.radio_divisor_usado` — para las ~6.800 ventas anteriores a la
   migración, la tasa que quedó estampada es la del día en que alguien editó esa venta, sea cuando
   sea. Es «una tasa de alguna fecha», no «la tasa de la venta».
3. **El 36 % no la tiene — pero es casi todo USD, y eso achica el agujero** *(medido en la v2)*. El
   comentario de `hermes/server/src/db/canonico.ts:78-82` dice «*el 36 % de las ventas no traen
   radio*». Sobre el volcado histórico da **35,1 % (1.718 de 4.892)** — y al abrirlo por moneda:

   ```
   == el «36 % sin radio»: ¿de qué moneda es? ==
     ventas: 4892   sin radio_multiplicador: 1718 (35.1 %)
     moneda  ventas  sin radio
     USD     1716    1713            ← el 99,7 % de las ventas sin radio
     MXN     1224    1
     PEN     1036    1
     BOB     788     1
     DOP     71      2
     COP     55      0
     CLP     2       0
     → de las ventas SIN radio, solo 5 son de moneda ≠ USD (las USD no necesitan tasa).
   ```

   O sea: **de 3.176 ventas en moneda ≠ USD, 5 no tienen radio congelado.** Para una venta en USD
   `proyectar.ts:49` pasa derecho (no hay tasa que aplicar), así que el fallback a la tasa de hoy
   —que sí reescribe el histórico retroactivamente— toca **cinco filas** en este corpus, no un tercio.
   **La mitigación de Ivi puede ser bastante más chica de lo que sugería la v1.** Falta la misma
   cuenta sobre la base viva (§5).

### 2.2 🔴 El agujero grande: **Cerberus no convierte moneda en el servidor**

Ni Ivi ni el pedido de Hermes lo mencionan, y es el que más plata mueve.

**Toda la conversión USD → local vive en el JavaScript del navegador.** El servidor guarda lo que le
posteen:

```python
# sales/forms.py:48-61 — VentaForm
fields = ['cliente', 'moneda', 'pais', 'local', 'ubicacion', 'medio', 'origen',
          'monto_total', 'estado', 'fecha_venta']
'monto_total': forms.NumberInput(attrs={'readonly': True, ...}),   # readonly es del WIDGET, no del server
```

```python
# sales/views.py:1113-1115 (crear_venta) y :3165 (editar_venta)
precio_regular=prod.get("precio_regular", 0),
precio_venta=prod.get("precio_venta", 0),
precio_total=prod.get("precio_total", 0),
```

No hay una sola línea en `crear_venta` / `editar_venta` que multiplique por una tasa. El único lugar
donde eso ocurre es `static/js2/_crear_venta_v2.js:616`:

```js
p.precio_regular = p.precio_base_usd * monedaMultiplicador;
```

**Y Hermes postea ese mismo formulario sin pasar por ese JavaScript.**
`hermes/server/src/cerberus/venta.ts:99-152` arma el POST a `/ventas/crearVenta/` con la sesión de la
vendedora. El monto sale de `src/features/venta/FormularioVenta.tsx:115-118`:

```tsx
const monto = useMemo(
  () => lineas.reduce((s, l) => s + l.producto.precioPromocion * l.cantidad, 0),
  [lineas],
);
```

`precioPromocion` viene de `cerberus/productos.ts` = `Producto.precio_promocion`, que está en **USD**
— **medido en la v2** sobre 1.219 líneas de venta que caen exacto sobre `precio_promocion ×
multiplicador` (§2.4). **De esto depende la MAGNITUD de todo este apartado**: si `precio_promocion`
estuviera en soles, el mecanismo seguiría siendo real pero la cifra de abajo estaría mal. Está
medida, y cayó del lado del dólar. Y la moneda es un `<select>` libre (`FormularioVenta.tsx:119`, con `hermes.ultimaMoneda`
recordada en `localStorage`). **En ningún punto de Hermes se multiplica por una tasa** —
`grep -rn "radioMultiplicador\|radio_multiplicador" hermes/src/` no devuelve nada.

Resultado, para una venta registrada desde Hermes con moneda ≠ USD:

| | lo que se guarda | lo que debería |
|---|---|---|
| `tb_venta.monto_total` | `150` | `523,50` |
| `tb_venta.codigo_moneda` | PEN | PEN |
| `ontologia.venta.monto_usd` | `150 / 3,49 = 42,98` | `150` |

**Una venta de US$ 150 se contabiliza como US$ 42,98.** En COP el factor es 4.138. Y sigue viaje:
`hermes/server/src/lazo/evento.ts:163` manda ese mismo par a Meta CAPI

```ts
custom_data: { value: venta.montoTotal, currency: venta.moneda },
```

o sea, **el optimizador de Meta aprende con valores 3,5× a 4.138× menores** para las conversiones que
salieron por este camino.

> **Por qué esto rompe el gate tal como está planteado.** El gate de Ivi es «no servir cifras en
> moneda local como `HECHO`». Una venta contaminada por B **se sirve en USD** (`monto_usd`) y su
> cifra original tiene su moneda al lado, coherente. Pasa el gate y pasa el grounding. La regla
> tiene que ser **por campo (todo monto)**, no por moneda.

**Cómo se identifican estas ventas.** `cerberus/venta.ts:148` estampa
`venta_request_key: hermes-<vendedoraId>-<timestamp>`; Cerberus lo guarda en
`tb_venta.idempotency_key` (`views.py:928, 976`) y lo reenvía a icarus (`icarus_payload.py:327`). Un
`WHERE idempotency_key LIKE 'hermes-%' AND
codigo_moneda <> <id de USD>` da el universo exacto. **No corrí esa consulta: no tengo —ni quiero—
acceso a producción.** Es el primer número que hay que medir, y decide si esto es una nota al pie o
una corrección de datos.

**Y no es solo Hermes.** Cualquier consumidor futuro del endpoint (una integración, un script, un
móvil) hereda la misma trampa: la regla de negocio vive en un `.js` de `static/`, donde ningún
servidor la puede aplicar.

### 2.3 🟡 `tb_pago.codigo_moneda` puede diferir del de la venta — y Hermes lo pisa

Cerberus **permite explícitamente** que un pago sea en USD contra una venta en otra moneda:

```python
# sales/forms.py:247-256
moneda_usd = _es_moneda_usd(moneda)
if not moneda_usd:
    self.add_error('moneda', "Link PayPal siempre debe registrarse en dolares (USD).")
    ...
# "Si la moneda del método quedó mal configurada en BD (ej. PEN),
#  igual permitimos registrar PayPal en USD por regla de negocio."
```

Por eso `Pago` tiene su propia FK a moneda (`models.py:501-505`), igual que `MetodoPago`
(`models.py:447-451`). `Cuota` y `DetalleVenta` **no** — heredan la de la venta.

La proyección de Hermes hace lo contrario de lo que dice Cerberus:

```ts
// hermes/server/src/ontologia/proyectar.ts:219-221
const iso = mv?.iso ?? isoPorMoneda.get(String(p.codigo_moneda)) ?? null;
const usd = aUsd(monto, iso, mv?.radio ?? null, tasas);
```

`mv.iso` es la moneda **de la venta**, y gana. La moneda propia del pago solo se usa si la venta no
tiene. Para un pago PayPal en USD contra una venta en PEN: se etiqueta PEN y se divide por 3,49 →
**se subestima 3,49×**. El comentario de arriba explica la intención («toda la plata que orbita una
venta tiene que usar la misma vara») y es razonable — pero la vara correcta cuando las monedas
difieren es convertir, no reetiquetar.

Afecta `ontologia.pago.moneda_iso`, `ontologia.pago.monto_usd`, y todo lo que sume pagos:
`analisis/cartera.ts:56, 132`, `canales/tesoreria.ts`.

### 2.4 🟡 La moneda del catálogo: **Cerberus se contradice a sí mismo, y la medición desempata**

> **Esta sección se rehízo entera en la v2.** La v1 afirmaba «los precios del catálogo están en USD»
> apoyada en **tres indicios de nombre**, los tres sobre `precio_normal`, y **no mencionaba la
> evidencia en contra**. Era la única recomendación del documento que apagaba MENOS, o sea la que
> más confianza pedía, y era la peor sostenida. La conclusión aguanta; el camino no aguantaba.

**Confirmado del lado de Hermes:** `cerberus/productos.ts:8-13` y `productos.test.ts:14-15`
documentan que el payload vivo (111 productos, verificado 2026-07-23) no trae ninguna key de moneda,
y que el mapeo devuelve `''` antes que inventar una. **Y no es una omisión del payload: `Producto`
no tiene columna de moneda.** `grep -n "moneda" ceberusapp/products/models.py` → sin resultados.

#### La contradicción, que la v1 no reportó

| Dice USD | Dice soles |
|---|---|
| `sales/views.py:2264-2268` — `api_precio_producto` devuelve `{"precio_usd": float(producto.precio_normal)}` | `products/views.py:1233-1234` — `producto_json`: `"precio_normal": f"S/ {producto.precio_normal:.2f}"` **y** `"precio_promocion": f"S/ {...}"` |
| `static/js2/_crear_venta_v2.js:253-254` — `baseUSD = parseFloat(prod.precio)`, y `precioMostrar = monedaNombre === 'USD' ? baseUSD : baseUSD * monedaMultiplicador` | `templates/lista_productos.html:323-326` — `S/ {{ producto.precio_promocion }}` / `S/ {{ producto.precio_normal }}` |
| `products/models.py:307` — el campo hermano se llama `precio_docente_usd` | |

Las dos pantallas de la derecha están **vivas**: `producto_json` cuelga de
`products/urls.py:27` (`<int:pk>/json/`) y la llama el modal de la lista de productos
(`templates/lista_productos.html:492`). O sea: **Cerberus rotula `S/` las mismas dos columnas que su
flujo de venta trata como dólares.**

Peor: la columna que la v1 daba por USD con más confianza —`precio_promocion`— **no tiene ni un solo
indicio de USD en el flujo de venta, porque ese flujo ni la lee.** El buscador de productos de la
venta devuelve `'precio': float(p.precio_normal)` (`products/views.py:2477`, dentro de
`buscar_productos_json`, `products/urls.py:28`) y nada más. Contado sobre los cinco archivos que
**son** el flujo de venta:

```
grep -c "precio_promocion" \
  static/js2/_crear_venta_v2.js  static/js2/_editar_venta.js \
  templates/modals/modal_buscar_producto.html  sales/views.py  sales/forms.py
→ 0  0  0  0  0
```

`precio_promocion` solo aparece en el ABM del producto, en la lista rotulada `S/`, en el export, en
el payload a icarus y en la API pública que consume Hermes.

**Por qué importa:** el `FormularioVenta.tsx:115-118` de Hermes suma **`precioPromocion`**. Un
producto real del payload vivo tiene `precio_promocion = 80` (`server/src/cerberus/productos.test.ts:22`).
Si eso fueran soles, servir «el curso cuesta US$ 80» como `HECHO` sería un error de **3,49×** — la
violación exacta de la Ley I que H11 existe para evitar. No alcanzaba con inferirlo del nombre.

#### La medición que desempata

`tb_detalleVenta` guarda el precio unitario que se cobró, y la venta guarda su moneda. Si el catálogo
estuviera en moneda local, el unitario de una venta en PEN se parecería al precio de catálogo. Si
estuviera en USD, se parecería al precio de catálogo **× el multiplicador de esa moneda**.

Medido sobre el volcado histórico versionado en `ceberusapp/csv/extracted_from_xlsx/`
(6.611 líneas de detalle; 4.428 cruzan con un producto del catálogo y una venta en moneda ≠ USD):

```
$ python3 docs/evidencia/medir-moneda-catalogo.py ../ceberusapp

== ¿el unitario cobrado es el precio de catálogo, o el catálogo × multiplicador? ==
moneda  mult     n     mediana(unit/normal)  mediana(unit/promo)  ==normal×mult  ==promo×mult
PEN     3.46     1482  3.49                  3.64                 771            419
BOB     9.0      1108  6.91                  9.00                 431            245
COP     3853.57  77    4138.46               4138.46              35             20
MXN     18.34    1670  20.43                 20.43                761            487
CLP     961.54   4     961.54                961.54               3              3
DOP     62.4     87    62.40                 62.90                80             45

  mediana global unit/precio_normal: 9.00   n=4428
  coincidencias exactas (±2%):  == catálogo 19   == catálogo × multiplicador 2100   ninguno 2309
```

**La razón `unitario / precio_de_catálogo` es el multiplicador de cada moneda, no 1.** Si el catálogo
estuviera en moneda local, la mediana sería ~1,00 en las seis. De las 2.119 líneas que caen exacto
sobre alguno de los dos candidatos, **2.100 (99,1 %) caen sobre `catálogo × multiplicador`** y 19
sobre el catálogo crudo. Las 2.309 restantes no caen exacto sobre ninguno —descuentos, precios
editados a mano, productos re-tarifados— pero su mediana sigue siendo el multiplicador.

Y lo mismo vale para **`precio_promocion`**, que era la columna sin evidencia: **1.219 líneas caen
exacto sobre `precio_promocion × multiplicador`** (419 PEN, 487 MXN, 245 BOB, 45 DOP, 20 COP, 3 CLP).
No es una inferencia por el nombre de la columna hermana: es la columna misma, medida.

Reproducible: `docs/evidencia/medir-moneda-catalogo.py` (read-only, sin red ni base).

#### Qué queda 🟡 y por qué no 🟢

**El valor está en USD.** Pero se sirve **con salvedad**, no limpio, por tres cosas que no se pueden
cerrar leyendo código:

1. **No hay columna que lo diga.** El dato lo afirma el código; el schema no lo sabe, así que ningún
   consumidor lo puede verificar y una re-tarifación futura no deja rastro.
2. **Cerberus muestra `S/` en pantallas vivas.** Cualquier cifra que llegue **con el rótulo puesto**
   —`producto_json`, la lista de productos, un screenshot, una vendedora que copió de ahí— está mal
   rotulada. Ivi no debe servir jamás el string `"S/ 150.00"` de `producto_json`: es un número USD
   con símbolo de soles.
3. **La medición es sobre el corpus histórico, no sobre el catálogo de hoy.** Nada prueba que los 111
   productos vivos sigan la misma convención. La comprobación está en §5.

**Consecuencia para el gate:** `precio_normal` y `precio_promocion` **no pasan por `tb_moneda` y no
están afectados por A** — se pueden seguir sirviendo, **declarando USD, declarando que lo afirma el
código y no el schema, y declarando que la propia app los rotula `S/`**. Apagarlos junto con las
ventas sería apagar de más; servirlos sin las tres salvedades sería apagar de menos.

#### El efecto colateral, y de qué lado cayó

Si `precio_promocion` hubiera estado en soles, **la aritmética del agujero B también estaría mal**:
«una venta de US$ 150 se contabiliza como US$ 42,98» (§2.2) supone que el número que Hermes postea es
un dólar. La medición dice que **sí lo es**, así que la magnitud de B se sostiene tal cual estaba.
El mecanismo nunca dependió de esto; la cifra sí, y ahora está apoyada.

---

## 3. Qué cifras de Hermes están contaminadas hoy

Hermes tiene **dos mitades** (`CLAUDE.md` §«DOS MITADES», `docs/arquitectura.md` §2): el CRM que la
vendedora usa, y el dashboard de pauta del que salió, que sigue en el árbol pero **ninguna acción de
la vendedora alcanza**. La contaminación se reparte muy distinto entre las dos.

### 3.1 La mitad que la vendedora ve

| Superficie | Muestra plata | Contaminada |
|---|---|---|
| **Dashboard** (`routes/dashboard.ts`) | **no** | 🟢 — `grep -n "monto\|precio\|usd" server/src/routes/dashboard.ts` no devuelve nada. Todo lo que muestra son **conteos**. `PanelNegocio.tsx:354` dice «`precio_mencionado` conversaciones» — es cuántas, no cuánto |
| **Pipeline · Cola · Contactos · Agenda** | no | 🟢 |
| **`{precio}` de plantillas** (`plantillas/expandir.ts`) | sí | 🟡 — sale de `Producto.precio_*`: **USD, medido** (§2.4), pero **sin moneda**. `expandir.ts:47-59` ya se niega a mostrar un precio sin moneda y deja el hueco `[precio]`. La regla existente es la correcta y no hay que tocarla — **y con la contradicción del rótulo `S/` a la vista, es la única defensa que hay** |
| **La lista de productos de Cerberus** (fuera de Hermes) | sí | 🔴 — `templates/lista_productos.html:323-326` y `producto_json` muestran **`S/ 80` de un curso de US$ 80**. No es una superficie de Hermes, pero **es donde una vendedora mira para cotizar**, así que es una fuente de cifras mal rotuladas que después entran a un chat (§2.4) |
| **Panel derecho — ficha del cliente** (`cerberus/ficha.ts:74-80`) | sí | 🟡 — muestra `monto` + `moneda` **crudos de Cerberus, sin convertir**. Honesto por construcción; lo único que puede mentir es una venta contaminada por B |
| **Formulario de venta** (`FormularioVenta.tsx:333, 367, 381`) | sí | 🔴 — muestra el total en USD junto a un selector de moneda que dice otra cosa, y es **el punto donde se origina el agujero B** |

**En una línea:** *hoy la vendedora casi no ve cifras de plata, y el Dashboard no muestra ninguna.*
La contaminación de Hermes es de **escritura**, no de presentación.

### 3.2 La mitad desconectada — que es de donde Ivi comería

Ninguna de estas superficies la ve una vendedora. **Todas son las que un consumidor máquina —Ivi—
consultaría**, así que el gate va acá:

| Módulo | Campos | Estado |
|---|---|---|
| `ontologia/proyectar.ts` | **las derivadas en USD** — `venta.monto_usd`, `detalle_venta.precio_usd`, `cuota.monto_usd`, `pago.monto_usd`, `pago.moneda_iso` | 🔴 A + B (+ C en `pago`) |
| `db/canonico.ts` | **los originales en moneda local** — `venta.monto_total` (`:79`), `detalle_venta.precio_venta`/`precio_total` (`:126-127`), `cuota.monto_total` (`:152`), `pago.monto` (`:174`) | 🔴 por B — **la v1 omitió esta fila entera**, y es la que el agujero B contamina de verdad |
| `db/canonico.ts` | `producto.precio_normal` (`:59`) | 🟡 — el catálogo, sin columna de moneda (§2.4) |
| `sdk/herramientas/ventas.ts` | todo `usd` y `ticket` | 🔴 |
| `sdk/herramientas/atribucion.ts` | `usd` (`:239, :247`) | 🔴 |
| `analisis/comercial.ts`, `ventasPorPais.ts`, `cartera.ts` | sumas y promedios **en USD** (`monto_usd`, `precio_usd`) | 🔴 |
| **`canales/tesoreria.ts`** | `esperando[].monto` (`:65, :92, :149`) + `.moneda` | 🔴 — **corregido en la v2.** La v1 lo listaba junto a los tres de arriba como «sumas y promedios en USD»: **no tiene un solo campo USD** (`grep -c "usd\|Usd\|USD"` → **0**). Sirve el `monto_pagado` **crudo en moneda local**, que es justamente lo que B ensucia. Y es la salida de `governa.tesoreria.reloj` — o sea, **le llega a Ivi** |
| `analisis/tasas.ts` | `tasasDeCambio()` | 🟡 — **usa `radio_multiplicador`, el campo correcto** (`:22`), y lo declara en su comentario de cabecera. Sin fecha de vigencia: no aplica a histórico |
| `lazo/evento.ts:163` | `custom_data.value` + `currency` hacia Meta | 🔴 por B — el monto local crudo, que es lo correcto para Meta **si el monto es real** |

**Lo que no se toca:** conteos de ventas, países, fechas, estados, latencia de Tesorería, unidades
por producto. Todo eso sigue siendo `HECHO` sin salvedad.

> **Una divergencia que conviene mirar antes de arreglar C.** `canales/tesoreria.ts:112` joinea la
> moneda del pago por **`p.payload->>'codigo_moneda'`** — la del pago, que es la correcta — mientras
> `ontologia/proyectar.ts:219-221` la **pisa con la de la venta**. Son dos implementaciones de «¿de
> qué moneda es un pago?» que ya no dicen lo mismo. Es la lección de #37 otra vez: el criterio tiene
> que vivir una vez. La buena es la de `tesoreria.ts`.

---

## 4. Cómo se arregla del lado de Cerberus (descrito, **no aplicado**)

`ceberusapp` es de otro equipo. Esto es la descripción para que ellos decidan, en orden de
costo/beneficio. **Nada de esto se ejecutó.**

**1 · Elegir la tasa buena y retirar el divisor** *(barato, arregla A)*
Es el multiplicador: es el que facturó. `radioDivisor` pasa a derivado read-only (una `@property`
que devuelve `1/radioMultiplicador`) o se retira. Los dos consumidores del divisor son
`views.py:1600-1613` (filtro USD) y `views.py:2022` (export) — dos líneas. Dos columnas que dicen lo
mismo distinto son un bug esperando consumidor, y ya tiene dos.

**2 · Mover la conversión al servidor** *(el que más plata salva, arregla B)*
Hoy `crear_venta`/`editar_venta` guardan lo que les postean. Que el servidor calcule
`precio_* = precio_base_usd × radioMultiplicador(moneda)` a partir del producto y la moneda, y que
lo posteado sea entrada a validar, no verdad. Efecto lateral: **todo cliente que no sea ese
navegador queda arreglado de una vez**, Hermes incluido, sin cambiar Hermes.
*Mientras tanto*, el parche mínimo del lado de Hermes es multiplicar en `cerberus/venta.ts` con la
tasa de `tb_moneda` — pero eso pone la regla de negocio en dos repos, que es cómo empezó esto.

**3 · Una fila `USD` con `radioMultiplicador = 1`** *(trivial, saca una rama especial de todos lados)*
Hoy USD tiene los dos radios en `NULL` y cada consumidor inventa su propio caso especial:
`views.py:1605-1609` (`CASE WHEN moneda__nombre = 'USD' THEN 1`), `proyectar.ts:49`,
`tasas.ts:31`, `views.py:2258` (`or 1`). Cuatro implementaciones de la misma excepción.

**4 · `fecha_vigencia` e historial** *(el arreglo de fondo)*
Tabla `tb_moneda_tasa (moneda_id, unidades_por_usd, vigencia_desde, vigencia_hasta, fuente,
registrado_por)`, ya especificada por Ivi en `governa-tesoreria.md` §237. Sin esto, mover PEN de
3,49 a 3,60 reescribe el histórico y no hay forma de reconstruir el número anterior.

**5 · Darle una vista al formulario que ya existe** *(o borrarlo)*
`MonedaTipoCambioForm` (`forms.py:281-313`) está bien escrito y no lo llama nadie. O se enchufa —y
entonces la tasa se edita por un camino que aplica la coherencia— o se borra, para que nadie crea
que la coherencia está garantizada. Hoy da la falsa impresión de que sí.

**6 · Una columna de moneda en `Producto`** *(arregla la etiqueta faltante, no el divisor)*
Es el issue #43 visto desde el otro lado: el payload no trae moneda porque el modelo no la tiene.
Con una columna (default `USD`), `cerberus/productos.ts` la toma sola — el mapeo de Hermes ya la
busca en tres keys distintas y está esperando.

**7 · Sacar el `S/` hardcodeado del catálogo** *(dos líneas, y es el que puede costar una venta hoy)*
`products/views.py:1233-1234` y `templates/lista_productos.html:323-326` rotulan `S/` cifras que el
propio flujo de venta trata como dólares (§2.4, medido). Una vendedora que cotiza mirando esa
pantalla lee **S/ 80 de un curso de US$ 80**: un factor de 3,49 en el precio que le pasa a un cliente.
Es la corrección más barata del documento y la única cuyo daño no es analítico sino comercial. Va
antes que el punto 6, o junto con él (la columna define qué rótulo poner).

---

## 5. Lo que sigue sin verificar — dicho como incertidumbre, no como certeza

Casi todo este documento salió de leer código, y la v2 agregó medición sobre el **volcado histórico**
versionado en `ceberusapp/csv/extracted_from_xlsx/` — que es real, pero **es la exportación del
sistema anterior, no la base de hoy**. Lo que falta, en orden de cuánto cambia el gate:

| Pregunta | Cómo se responde | Estado hoy |
|---|---|---|
| ¿Cuántas ventas están contaminadas por B? | `SELECT count(*), codigo_moneda FROM tb_venta WHERE idempotency_key LIKE 'hermes-%' GROUP BY 2` | **sin medir.** Decide si B es una nota al pie o una corrección de datos |
| ¿El catálogo **de hoy** sigue en USD? | mismo cruce de §2.4 sobre `tb_detalleVenta` × `tb_venta` × `tb_producto` de los últimos 12 meses: la mediana de `precio_venta / precio_normal` por moneda tiene que dar el multiplicador, no 1 | **medido sobre el histórico (4.428 líneas, da el multiplicador); no sobre el catálogo vivo.** Si diera 1 en alguna moneda, `tb_producto` pasa a 🔴 |
| ¿Cuál es el par real de cada moneda hoy? | `SELECT nombre_moneda, radio_divisor, radio_multiplicador FROM tb_moneda` | **solo BOB**, por la medición de Ivi del 2026-07-26. Del resto no se afirma nada |
| ¿Cuántas ventas tienen `radio_multiplicador_usado` nulo, **y cuántas de esas no son USD**? | `SELECT codigo_moneda, count(*) FROM tb_venta WHERE radio_multiplicador_usado IS NULL GROUP BY 1` | en el histórico: 35,1 %, **y el 99,7 % son USD** (§2.1). La segunda columna es la que importa y falta sobre la base viva |
| ¿Cuántos pagos tienen moneda distinta a la de su venta? (agujero C) | join `tb_pago` × `tb_cuotas` × `tb_venta` comparando `codigo_moneda` | **sin medir.** Acota cuánto pesa C |
| ¿Cuánta plata quedó mal rotulada `S/` en cotizaciones enviadas? | buscar en los hilos de Hermes precios con `S/` que coincidan con un `precio_promocion` del catálogo | **sin medir.** Es el daño comercial del punto 4.7 |

**Cómo se lee esta tabla:** una fila «sin medir» **no es una fila verde**. Donde no hay medición, el
gate va cerrado y se abre cuando alguien mide — no al revés. Una certeza equivocada no se revisa
nunca; un «no verificable» sí.

---

## Anexo · Todos los archivos leídos, con su rol

**`Goberna-Lab/ceberusapp` @ `c83adbf`**

| Archivo:línea | Rol |
|---|---|
| `sales/models.py:62-86` | el modelo `Moneda` y su `save()` de coherencia |
| `sales/models.py:178-187, 279-282, 295-298` | los `radio_*_usado` de `Venta` y su congelado |
| `sales/models.py:447-451, 501-505` | moneda propia de `MetodoPago` y `Pago` |
| `sales/forms.py:48-61` | `VentaForm` — `monto_total` es campo posteable |
| `sales/forms.py:247-256` | la excepción PayPal/USD (agujero C) |
| `sales/forms.py:281-313` | `MonedaTipoCambioForm` — código muerto |
| `sales/views.py:1113-1115, 3165` | `crear_venta`/`editar_venta` confían en los precios posteados |
| `sales/views.py:1583-1613` | el filtro de monto mínimo USD — el consumidor del divisor |
| `sales/views.py:2021-2023` | el export con las tasas de hoy sobre montos históricos |
| `sales/views.py:2255-2258` | `api_moneda_multiplicador` |
| `sales/views.py:2264-2268` | `api_precio_producto` → `precio_usd` |
| `sales/icarus_payload.py:356-357` | los radios congelados viajan a icarus |
| `sales/migrations/0013_*.py` | fecha del congelado: 2025-10-23 |
| `sales/management/commands/comparar_ventas_csv_app.py:550, 563` | matchea moneda por cualquiera de los dos radios |
| `static/js2/_crear_venta_v2.js:210, 254, 616` · `_editar_venta.js:113, 131` | la conversión, en el navegador |
| `products/models.py:85-86` | `precio_normal`/`precio_promocion` sin columna de moneda |
| `products/views.py:1233-1234` · `products/urls.py:27` | **`producto_json` rotula `S/` las dos columnas** — la evidencia en contra (v2, §2.4) |
| `templates/lista_productos.html:323-326, 492` | la lista de productos muestra `S/`, y llama a `producto_json` |
| `products/views.py:2477` · `products/urls.py:28` | `buscar_productos_json` — el precio base del flujo de venta es **`precio_normal`, nunca `precio_promocion`** |
| `products/views.py:2214-2247` | la API pública que consume Hermes — sin key de moneda |
| `sales/management/commands/import_ventas_bundle.py:609, 629-631` | un tercer camino que escribe precios de catálogo **sin convertir** en `tb_detalleVenta` |
| `csv/extracted_from_xlsx/Detalle_Venta/sheets/01__Ventas.csv` · `02__Detalle_Venta.csv` · `05__Moneda.csv` · `Categoria/sheets/01__Producto.csv` | **el volcado histórico** sobre el que se midió todo lo nuevo de la v2 |

**`Goberna-Lab/hermes` @ `934122a`**

| Archivo:línea | Rol |
|---|---|
| `server/src/ontologia/proyectar.ts:47-53, 150, 176, 191, 219-221` | todas las conversiones a USD |
| `server/src/analisis/tasas.ts:16-33, 44-50` | lee `tb_moneda` — con el campo correcto |
| `server/src/analisis/geo.ts:37-46` | `aUsd` con la tasa congelada |
| `server/src/db/canonico.ts:78-84, 129` | los campos USD de la proyección y el «36 % sin radio» |
| `server/src/cerberus/venta.ts:99-152` | el POST a Cerberus sin conversión |
| `server/src/cerberus/ficha.ts:74-80` | monto + moneda crudos |
| `server/src/cerberus/productos.ts:8-13` | la moneda que no viene |
| `server/src/lazo/evento.ts:163` | `value` + `currency` hacia Meta |
| `server/src/plantillas/expandir.ts:47-59` | sin moneda no hay precio — la regla que ya está bien |
| `server/src/sdk/herramientas/ventas.ts` · `atribucion.ts` | el SDK `governa.*` que sumaría Ivi |
| `src/features/venta/FormularioVenta.tsx:115-118` | el total en USD con moneda libre |
| `server/src/routes/dashboard.ts` | sin una sola cifra de plata |
