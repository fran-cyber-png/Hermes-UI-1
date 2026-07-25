# Evidencia — modo revisión interactivo (ADR 0018)

**2026-07-25** · rama `redesign/supervisado-interactivo` · regla dura #2.

Front corriendo en local **contra el server de producción**
(`env VITE_API_URL=https://hermes-api.goberna.us npm run dev`). Las conversaciones, los hilos, los
nombres, la ficha de Cerberus y el badge del anuncio de las capturas son **datos reales de VPS1**,
leídos con `GET`.

## Cómo se corrió sin tocar producción

Producción está en `apagada` y con **0** esperando aprobación, así que el estado de la auto-respuesta
se sirvió desde un **fixture** en el navegador. Las filas del fixture apuntan a **claves de
conversaciones reales**, que es lo que hace que el centro muestre un chat de verdad y que el panel de
la derecha lea lo que esa persona escribió de verdad.

Tres guardas, puestas **antes de navegar**:

| Guarda | Qué hace |
|---|---|
| `route('**/api/whatsapp/leido/**')` | **Los ticks azules nunca salen.** Abrir una conversación dispara ese POST; acá se intercepta y se responde 200 sin llegar al server. Interceptadas y registradas en cada corrida. |
| `route('**/api/**')` con filtro por método | Todo lo que no es `GET`/`HEAD` se responde localmente. Registró y frenó `PUT /api/conversaciones/estado`. |
| `route('**/api/autorespuesta*')` | El fixture del estado y de la bandeja. |

**Ninguna escritura llegó a producción.** Ningún mensaje de WhatsApp se envió: en modo revisión el
botón no manda, llama a `POST /api/autorespuesta/aprobar`, y esa ruta también estaba interceptada.

Las conversaciones del fixture se eligieron **descartando las que tuvieran datos personales** en el
hilo (correo, secuencias largas de dígitos, enlaces): las capturas se commitean.

## Las capturas

| Archivo | Qué muestra |
|---|---|
| `01-chip-sin-pendientes-1440.png` | El chip con **dos** etiquetas (Apagada · Supervisada) y el renglón inerte: `nada esperando`. |
| `02-chip-con-pendientes-1440.png` | El mismo lugar, ahora **puerta**: `12 esperando tu OK ›`, y es un `<button>`. |
| `03-revision-completa-1440.png` | El modo entero: fila agrupada por campaña con su lote a la izquierda · **la conversación real** al centro · «Por qué esta respuesta» arriba de la ficha · el borrador en el composer. El oro aparece **una sola vez**, en lo que está por caducar. |
| `04-teclado-avanzo-a-la-siguiente-1440.png` | Después de `⌘↓` con el foco en el borrador: pasó de `1/4` a `2/4`, la lista movió la marca y el centro cambió de conversación. |
| `05-borrador-editado-1440.png` | Con el texto tocado: marca `editada` en la banda y el botón pasa a **«Aprobar lo editado»**. Lo agregado es uno de los hechos que #153 midió como decisivos y casi nunca dichos («acceso por un año», «se puede pagar en cuotas»). |
| `06-revision-completa-1280.png` | Lo mismo a 1280: sin scroll horizontal y con el borrador legible entero. |

## Lo que devolvió cada verificación (literal)

```
chip:      { textoSin: "Apagada | Supervisada | nada esperando",
             textoCon: "Apagada | Supervisada | 12 esperando tu OK",
             elRenglonEsBoton: true }

teclado:   { entroConTeclaA: true, llevoAMensajes: true,
             salioConEscapeDesdeElBorrador: true, volvioALaCola: true }
           { paso2: "2/4" }                      ← ⌘↓ avanzó desde el composer

edición:   { boton: 1, marca: 1 }                ← «Aprobar lo editado» + chip «editada»

1280:      { scrollHorizontal1280: 0, anchoDelBorradorEn1280: 444 }

sin tocar
prod:      bloqueadas: ["TICKS-AZULES-BLOQUEADOS /api/whatsapp/leido/51921911132",
                        "TICKS-AZULES-BLOQUEADOS /api/whatsapp/leido/5219612336861",
                        "PUT /api/conversaciones/estado"]

consola:   sin errores de JavaScript (solo un 404 de recurso, de una foto de perfil)
```

## El clasificador, contra datos reales

`loQueDijo` corrió sobre hilos de producción sin tocar sus tests:

- **«Hola Quiero más información del Diploma de Inteligencia y Contrainteligencia»** →
  `copy-del-anuncio`. El panel dice: *«Es el texto pre-rellenado del anuncio: un clic, no una
  pregunta. La plantilla genérica va bien.»*
- **«Quiero saber si se recibe diploma del diplomado de inteligencia y contrainteligencia mande Mis
  transferencias Para el pago»** → `propio`. El panel dice: *«Esto lo escribió ella. Si la plantilla
  no se lo contesta, editala antes de aprobar.»*

El segundo es exactamente el caso que justifica la pantalla: una persona preguntando por el
certificado **y avisando que va a pagar**, a punto de recibir un acuse genérico.

## Dos defectos encontrados mirando las capturas, y corregidos

1. **El borrador se veía en renglón y medio** (el `textarea` heredaba `rows={1}` del composer normal).
   Se supervisa leyendo: en revisión arranca en 5 renglones y hasta `max-h-56`.
2. **A 1280 los dos botones aplastaban el borrador a ~150 px.** En revisión las acciones bajan a su
   propia fila; el borrador quedó en 444 px.

Y un tercero, funcional: **`Escape` no salía del modo**, porque el foco vive en el composer y la
guarda global de «no pises un input» se comía la tecla. Ahora sale, acotado al `textarea`.
