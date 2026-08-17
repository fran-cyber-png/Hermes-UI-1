// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { montar, teclear, tocar, type Montado } from '../../pruebas/dom';
import { ModalDeLink } from './ModalDeLink';
import type { Nota } from './notas';

/**
 * EL CABLEADO DEL MODAL DEL LINK — lo que ningún test puro puede ver.
 *
 * Las reglas (qué `venceAt` sale de cada plazo, cómo se lee cada evento) ya están
 * en `auditoria.test.ts`. Acá se prueba lo otro: que el control que la pantalla
 * dibuja **mande de verdad lo que dice que manda**. Los tres defectos que este
 * archivo fija aparecieron los tres en pantalla y ninguno rompía nada visible.
 */

function nota(parcial: Partial<Nota> = {}): Nota {
  return {
    id: 7,
    clave: 'general',
    vendedoraId: 'luz',
    texto: 'Precios del diploma',
    doc: null,
    fijada: false,
    creadoAt: '2026-08-10T09:00:00.000Z',
    editadoAt: null,
    archivadoAt: null,
    origen: 'nota',
    ...parcial,
  };
}

let montado: Montado | null = null;
afterEach(() => {
  montado?.desmontar();
  montado = null;
});

function seleccionar(contenedor: Element, indice: number, valor: string) {
  const select = contenedor.querySelectorAll('select')[indice] as HTMLSelectElement;
  select.value = valor;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function botonDeTexto(contenedor: Element, texto: string): HTMLButtonElement {
  const b = [...contenedor.querySelectorAll('button')].find((x) => x.textContent?.includes(texto));
  expect(b, `no encontré el botón «${texto}»`).toBeTruthy();
  return b as HTMLButtonElement;
}

describe('el modal del link', () => {
  it('sin link todavía, el botón ofrece generarlo', () => {
    montado = montar(<ModalDeLink nota={nota()} onCerrar={() => {}} onGuardar={() => {}} onCortar={() => {}} onVerRegistro={() => {}} />);
    expect(montado.contenedor.textContent).toContain('Generar el link');
  });

  it('🔴 con link ya repartido dice «Guardar cambios», nunca «generar uno nuevo»', () => {
    // Reconfigurar CONSERVA el token (ADR 0048): el link que ya se mandó sigue
    // sirviendo con las reglas nuevas. Prometer uno nuevo describiría lo contrario
    // de lo que pasa — y es justo lo que alguien cree estar haciendo cuando quiere
    // que el link viejo deje de valer.
    montado = montar(
      <ModalDeLink nota={nota({ token: 'a'.repeat(32) })} onCerrar={() => {}} onGuardar={() => {}} onCortar={() => {}} onVerRegistro={() => {}} />,
    );
    expect(montado.contenedor.textContent).toContain('Guardar cambios');
    expect(montado.contenedor.textContent).not.toContain('Generar');
  });

  it('🔴 arranca en lo que el link YA es, no en los defaults', () => {
    // Esto depende de que el server sirva `alcance`/`permiso` en el listado — no lo
    // hacía hasta el 17-ago-2026, y el modal abría siempre en «público / solo ver»
    // aunque el link fuera de Goberna con permiso de editar.
    montado = montar(
      <ModalDeLink
        nota={nota({ token: 'a'.repeat(32), alcance: 'goberna', permiso: 'editar' })}
        onCerrar={() => {}}
        onGuardar={() => {}}
        onCortar={() => {}}
        onVerRegistro={() => {}}
      />,
    );
    const selects = montado.contenedor.querySelectorAll('select');
    expect((selects[1] as HTMLSelectElement).value).toBe('goberna');
    expect(montado.contenedor.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
  });

  it('🔴 pasar a público APAGA «puede editar» — esa combinación no existe', () => {
    // Sin identidad no hay autoría: el server la rechaza con 400 y su tipo la hace
    // imposible de construir. Dejarla marcada mostraría un estado que se va a
    // rechazar, y el error llegaría después de que la vendedora repartió el link.
    montado = montar(
      <ModalDeLink
        nota={nota({ token: 'a'.repeat(32), alcance: 'goberna', permiso: 'editar' })}
        onCerrar={() => {}}
        onGuardar={() => {}}
        onCortar={() => {}}
        onVerRegistro={() => {}}
      />,
    );
    const interruptor = montado.contenedor.querySelector('[role="switch"]') as HTMLButtonElement;
    expect(interruptor.getAttribute('aria-checked')).toBe('true');

    seleccionar(montado.contenedor, 1, 'publico');

    expect(interruptor.getAttribute('aria-checked')).toBe('false');
    expect(interruptor.disabled).toBe(true);
    // Y la pantalla DICE por qué no se puede prender, en vez de dejar un control
    // apagado sin motivo.
    expect(montado.contenedor.textContent).toContain('sin cuenta no hay a quién atribuirle un cambio');
  });

  it('🔴 cambiar el alcance NO le saca el vencimiento al link', () => {
    // El bug: el body manda `venceAt ?? null` y el server trata `undefined` como
    // «no vence». Abrir el modal para cambiar OTRA cosa y guardar le borraba el
    // vencimiento a un link ya repartido, sin un solo síntoma.
    const onGuardar = vi.fn();
    const vence = '2026-09-20T00:00:00.000Z';
    montado = montar(
      <ModalDeLink
        nota={nota({ token: 'a'.repeat(32), alcance: 'publico', permiso: 'ver', venceAt: vence })}
        onCerrar={() => {}}
        onGuardar={onGuardar}
        onCortar={() => {}}
        onVerRegistro={() => {}}
      />,
    );

    seleccionar(montado.contenedor, 1, 'goberna');
    tocar(botonDeTexto(montado.contenedor, 'Guardar cambios'));

    expect(onGuardar).toHaveBeenCalledWith({ alcance: 'goberna', permiso: 'ver', venceAt: vence });
  });

  it('elegir un plazo sí cambia el vencimiento', () => {
    const onGuardar = vi.fn();
    montado = montar(
      <ModalDeLink nota={nota()} onCerrar={() => {}} onGuardar={onGuardar} onCortar={() => {}} onVerRegistro={() => {}} />,
    );

    seleccionar(montado.contenedor, 0, '7d');
    tocar(botonDeTexto(montado.contenedor, 'Generar el link'));

    const enviado = onGuardar.mock.calls[0][0] as { venceAt: string | null };
    expect(enviado.venceAt).toBeTruthy();
    const dias = (new Date(enviado.venceAt!).getTime() - Date.now()) / 86_400_000;
    expect(dias).toBeGreaterThan(6.9);
    expect(dias).toBeLessThan(7.1);
  });

  it('«No vence» manda null — es el default del link de un lead (ADR 0047)', () => {
    const onGuardar = vi.fn();
    montado = montar(
      <ModalDeLink nota={nota()} onCerrar={() => {}} onGuardar={onGuardar} onCortar={() => {}} onVerRegistro={() => {}} />,
    );
    tocar(botonDeTexto(montado.contenedor, 'Generar el link'));
    expect(onGuardar).toHaveBeenCalledWith({ alcance: 'publico', permiso: 'ver', venceAt: null });
  });

  it('🔴 cortar el link NO es un clic solo: se dice qué pasa antes de hacerlo', () => {
    // Borra la fila (ADR 0047), así que el token queda muerto para siempre: quien
    // lo tenga pegado en un chat abre un 404 y no hay forma de resucitarlo. Un
    // clic silencioso sobre eso es la clase de acción que se descubre tarde.
    const onCortar = vi.fn();
    montado = montar(
      <ModalDeLink
        nota={nota({ token: 'a'.repeat(32), ultimoAccesoAt: '2026-08-16T10:00:00.000Z' })}
        onCerrar={() => {}}
        onGuardar={() => {}}
        onCortar={onCortar}
        onVerRegistro={() => {}}
      />,
    );

    tocar(botonDeTexto(montado.contenedor, 'Cortar el link'));
    expect(onCortar).not.toHaveBeenCalled();

    // El aviso nombra la CONSECUENCIA, no pregunta «¿estás segura?».
    expect(montado.contenedor.textContent).toContain('va a dejar de poder entrar');
    expect(montado.contenedor.textContent).toContain('No se puede deshacer');
    // Y dice que el registro sobrevive: es lo único que queda del link cortado.
    expect(montado.contenedor.textContent).toContain('registro de lo que pasó se conserva');

    tocar(botonDeTexto(montado.contenedor, 'Cortarlo igual'));
    expect(onCortar).toHaveBeenCalledTimes(1);
  });

  it('«Dejarlo andando» no corta nada', () => {
    const onCortar = vi.fn();
    montado = montar(
      <ModalDeLink nota={nota({ token: 'a'.repeat(32) })} onCerrar={() => {}} onGuardar={() => {}} onCortar={onCortar} onVerRegistro={() => {}} />,
    );

    tocar(botonDeTexto(montado.contenedor, 'Cortar el link'));
    tocar(botonDeTexto(montado.contenedor, 'Dejarlo andando'));

    expect(onCortar).not.toHaveBeenCalled();
    // Y el aviso se fue: se puede seguir usando el modal.
    expect(montado.contenedor.textContent).not.toContain('No se puede deshacer');
  });

  it('Escape cierra el modal — el contrato de todos los modales de Hermes', () => {
    const onCerrar = vi.fn();
    montado = montar(
      <ModalDeLink nota={nota()} onCerrar={onCerrar} onGuardar={() => {}} onCortar={() => {}} onVerRegistro={() => {}} />,
    );
    teclear('Escape');
    expect(onCerrar).toHaveBeenCalled();
  });

  it('el registro solo se ofrece cuando hay un link del que hablar', () => {
    montado = montar(<ModalDeLink nota={nota()} onCerrar={() => {}} onGuardar={() => {}} onCortar={() => {}} onVerRegistro={() => {}} />);
    expect(montado.contenedor.textContent).not.toContain('Ver el registro');

    montado.repintar(
      <ModalDeLink nota={nota({ token: 'a'.repeat(32) })} onCerrar={() => {}} onGuardar={() => {}} onCortar={() => {}} onVerRegistro={() => {}} />,
    );
    expect(montado.contenedor.textContent).toContain('Ver el registro');
  });
});
