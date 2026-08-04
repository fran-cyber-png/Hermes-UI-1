import { BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core';
import { es } from '@blocknote/core/locales';

/**
 * CÓMO SE CONFIGURA EL EDITOR DE LA LIBRETA — y las dos cosas que estaban mal.
 *
 * `useCreateBlockNote` recibía SOLO `initialContent`, así que mandaba todo el
 * default de BlockNote. Dos consecuencias, las dos visibles el primer día:
 *
 *  1. **El editor entero estaba en inglés** dentro de una app 100 % en español:
 *     el menú de «/», los placeholders, la barra de formato, todo.
 *  2. **Ofrecía bloques de archivo que no se pueden guardar.**
 *
 * ══ POR QUÉ SALEN LOS BLOQUES DE ARCHIVO ════════════════════════════════════
 *
 * `image` / `video` / `audio` / `file` tienen contenido `"none"`: su URL, su
 * nombre y su caption viven en `props`. El server deriva el texto plano con
 * `aTextoPlano`, que lee `text`/`content`/`children`/`rows`/`cells` y **nunca
 * props** (por diseño). Entonces una página que sea SOLO una imagen aplana a
 * cadena vacía, `validarTexto` la rechaza por vacía y el 400 se perdía.
 *
 * El ítem «Image» aparecía en el «/» aunque no hubiera `uploadFile`, y el file
 * panel dejaba pegar una URL: el camino estaba abierto y terminaba en una
 * página que no se guarda nunca, sin aviso.
 *
 * Sacarlos del schema es **barato AHORA y caro después**: hoy no hay ni un
 * documento viejo que los contenga (la tabla venía de cero filas). Cuando los
 * haya, sacarlos del schema los rompe al abrir.
 *
 * Cuando existan los adjuntos de verdad (`uploadFile` + `resolveFileUrl` +
 * almacenamiento), esto se revierte junto con el arreglo del aplanado — no
 * antes, o vuelve el mismo agujero.
 */

// Los cuatro se descartan por desestructuración: el `_` es la convención del
// linter para «lo saqué a propósito y no lo voy a usar».
const {
  image: _image,
  video: _video,
  audio: _audio,
  file: _file,
  ...BLOQUES_QUE_SE_PUEDEN_GUARDAR
} = defaultBlockSpecs;

/** Los cuatro que se sacaron, para que el test los pueda nombrar sin adivinar. */
export const BLOQUES_RETIRADOS = ['image', 'video', 'audio', 'file'] as const;

export const ESQUEMA_LIBRETA = BlockNoteSchema.create({
  blockSpecs: BLOQUES_QUE_SE_PUEDEN_GUARDAR,
});

/**
 * 🔴 UN BLOQUE QUE EL ESQUEMA NO CONOCE TUMBA LA APP ENTERA, NO LA NOTA.
 *
 * `useCreateBlockNote` construye el editor **durante el render** y su
 * constructor mapea `initialContent` con `blockToNode`, que lanza
 * `node type <x> not found in schema`. En `src/` no hay ningún ErrorBoundary
 * (verificado: cero `componentDidCatch`), así que ese throw no deja «la nota no
 * abre»: deja **la ventana en blanco**, y de nuevo cada vez que se toque esa
 * página.
 *
 * Y el caso no es hipotético aunque la tabla haya arrancado en cero. N4
 * despliega el front sin reiniciar nada, así que hay app abiertas con el bundle
 * VIEJO —el que sí ofrece «Image» en el `/` y deja pegar una URL— escribiendo
 * mientras tanto. Una página con texto + imagen aplana a texto no vacío, pasa
 * `validarTexto`, y el bloque `image` queda guardado en el `jsonb`.
 *
 * Apoyar la seguridad en «hoy no hay documentos así» era apoyarla en una
 * afirmación sobre datos de producción que este repo no puede verificar. Acá se
 * verifica el dato, que es lo que sí se puede.
 *
 * Se DESCARTA el bloque en vez de convertirlo a texto: su URL vive en `props`,
 * y el server nunca la indexó, así que no hay nada que rescatar sin inventar.
 * Lo que había alrededor —que es lo que la vendedora escribió— se conserva.
 */
const TIPOS_CONOCIDOS = new Set(Object.keys(BLOQUES_QUE_SE_PUEDEN_GUARDAR));

export function soloBloquesConocidos(doc: unknown[]): unknown[] {
  return doc.filter((b) => {
    const tipo = (b as { type?: unknown } | null)?.type;
    // Sin `type` BlockNote asume `paragraph`, que sí existe: se deja pasar.
    return typeof tipo !== 'string' || TIPOS_CONOCIDOS.has(tipo);
  });
}

/**
 * EL DICCIONARIO — la locale `es` que trae el paquete, con el castellano
 * peninsular pisado.
 *
 * La locale oficial dice «Escribe o teclea '/' para comandos» y Hermes escribe
 * en voseo en toda la app («Anotá lo que quieras», «Elegí una página»,
 * «Escribir la primera»). Dejar el default metería una segunda voz adentro del
 * único lugar donde la vendedora escribe.
 *
 * Se pisa lo que se VE seguido y en imperativo. No se traduce el paquete
 * entero: lo que no está acá queda en la locale `es`, que es correcta aunque
 * suene de España, y eso es mucho mejor que quedar en inglés.
 */
export const DICCIONARIO_LIBRETA = {
  ...es,
  placeholders: {
    ...es.placeholders,
    default: "Escribí, o poné '/' para los comandos",
    heading: 'Título',
    bulletListItem: 'Lista',
    numberedListItem: 'Lista',
    checkListItem: 'Tarea',
  },
  slash_menu: {
    ...es.slash_menu,
    heading: { ...es.slash_menu.heading, subtext: 'Título de sección' },
    bullet_list: { ...es.slash_menu.bullet_list, subtext: 'Lista con viñetas' },
    numbered_list: { ...es.slash_menu.numbered_list, subtext: 'Lista numerada' },
    check_list: { ...es.slash_menu.check_list, subtext: 'Lista para ir tildando' },
    paragraph: { ...es.slash_menu.paragraph, subtext: 'Texto común' },
    table: { ...es.slash_menu.table, subtext: 'Una tabla' },
  },
} as const;
