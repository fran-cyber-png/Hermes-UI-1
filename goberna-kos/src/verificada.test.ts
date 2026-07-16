import { describe, it, expect } from 'vitest';
import { estaVerificada, soloVerificadas, motivoDeCuarentena } from './verificada.js';
import type { CompetencyQuestion } from './types.js';

/**
 * Estos tests protegen la puerta por la que una falsedad puede llegar a los pesos de un modelo.
 *
 * `lora-producer.ts` convierte `expectedAnswer` en el `output` de un dataset de entrenamiento.
 * Hasta 2026-07-16 el filtro dejaba salir cualquier CQ `active`, y las 105 estaban `active` sin
 * que ninguna se hubiera contrastado contra el código. Entre ellas, la que afirmaba que los
 * estados de venta eran "4=en_curso, 5=retirado, 7=anulado" — el mapa que decide qué ventas ve
 * Meta. Todos los mapeos estaban mal.
 *
 * Lo único que impidió entrenar sobre eso fue un conflicto de dependencias de torch. Estos tests
 * son lo que lo impide ahora.
 */

function cq(over: Partial<CompetencyQuestion> = {}): CompetencyQuestion {
  return {
    id: 'cq-prueba-001',
    slug: 'prueba',
    text: '¿Una pregunta?',
    expectedAnswer: 'Una respuesta.',
    answerFormat: 'value',
    type: 'definition',
    capabilityId: 'cap-prueba',
    complexity: 'simple',
    requiresEntities: [],
    requiresRelations: [],
    requiresRules: [],
    requiresWorkflows: [],
    requiresConcepts: [],
    confidence: 0.9,
    priority: 'medium',
    status: 'draft',
    source: 'domain_analysis',
    createdAt: '2026-07-16T00:00:00Z',
    version: 1,
    contentHash: 'abc',
    ...over,
  };
}

describe('estaVerificada — el default está invertido a propósito', () => {
  it("una CQ 'active' NO sale: era el agujero por el que salían las 105 sin verificar", () => {
    expect(estaVerificada(cq({ status: 'active' }))).toBe(false);
  });

  it("'active' + validatedAt tampoco sale: el status tiene que decir validated", () => {
    expect(estaVerificada(cq({ status: 'active', validatedAt: '2026-07-16T00:00:00Z' }))).toBe(
      false,
    );
  });

  it("'validated' SIN validatedAt no sale: la etiqueta sola no es evidencia", () => {
    // Se exigen los dos para que un find/replace descuidado sobre el JSON no reabra la puerta.
    expect(estaVerificada(cq({ status: 'validated' }))).toBe(false);
  });

  it("'validated' + validatedAt sale", () => {
    expect(estaVerificada(cq({ status: 'validated', validatedAt: '2026-07-16T00:00:00Z' }))).toBe(
      true,
    );
  });

  it('draft y deprecated no salen', () => {
    expect(estaVerificada(cq({ status: 'draft' }))).toBe(false);
    expect(estaVerificada(cq({ status: 'deprecated', validatedAt: '2026-07-16T00:00:00Z' }))).toBe(
      false,
    );
  });

  it('una confianza alta NO alcanza: cq-ventas-002 tenía 0.98 y era falsa', () => {
    expect(estaVerificada(cq({ status: 'active', confidence: 0.99, priority: 'critical' }))).toBe(
      false,
    );
  });
});

describe('soloVerificadas — el filtro que usan los producers', () => {
  it('deja pasar solo las verificadas', () => {
    const lista = [
      cq({ id: 'a', status: 'active' }),
      cq({ id: 'b', status: 'validated', validatedAt: '2026-07-16T00:00:00Z' }),
      cq({ id: 'c', status: 'draft' }),
    ];
    expect(soloVerificadas(lista).map((q) => q.id)).toEqual(['b']);
  });

  it('un catálogo entero sin verificar exporta CERO, no todo', () => {
    // El estado real del registro el 2026-07-16: 105 CQs, ninguna verificada.
    const registro = Array.from({ length: 105 }, (_, i) =>
      cq({ id: `cq-${i}`, status: 'active' }),
    );
    expect(soloVerificadas(registro)).toHaveLength(0);
  });
});

describe('motivoDeCuarentena — un filtro silencioso miente', () => {
  it('una verificada no tiene motivo', () => {
    expect(motivoDeCuarentena(cq({ status: 'validated', validatedAt: '2026-07-16T00:00:00Z' })))
      .toBeNull();
  });

  it('sin answeredBy dice que le falta la Tool', () => {
    expect(motivoDeCuarentena(cq({ status: 'draft' }))).toMatch(/answeredBy/);
  });

  it('con Tool pero sin verificar dice que falta validatedAt', () => {
    expect(motivoDeCuarentena(cq({ status: 'draft', answeredBy: 'governa.ventas.estados' })))
      .toMatch(/validatedAt/);
  });

  it('con Tool y validatedAt pero status raro, dice cuál es el status', () => {
    const q = cq({
      status: 'deprecated',
      answeredBy: 'governa.ventas.estados',
      validatedAt: '2026-07-16T00:00:00Z',
    });
    expect(motivoDeCuarentena(q)).toMatch(/deprecated/);
  });
});
