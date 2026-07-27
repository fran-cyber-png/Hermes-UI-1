# La atribución de ventas — cómo una conversación se vuelve plata

> Qué se construyó en Hermes, qué falta del lado de Cerberus, y qué se apaga cuando eso llegue.
> Todo lo medido es del **2026-07-27**, en lectura contra producción (VPS1, `default_transaction_read_only`).
> Frente: issue **#161**, fase 1.

## El problema, en una línea

`conversiones_wa` tenía **0 filas** mientras Cerberus registraba **6.798 ventas por US$768.657**.
Hermes no podía decir qué chat produjo un solo dólar: ni conversión por curso, ni ROI por anuncio,
ni valor por vendedora, ni `Purchase` para Meta.

No faltaba construir mucho. Faltaba **enchufar**, y la pieza estaba enchufada al lugar equivocado.

## Los tres eslabones, y quién depende de quién

| | Qué | De quién depende |
|---|---|---|
| **1. El receptor** | El webhook de venta proyecta a `conversiones_wa`, valida con Zod, y lo que no se atribuye queda contado | **de nadie** ✅ hecho |
| **2. La llave** | La conversación viaja a Cerberus en el `venta_request_key` y vuelve | **de nadie** ✅ hecho |
| **3. El emisor** | Cerberus tiene que postear el webhook **también** a Hermes | ⛔ `Goberna-Lab/ceberusapp` — §«Lo que hay que pedirle a Cerberus» |

Mientras 3 no exista, el **puente temporal** (`npm run ventas:sincronizar`) hace el trabajo con los
eventos que Cerberus ya emitió. Ver §«El puente».

---

## 1. La llave de atribución (determinista)

`Venta.idempotency_key` de Cerberus es el **único campo que hace el viaje completo**:

```
Hermes  ──POST /ventas/crearVenta/  venta_request_key=h1~w~51987654321~51986394450~m4kx91c──▶  Cerberus
                                                                                                  │
Hermes  ◀──webhook  { …, "idempotency_key": "h1~w~51987654321~51986394450~m4kx91c" }─────────────┘
```

y `h1~w~51987654321~51986394450~m4kx91c` **es** `conv:whatsapp:51987654321:51986394450`.

- **Formato**: `h1~<letra de canal>~<persona>~<número propio>~<ms en base 36>`.
  `w` whatsapp · `i` instagram · `f` facebook.
- **Techo de 64 caracteres** (`sales/models.py:136`, `CharField(max_length=64, unique=True)`).
  Si no entra, `armarLlaveAtribucion` devuelve la llave de siempre (`hermes-<vendedora>-<ms>`):
  **nunca una llave truncada**, porque una truncada se lee mal y eso es peor que no leerla.
- **La idempotencia no cambia**: dos envíos del mismo formulario en el mismo milisegundo siguen
  dando la misma llave, y dos conversaciones distintas nunca comparten llave.
- Código: `server/src/atribucion/llave.ts`. Tests: `llave.test.ts` (el central es el ida y vuelta).

**Lo que le pedimos a Cerberus por escrito**: que `idempotency_key` **no se normalice, trunque ni
regenere**. Es un contrato, no un detalle de implementación.

## 2. La cascada de resolución

`server/src/atribucion/resolverConversacion.ts`. De más fuerte a más débil, y **cada escalón se
etiqueta** (columna `conversiones_wa.atribucion`) para saber cuánto confiar en el número:

| Escalón | Cuándo | Etiqueta |
|---|---|---|
| La llave | La venta salió de un chat de Hermes | `llave` |
| E.164 completo | El teléfono del cliente y el del chat coinciden entero | `telefono_e164` |
| Sufijo de 9 dígitos | Cerberus guardó el número local, WhatsApp lo trae con código de país | `telefono_sufijo` |
| — | No se pudo | fila en `ventas_no_atribuidas` |

⚠️ **El sufijo es más débil de lo que parece** (issue #119). Medido el 27-jul: de las **143** ventas
que matchean por sufijo, **29 (20 %) tienen un E.164 distinto**. Con clientes de MX/GT/EC en el
padrón, un sufijo compartido puede ser dos personas. Tres defensas, en este orden:

1. **El E.164 se arma con el país declarado del cliente** — `normalizarDelPadron`
   (`clientes/padron.ts`, la misma función que usa la marca de ex-cliente de la cola). Cerberus
   guarda muchos teléfonos en formato **local**: sin el país, un guatemalteco de 8 dígitos no llega
   ni a los 9 del sufijo (los **393 clientes invisibles** de #133) y un mexicano de 10 se compara mal.
2. **El E.164 completo gana siempre** sobre el sufijo.
3. **Guarda de país en el respaldo**: si el match es *solo* por sufijo y sabemos el país del cliente,
   el teléfono del chat tiene que **empezar con ese código**. Un mexicano de Veracruz y un peruano
   comparten los últimos 9 dígitos; no comparten el código.

Y lo que igual entra por sufijo queda **etiquetado** `telefono_sufijo`, para poder excluirlo de un
reporte sin tocar código.

El SQL solo hace un **prefiltro superconjunto** por sufijo; el veredicto lo dan las funciones puras
que ya existían (`whatsapp/identidadWa.ts`, `clientes/padron.ts`). No hay una segunda definición de
«qué dos teléfonos son el mismo» — la lección de #37.

## 3. Dónde aterriza

**`conversiones_wa`** (lo que el CRM lee) gana la venta de verdad: `external_sale_id`, `folio`,
`monto`, `moneda`, `medio`, `origen_venta`, `estado_venta`, `estado_pago`, `clave`, `canal`,
**`numero_propio`**, `atribucion`, `fuente_venta`, `ocurrida_at`.

`numero_propio` está desde el día uno porque el equipo vende por **varios** números (#50): sin esa
columna, la misma persona escribiendo a dos números nuestros sería una sola conversión y el
rendimiento por número no se puede medir.

**`ventas_no_atribuidas`** (nueva) guarda lo que no se pudo atar, con su motivo. Es el **denominador**.
Tabla aparte y no un flag: `conversiones_wa` significa «esta conversación produjo esta venta», y hay
tres consultas vivas que la cuentan entera como ventas del CRM (`dashboard/series.ts`,
`dashboard/porVendedora.ts`, la compuerta de Cierre en `gestiones/registrarGestion.ts`). Meter ahí
las 6.800 ventas del negocio convertiría el panel de la vendedora en el reporte de Cerberus.

Una venta está **de un lado o del otro, nunca en los dos**: cuando una no atribuida se vuelve
atribuible, `proyectarVenta` la mueve.

**`ontologia.conversiones` se queda donde está.** No es un schema muerto: es el **outbox del CAPI**
y `lazo/worker.ts:87` lo consulta para no mandarle a Meta dos veces el mismo `Purchase`. Sacarlo de
ahí rompería esa deduplicación.

---

## El puente (⚠️ temporal)

```bash
cd server
npm run ventas:sincronizar                 # dry-run: mide, no escribe
npm run ventas:sincronizar -- --aplicar    # proyecta de verdad
npm run ventas:sincronizar -- --desde 2026-06-01 --limite 500
```

**Qué hace**: relee `icarus.cerberus_events` —los payloads crudos que Cerberus ya emitió— y los pasa
por el **mismo camino que el webhook**: `leerEventoCerberus` → `ventaDeEvento` → `proyectarVenta`.
No interpreta nada por su cuenta; es literalmente el mismo JSON.

**Por qué existe**: el webhook de Cerberus funciona desde hace meses, pero
`ICARUS_CERBERUS_WEBHOOK_URL` acepta **una sola URL** y esa URL es `https://icarus.goberna.us`.
Los eventos ya existen, ya son de Cerberus y están en el mismo VPS.

**Por qué se apaga y no se queda**: *icarus no es el espejo de Cerberus.* Es la plataforma
multi-tenant de los clientes de **consultoría** (`icarus_api:8092`, `icarus_tejada_api:8093`,
`icarus_demo_api:8094`) y **sirve a un cliente real**. Que las ventas de la Escuela estén ahí es un
desvío, no un diseño. Construir algo permanente encima sería hornear el desvío.

**El día del fan-out**: se deja de correr el script. No hay una línea que tocar en el proyector, ni
un segundo modelo que retirar. Eso es lo que compra el seam.

**Garantías**: read-only a nivel de sesión sobre icarus (`default_transaction_read_only`, lo hace
cumplir el servidor) · idempotente (dedup por `external_sale_id` / `folio`) · dry-run por default ·
deja fila en `sincronizaciones` para que el atraso se note.

---

## Lo que hay que pedirle a Cerberus (`Goberna-Lab/ceberusapp`)

> 🚨 **NUNCA repuntar el webhook.** `ICARUS_CERBERUS_WEBHOOK_URL` apunta a icarus, e **icarus sirve
> a un cliente real** (Tejada). Cambiar el destino rompe producción de un cliente. La única forma
> correcta es **fan-out**: Cerberus postea a icarus **y** a Hermes, cada uno con su token, y el
> fallo de uno no toca al otro.

### El cambio, exacto

**Archivo**: `sales/icarus_payload.py`
**Función**: `send_payload_to_icarus` (**línea 466**), donde hoy lee un único destino:

```python
url   = os.environ.get("ICARUS_CERBERUS_WEBHOOK_URL", "").strip()      # línea 471
token = os.environ.get("ICARUS_CERBERUS_WEBHOOK_TOKEN", "").strip()    # línea 472
```

**Forma propuesta** — una lista de destinos, sin tocar el resto del archivo:

```python
def _destinos() -> list[tuple[str, str, str]]:
    """
    [(nombre, url, token)]. Formato: nombre|url|token,nombre|url|token
    Retrocompatible: si CERBERUS_WEBHOOK_TARGETS no está, se usa el par de envs de siempre.
    """
    crudo = os.environ.get("CERBERUS_WEBHOOK_TARGETS", "").strip()
    if crudo:
        destinos = []
        for parte in crudo.split(","):
            trozos = [t.strip() for t in parte.split("|")]
            if len(trozos) == 3 and all(trozos):
                destinos.append(tuple(trozos))
        return destinos
    url = os.environ.get("ICARUS_CERBERUS_WEBHOOK_URL", "").strip()
    token = os.environ.get("ICARUS_CERBERUS_WEBHOOK_TOKEN", "").strip()
    return [("icarus", url, token)] if url and token else []
```

y en `send_payload_to_icarus`, iterar `_destinos()` **capturando el error de cada uno por separado**:

```python
resultados = {}
for nombre, url, token in _destinos():
    try:
        resultados[nombre] = _postear(url, token, payload, timeout)
    except Exception:
        logger.exception("Webhook a %s falló. Los demás destinos siguen.", nombre)
        resultados[nombre] = {"ok": False}
return resultados
```

**Dónde corre**: dentro del thread de background que ya existe (`_run_in_background`, **línea 513**).
No hay que tocar ninguno de los siete `transaction.on_commit` de `sales/views.py`
(líneas 1201, 2975, 3286, 3418, 3814, 3883, 4135).

**Variables de entorno** (en `/srv/cerberus/.env`):

```
CERBERUS_WEBHOOK_TARGETS = icarus|https://icarus.goberna.us|<token de icarus>,hermes|https://hermes-api.goberna.us/webhook/cerberus|<token de hermes>
```

El token de Hermes es el que Hermes valida como `CERBERUS_WEBHOOK_TOKEN` (referenciado por nombre,
regla dura #1 — **no se pega en ningún archivo del repo**). El token viaja en el **querystring**, que
es como Hermes ya lo espera (`_webhook_url_with_token`, línea 456, lo agrega solo).

**Cómo se verifica que sirvió**: `SELECT count(*) FROM webhooks_recibidos` en `hermes_db` deja de ser
**0** y crece con cada venta. Y `icarus.cerberus_events` **sigue creciendo igual** — eso es lo que hay
que mirar primero, porque es el cliente que no se puede romper.

**Riesgo de este cambio**: bajo pero no nulo. El thread de background pasa de un POST a dos, con el
mismo timeout de 10 s cada uno; en el peor caso, una venta tarda 20 s en terminar de sincronizar (sin
bloquear la request, que ya responde antes). Un despliegue de Cerberus corre migraciones solas, así
que conviene hacerlo fuera de la hora pico de ventas.

### ❓ Pregunta abierta para el dueño: ¿son dos destinos o tres?

Existe **meta-escuela** (VPS1 `:4100`, bindeado al tailnet), que según el ADR 0002 de ese repo es
**el que debe ingerir**, y su proyección está **congelada desde el 13-jul**. Los ~39 archivos de
`sdk/`, `analisis/`, `ontologia/` y `fuentes/` de Hermes son una copia byte-idéntica de su SDK.
Si meta-escuela sigue siendo el motor analítico, el fan-out son **tres** destinos, no dos — y el
formato de `CERBERUS_WEBHOOK_TARGETS` ya lo soporta sin volver a tocar código.
**Esto no lo decide este PR.**

### Los otros pedidos (no bloquean esto)

- **`idempotency_key` como contrato estable** — que no se normalice, trunque ni regenere. Mejor aún:
  un campo propio `origen_externo` para no sobrecargar la idempotencia.
- **Configurar el push del mapa de números** (#161 E3): `HERMES_BASE_URL`, `HERMES_ADMIN_TOKEN`,
  `HERMES_TIMEOUT`. El código está escrito de los dos lados; hoy Hermes ve **1** número.
- **Desplegar el catálogo con eventos** (`c83adbf`, mergeado y sin desplegar).

---

## Lo que este frente NO hace

1. **No mueve el embudo.** La etapa efectiva sale de `gestiones` (ADR 0013) y una venta que entra por
   webhook **no** escribe una gestión: hacerlo en un backfill movería 143 conversaciones a «cierre»
   de golpe. Es una decisión aparte.
2. **No toca `ontologia.conversiones` ni el lazo del CAPI.** Sigue igual, con su dedup.
3. **No arregla la sesión de Cerberus en memoria** (#161 E1.5): cada restart sigue dejando a las
   vendedoras sin poder registrar una venta hasta que vuelvan a entrar.
4. **No copia clientes.** `conversiones_wa` guarda una **referencia** (`cerberus_cliente_id`), y
   `ventas_no_atribuidas` guarda **cuántos** teléfonos tenía el cliente, no los teléfonos.

## Lo medido (2026-07-27, lectura de producción)

### Cuánto cierra el puente HOY

Corriendo la cascada real sobre los **7.566** eventos que Cerberus ya emitió, contra las
conversaciones vivas de Hermes:

| | |
|---|---|
| Ventas distintas evaluadas | **6.945** |
| **ATRIBUIDAS** | **142 · 2,0 %** |
| … por la **llave** | **0** — todavía no se creó ninguna venta desde el CRM |
| … por **E.164 completo** | **130** |
| … por **sufijo de 9** | **12** ⚠️ los más débiles (#119) |
| **SIN ATRIBUIR** | **6.803** — sin teléfono **22** · sin conversación **6.781** |
| Payloads que **no** validaron contra el Zod | **0 de 7.566** |

Plata atribuida vs. total, por moneda (sin convertir — convertir acá sería hornear una tasa):

| | PEN | USD | MXN | COP | BOB | CLP | DOP |
|---|---|---|---|---|---|---|---|
| atribuida | 28.601 | 5.726 | 72.474 | 539.514 | 2.094 | 0 | 0 |
| total | 682.079 | 296.741 | 3.571.165 | 36.603.652 | 796.961 | 285.329 | 876.834 |

### El contexto que explica ese 2 %

| | |
|---|---|
| Conversaciones de WhatsApp en Hermes | **1.998** — historia de **6 días** (21 → 27 jul) |
| Ventas en el espejo de Cerberus | **6.973** · confirmadas **6.651** |
| Match sobre las ventas de los **últimos 30 días** | **25 de 454 · 5,5 %** |
| Match sobre las ventas de los **últimos 7 días** | **10 de 94 · 10,6 %** |
| Ventas que matchean **solo** por sufijo (E.164 distinto) | **29** — el 20 % de los matches por sufijo |
| `conversiones_wa` · `webhooks_recibidos` | **0** · **0** |
| Eventos con `venta.vendedor` · con `cliente.telefonos[]` | **7.560** · **7.538** de 7.566 |

**El techo real de hoy es la historia, no el algoritmo.** Hermes tiene 6 días de conversaciones
(desde que se vinculó el número) y **un solo número** vinculado. Por eso el match de los últimos 7
días (10,6 %) es 5× el histórico (2,0 %) — y por eso el **multi-número (#50)** y la **llave
determinista** suben ese número mucho más que cualquier heurística de matching. El 2 % no es el
techo del sistema: es la sombra que proyectan 6 días de conversación sobre 3 años de ventas.
