import { describe, expect, it } from 'vitest';
import { personaEsTelefono, telefonoDe } from './canal';
import { quiereFoto } from './fotoVisible';

/**
 * ══ LAS TRES PREGUNTAS QUE `canal === 'whatsapp'` RESPONDÍA A LA VEZ ════════
 *
 * El defecto que fija este archivo (11-ago-2026): la ficha de un lead de
 * formulario salía vacía —«Sin ficha · este canal no lo trae»— **al lado de su
 * propio número**, y sin su correo, que es el insumo para cotizarle. La causa no
 * era un dato que faltara: el endpoint `/api/contactos/lead` devolvía nombre,
 * email, campaña y fecha. Era que el front no lo pedía, porque preguntaba
 * «¿es WhatsApp?» donde quería saber «¿hay teléfono?».
 */
describe('personaEsTelefono — ¿el persona_id es un número?', () => {
  it('whatsapp sí: ahí el persona_id ES el teléfono', () => {
    expect(personaEsTelefono('whatsapp')).toBe(true);
  });

  it('🔴 landing TAMBIÉN: `cola/leadsCte.ts` emite el teléfono como persona_id', () => {
    expect(personaEsTelefono('landing')).toBe(true);
  });

  it('los canales de Meta no: ahí el persona_id es un id, no un número', () => {
    expect(personaEsTelefono('facebook')).toBe(false);
    expect(personaEsTelefono('instagram')).toBe(false);
  });

  it('un canal que el front todavía no conoce cae en false, que es el lado seguro', () => {
    expect(personaEsTelefono('telegram')).toBe(false);
    expect(personaEsTelefono('')).toBe(false);
  });
});

describe('🔴 la foto es OTRA pregunta, y no se colapsa con ésta', () => {
  /**
   * Pedirle a WhatsApp la foto de perfil de alguien a quien **nunca le
   * escribimos** es justo lo que #59 evita. Un lead de landing tiene teléfono y
   * no tiene hilo: se le busca la ficha, no la foto. Si algún día alguien
   * "simplifica" las dos en una sola función, este test se pone rojo.
   */
  it('landing tiene teléfono y NO pide foto', () => {
    expect(personaEsTelefono('landing')).toBe(true);
    expect(quiereFoto('landing')).toBe(false);
  });

  it('whatsapp es el único que pide foto', () => {
    expect(quiereFoto('whatsapp')).toBe(true);
    expect(quiereFoto('facebook')).toBe(false);
  });
});

describe('telefonoDe', () => {
  it('devuelve el número en los canales que lo traen', () => {
    expect(telefonoDe({ canal: 'landing', persona_id: '51987654321' })).toBe('51987654321');
    expect(telefonoDe({ canal: 'whatsapp', persona_id: '51987654321' })).toBe('51987654321');
  });

  it('null donde el persona_id no es un número — nunca el id de Meta como si lo fuera', () => {
    expect(telefonoDe({ canal: 'instagram', persona_id: '17841400000000000' })).toBe(null);
  });
});
