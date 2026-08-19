// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { escribir, montar, reposar, teclear, tocar, type Montado } from '../../pruebas/dom';
import { CambiarClave } from './CambiarClave';
import { ContenidoUsuario } from './PanelUsuario';
import type { Vendedora } from './sesion';

/**
 * CAMBIAR MI CONTRASEÑA — lo que se fija montando de verdad, porque el defecto
 * que importa acá vive en el CABLEADO (ADR 0024): que el POST salga con lo que
 * se tipeó, que un rechazo del server se LEA, y que a quien no tiene cuenta de
 * Cerberus el botón ni se le ofrezca (ofrecerlo es ofrecerle un 409).
 */

const LUZ: Vendedora = { id: 'luz', nombre: 'Luz' };
const BETTO: Vendedora = { id: 'centurion:betto.romero', nombre: 'Betto' };

let m: Montado | null = null;
const fetchDeVerdad = globalThis.fetch;
/** Lo que salió hacia el server, para poder afirmar sobre el cuerpo. */
let pedidos: { url: string; body: unknown }[] = [];

function servidorQueContesta(status: number, cuerpo: unknown) {
  globalThis.fetch = (async (entrada: Parameters<typeof fetch>[0], init?: RequestInit) => {
    pedidos.push({ url: String(entrada), body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

afterEach(() => {
  m?.desmontar();
  m = null;
  globalThis.fetch = fetchDeVerdad;
  pedidos = [];
  localStorage.clear();
});

const inputs = () => [...m!.contenedor.querySelectorAll('input[type="password"]')] as HTMLInputElement[];
const alerta = () => m!.contenedor.querySelector('[role="alert"]')?.textContent ?? '';
const enviar = () => tocar(m!.contenedor.querySelector('button[type="submit"]')!);

async function llenarYMandar(actual: string, nueva: string, repetir = nueva) {
  const [a, n, r] = inputs();
  escribir(a, actual);
  escribir(n, nueva);
  escribir(r, repetir);
  enviar();
  await reposar();
}

describe('CambiarClave — el modal', () => {
  it('manda la actual y la nueva al server, y al 200 dice que cambió', async () => {
    servidorQueContesta(200, { ok: true });
    m = montar(<CambiarClave onCerrar={() => {}} />);
    await llenarYMandar('la-de-antes', 'Nueva-Segura-2026');

    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].url).toMatch(/\/api\/auth\/cambiar-clave$/);
    expect(pedidos[0].body).toEqual({ claveActual: 'la-de-antes', claveNueva: 'Nueva-Segura-2026' });
    expect(m.contenedor.textContent).toMatch(/tu contraseña cambió/i);
    // No se le dice «volvé a entrar»: la sesión de Hermes sigue viva.
    expect(m.contenedor.textContent).not.toMatch(/volv[ée] a entrar/i);
  });

  it('con las dos nuevas distintas NO sale nada al server y se lee por qué', async () => {
    servidorQueContesta(200, { ok: true });
    m = montar(<CambiarClave onCerrar={() => {}} />);
    await llenarYMandar('la-de-antes', 'Nueva-Segura-2026', 'Otra-Cosa-2026');

    expect(pedidos).toHaveLength(0);
    expect(alerta()).toMatch(/no coinciden/);
  });

  it('un rechazo del server (la actual mal) se muestra tal cual y se queda en el formulario', async () => {
    servidorQueContesta(400, { ok: false, type: 'clave_actual_incorrecta', message: 'La contraseña actual no es correcta.' });
    m = montar(<CambiarClave onCerrar={() => {}} />);
    await llenarYMandar('mala', 'Nueva-Segura-2026');

    expect(alerta()).toContain('La contraseña actual no es correcta.');
    expect(inputs()).toHaveLength(3);
    expect(m.contenedor.textContent).not.toMatch(/tu contraseña cambió/i);
  });

  it('lo que dijo Django sobre la nueva llega a la pantalla sin traducir', async () => {
    const dicho = 'Esta contraseña es demasiado común.';
    servidorQueContesta(400, { ok: false, type: 'clave_nueva_rechazada', message: dicho, errores: [dicho] });
    m = montar(<CambiarClave onCerrar={() => {}} />);
    await llenarYMandar('la-de-antes', 'password1234');

    expect(alerta()).toContain(dicho);
  });

  it('Escape cierra el modal', () => {
    let cerrado = 0;
    m = montar(<CambiarClave onCerrar={() => cerrado++} />);
    teclear('Escape');
    expect(cerrado).toBe(1);
  });
});

const botonCambiar = () =>
  [...m!.contenedor.querySelectorAll('button')].find((b) => /cambiar contraseña/i.test(b.textContent ?? ''));

describe('PanelUsuario · a quién se le ofrece cambiar la contraseña', () => {
  it('a una vendedora de Cerberus, sí — y toca el handler', () => {
    let abierto = 0;
    m = montar(
      <ContenidoUsuario vendedora={LUZ} cerberusVivo mias={[]} onSalir={() => {}} onCambiarClave={() => abierto++} />,
    );
    const b = botonCambiar();
    expect(b).toBeTruthy();
    tocar(b!);
    expect(abierto).toBe(1);
  });

  it('aunque Hermes haya PERDIDO su sesión de Cerberus, también: el server vuelve a entrar con la actual', () => {
    m = montar(<ContenidoUsuario vendedora={LUZ} cerberusVivo={false} mias={[]} onSalir={() => {}} />);
    expect(botonCambiar()).toBeTruthy();
  });

  it('a una identidad de Centurión, NO: no tiene clave en Cerberus que cambiar', () => {
    m = montar(<ContenidoUsuario vendedora={BETTO} cerberusVivo={null} mias={[]} onSalir={() => {}} />);
    expect(botonCambiar()).toBeFalsy();
  });
});
