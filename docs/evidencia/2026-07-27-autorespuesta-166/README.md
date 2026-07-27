# Evidencia — auto-respuesta, los siete defectos (#166)

**2026-07-27** · rama `fix/autorespuesta-siete-defectos` · regla dura #2.

Lo único que cambió de UI en este PR es la **cabecera de grupo de la revisión**: donde decía
«Aprobar 8» ahora dice «Revisar 8 ›». Las capturas son de la app corriendo, no maquetas.

## Cómo se sacaron, y por qué NO contra producción

**Producción está apagada y con 40 preparadas del 27-jul que no hay que tocar** (el issue las
deja explícitamente afuera: el arreglo es de código). Y el server de producción es el viejo,
así que apuntar el front ahí mostraría el bug, no el arreglo — el mismo motivo que quedó
escrito en `docs/evidencia/2026-07-27-plantillas-y-curso/README.md`.

Acá se fue un paso más lejos que aquella vez: **no hay ningún server de Hermes levantado**.
El front corre en Vite local (`:5199`) y **todo `/api/**` lo sirven fixtures del arnés de
Playwright**. No hay a dónde escribir aunque el código quisiera.

Tres guardas, puestas **antes de navegar**:

| Guarda | Qué hace |
|---|---|
| `route('**/api/whatsapp/leido/**')` | **Los ticks azules nunca salen.** Abrir una conversación dispara ese POST. Registró y frenó tres. |
| `route('**/api/**')` con filtro por método | Todo lo que no es `GET`/`HEAD` se contesta local. Registró y frenó `PUT /api/conversaciones/estado`. |
| Fixtures de `GET` | Bandeja, estado, hilo y ficha son sintéticos: teléfonos `5190001xxxx` y nombres inventados. **Ninguna captura se lleva el dato de una persona real.** |

El login no se usa —**es** una mutación— así que la sesión se siembra escribiendo el token en
`localStorage`, que es lo que el cliente lee sin validar firma (la valida el server, que acá
no existe).

## Las capturas

| Archivo | Qué muestra |
|---|---|
| `166-ANTES-aprobar-en-lote-1440.png` | Lo que había: **«✓ Aprobar 5»**, **«✓ Aprobar 3»** y **«✓ Aprobar 8»** en las tres cabeceras. Ocho personas, una decisión. |
| `166-revision-sin-aprobar-en-lote-1440.png` | Lo mismo con el arreglo: **«Revisar 5 ›»**, **«Revisar 3 ›»**, **«Revisar 8 ›»**. La cabecera sigue siendo la puerta al grupo; lo que ya no hace es saltearlo. En el composer se ve además la plantilla nueva, sin «Te escribe un mensaje automático». |
| `166-revision-abrio-la-primera-1440.png` | Después de tocar «Revisar 8»: el foco saltó al primero de **ese** grupo (de Luis Paredes a Miguel Ángel Ríos) y el chat del medio cambió con él. La puerta lleva al recorrido, no lo evita. |
| `166-revision-1280.png` | Lo mismo a 1280×720: sin scroll horizontal. |

## Lo que devolvió la verificación (literal)

```json
{
  "cabecerasDeGrupo": ["Revisar 5 ", "Revisar 3 ", "Revisar 8 "],
  "hayAprobarEnLote": false,
  "hayAlgunBotonQueDigaAprobarN": [],
  "alTocarRevisar8": {
    "antes":   "Luis Paredes | escribió 20:47 · hace 5 h",
    "despues": "Miguel Ángel Ríos | escribió 20:47 · hace 5 h"
  },
  "scrollHorizontal1280": 0,
  "mutacionesBloqueadas": [
    "POST /api/whatsapp/leido/51900010101",
    "PUT  /api/conversaciones/estado",
    "POST /api/whatsapp/leido/51900010101",
    "POST /api/whatsapp/leido/51900010301",
    "PUT  /api/conversaciones/estado"
  ],
  "erroresDeJs": []
}
```

**Ninguna escritura salió del navegador. Ningún mensaje de WhatsApp se envió**: en modo revisión
el botón no manda, llama a `POST /api/autorespuesta/aprobar` — y esa ruta también estaba
interceptada.

## Lo que NO tiene captura, y por qué

Los otros seis arreglos son de server y **no se ven en una pantalla**: viven en `decidir.ts`,
`rechazo.ts`, `plantillas.ts` y el simulacro. Su evidencia es de otra clase y está en el PR —
la salida literal de `npm run auto:simulacro -- --demo`, antes y después, con los tres casos del
issue sembrados: la que escribió 10:47 en horario, la de hace tres días y la abogada que se
despidió. Una captura de eso sería una foto de una terminal; el texto se lee mejor y se puede
comparar línea a línea.
