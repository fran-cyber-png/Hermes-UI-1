# El flujo — Hermes como mesa de venta sin salir del chat

> Decisiones tomadas con Estephano (2026-07-22). Esto manda sobre `PLAN.md` donde se contradigan.
> El norte, textual: **«que no tengan que salir de la plataforma para vender: tendrán todo ahí»**.

## La forma: un menú `···` en la BarraGestion, sobre cada conversación

`BarraGestion` (`src/features/gestion/BarraGestion.tsx`) ya es la franja de acciones sobre el chat
abierto — Llamar, Agendar, etapa, etiquetas. Ahí se cuelga un menú **`···` (vertical)** que abre las
cinco herramientas, cada una sabiendo de quién se está hablando (recibe la `clave` de conversación).
No es una zona nueva de la pantalla: es profundizar la que ya existe.

| Herramienta | Qué es | Alcance | Qué ya existe |
|---|---|---|---|
| **Correo rápido** | Cotización o confirmación al correo del contacto, **sin salir del chat** | — | La ficha ya trae `correo` (`cerberus/ficha.ts:94`); SMTP configurado (SES, 587) |
| **Mensajes predeterminados** | Los templates que se insertan con `/`, **con su pantalla para agregar/editar/quitar** | **Por vendedora** | nuevo |
| **Etiquetas** | Categorías con **color elegible** | **Por vendedora** | `etiquetas` existe, sin color |
| **Listas / notas** | El «Notion» a una tecla: anotar cosas de la conversación o propias | Por vendedora | nuevo |
| **Catálogo** | Los productos que venden, para consultar mientras chatean | **Compartido** (es de Cerberus) | `/api/venta/productos`, sin contexto |

## Las decisiones que cambian el plan

**El correo NO es «Marca» en el hilo.** Es una **acción de correo desde el chat**: se abre del `···`,
se manda, se cierra. El hilo **sigue siendo por un canal** (CONTEXT.md intacto): el correo no cuenta
como mensaje, no salda Deuda ni empieza Silencio. Esto simplifica el D4 del plan: no hace falta el
concepto «Marca» todavía.

**El correo de cotización reusa el armado de venta.** No se escribe el precio a mano: la vendedora
elige productos del **catálogo** —con el precio real de Cerberus— y eso arma la cotización. Mismo
motor que registrar venta (`FormularioVenta.tsx` / `useVenta.ts`). Es la única forma segura: un
precio mal tipeado en una cotización es plata. **Precondición dura**: `/api/venta/productos`
(`venta.ts:40`) hoy **no devuelve la moneda** — hay que arreglarlo primero, un `{precio}` sin moneda
en LATAM es una bomba.

**Mensajes y etiquetas son por vendedora.** Costo aceptado: la 2ª vendedora arranca con la libreta
vacía. Fácil de promover a «del equipo» después si molesta. El catálogo, en cambio, es de Cerberus:
compartido por definición.

## El primer día (sin tocar la UI de la vendedora)

Antes de construir herramientas nuevas, se pone el piso — que es lo que Estephano pidió con «tests
verdaderos y reales de cada funcionalidad»:

1. **Harness de tests con base de datos** (#33): Postgres en Docker en el runner (puerto 5439,
   tmpfs), guardia anti-producción, base por corrida. Es lo que hace que **la próxima consulta SQL
   nazca con su test al lado**.
2. **Primer test rojo→verde: el nivel VENCIDO** (#38). Arranca rojo porque prueba que el campo
   `seguimientoEn` nunca llega al radar; se pone verde con el JOIN a `recordatorios`. Con screenshot.
3. **Cerrar la auth partida** (#36) en las 4 rutas públicas. Verificable con `curl` (401 sin token).
   Desbloquea el pin/no-leído por vendedora y el ingestor de FB/IG.
4. **Dos chequeos baratos que destraban el correo/templates**: que `productos-cursos` traiga la
   **moneda**, y que los correos de la ficha vengan poblados en producción.

## El orden de las herramientas, después del piso

1. **Mensajes predeterminados + `/`** — el golpe más directo a «todo ahí para vender». Con su
   pantalla de edición.
2. **Correo rápido de cotización** — reusando el armado de venta. Depende de la moneda (paso 4).
3. **Etiquetas con color** + la cola potenciada (tabs `Todo · No leídos · Favoritos`, pin, filtros).
4. **Listas / notas**.
5. **Catálogo con contexto** — engancha con el trabajo de fichas de curso que ya empezamos.
6. **Multi-número** y **FB/IG visibles** — al final, por peso y riesgo (ver `PLAN.md` §4, fases 4-5).

## Lo que NO se hace (los guardarraíles)

- Nada masivo, nada automático: un envío = una acción humana. El correo y el mensaje salen **de a
  uno**, siempre editados antes de mandar.
- El `{precio}` sale de Cerberus **en el instante**, nunca cacheado ni escrito a mano.
- Las notas no tienen botón «Enviar»: una libreta no es un enviador.
- El catálogo se **consulta**; no manda nada solo.
