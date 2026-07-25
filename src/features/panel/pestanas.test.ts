import { describe, expect, it } from 'vitest';
import { pestanaInicial, pestanasDe, type IdPestana } from './pestanas';

describe('las pestañas del panel derecho', () => {
  it('son siempre las cuatro, en el mismo orden, en cualquier canal', () => {
    for (const canal of ['whatsapp', 'facebook', 'instagram'] as const) {
      expect(pestanasDe({ canal, conTelefono: canal === 'whatsapp' }).map((p) => p.id)).toEqual([
        'ficha',
        'plantillas',
        'notas',
        'curso',
      ]);
    }
  });

  it('en Facebook, «Enviar» se apaga con su motivo — no desaparece', () => {
    const enviar = pestanasDe({ canal: 'facebook', conTelefono: false }).find((p) => p.id === 'plantillas')!;
    expect(enviar.disponible).toBe(false);
    expect(enviar.motivo).toMatch(/WhatsApp/);
  });

  it('en WhatsApp «Enviar» está disponible y sin motivo que explicar', () => {
    const enviar = pestanasDe({ canal: 'whatsapp', conTelefono: true }).find((p) => p.id === 'plantillas')!;
    expect(enviar.disponible).toBe(true);
    expect(enviar.motivo).toBeUndefined();
  });

  it('se respeta la última pestaña elegida al cambiar de conversación', () => {
    const wa = pestanasDe({ canal: 'whatsapp', conTelefono: true });
    expect(pestanaInicial(wa, 'notas')).toBe('notas');
  });

  it('si la elegida no está disponible en este canal, cae a la primera que sí', () => {
    const fb = pestanasDe({ canal: 'facebook', conTelefono: false });
    expect(pestanaInicial(fb, 'plantillas')).toBe('ficha');
  });

  it('sin preferencia previa, abre en la Ficha', () => {
    expect(pestanaInicial(pestanasDe({ canal: 'whatsapp', conTelefono: true }), null)).toBe('ficha');
  });

  it('una preferencia basura no rompe nada', () => {
    const wa = pestanasDe({ canal: 'whatsapp', conTelefono: true });
    expect(pestanaInicial(wa, 'inventada' as IdPestana)).toBe('ficha');
  });
});
