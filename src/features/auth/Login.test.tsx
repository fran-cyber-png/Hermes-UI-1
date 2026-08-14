// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { ErrorApi } from '../../lib/datos/cliente';
import { escribir, montar, tocar, reposar, type Montado } from '../../pruebas/dom';
import { Login } from './Login';

/**
 * QUÉ LEE LA VENDEDORA CUANDO EL LOGIN FALLA.
 *
 * `mensajeDeError` no se exporta y no hace falta exportarla: lo que importa no
 * es la función, es **lo que termina en la pantalla**, y el defecto que este
 * archivo fija vivía justo ahí — un 403 con `type: 'sin_linea_asignada'` caía en
 * el fallback y la pantalla decía «revisá tu internet» a alguien que tiene la
 * clave bien y necesita hablar con soporte. Montando el formulario de verdad, el
 * test también cubre que el mensaje se dibuje (el `role="alert"`), que es la otra
 * mitad de que se pueda leer.
 */

const MENSAJE_SIN_LINEA = 'todavía no tenés una línea de WhatsApp asignada en Hermes — avisá a soporte';

let montado: Montado | null = null;

afterEach(() => {
  montado?.desmontar();
  montado = null;
  localStorage.clear();
});

/** Escribe usuario y clave, manda el formulario y devuelve el texto del cartel. */
async function intentarEntrarY(falla: unknown): Promise<string> {
  montado = montar(
    <Login
      entrar={async () => {
        throw falla;
      }}
    />,
  );
  const [usuario, clave] = [...montado.contenedor.querySelectorAll('input')] as HTMLInputElement[];
  escribir(usuario, 'betto.romero');
  escribir(clave, 'la-clave-que-nunca-se-loguea');

  const boton = montado.contenedor.querySelector('button[type="submit"]')!;
  tocar(boton);
  await reposar();

  const alerta = [...montado.contenedor.querySelectorAll('[role="alert"]')].at(-1);
  return alerta?.textContent ?? '';
}

describe('Login — el cartel de error', () => {
  it('🔴 un 403 sin_linea_asignada muestra lo que dijo el server, no «revisá tu internet»', async () => {
    const texto = await intentarEntrarY(new ErrorApi(MENSAJE_SIN_LINEA, 403, 'sin_linea_asignada'));

    expect(texto).toContain(MENSAJE_SIN_LINEA);
    // Lo que decía antes, y que manda a reiniciar el router en vez de a soporte.
    expect(texto).not.toMatch(/internet/i);
  });

  it('un 401 sigue siendo «usuario o contraseña incorrectos»', async () => {
    const texto = await intentarEntrarY(new ErrorApi('usuario o contraseña incorrectos', 401));
    expect(texto).toMatch(/Usuario o contraseña incorrectos/i);
  });

  it('el 503 de Cerberus caído no le echa la culpa al wifi', async () => {
    const texto = await intentarEntrarY(
      new ErrorApi('Cerberus no responde en este momento.', 503, 'cerberus_caido'),
    );
    expect(texto).toMatch(/Cerberus no responde/i);
    expect(texto).not.toMatch(/internet/i);
  });

  it('lo que no se reconoce cae en el genérico, que sí habla de la conexión', async () => {
    const texto = await intentarEntrarY(new TypeError('fetch failed'));
    expect(texto).toMatch(/internet/i);
  });

  it('un 403 con el `type` de siempre pero sin mensaje no deja el cartel vacío', async () => {
    const texto = await intentarEntrarY(new ErrorApi('', 403, 'sin_linea_asignada'));
    expect(texto.trim().length).toBeGreaterThan(0);
  });
});
