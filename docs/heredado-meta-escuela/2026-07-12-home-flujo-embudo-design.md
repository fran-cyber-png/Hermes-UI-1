# El home como el embudo de Goberna

**Fecha:** 2026-07-12
**Estado:** aprobado, en construcción
**Reemplaza:** la organización del home por conceptos internos (lazo / accionable / cerrado / preguntas)

## El problema

El home tiene información buena, pero está organizada por *nuestros* conceptos internos —el lazo, lo
accionable, lo que Meta cerró, las preguntas— y no por *quién la lee*. Cada profesional (community
manager, ventas, pauta, creativos, dirección) tiene que traducir esos conceptos a "¿esto es lo mío?".

La frase del usuario: *"tenemos info pero nos falta visualización, para que lo entiendan los diferentes
profesionales involucrados"*. Y: *"hagamos bien los flujos"*.

## La decisión

El home **es el embudo de Goberna**, contado de izquierda a derecha como una sola historia:

```
ENTRA  →  CONVERSA  →  LEAD  →  COMPRA  →  META
```

Cinco estaciones. Cada profesional reconoce "su" estación, pero ve el recorrido completo. Cada estación
es una **puerta** a su pantalla de detalle: el home es el mapa, no el volcado de datos.

Arriba de las estaciones, el **tablero de salud** que ya existe (`server/src/canales/salud.ts`) se
convierte en la *barra de estado del flujo*: un semáforo por etapa. Sus cinco piezas actuales
(pauta, interacciones, whatsapp, ventas, el lazo) mapean casi 1:1 a las cinco estaciones.

## Las cinco estaciones

| Etapa | Dueño | Qué muestra HOY (datos que ya tenemos) | Qué le falta (gap de Meta) | Puerta a |
|---|---|---|---|---|
| **1. ENTRA** | Pauta, Creativos | Gasto e inversión del período · anuncios que traen gente por costo por resultado | Miniatura + copy del creativo (gap 1) · gasto por país (gap 2) | `/campanas`, futura `/creativos` |
| **2. CONVERSA** | Community | Las 3 tarjetas por canal (IG · Facebook · WhatsApp): cuántos esperan, cuánta ventana queda | Puente comentario→anuncio (gap 3) · WhatsApp Cloud API (gap 5) | `/bandeja`, `/canal/:canal` |
| **3. LEAD** | Ventas | Formularios sin contactar (traen teléfono) · costo por lead | — (completo) | `/leads` |
| **4. COMPRA** | Ventas, Dirección | Ventas por país en USD · medios de pago | ROAS real por país (necesita gap 2) | `/tesoreria`, futura `/ventas` |
| **5. META** | Todos | Ventas reportadas a Meta · perdidas por la ventana · reloj de Tesorería | — (se robustece con gap 5) | `/tesoreria` |

## La bandeja de 3 canales

Hoy la bandeja mete todo en una cola y esconde que los canales **no son intercambiables**. El rediseño:
**tres tarjetas grandes, lado a lado**, una por canal, cada una honesta sobre lo que se puede hacer ahí.

- **Instagram** — solo responder comentarios en público. Los DM necesitan que Meta apruebe la revisión
  de la app (bloqueado, se dice con todas las letras).
- **Facebook** — responder en público siempre; en privado solo dentro de la ventana de 7 días. Muestra
  cuántos están en ventana y cuánto le queda al más urgente.
- **WhatsApp** — sin conectar. Es donde se cierra la venta y el 77% de la inversión. La tarjeta explica
  qué falta (migrar a Cloud API), no finge un cero.

En el home aparece la versión **compacta** de estas tres (la estación CONVERSA). La pantalla `/bandeja`
muestra las tres **a fondo**, con las colas de interacciones dentro de cada una.

## Arquitectura

Se respeta el patrón ya establecido:

- **BFF**: el home sigue leyendo de `GET /api/overview` (una llamada, solo Postgres). Las estaciones que
  necesiten datos nuevos (ventas por país, creativos) se agregan a ese payload o a endpoints hermanos
  bajo `/api/overview/*`, nunca hablando con Meta en el camino de la pantalla.
- **Snapshots**: cualquier dato nuevo de Meta (creativo, gasto por país) se recolecta en el JOB de pauta
  (`server/src/pauta/`), se guarda en Postgres, y la pantalla lee el snapshot. Meta jamás se toca al render.
- **TanStack Query** para el estado del servidor; `localStorage` solo para preferencias de UI (el rango).
- **Frontend**: las estaciones son componentes aislados bajo `src/features/home/`. La bandeja de 3 canales
  vive en `src/features/canales/` y se reusa entre el home (compacta) y `/bandeja` (completa).

### Qué falta traer de Meta, y de quién depende

**Código (lo hago yo; Meta ya expone el dato):**
1. **Creativo** — `creative{effective_object_story_id,thumbnail_url,body,title,object_type}` en el mismo
   llamado a `/ads` que ya hace `recolectar.ts`. Cero llamadas nuevas, más campos.
2. **Gasto por país** — insights con `breakdowns=country` a nivel de cuenta. Una llamada más por cuenta.
   Alimenta el cerebro de ROAS por país (`server/src/analisis/geo.ts`, ya construido y testeado).
3. **Puente comentario→anuncio** — mapear el `story_id` del post con el `effective_object_story_id` del
   anuncio, para saber qué creativo genera conversación (Reality Gap RG-005, 31,6% atribuible).
4. **Tipo de resultado** — `actions`/`action_type` en insights, para saber si el "resultado" es
   conversación iniciada, lead o compra. Hace honesto el costo por resultado.

**Infraestructura / decisión del usuario (no lo puedo prender solo):**
5. **WhatsApp Cloud API** — el 77% de la inversión. Baileys no mide; la Cloud API sí. Migración pendiente.
6. **Atribución clic-a-WhatsApp (`ctwa_clid`)** — qué anuncio trajo cada conversación. Necesita Cloud API.
   Desbloquea atribuir la VENTA al creativo.
7. **Mensajes privados de Instagram** — bloqueados hasta la aprobación de revisión de la app por Meta.

## Orden de construcción

1. **Reestructurar el home como el embudo** + rediseñar la bandeja de 3 canales, todo con **datos que ya
   tenemos**. Se ve y funciona de inmediato. (Sin dependencia de Meta.)
2. **Cerrar los gaps de código (1–4)**: enriquecer el creativo, el gasto por país, el puente
   comentario→anuncio. Llena de profundidad las estaciones ENTRA y COMPRA.
3. Los gaps 5–7 quedan marcados como "lo que sigue" en el tablero de salud — son del usuario / infra.

## Pruebas

- La lógica pura nueva (mapeos, agregaciones, el cruce comentario→anuncio) va con `node:test`, como el
  resto (`roas.test.ts`, `geo.test.ts`, `mysqldump.test.ts`).
- Los componentes se verifican en el navegador (build + screenshot), como se viene haciendo.
- Nada que muestre un número inventado: una etapa sin dato dice "sin conectar" o "sin revisar", nunca un 0
  que parezca un hecho. Es la misma regla del tablero de salud.

## Reality Gaps que toca

- **RG-005** (comentario→anuncio, 31,6% atribuible) — se materializa en el gap 3.
- El gasto-por-país (gap 2) es la mitad que le faltaba al cruce geográfico ya construido en `geo.ts`.
- La atribución de venta a creativo queda como HIPÓTESIS hasta el gap 6 (ctwa), y se dice así en la UI.

## Regla de estilo

Todo el texto de UI, mensajes y comentarios en **español peruano neutro**, sin argentinismos. Regla dura.
