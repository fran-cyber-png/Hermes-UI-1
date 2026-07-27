import { describe, expect, test } from 'vitest';
import { familiaDeProducto } from './producto';

/**
 * Los nombres de esta suite son LITERALES del catálogo vivo de Cerberus y de la
 * base de leads de producción (medidos el 25-jul-2026, ver el PR): 111 productos
 * activos que son 38 familias con ediciones, y 26.075 leads cuyo curso viaja en
 * `campaign_name`. No son ejemplos inventados — es lo que le va a llegar.
 */

describe('familiaDeProducto — el nombre corto que entra en una fila de 360 px', () => {
  test('saca el calificativo de adelante y la edición de atrás', () => {
    const r = familiaDeProducto('DIPICOT014', 'Diploma de Especialización en Inteligencia y Contrainteligencia 14');
    expect(r.nombreCorto).toBe('Inteligencia y Contrainteligencia');
    expect(r.edicion).toBe(14);
  });

  test('las tres variantes de nombre de DIPICOT son la MISMA familia', () => {
    const a = familiaDeProducto('DIPICOT011', 'Diploma de Especialización en Inteligencia y Contrainteligencia 11');
    const b = familiaDeProducto('DIPICOT014', 'Diploma Internacional de Inteligencia y Contrainteligencia');
    const c = familiaDeProducto('DIPICOT026', 'diploma internacional de inteligencia y contrainteligencia 26');
    expect(a.familia).toBe('DIPICOT');
    expect(b.familia).toBe('DIPICOT');
    expect(c.familia).toBe('DIPICOT');
  });

  test('los SKU genéricos GEN* NO se colapsan en una sola familia', () => {
    const a = familiaDeProducto('GEN9000F6', 'Pago de matrícula');
    const b = familiaDeProducto('GEN5C2G3', 'Otro pago suelto');
    expect(a.familia).not.toBe(b.familia);
  });

  // Los tres GEN* reales del catálogo (26-jul-2026): Bicameral, Cartografía
  // Electoral y Dirección Corporativa de Seguridad. Son cursos sin nada que ver
  // entre sí; si el prefijo volviera a ser la familia, el chip los pintaría
  // iguales y el Dashboard los sumaría en una fila que no existe.
  test('Bicameral, Cartografía y Dirección Corporativa no comparten familia', () => {
    const familias = [
      familiaDeProducto('GEN5C4BE8', 'Diploma de especialización Bicameral 1').familia,
      familiaDeProducto('GEN15527B', 'Diploma intensivo de Cartografía Electoral 1').familia,
      familiaDeProducto('GENCDE6AE', 'Diploma Élite Internacional En Dirección Corporativa De Seguridad')
        .familia,
    ];
    expect(new Set(familias).size).toBe(3);
    expect(familias).not.toContain('GEN');
  });

  // `DIPICOT003-6B5D` y `DIPCOCO002-BFA8` existen en el catálogo vivo: Cerberus
  // le pegó un sufijo al SKU para desambiguar dos filas del mismo producto.
  test('un SKU con sufijo de desambiguación sigue siendo de su familia', () => {
    expect(familiaDeProducto('DIPICOT003-6B5D', 'Diploma de Inteligencia y Contrainteligencia 3').familia).toBe(
      'DIPICOT',
    );
    expect(familiaDeProducto('DIPCOCO002-BFA8', 'Diploma de Contraterrorismo 2').familia).toBe('DIPCOCO');
  });

  test('un producto sin número de edición no se inventa una', () => {
    const r = familiaDeProducto('DIPCPOL025', 'Diploma Internacional del Consultor Político');
    expect(r.nombreCorto).toBe('Consultor Político');
    expect(r.edicion).toBeNull();
  });

  test('sin SKU (el caso de la cola: solo el nombre) la familia sale del nombre, sin acentos ni mayúsculas', () => {
    const a = familiaDeProducto(null, 'Diploma de Especialización en Inteligencia y Contrainteligencia 14');
    const b = familiaDeProducto(null, 'diploma internacional de inteligencia y contrainteligencia');
    expect(a.familia).toBe(b.familia);
    expect(a.familia).toBe('INTELIGENCIAYCONTRAINTELIGENCIA');
  });

  test('nombres reales de leads y campañas de producción', () => {
    const casos: [string, string][] = [
      ['Diploma Técnico de Gestión Parlamentaria Bicameral', 'Gestión Parlamentaria Bicameral'],
      ['Diploma Élite del Gestor Parlamentario', 'Gestor Parlamentario'],
      ['Diploma en Operaciones Clandestinas de Inteligencia', 'Operaciones Clandestinas de Inteligencia'],
      ['Curso de especialización en Estrategia Territorial en campañas electorales', 'Estrategia Territorial en campañas electorales'],
      ['Diploma técnico en Osint & Socmint', 'Osint & Socmint'],
      ['Diploma Élite Internacional de Director de Seguridad Corporativo', 'Director de Seguridad Corporativo'],
      // El título de una campaña de Click-to-WhatsApp: no empieza con calificativo, no se toca.
      ['Inteligencia Estratégica', 'Inteligencia Estratégica'],
    ];
    for (const [entrada, esperado] of casos) {
      expect(familiaDeProducto(null, entrada).nombreCorto, entrada).toBe(esperado);
    }
  });

  test('si el nombre es SOLO calificativos no se devuelve vacío: gana el original', () => {
    expect(familiaDeProducto(null, 'Diploma Internacional').nombreCorto).toBe('Diploma Internacional');
    expect(familiaDeProducto(null, '   ').nombreCorto).toBe('');
  });

  test('un año al final no es una edición', () => {
    const r = familiaDeProducto(null, 'I FORO DE ESTADO 2026');
    expect(r.edicion).toBeNull();
    expect(r.nombreCorto).toBe('I FORO DE ESTADO 2026');
  });
});
