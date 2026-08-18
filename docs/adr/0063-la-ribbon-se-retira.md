# ADR 0063 — La Ribbon se retira: vuelve la barrita flotante de BlockNote

**Fecha**: 2026-08-19 · **Estado**: aceptado · **Reemplaza**: **ADR 0058** (la Ribbon) y los
documentos `docs/ribbon-de-la-libreta.md` y `docs/barra-de-formato-libreta.md`, que se archivan con
ella. Lo que 0058 reemplazaba a su vez —la barra fija del 17-ago— tampoco vuelve.

---

## La decisión

**Pedido directo del dueño**: la Ribbon completa (Inicio · Insertar · Dibujar · Revisar · Vista,
~35 archivos) **no era lo que se quería**. Se saca entera —componentes, catálogo, tests y su galería
de evidencia— y en su lugar queda **la barrita que el propio BlockNote ya trae**: aparece sola al
seleccionar texto o celdas, con negrita, alinear, combinar celdas y colores. Insertar bloques sigue
por `/`, como siempre; eso no se tocó.

Esto **no reabre el problema que 0058 planteaba** —«una herramienta que no se ve no existe»— lo
responde distinto: la barrita aparece **cuando hay algo seleccionado**, que es cuando el comando
tiene sentido, en vez de estar siempre a la vista ocupando el alto de la página.

## Lo que se aprendió, y por qué queda escrito

El bug de «Colores» **no tenía nada que ver con el paquete ni con Mantine**. En una página **recién
creada**, el primer guardado exitoso cambia el `key` de React (de `nueva` a la nota ya guardada) y
el editor entero se **remonta** — el mismo remonte que al cambiar de nota, y ProseMirror pierde la
selección con él. Medido con el mouse quieto, sin tocar nada: la selección se perdía sola a los
400-800 ms, justo el tiempo de `ESPERA_AUTOGUARDADO_MS`. En cualquier página ya guardada no pasa
nada de esto (verificado a mano).

⚠️ **Sigue sin arreglarse formatear texto durante esa ventana del primer guardado** — es un frente
aparte, en el manejo del `key` de `Libreta.tsx`.

Por eso el panel de colores (`SelectorDeColores.tsx`) vive **afuera** del ciclo de vida de
`FormattingToolbarController`: esa barrita puede desmontarse por este motivo hoy y por cualquier
otro mañana, y el panel no puede depender de seguir montado un instante después de abrirse. Las
muestras de color usan `COLORS_DEFAULT` del propio paquete (nunca un hex copiado a mano) con el tono
correcto por fila — `.text` para Texto, `.background` para Fondo, que antes usaban el mismo tono
vívido y no se parecían a lo que realmente queda pintado.

## Lo que NO se llevó puesto

- 🔴 **El `/` sigue teniendo su ítem propio «Plantillas»** (ADR de las plantillas de texto): vive en
  `EditorDePagina.tsx` con su `SuggestionMenuController`, y **`slashMenu={false}` sólo se apaga
  cuando montamos el nuestro** — en la mitad derecha de la pantalla dividida, donde no hay modal que
  abrir, el menú del paquete es el único que hay y apagarlo dejaría el `/` muerto.
- **La capa de anotaciones** (el dibujo sobre el documento) es independiente y no se tocó: su barra
  es otra, vertical, y vive en `dibujo/BarraDeDibujo.tsx`.
- **`tables: { splitCells: true }`** hay que dejarlo prendido: viene apagado por default en
  BlockNote y sin eso «combinar celdas» de la barrita se queda **callado** (devuelve `null`) aunque
  el resto ande.

## Consecuencia para quien lea el árbol

`src/features/notas/ribbon/` **ya no existe**. Si encontrás una referencia a la Ribbon en un
comentario o en un doc, es de antes del 19-ago-2026 y hay que borrarla, no reconstruirla.

⚠️ **«Deshacer» dejó de ser un nombre exclusivo de la Ribbon y nunca lo fue del todo**: el toast de
archivar tiene el suyo y el diagrama otro. Un test que lo busque con un `querySelector` global
agarra el primero del documento — hay que acotar la búsqueda a la barra que se está probando
(`Libreta.dibujo.test.tsx`).
