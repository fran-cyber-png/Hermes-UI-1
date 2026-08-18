import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  armarSobre,
  componerCuerpo,
  correoDeVendedora,
  sinSaltos,
  type Remitente,
} from './remitente.js';

/**
 * EL SOBRE, INTERROGADO SOBRE LO QUE LA PANTALLA PROMETÍA Y NO PASABA.
 *
 * Puro: no hace falta base ni SMTP para preguntar de quién sale un correo. Los
 * casos que importan no son los lindos —ésos ya andaban en la cabeza de quien
 * escribió el módulo— sino los tres que rompen una cabecera sin que nadie vea un
 * error: el nombre con comillas, el nombre con barra invertida y el salto de
 * línea metido desde la caja de texto.
 */

/** El remitente que existe hoy: el único buzón verificado en SES que se usa. */
const escuela: Remitente = {
  id: 1,
  direccion: 'escuela@goberna.us',
  nombre: 'Escuela Goberna',
  responderA: 'escuela@goberna.us',
  firma: null,
};

describe('¿el vendedora_id es además un buzón?', () => {
  test('los ids que SON correos vuelven tal cual', () => {
    assert.equal(correoDeVendedora('ventas10@grupogoberna.com'), 'ventas10@grupogoberna.com');
    assert.equal(correoDeVendedora('ventas11@grupogoberna.com'), 'ventas11@grupogoberna.com');
    assert.equal(correoDeVendedora('ventas12@grupogoberna.com'), 'ventas12@grupogoberna.com');
  });

  test('los ids que NO son correos dan null — son seis de las nueve', () => {
    // Hermes no tiene tabla de personas: el `vendedora_id` es texto libre y en
    // producción convive con estas formas. Ninguna es un buzón, y forzarlas a
    // serlo pondría un `Reply-To` inventado.
    assert.equal(correoDeVendedora('luz'), null);
    assert.equal(correoDeVendedora('alan'), null);
    assert.equal(correoDeVendedora('Sindy'), null);
    assert.equal(correoDeVendedora('Usuario1'), null);
  });

  test('🔴 un id con prefijo de sistema NO es un correo, ni con arroba adentro', () => {
    // Los ids con `centurion:` existen en producción. Sin la guarda de los dos
    // puntos, `centurion:betto@goberna.us` se colaría al `Reply-To` como una
    // dirección con un carácter que ningún MTA acepta sin comillas: el correo
    // sale igual y la respuesta del lead rebota, que es el peor final —nadie
    // mira los rebotes de un buzón que no lee nadie.
    assert.equal(correoDeVendedora('centurion:betto.romero'), null);
    assert.equal(correoDeVendedora('centurion:betto@goberna.us'), null);
  });

  test('🔴 una cadena con DOS direcciones no es una dirección', () => {
    // Mismo defecto que `leerDestinatario` atrapa del otro lado del sobre: acá
    // serían dos `Reply-To`, o sea la respuesta del lead copiada a un tercero.
    assert.equal(correoDeVendedora('a@b.com, c@d.com'), null);
    assert.equal(correoDeVendedora('a@b.com; c@d.com'), null);
    assert.equal(correoDeVendedora('Luz <luz@goberna.us>'), null);
  });

  test('sin dominio con punto tampoco: `algo@localhost` no es un buzón al que contestarle', () => {
    assert.equal(correoDeVendedora('luz@localhost'), null);
    assert.equal(correoDeVendedora('@goberna.us'), null);
    assert.equal(correoDeVendedora('luz@'), null);
    assert.equal(correoDeVendedora(''), null);
    assert.equal(correoDeVendedora('   '), null);
  });

  test('se recorta, pero NO se baja a minúsculas: la grafía es del buzón, no nuestra', () => {
    // Misma regla que el reparto con `Luz`: se compara normalizando los dos
    // lados (el índice `remitentes_correo_direccion_uq` usa `lower()`), pero lo
    // que se GUARDA y lo que se manda es lo que vino. El local part es
    // técnicamente sensible a mayúsculas y reescribirlo es decidir por otro.
    assert.equal(correoDeVendedora('  ventas10@grupogoberna.com  '), 'ventas10@grupogoberna.com');
    assert.equal(correoDeVendedora('Ventas10@GrupoGoberna.com'), 'Ventas10@GrupoGoberna.com');
  });

  test('un salto de línea adentro del id no se cuela al Reply-To', () => {
    assert.equal(correoDeVendedora('ventas10@grupogoberna.com\r\nBcc: otro@ajeno.com'), null);
  });
});

describe('sinSaltos — una cabecera es UNA línea', () => {
  test('🔴 los tres saltos, por separado: \\r, \\n y la combinación de los dos', () => {
    // Se prueban los tres sueltos porque el que se olvida siempre es el `\r`
    // solo: en un pegado desde Word o desde un Mac viejo viene sin `\n` detrás,
    // y un regex escrito como `/\n/` lo deja pasar entero.
    assert.equal(sinSaltos('Foro de Estado\rAgosto'), 'Foro de Estado Agosto');
    assert.equal(sinSaltos('Foro de Estado\nAgosto'), 'Foro de Estado Agosto');
    assert.equal(sinSaltos('Foro de Estado\r\nAgosto'), 'Foro de Estado Agosto');
  });

  test('🔴 el Bcc que se agrega desde la caja de asunto queda en una sola línea', () => {
    // Éste es el agujero completo, escrito como lo escribiría quien lo explota:
    // el `\r\n` cierra la cabecera `Subject:` y lo que sigue viaja como cabecera
    // propia. Después de `sinSaltos` no hay dónde empezar la segunda.
    const atacado = sinSaltos('Tu diploma\r\nBcc: quien-yo-quiera@ajeno.com');
    assert.equal(atacado, 'Tu diploma Bcc: quien-yo-quiera@ajeno.com');
    assert.doesNotMatch(atacado, /[\r\n]/);
  });

  test('reemplaza por un espacio, no borra: las palabras no se pegan', () => {
    // Borrarlos daría «Foro de Estado2026», que llega al lead como un asunto mal
    // escrito y no se puede explicar mirando la pantalla, donde se veía bien.
    assert.equal(sinSaltos('Foro de Estado\n2026'), 'Foro de Estado 2026');
  });

  test('una corrida de saltos colapsa en UN espacio', () => {
    assert.equal(sinSaltos('Hola\n\n\nLuz'), 'Hola Luz');
    assert.equal(sinSaltos('Hola\r\n\r\nLuz'), 'Hola Luz');
  });

  test('recorta los bordes: un espacio al principio de una cabecera es folding whitespace', () => {
    assert.equal(sinSaltos('\n  Tu diploma  \n'), 'Tu diploma');
    assert.equal(sinSaltos('\r\n'), '');
  });

  test('los separadores de línea de Unicode también se limpian, aunque NO inyecten', () => {
    // Decisión escrita: U+2028, U+2029, NEL, tabulación vertical y form feed no
    // contienen los bytes 0x0D/0x0A, así que SMTP los ve como texto y no pueden
    // abrir una cabecera. Se limpian igual para que la regla sea una sola —«una
    // cabecera es una línea»— y porque varios clientes los DIBUJAN como un salto:
    // un remitente partido en dos renglones se lee como un correo mal armado.
    assert.equal(sinSaltos('Luz\u2028Rodríguez'), 'Luz Rodríguez'); // LINE SEPARATOR
    assert.equal(sinSaltos('Luz\u2029Rodríguez'), 'Luz Rodríguez'); // PARAGRAPH SEPARATOR
    assert.equal(sinSaltos('Luz\u0085Rodríguez'), 'Luz Rodríguez'); // NEL
    assert.equal(sinSaltos('Luz\u000bRodríguez'), 'Luz Rodríguez'); // tabulación vertical
    assert.equal(sinSaltos('Luz\u000cRodríguez'), 'Luz Rodríguez'); // form feed
  });

  test('lo que ya es una línea no se toca', () => {
    assert.equal(sinSaltos('Escuela Goberna'), 'Escuela Goberna');
    assert.equal(sinSaltos('Foro de Estado · 5 de agosto'), 'Foro de Estado · 5 de agosto');
  });
});

describe('armarSobre — quién escribe y a dónde le contestan', () => {
  test('el From lleva el nombre de la vendedora y la dirección verificada', () => {
    // Ésta es la frase «con tu nombre» de la pantalla, vuelta cierta: hasta hoy
    // el From era `SMTP_FROM` y era el mismo para las nueve.
    const sobre = armarSobre(escuela, 'luz', 'Luz');
    assert.equal(sobre.from, '"Luz · Escuela Goberna" <escuela@goberna.us>');
  });

  test('sin correo propio, el Reply-To cae al del remitente', () => {
    assert.equal(armarSobre(escuela, 'luz', 'Luz').replyTo, 'escuela@goberna.us');
  });

  test('🔴 D2: el correo de la vendedora le GANA al responder_a del remitente', () => {
    // Decisión del dueño del 17-ago-2026. Al revés —el buzón compartido arriba—
    // la respuesta de un lead que trabajó Sindy le llega a todo el mundo y a
    // nadie en particular, que es el agujero que este frente vino a tapar.
    const sobre = armarSobre(escuela, 'ventas11@grupogoberna.com', 'Sindy');
    assert.equal(sobre.replyTo, 'ventas11@grupogoberna.com');
    // Y el From NO cambia: `grupogoberna.com` no está verificado en SES y ahí
    // sería un 554 con un lead esperando. SES verifica de dónde SALE, no a dónde
    // se CONTESTA — ésa es la rendija por la que entra toda esta decisión.
    assert.equal(sobre.from, '"Sindy · Escuela Goberna" <escuela@goberna.us>');
  });

  test('sin responder_a y sin correo propio, el Reply-To es null — no se inventa uno', () => {
    const sinBuzon: Remitente = { ...escuela, responderA: null };
    assert.equal(armarSobre(sinBuzon, 'luz', 'Luz').replyTo, null);
  });

  test('un responder_a en blanco es lo mismo que no tenerlo', () => {
    // La columna es opcional y un supervisor puede haber apretado espacio: un
    // `Reply-To: ` vacío es una cabecera rota, no un valor.
    assert.equal(armarSobre({ ...escuela, responderA: '   ' }, 'luz', 'Luz').replyTo, null);
    assert.equal(armarSobre({ ...escuela, responderA: '\r\n' }, 'luz', 'Luz').replyTo, null);
  });

  test('🔴 un nombre con comillas dobles queda ESCAPADO, no rompe la cabecera', () => {
    // Sin escapar, la comilla del nombre cierra el display name antes de tiempo y
    // el resto del texto queda afuera de las comillas: la dirección se cae del
    // sobre y el correo no sale, o peor, sale a otra parte.
    const sobre = armarSobre({ ...escuela, nombre: 'Escuela "Goberna"' }, 'luz', 'Luz');
    assert.equal(sobre.from, '"Luz · Escuela \\"Goberna\\"" <escuela@goberna.us>');
  });

  test('🔴 una barra invertida al final del nombre tampoco escapa la comilla de cierre', () => {
    // El caso que obliga a escapar `\` ANTES que `"`: adentro de un
    // quoted-string la barra es el carácter de escape, así que un nombre que
    // termina en `\` convertiría nuestra comilla de cierre en una comilla
    // literal. Es raro y es un campo de texto que llena una persona.
    const sobre = armarSobre(escuela, 'luz', 'Luz\\');
    assert.equal(sobre.from, '"Luz\\\\ · Escuela Goberna" <escuela@goberna.us>');
  });

  test('🔴 un salto de línea en cualquiera de los tres campos no abre una cabecera nueva', () => {
    const sobre = armarSobre(
      { ...escuela, nombre: 'Escuela\r\nBcc: ajeno@ajeno.com', direccion: 'escuela@goberna.us\n' },
      'luz',
      'Luz\nRodríguez',
    );
    assert.doesNotMatch(sobre.from, /[\r\n]/);
    assert.equal(sobre.from, '"Luz Rodríguez · Escuela Bcc: ajeno@ajeno.com" <escuela@goberna.us>');
  });

  test('sin nombre de vendedora no queda el separador huérfano', () => {
    // « · Escuela Goberna» se lee como un dato roto. Lo que falta acá es un
    // nombre, no la posibilidad de mandar el correo.
    assert.equal(armarSobre(escuela, 'luz', '').from, '"Escuela Goberna" <escuela@goberna.us>');
    assert.equal(armarSobre(escuela, 'luz', '   ').from, '"Escuela Goberna" <escuela@goberna.us>');
  });

  test('sin ningún nombre, la dirección sale sola: un display name vacío se ve como una falla', () => {
    const anonimo: Remitente = { ...escuela, nombre: '' };
    assert.equal(armarSobre(anonimo, 'luz', '').from, 'escuela@goberna.us');
  });

  test('un remitente que no es la Escuela arma su propio sobre', () => {
    // La tabla existe para esto: `goberna.us` está verificado como DOMINIO, así
    // que cualquier buzón de ahí puede ser remitente sin verificar nada más.
    const eventos: Remitente = {
      id: 2,
      direccion: 'eventos@goberna.us',
      nombre: 'Eventos Goberna',
      responderA: 'eventos@goberna.us',
      firma: null,
    };
    const sobre = armarSobre(eventos, 'ventas10@grupogoberna.com', 'Ana');
    assert.equal(sobre.from, '"Ana · Eventos Goberna" <eventos@goberna.us>');
    assert.equal(sobre.replyTo, 'ventas10@grupogoberna.com');
  });
});

describe('componerCuerpo — «con tu firma de siempre»', () => {
  const cuerpo = 'Hola Marta,\n\nTe paso el temario del diploma.';

  test('con firma: renglón en blanco, el separador de RFC 3676 y la firma', () => {
    const firma = 'Luz Rodríguez\nEscuela Goberna\n+51 984 429 504';
    assert.equal(componerCuerpo(cuerpo, firma), `${cuerpo}\n\n-- \n${firma}`);
  });

  test('⚠️ el separador conserva el espacio del final — sin él la firma se cita en cada respuesta', () => {
    const armado = componerCuerpo('Hola', 'Luz');
    const renglones = armado.split('\n');
    assert.equal(renglones[renglones.length - 2], '-- ');
  });

  test('sin firma, el cuerpo sale TAL CUAL: nada de un separador huérfano', () => {
    // Un `-- ` colgado al final de un correo sin firma es una firma vacía, y se
    // lee como si algo hubiera fallado del lado nuestro.
    assert.equal(componerCuerpo(cuerpo, null), cuerpo);
    assert.doesNotMatch(componerCuerpo(cuerpo, null), /--/);
  });

  test('una firma en blanco NO es una firma', () => {
    // La columna es opcional y alguien puede haber apretado espacio al darla de
    // alta: eso tiene que valer lo mismo que dejarla vacía.
    assert.equal(componerCuerpo(cuerpo, '   '), cuerpo);
    assert.equal(componerCuerpo(cuerpo, '\n\n'), cuerpo);
  });

  test('el renglón en blanco es exactamente UNO, aunque el cuerpo termine en tres Enter', () => {
    // Quien escribe siempre deja Enter de más; el correo no tiene por qué salir
    // con un agujero de cuatro renglones antes de la firma.
    assert.equal(componerCuerpo('Hola Marta\n\n\n\n', 'Luz'), 'Hola Marta\n\n-- \nLuz');
  });

  test('el cuerpo de adentro no se toca: los renglones en blanco del medio son del que escribió', () => {
    assert.match(componerCuerpo(cuerpo, 'Luz'), /Hola Marta,\n\nTe paso/);
  });

  test('la firma se recorta por los bordes y conserva su forma adentro', () => {
    assert.equal(componerCuerpo('Hola', '\n  Luz\n  Escuela Goberna  \n'), 'Hola\n\n-- \nLuz\n  Escuela Goberna');
  });
});
