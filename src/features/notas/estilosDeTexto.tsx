import { createReactStyleSpec } from '@blocknote/react';

/**
 * FUENTE Y TAMAÑO — los dos estilos propios de la Libreta.
 *
 * ══ ESTO NO ES UN BOTÓN MÁS: ES UN CAMBIO DE ESQUEMA ════════════════════════
 *
 * El resto de la barra (negrita, color, alineación) usa estilos que BlockNote ya
 * trae. Estos dos NO EXISTEN en el paquete, así que se agregan al esquema — y con
 * eso cambia **lo que se guarda en la base**:
 *
 *     { "type": "text", "text": "hola", "styles": { "fuente": "Georgia" } }
 *
 * 🔴 **Es una puerta de una sola dirección**, la misma que `editor.ts` documenta
 * para los bloques de archivo: el día que haya páginas guardadas con `fuente`,
 * sacar el estilo del esquema las rompe **al abrirlas**. Y no rompe la nota:
 * `useCreateBlockNote` construye el editor durante el render, sin ErrorBoundary
 * en `src/`, así que deja **la ventana en blanco**.
 *
 * Por eso entran junto con `soloEstilosConocidos` (`editor.ts`) y no antes.
 *
 * ══ LOS VALORES SON CSS, NO UN ENUM ═════════════════════════════════════════
 *
 * `propSchema: "string"` y el valor va derecho a `style`. Se eligió así, y no una
 * lista cerrada de tokens, porque una lista cerrada obliga a un mapa
 * `token → CSS` **en el front y en cualquier lector futuro** — el server tendría
 * que conocerlo para renderizar la página pública (`paginaPublica.ts`), y ahí
 * volvería a aparecer la misma regla escrita dos veces (#37).
 *
 * ⚠️ **Lo que eso cuesta, dicho**: el valor guardado es texto libre. Hoy solo lo
 * escriben los dos selectores de la barra, así que en la práctica es una lista
 * corta; pero si alguna vez se acepta un valor de afuera, se sanea antes de
 * guardarlo — no se confía en que venga de nuestro `<select>`.
 *
 * ⚠️ **La página pública NO los muestra**, y es correcto: `paginaPublica.ts`
 * pinta desde `texto` (el plano), no desde `doc`. Una página compartida por link
 * se ve sin formato — como ya pasaba con la negrita. Que estos estilos no
 * cambien eso es lo esperado, no un defecto nuevo.
 */

/** Los dos nombres, en un solo lugar: el esquema y el saneador leen de acá. */
export const ESTILOS_PROPIOS = ['fuente', 'tamano'] as const;

export const Fuente = createReactStyleSpec(
  { type: 'fuente', propSchema: 'string' },
  {
    render: (props) => <span style={{ fontFamily: props.value }} ref={props.contentRef} />,
  },
);

export const Tamano = createReactStyleSpec(
  { type: 'tamano', propSchema: 'string' },
  {
    render: (props) => <span style={{ fontSize: props.value }} ref={props.contentRef} />,
  },
);

/**
 * EL TAMAÑO DEL PAPEL, EN UN SOLO LUGAR.
 *
 * 🔴 **El selector muestra este número cuando no hay estilo puesto, así que tiene
 * que ser el que de verdad sale.** Está también en `index.css` (`.bn-editor`), y
 * si los dos se separan el selector dice «16» sobre un texto de 15 — la clase de
 * mentira chica que después nadie puede explicar. `estilosDeTexto.test.ts` cruza
 * los dos y falla si divergen.
 *
 * En `px` y no en `rem` porque el número que ve la vendedora tiene que ser el
 * número que sale: con `rem`, «16» dependería del tamaño base del navegador y dos
 * personas verían distinto lo que el selector llama igual.
 *
 * Las fuentes ya no viven acá: se MIDEN contra la máquina, en
 * `fuentesDisponibles.ts`.
 */
export const TAMANO_POR_DEFECTO = 16;
