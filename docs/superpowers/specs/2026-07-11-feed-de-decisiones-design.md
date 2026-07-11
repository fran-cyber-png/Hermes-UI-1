# Feed de decisiones — diseño

> Pantalla principal de pauta. Reemplaza la tabla de 409 campañas como primera
> vista. La tabla y el árbol no se tiran: pasan a ser vistas de detalle.

## El problema

Hoy la pantalla de campañas es una tabla de 409 filas. Para encontrar que el
conjunto "ABRIL" se lleva el 78% del presupuesto siendo 2× más caro que "MAYO",
hay que cruzar dos tablas a mano. Nadie lo hace. Por eso la fuga estuvo
invisible durante meses.

## Los usuarios (relevado con el usuario)

| Quién | Frecuencia | Qué necesita |
|---|---|---|
| **Pauteador** | varias veces al día | Ejecutar rápido: pausar, mover presupuesto, duplicar, subir creativos, **duplicar entre cuentas/países** |
| **Estratega (Alan)** | 1-2 veces por semana | Que le digan qué está mal, sin operar ni buscar |
| **Comercial** | — | Ya tiene su pantalla (`/leads`). No usa esta. |

La tensión: el estratega quiere **señal**, el pauteador quiere **velocidad**. Una
tabla no sirve a ninguno. Un feed de decisiones sirve a los dos: mismas
tarjetas, uno las lee y el otro las ejecuta.

## Principio rector

**La pantalla no muestra todo: muestra lo que requiere atención.**
Si no hay nada que hacer, está vacía — y eso también es información.
El orden no es cronológico: es **por plata en juego**.

## Los detectores

Cada tarjeta sale de un detector que corre sobre datos reales de Meta.

| Detector | Regla | Nivel | Acción propuesta |
|---|---|---|---|
| `presupuesto-mal-repartido` | Un conjunto con CPR ≥1.5× el del mejor se lleva ≥2× su participación de gasto | conjunto | Mover presupuesto |
| `sin-exclusiones` | El conjunto incluye públicos y `excluded_custom_audiences` está vacío | conjunto | Excluir los públicos marcados como exclusión |
| `anuncio-caro` | CPR del anuncio ≥1.5× el promedio de su campaña, con gasto significativo | anuncio | Pausar |
| `gasto-sin-resultados` | Gastó > 0 y trajo 0 resultados | anuncio | Pausar |
| `ganador-sin-escalar` | El conjunto con menor CPR tiene < 25% del gasto | conjunto | Subirle presupuesto |
| `pais-sin-replicar` | Campaña con buen CPR que existe en una cuenta y no en otras | campaña | Duplicar a otras cuentas |

**Ranking:** por dinero en juego (`plataEnJuego`), no por severidad abstracta.
Si un hallazgo no tiene impacto en plata, no aparece.

## Seguridad — cómo funciona "Aplicar"

Restricción del usuario (textual): *"respeta las configuraciones actuales de las
pautas, no las toques... cuando tengamos algo seguro poder recién impactar"*.

Dos modos:

- **Simulación** (default, y como arranca): muestra el cambio exacto que haría
  (de $X a $Y, pausar tal anuncio) pero **no escribe en Meta**.
- **Ejecución**: lo habilita el usuario. Pide confirmación, escribe, y **guarda
  el estado anterior** para poder deshacer.

Cada acción aplicada se persiste como un **evento** en el event store
(`events`, source `decision_applied`), con el estado previo en el payload. Queda
el registro de quién cambió qué, cuándo, y qué había antes. Eso es lo que hace
que sea reversible y auditable.

## Restricciones aprendidas (de goberna-dashboard, no reinventar)

- **Los públicos personalizados NO cruzan de cuenta.** Un lookalike de Perú no
  existe en la cuenta de México. Al duplicar entre países hay que quitarlos y
  avisar (`strip_uncopyable_targeting`).
- **Cada cuenta destino necesita sus propios recursos** (Página, Instagram,
  píxel, formulario). Si falta uno, la fila se bloquea y no se crea
  (`resolve_account_resources`).
- **Rate limit de Meta es real.** La cuenta de Perú tiró error 17 dos veces en
  una sesión. Los detectores deben correr sobre datos ya traídos, no disparar
  una llamada por regla.

## Arquitectura

```
server/src/decisions/
  detectors.ts     — las reglas puras (entrada: Structure, salida: Decision[])
  types.ts         — Decision, Accion, PlataEnJuego
server/src/routes/
  decisions.ts     — GET /api/decisions?accountIds=...  (corre los detectores)
                     POST /api/decisions/:id/aplicar    (ejecuta o simula)

src/features/decisions/
  DecisionFeed.tsx — el feed
  DecisionCard.tsx — una tarjeta (qué pasa, cuánta plata, qué haría, botones)
  api.ts, types.ts
```

Los detectores son **funciones puras** sobre la `Structure` que ya devuelve
`/api/structure/:campaignId`. Se testean sin tocar Meta.

## Pantallas

```
/campanas          → FEED DE DECISIONES  (nuevo, pantalla principal)
                     + pestaña "Todas" con la tabla de 409 (ya existe)
/campanas/:id      → ÁRBOL campaña→conjunto→anuncio (ya existe)
/campanas/nueva    → WIZARD de 3 etapas (ya existe)
```

## Fuera de alcance (por ahora)

- Duplicación entre cuentas: el detector `pais-sin-replicar` la **sugiere**,
  pero el flujo de duplicación en sí es un proyecto aparte (ya existe uno en
  goberna-dashboard del que hay que portar la lógica de recursos).
- Subir creativos nuevos: bloqueado hasta publicar la app de Meta.
