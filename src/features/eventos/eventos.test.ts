import { describe, expect, test } from 'vitest';
import {
  CATALOGO_EVENTOS,
  TIPOS_EVENTO,
  TOPE_NOTA,
  esMio,
  esTipoConocido,
  motivoParaNoRegistrar,
  nombreCortoVendedora,
  rotuloDeTipo,
} from './eventos';

describe('rotuloDeTipo — el tipo que este build no conoce', () => {
  // El caso que importa: el vocabulario crece del lado del server y los dos se
  // despliegan por separado. Un `switch` adentro de un componente no se puede
  // interrogar sobre esto.
  test('lo muestra tal cual, legible', () => {
    expect(rotuloDeTipo('pidio_factura')).toBe('Pidio factura');
  });

  test('NUNCA lo confunde con un tipo conocido', () => {
    const conocidos = TIPOS_EVENTO.map((t) => CATALOGO_EVENTOS[t].rotulo);
    expect(conocidos).not.toContain(rotuloDeTipo('pidio_factura'));
  });

  test('no tira con un tipo vacío', () => {
    expect(rotuloDeTipo('')).toBe('Evento');
    expect(rotuloDeTipo('   ')).toBe('Evento');
  });

  test('los conocidos salen del catálogo', () => {
    expect(rotuloDeTipo('objecion')).toBe('Objeción');
    expect(esTipoConocido('objecion')).toBe(true);
    expect(esTipoConocido('pidio_factura')).toBe(false);
  });
});

describe('motivoParaNoRegistrar — la MISMA regla que consultan el botón y el submit', () => {
  const vacio = { tipo: null, curso: '', nota: '' };

  test('sin tipo no hay evento, y lo dice en criollo', () => {
    expect(motivoParaNoRegistrar(vacio)).toBe('Elegí qué pasó');
  });

  test('«Preguntó por un curso» sin curso: el curso ES el dato', () => {
    expect(motivoParaNoRegistrar({ tipo: 'pregunto_curso', curso: '', nota: 'algo' })).toMatch(
      /curso/i,
    );
  });

  test('con el curso puesto, ya se puede — la nota es opcional ahí', () => {
    expect(
      motivoParaNoRegistrar({ tipo: 'pregunto_curso', curso: 'Gestión Pública', nota: '' }),
    ).toBeNull();
  });

  test('«Objeción» sin texto no es un evento: el tipo solo no dice nada', () => {
    expect(motivoParaNoRegistrar({ tipo: 'objecion', curso: '', nota: '' })).toMatch(/qué pasó/i);
    expect(motivoParaNoRegistrar({ tipo: 'objecion', curso: '', nota: '   ' })).toMatch(/qué pasó/i);
  });

  test('«Pidió precio» pasa sin nada más: existir ya afirma algo', () => {
    expect(motivoParaNoRegistrar({ tipo: 'pidio_precio', curso: '', nota: '' })).toBeNull();
  });

  test('pasarse del tope dice CUÁNTO, no «se rompió algo»', () => {
    const motivo = motivoParaNoRegistrar({
      tipo: 'otro',
      curso: '',
      nota: 'x'.repeat(TOPE_NOTA + 12),
    });
    expect(motivo).toBe('Te pasaste 12 caracteres');
  });

  test('a un tipo DESCONOCIDO no se le inventa una regla', () => {
    // Ni exigirle nota ni perdonársela: no sabemos qué afirma. Que el server
    // decida — acá lo que no se puede hacer es bloquear algo válido.
    expect(motivoParaNoRegistrar({ tipo: 'pidio_factura', curso: '', nota: '' })).toBeNull();
  });
});

describe('esMio — 🔴 normaliza los DOS lados', () => {
  // Cerberus empuja `Luz`, ella entra tipeando `luz`. Con comparación exacta
  // esto no da un error visible: da que Luz no ve los botones de sus propios
  // eventos, y eso se lee como «no se puede editar», no como un bug.
  test('la misma persona con dos grafías es la misma persona', () => {
    expect(esMio({ vendedoraId: 'Luz' }, 'luz')).toBe(true);
    expect(esMio({ vendedoraId: 'luz' }, 'Luz')).toBe(true);
    expect(esMio({ vendedoraId: ' Luz ' }, 'luz')).toBe(true);
  });

  test('dos personas distintas siguen siendo distintas', () => {
    expect(esMio({ vendedoraId: 'ventas10@grupogoberna.com' }, 'ventas11@grupogoberna.com')).toBe(
      false,
    );
  });

  test('sin sesión NO es tuyo — se degrada a no dibujar botones, nunca al revés', () => {
    expect(esMio({ vendedoraId: 'luz' }, null)).toBe(false);
    expect(esMio({ vendedoraId: 'luz' }, undefined)).toBe(false);
    expect(esMio({ vendedoraId: 'luz' }, '')).toBe(false);
  });

  test('un vendedoraId vacío no matchea con una sesión vacía', () => {
    expect(esMio({ vendedoraId: '' }, '  ')).toBe(false);
  });
});

describe('nombreCortoVendedora', () => {
  test('las nuevas son el correo completo y se cortan en el @', () => {
    expect(nombreCortoVendedora('ventas10@grupogoberna.com')).toBe('Ventas10');
  });

  test('las viejas son cortas y solo se capitalizan', () => {
    expect(nombreCortoVendedora('luz')).toBe('Luz');
    expect(nombreCortoVendedora('Usuario1')).toBe('Usuario1');
  });

  test('nunca devuelve vacío', () => {
    expect(nombreCortoVendedora('@grupogoberna.com')).toBe('@grupogoberna.com');
  });
});
