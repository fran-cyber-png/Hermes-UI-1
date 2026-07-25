# Evidencia — modo supervisado de la auto-respuesta (#125 · ADR 0016)

Capturado el **2026-07-25** con Playwright contra el front real construido con
`VITE_API_URL=https://hermes-api.goberna.us` (`npm run build` + `vite preview`), con **login de
verdad** del usuario de prueba contra producción.

## Qué estaba mockeado, y por qué

| Ruta | Por qué |
|---|---|
| `POST /api/whatsapp/leido/*` | **Manda tildes azules a un cliente real.** Se intercepta ANTES de navegar; nunca sale del navegador. |
| `POST /api/autorespuesta/aprobar` · `/descartar` · `PUT /modo` | Son escrituras. Ninguna llega a producción. |
| `GET /api/autorespuesta` · `/bandeja` | Producción **todavía no tiene el `db:push`** de ADR 0016 (columnas `modo`, `aprobada_por`, `campana`…), así que no hay preparadas que mostrar. Lo que se verifica acá es **la pantalla**; el camino de datos lo cubren los tests puros y los `*.test.db.ts`. |

Todo corrió en un **contexto de navegador propio** (`browser.newContext()`), aislado de las sesiones y
las rutas de los otros agentes que comparten el Chrome.

## Las capturas

| Archivo | Qué muestra |
|---|---|
| `125-chip-apagada.png` | El chip neutro. Los tres modos a la vista; apagar cuesta un click desde cualquiera. |
| `125-chip-supervisada.png` | Segmento delineado en azul + `9 esperando tu OK` + el botón **Revisar 9**. Sin punto vivo: no está saliendo nada. |
| `125-chip-automatica.png` | Segmento sólido navy + punto verde latiendo + `3 en cola · próxima 11:55`. El peso visual crece con la consecuencia. |
| `125-bandeja.png` | La bandeja con 9 esperando, agrupadas en 3 campañas. El texto se muestra **una vez por grupo**. El **oro aparece solo en 2 de 9 filas** — las que vencen en 42 y 51 min. |
| `125-bandeja-lote.png` | Seleccionadas las 9. El primario dice **«Aprobar — 9 mensajes de 3 campañas»**: nombra las campañas, no solo el número. |
| `125-bandeja-editar.png` | El texto de una fila desplegado y editable antes de aprobar. |
| `125-bandeja-recibo.png` | El recibo: **«7 aprobadas — salen entre las 11:51 y las 12:07, una por vez»** y el motivo de la que no entró (techo por hora). |
| `125-bandeja-vacia.png` | Abierta con la tecla **A** desde el Dashboard, sin nada que revisar. |

> En `125-bandeja-vacia.png` el chip sigue diciendo «9 esperando» porque el fixture de `/bandeja` se
> cambió a vacío y el de `/api/autorespuesta` no: es un artefacto del mock, no de la app.

## Salidas literales leídas del DOM

```
chip-apagada     : Dashboard | datos hace 1 min | Apagada | Supervisada | Automática | 51 986 394 450
chip-supervisada : … | Apagada | Supervisada | Automática | 9 esperando tu OK | Revisar | 9 | …
chip-automatica  : … | Apagada | Supervisada | Automática | 3 en cola · próxima 11:55 | …

lote             : Descartar todo (9) | Descartar | Aprobar — 9 mensajes de 3 campañas
recibo           : 7 aprobadas — salen entre las 11:51 y las 12:07, una por vez
                   · #301: techo por hora del número (20 auto-respuestas): entra en la hora que viene
vacía            : No hay nada esperando tu OK. | La cola prepara respuestas para quien escribe fuera
                   de horario y nadie atiende en 30 minutos. Si anoche no entró nadie, esto queda
                   vacío — y está bien.
```

## Lo que NO se verificó en el navegador

- La burbuja **«Aprobado · ana»** del hilo: exige `aprobada_por` en la base, que es parte del
  `db:push` pendiente. La consulta y el render están cubiertos por typecheck; la marca «Automático»
  que la precede ya tiene su captura en `125-burbuja-automatica.png` (ADR 0015).
- Los `*.test.db.ts` de esta rama corren **en CI** (runner de VPS1): la Postgres efímera local estaba
  ocupada por otro agente y montar el template la habría tirado a mitad de su corrida.
