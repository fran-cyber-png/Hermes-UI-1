# Adenda al spec «Cierre de edición» — gráficas y resúmenes

> Pedido de Estephano (2026-07-21, durante la sesión): «charts, gráficas, resúmenes».
> Esta adenda extiende el spec sin contradecirlo: las gráficas hablan en la voz de imprenta
> (secundarias, honestas, deterministas), jamás compiten con el único titular de cada vista.
> Método: skill `dataviz` — la forma la elige el trabajo del dato; el color va último.

## Qué se grafica (y qué no)

| Dato | Trabajo | Forma | Dónde |
|---|---|---|---|
| Leads que cayeron por día (14 días, por fuente) | cambio en el tiempo | **columnas** finas, una serie (total) con desglose en tooltip | Dashboard, riel |
| Embudo por etapa | magnitud + flujo | **barra segmentada** (ya existe) + micro-tabla de conversión etapa→etapa | Dashboard, riel · recibo de venta (mini) |
| Mensajes enviados del equipo por día (14d) | pulso | **chispa** (sparkline 2px) | Dashboard, card Equipo |
| Ventas | cifra | número en la micro-tabla (ya existe) — una serie de casi-ceros NO se grafica | Dashboard, Equipo |
| Agenda / Pipeline / Correos | — | el calendario y el kanban YA son la visualización; Correos no grafica hasta tener SMTP y volumen | — |

**Resúmenes en lenguaje humano** (determinista, calculado de la serie, sin adjetivos):
bajo la gráfica de leads, una línea `text-xs text-muted-foreground`:
«Esta semana cayeron {n}; la pasada, {m}.» — dos números comparables, sin «↑30%» ni juicio.

## El dato (server — único cambio de API de todo el rediseño)

`GET /api/dashboard` suma un bloque `series` (agregados de 14 días, hora de Lima):

```ts
series: {
  leads_dia:  { dia: string /* YYYY-MM-DD */, chats: number, comentarios: number, formularios: number }[],
  envios_dia: { dia: string, n: number }[],
  ventas_dia: { dia: string, n: number }[],
}
```

SQL: `date_trunc('day', …)` + `count(*)` sobre `interactions` (mensajes entrantes + comentarios),
`leads`, `envios_wa` (estado enviado) y `conversiones_wa`. Días sin datos se rellenan con 0 en el
server (la serie siempre trae 14 puntos — el front no inventa continuidad).

## El kit (`src/components/graficos/`) — SVG propio, sin librerías

- **`Columnas`**: columnas finas con separación de 2px, tope redondeado 2px anclado a la base,
  eje base hairline `border`, sin grilla; etiqueta de día `font-mono text-[11px]` cada 2-3 columnas;
  máximo de la serie anotado una vez. Hover: tooltip HTML (estado local) con «mar 21 · 14 leads —
  9 chats · 3 comentarios · 2 formularios»; blanco de hover = todo el slot, no la columna.
- **`BarraSegmentada`**: la del embudo, extraída del Dashboard para reuso (riel + recibo de venta),
  con separadores de 2px del color de la superficie y conteos en `font-mono tabular-nums`.
- **`Chispa`**: línea 2px, sin ejes, punto final marcado, `aria-label` con el resumen.

## Color (validado, no intuido)

- Leads/día es UNA serie → **sin paleta categórica que validar**: azul `--primary` (hoy al 100%,
  días pasados `opacity-60`), texto SIEMPRE en tokens de tinta (`muted-foreground`), nunca del
  color de la serie. El desglose por fuente vive en el tooltip (texto), no en apilado de colores.
- Embudo: los colores de etapa ya canónicos en `ETAPA_CHIP` (`src/lib/etapas.ts`) — identidad
  fija, jamás re-pintada por filtros.
- La chispa: `--navy`.
- El oro NO aparece en ninguna gráfica (no es tiempo-que-se-acaba; es historia).
- Accesibilidad: cada gráfica con `role="img"` + `aria-label` resumen; la micro-tabla de
  conversión ES la vista tabla del embudo; los números del tooltip también viven en el `title`.

## Reglas que heredan del spec

Una gráfica jamás es el titular (la cifra héroe manda). Skeleton con la anatomía de la gráfica
(columnas fantasma). Vacío honesto: «Todavía no hay 14 días de datos — la serie arranca el {fecha}».
Sin animación de entrada de barras (el radar ya se mueve; la gráfica informa quieta).
