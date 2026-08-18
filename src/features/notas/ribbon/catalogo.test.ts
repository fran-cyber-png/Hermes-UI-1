import { expect, test } from 'vitest';
import { BLOQUES_RETIRADOS, ESQUEMA_LIBRETA } from '../editor';
import { ACCESO_RAPIDO, TABS, gruposDe, todosLosComandos, type Comando } from './catalogo';
import { ICONOS } from './iconos';

/**
 * EL CANDADO DE «NO FINGIR».
 *
 * Una Ribbon tiene lugar para cinco pestañas y ~40 cajas, y la mayoría de las
 * que Word pone ahí **no existen en la Libreta**. La tentación es dibujarlas
 * igual para que se vea completa; el resultado sería una barra donde probar un
 * botón no enseña nada, porque el que no anda se ve idéntico al que anda.
 *
 * El tipo de `EstadoComando` hace que apagar una caja **sin decir por qué** no
 * compile. Lo que este archivo cubre es lo que el tipo no puede: que nadie lo
 * evada, que los ids no choquen, y —lo más importante— que **lo que se ofrece
 * en «Insertar» sea exactamente lo que el esquema tiene**.
 */

const TODOS = todosLosComandos();

test('ningún comando apagado se queda sin motivo', () => {
  // El tipo ya lo garantiza; esto atrapa el `as` que lo evada, que es la única
  // forma de que entre uno mudo.
  for (const c of TODOS) {
    if (c.estado.tipo === 'futuro') {
      expect(c.estado.motivo, `«${c.etiqueta}» está apagado y no dice por qué`).toBeTruthy();
    }
  }
});

test('los ids no se repiten en ninguna parte', () => {
  const ids = TODOS.map((c) => c.id);
  expect(new Set(ids).size, `hay ids repetidos: ${ids.filter((id, i) => ids.indexOf(id) !== i)}`).toBe(ids.length);
});

test('cada comando tiene un ícono que existe de verdad', () => {
  // Sin esto, un nombre mal escrito dibuja un hueco: `ICONOS[nombre]` sería
  // `undefined` y React no renderiza nada, sin un solo error.
  for (const c of TODOS) {
    expect(ICONOS[c.icono], `«${c.etiqueta}» pide el ícono «${c.icono}», que no está`).toBeTruthy();
  }
});

test('los grupos declaran una prioridad, y el corte cae adentro de la lista', () => {
  for (const t of TABS) {
    for (const g of gruposDe(t.id)) {
      expect([1, 2]).toContain(g.prioridad);
      expect(g.comandos.length).toBeGreaterThan(0);
      if (g.corte !== undefined) {
        // Un corte fuera de rango deja una fila vacía o se come la segunda: en
        // los dos casos el grupo se dibuja mal y nadie lo nota hasta mirarlo.
        expect(g.corte).toBeGreaterThan(0);
        expect(g.corte).toBeLessThan(g.comandos.length);
      }
    }
  }
});

/**
 * 🔴 EL QUE IMPORTA: «INSERTAR» SE DERIVA DEL ESQUEMA, NO DE UNA LISTA.
 *
 * `editor.ts` sacó imagen, video, audio y archivo a propósito (sin `uploadFile`,
 * una página que sea sólo un adjunto aplana a cadena vacía y el server la
 * rechaza). Si el catálogo escribiera esa lista a mano, el día que los adjuntos
 * existan de verdad el esquema los volvería a traer y estas cuatro cajas
 * seguirían apagadas — sin error y sin test rojo.
 */
test('lo que «Insertar» ofrece es exactamente lo que el esquema tiene', () => {
  const bloques: Record<string, string> = {
    insertarTabla: 'table',
    insertarCita: 'quote',
    insertarCodigo: 'codeBlock',
    insertarSeparador: 'divider',
    insertarTareas: 'checkListItem',
    insertarDesplegable: 'toggleListItem',
    insertarImagen: 'image',
    insertarVideo: 'video',
    insertarAudio: 'audio',
    insertarArchivo: 'file',
  };

  const porId = new Map(gruposDe('insertar').flatMap((g) => g.comandos.map((c): [string, Comando] => [c.id, c])));

  for (const [id, tipo] of Object.entries(bloques)) {
    const comando = porId.get(id);
    expect(comando, `falta el comando ${id}`).toBeTruthy();
    const enElEsquema = tipo in ESQUEMA_LIBRETA.blockSchema;
    expect(
      comando!.estado.tipo === 'real',
      `«${comando!.etiqueta}» dice ${comando!.estado.tipo} y el bloque «${tipo}» ${enElEsquema ? 'SÍ' : 'no'} está en el esquema`,
    ).toBe(enElEsquema);
  }

  // Y los cuatro retirados tienen que estar todos representados: si mañana se
  // retira un quinto bloque y nadie le hace su caja, la Ribbon lo ofrecería.
  for (const tipo of BLOQUES_RETIRADOS) {
    expect(Object.values(bloques), `el bloque retirado «${tipo}» no tiene caja en Insertar`).toContain(tipo);
  }
});

/**
 * NO SE PERDIÓ NINGÚN CONTROL AL PASAR DE LA BARRA A LA RIBBON.
 *
 * La barra vieja tenía quince controles y la migración es a mano, un `Record`
 * por id: olvidarse de uno no rompe nada, sólo lo deja afuera. Esta es la lista
 * de lo que había, escrita una vez, para que la próxima reorganización de las
 * pestañas tampoco se coma ninguno.
 */
test('los quince controles de la barra anterior siguen estando', () => {
  const DE_LA_BARRA_VIEJA = [
    'deshacer',
    'rehacer',
    'masEstilos', // era el `BlockTypeSelect` suelto
    'fuente',
    'tamano',
    'negrita',
    'cursiva',
    'subrayado',
    'tachado',
    'codigo',
    'colores',
    'alinearIzquierda',
    'centrar',
    'alinearDerecha',
    'reducirSangria',
    'aumentarSangria',
    'enlace',
    'limpiarFormato',
  ];
  const ids = new Set(TODOS.map((c) => c.id));
  for (const id of DE_LA_BARRA_VIEJA) {
    expect(ids.has(id), `«${id}» estaba en la barra y no está en ninguna pestaña`).toBe(true);
  }
});

test('deshacer y rehacer no viven en ninguna pestaña', () => {
  // Van en la fila de las pestañas justamente para que no desaparezcan al pasar
  // a «Insertar», que es cuando más se buscan.
  const enPestanas = TABS.flatMap((t) => gruposDe(t.id).flatMap((g) => g.comandos.map((c) => c.id)));
  for (const c of ACCESO_RAPIDO) {
    expect(enPestanas).not.toContain(c.id);
  }
});
