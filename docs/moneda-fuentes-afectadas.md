# H11 — Qué fuentes y qué campos toca el divisor roto de `tb_moneda`

> **Para el equipo de Ivi.** El entregable que pidieron en
> [`plan-ejecucion-hermes.md` §H11](https://github.com/Goberna-Lab/ivi-cerebro/blob/main/docs/plan-ejecucion-hermes.md):
> la lista de fuentes/campos afectados, para poner el gate acotado y no apagar de más.
>
> **Investigación read-only.** No cambia comportamiento, no toca Cerberus, no toca producción.
> Código leído: `Goberna-Lab/ceberusapp` en `c83adbf` (2026-07-25) y `Goberna-Lab/hermes` en `main`
> (`934122a`). Refs #169.

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
| `tb_pago` | `codigo_moneda` | 🟢 en Cerberus · 🔴 **en la proyección de Hermes** | Ver §5.4 |
| `tb_producto` | `precio_normal` · `precio_promocion` | 🟡 | **No están afectados por el divisor**: no pasan por `tb_moneda`. Están en **USD** (§2.4) y el modelo **no tiene columna de moneda** — el problema es de etiqueta, no de conversión |
| `ontologia.venta` (Hermes) | `monto_usd` | 🔴 | Derivada: `monto_total / radio_multiplicador_usado` con fallback a `tb_moneda` (`proyectar.ts:150`). Hereda A y B |
| `ontologia.detalle_venta` | `precio_usd` | 🔴 | Ídem (`proyectar.ts:176`) |
| `ontologia.cuota` | `monto_usd` | 🔴 | Ídem (`proyectar.ts:191`) |
| `ontologia.pago` | `monto_usd` · `moneda_iso` | 🔴 | Ídem + agujero **C** (`proyectar.ts:219-221`) |
| `governa.ventas.*` (SDK de Hermes) | todo campo `usd` / `ticket` | 🔴 | Suman `monto_usd` / `precio_usd` (`sdk/herramientas/ventas.ts:116, 191-192, 245, 303, 317, 328, 384, 426, 439, 522, 530, 537, 544`) |
| `governa.atribucion.*` | `usd` | 🔴 | `sdk/herramientas/atribucion.ts:239, 247` |
| `ontologia.venta` | `estado`, `cobrada`, `fecha_venta`, `pais_cliente`, conteos | 🟢 | **Los conteos no se tocan.** «Cuántas ventas», «en qué país», «qué producto se vendió más por unidades» siguen siendo `HECHO` |
| `tb_pago` | `fecha_pago`, `fecha_confirmacion`, latencias | 🟢 | El reloj de Tesorería no depende de ninguna moneda |

**En una línea para el gate:** *«todo campo que sea un monto —o que derive de uno— es 🔴; los
conteos, fechas, estados y dimensiones son 🟢».* Es más ancho que «cifras en moneda local», porque el
agujero B rompe también las cifras en USD que salieron de una conversión que nunca ocurrió.

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
3. **El 36 % no la tiene.** El comentario de `hermes/server/src/db/canonico.ts:78-82` lo dice medido:
   «*el 36 % de las ventas no traen radio*». Para esas, `proyectar.ts:50` cae a `tasas.get(iso)` — la
   tasa de **hoy** de `tb_moneda`. Ahí el histórico sí se reescribe retroactivamente.

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
(§2.4). Y la moneda es un `<select>` libre (`FormularioVenta.tsx:119`, con `hermes.ultimaMoneda`
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

### 2.4 🟢 «El payload de productos no trae moneda» — cierto, pero el diagnóstico es otro

Confirmado del lado de Hermes: `cerberus/productos.ts:8-13` y `productos.test.ts:14-15` documentan
que el payload vivo (111 productos, verificado 2026-07-23) no trae ninguna key de moneda, y que el
mapeo devuelve `''` antes que inventar una.

**Lo que faltaba: no es una omisión del payload. `Producto` no tiene columna de moneda.**
`grep -n "moneda" ceberusapp/products/models.py` → sin resultados. Todos los precios del catálogo
están en **una sola moneda implícita, y es USD**:

- `views.py:2264-2268`: `api_precio_producto` devuelve `{"precio_usd": float(producto.precio_normal)}` —
  el endpoint le pone el nombre.
- `_crear_venta_v2.js:254`: `precioMostrar = monedaNombre === 'USD' ? baseUSD : baseUSD * monedaMultiplicador`,
  donde `baseUSD` sale de `precio_base_usd` ← `precio_normal`.
- El campo hermano del modelo de docentes se llama `precio_docente_usd` (`products/models.py:307`).

**Consecuencia para el gate — y es una que lo afloja:** `precio_normal` y `precio_promocion`
**no pasan por `tb_moneda`, no se convierten, y no están afectados por A**. Son cifras USD limpias.
Su problema es de **etiqueta** (no hay columna que lo diga, así que ningún consumidor puede
verificarlo) y es de otra familia: se arregla agregando la columna, no arreglando el divisor.

Ivi puede seguir sirviendo precios de catálogo, **declarando USD y declarando que el dato lo afirma
el código y no el schema**. Apagarlos junto con las ventas sería apagar de más — que es justo lo que
este documento venía a evitar.

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
| **`{precio}` de plantillas** (`plantillas/expandir.ts`) | sí | 🟡 — sale de `Producto.precio_*`: **USD limpio** (§2.4), pero **sin moneda**. `expandir.ts:47-59` ya se niega a mostrar un precio sin moneda y deja el hueco `[precio]`. La regla existente es la correcta y no hay que tocarla |
| **Panel derecho — ficha del cliente** (`cerberus/ficha.ts:74-80`) | sí | 🟡 — muestra `monto` + `moneda` **crudos de Cerberus, sin convertir**. Honesto por construcción; lo único que puede mentir es una venta contaminada por B |
| **Formulario de venta** (`FormularioVenta.tsx:333, 367, 381`) | sí | 🔴 — muestra el total en USD junto a un selector de moneda que dice otra cosa, y es **el punto donde se origina el agujero B** |

**En una línea:** *hoy la vendedora casi no ve cifras de plata, y el Dashboard no muestra ninguna.*
La contaminación de Hermes es de **escritura**, no de presentación.

### 3.2 La mitad desconectada — que es de donde Ivi comería

Ninguna de estas superficies la ve una vendedora. **Todas son las que un consumidor máquina —Ivi—
consultaría**, así que el gate va acá:

| Módulo | Campos | Estado |
|---|---|---|
| `ontologia/proyectar.ts` | `venta.monto_usd`, `detalle_venta.precio_usd`, `cuota.monto_usd`, `pago.monto_usd`, `pago.moneda_iso` | 🔴 A + B (+ C en `pago`) |
| `sdk/herramientas/ventas.ts` | todo `usd` y `ticket` | 🔴 |
| `sdk/herramientas/atribucion.ts` | `usd` (`:239, :247`) | 🔴 |
| `analisis/comercial.ts`, `ventasPorPais.ts`, `cartera.ts`, `canales/tesoreria.ts` | sumas y promedios en USD | 🔴 |
| `analisis/tasas.ts` | `tasasDeCambio()` | 🟡 — **usa `radio_multiplicador`, el campo correcto** (`:22`), y lo declara en su comentario de cabecera. Sin fecha de vigencia: no aplica a histórico |
| `lazo/evento.ts:163` | `custom_data.value` + `currency` hacia Meta | 🔴 por B — el monto local crudo, que es lo correcto para Meta **si el monto es real** |

**Lo que no se toca:** conteos de ventas, países, fechas, estados, latencia de Tesorería, unidades
por producto. Todo eso sigue siendo `HECHO` sin salvedad.

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

---

## 5. Cómo verificar todo esto sin producción

Todo lo de este documento salió de leer código. Lo que **no** se pudo verificar acá, y que decide el
tamaño real del problema:

| Pregunta | Cómo se responde | Quién |
|---|---|---|
| ¿Cuántas ventas están contaminadas por B? | `SELECT count(*), codigo_moneda FROM tb_venta WHERE idempotency_key LIKE 'hermes-%' GROUP BY 2` | quien tenga acceso de lectura a Cerberus |
| ¿Cuál es el par real de cada moneda hoy? | `SELECT nombre_moneda, radio_divisor, radio_multiplicador FROM tb_moneda` | ídem — los valores citados son la medición de Ivi del 2026-07-26 |
| ¿Cuántas ventas tienen `radio_multiplicador_usado` nulo? | `SELECT count(*) FROM tb_venta WHERE radio_multiplicador_usado IS NULL` | ídem (Hermes lo estima en 36 %, `canonico.ts:80`) |
| ¿Cuántos pagos tienen moneda distinta a la de su venta? (agujero C) | join `tb_pago` × `tb_cuotas` × `tb_venta` comparando `codigo_moneda` | ídem |

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
