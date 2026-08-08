// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test } from 'vitest';
import { montar, reposar, tocar } from '../../pruebas/dom';
import { VistaNavegador } from './VistaNavegador';

/**
 * EL CABLEADO DEL NAVEGADOR EMBEBIDO (ADR 0043).
 *
 * ══ POR QUÉ ESTO NO PUEDE SER UN TEST PURO ═══════════════════════════════════
 *
 * Las dos cosas que este archivo fija no son decisiones, son CONEXIONES — y esa
 * es exactamente la clase de defecto que ADR 0024 documenta como invisible para
 * un test puro (`escapeDePopover.ts` estaba testeado hasta el hueso y la app
 * perdió el Escape global igual, porque el defecto estaba en el cableado):
 *
 *   1. **Que `tapado` esconda el webview.** El navegador es una capa del SISTEMA
 *      OPERATIVO encima del DOM: si no se esconde, tapa a Ivi, a la cabina y a
 *      cualquier modal que caiga en su rectángulo. No hay función pura que
 *      pueda equivocarse acá; lo que se puede olvidar es el `useEffect`.
 *   2. **Que una cáscara vieja NO deje un botón muerto.** La UI viaja por OTA y
 *      llega en el acto; la cáscara se reinstala a mano. El día del deploy
 *      NINGUNA cáscara instalada tiene los comandos nuevos, y lo único que
 *      separa «anda distinto» de «no anda» es que el rechazo del ACL se lea y
 *      se caiga al camino anterior.
 *
 * ⚠️ `getBoundingClientRect` se remienda acá y no en `pruebas/dom.tsx`: jsdom no
 * hace layout y devuelve ceros, y el hook —con razón— se niega a mandarle a Rust
 * un rectángulo de 0×0. Sin el remiendo, `ir()` no llama a nadie y los dos tests
 * pasarían sin haber ejercido una sola línea del cableado.
 */

type Llamada = { cmd: string; args: Record<string, unknown> };

let llamadas: Llamada[] = [];
let rechazarCon: string | null = null;
let rectOriginal: typeof Element.prototype.getBoundingClientRect;

function puenteDeMentira() {
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
    invoke: async (cmd: string, args: Record<string, unknown>) => {
      llamadas.push({ cmd, args });
      if (rechazarCon) throw rechazarCon;
      if (cmd === 'navegador_donde') return 'https://app.goberna.us/';
      return undefined;
    },
  };
}

beforeEach(() => {
  llamadas = [];
  rechazarCon = null;
  puenteDeMentira();
  rectOriginal = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    return { x: 0, y: 96, left: 0, top: 96, width: 900, height: 700, right: 900, bottom: 796, toJSON: () => ({}) } as DOMRect;
  };
});

afterEach(() => {
  Element.prototype.getBoundingClientRect = rectOriginal;
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

function botonPorTexto(contenedor: HTMLElement, texto: string): HTMLElement {
  const b = [...contenedor.querySelectorAll('button')].find((x) => x.textContent?.includes(texto));
  if (!b) throw new Error(`no hay botón con «${texto}»`);
  return b;
}

/**
 * 🔴 EL CANDADO DE LA CAPA DEL SO.
 *
 * Se abre un destino (el webview queda montado) y recién ahí se tapa. Sin el
 * efecto de `tapado`, Ivi y la cabina se abrirían DETRÁS del navegador — que es
 * el motivo por el que ADR 0040 había descartado el webview hijo.
 */
test('tapado esconde el navegador, y destaparlo lo vuelve a poner en su lugar', async () => {
  const { contenedor, repintar, desmontar } = montar(<VistaNavegador tapado={false} />);

  tocar(botonPorTexto(contenedor, 'Cerberus'));
  await reposar();
  expect(llamadas.map((l) => l.cmd)).toContain('navegador_montar');

  llamadas = [];
  repintar(<VistaNavegador tapado />);
  await reposar();
  expect(llamadas.map((l) => l.cmd)).toContain('navegador_ocultar');

  // Y al destaparse se re-monta con el recuadro de AHORA, no solo se muestra:
  // mientras estuvo escondido la ventana pudo cambiar de tamaño y el
  // `ResizeObserver` no dispara sobre algo que nadie movió.
  llamadas = [];
  repintar(<VistaNavegador tapado={false} />);
  await reposar();
  expect(llamadas.map((l) => l.cmd)).toContain('navegador_montar');

  desmontar();
});

/** Al salir de la vista se esconde: si no, el navegador queda flotando sobre Mensajes. */
test('desmontar la vista esconde el navegador', async () => {
  const { contenedor, desmontar } = montar(<VistaNavegador tapado={false} />);
  tocar(botonPorTexto(contenedor, 'Cerberus'));
  await reposar();

  llamadas = [];
  desmontar();
  expect(llamadas.map((l) => l.cmd)).toContain('navegador_ocultar');
});

/**
 * 🔴 LA CÁSCARA VIEJA NO PUEDE DEJAR UN BOTÓN MUERTO.
 *
 * El rechazo del ACL —el mismo texto exacto que se comió el frente de ADR 0040
 * el día que se desplegó— tiene que apagar el embebido y devolver la pantalla al
 * camino anterior, diciéndolo.
 */
test('una cáscara sin los comandos cae al camino viejo y lo explica', async () => {
  rechazarCon = 'Command navegador_montar not allowed by ACL';
  const { contenedor, desmontar } = montar(<VistaNavegador tapado={false} />);

  tocar(botonPorTexto(contenedor, 'Cerberus'));
  await reposar();

  expect(contenedor.textContent).toContain('ventana aparte');
  // Y no se queda con el error crudo de Tauri en pantalla: eso está en inglés y
  // no le dice nada a la vendedora.
  expect(contenedor.textContent).not.toContain('not allowed by ACL');

  desmontar();
});

/**
 * 🔴 UN CLIC TIENE QUE ABRIR ALGO, aunque el peldaño cambie en el medio.
 *
 * Este test existe porque el defecto estaba y los otros no lo veían: `ir()`
 * apagaba el embebido y volvía **sin abrir nada**, así que el primer toque solo
 * cambiaba el cartel. Y ese no es un caso raro — es el estado de las CUATRO
 * máquinas el día del deploy, porque la UI viaja por OTA y la cáscara se
 * reinstala a mano. El estreno del frente habría sido «toco Cerberus y no pasa
 * nada».
 */
test('con una cáscara vieja, el MISMO clic sigue por la ventana aparte', async () => {
  rechazarCon = 'Command navegador_montar not allowed by ACL';
  const { contenedor, desmontar } = montar(<VistaNavegador tapado={false} />);

  tocar(botonPorTexto(contenedor, 'Cerberus'));
  await reposar();

  expect(llamadas.map((l) => l.cmd)).toContain('abrir_navegador');
  expect(llamadas.find((l) => l.cmd === 'abrir_navegador')?.args).toMatchObject({
    url: 'https://app.goberna.us',
  });

  desmontar();
});

/**
 * ⚠️ Y el rechazo de la GUARDA es lo contrario: la cáscara está perfecta, lo que
 * estaba mal era la dirección. Ahí se muestra el motivo y NO se apaga nada —
 * colapsar los dos casos degradaría la app entera por una URL mal tecleada. Los
 * distingue el idioma: los nuestros están en castellano, los de Tauri en inglés
 * (`cascara.ts`).
 */
test('un rechazo de la guarda muestra el motivo y no apaga el embebido', async () => {
  rechazarCon = 'solo se abren direcciones https — esta es «file»';
  const { contenedor, desmontar } = montar(<VistaNavegador tapado={false} />);

  tocar(botonPorTexto(contenedor, 'Cerberus'));
  await reposar();

  expect(contenedor.textContent).toContain('solo se abren direcciones https');
  expect(contenedor.textContent).not.toContain('ventana aparte');

  desmontar();
});
