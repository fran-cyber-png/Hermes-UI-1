import { describe, expect, it } from 'vitest';
import { conMiles, motivoParaNoEnviar, TOPE_CUERPO } from './correos';
import type { EstadoDeCorreos } from './tipos';

/**
 * EL CANDADO ENTRE LOS DOS `TOPE_CUERPO` — desde el lado del FRONT.
 *
 * El front tiene su propia copia del número porque apaga el botón de Enviar y
 * redacta el motivo («El correo pasa de los 20.000 caracteres: sobran 5.000»)
 * antes de tocar el server. La garantía sigue siendo el 400 de la ruta; lo del
 * navegador es que el aviso sea de la app y no un error anónimo después de
 * escribir todo.
 *
 * ══ 🔴 POR QUÉ HAY UNO DE CADA LADO Y NO ES UNA COPIA AL PEDO ═══════════════
 *
 * `server/src/correos/limites.paridad.test.ts` hace el cruce espejo: lee ESTE
 * archivo desde el server. Los dos existen porque **las dos suites se corren en
 * momentos distintos y por gente distinta**: quien toca sólo el front corre
 * `npm test` en la raíz y nunca `cd server && npm test`, así que el candado de
 * allá no se pone rojo hasta el CI —cuando el PR ya está escrito— y el de acá,
 * al revés. Un candado que se entera tarde igual sirve; uno que se entera en el
 * momento en que se rompe el número, sirve más.
 *
 * ══ POR QUÉ ESTO ES UN TEST Y NO UN COMENTARIO ══════════════════════════════
 *
 * 🔴 Ya se desincronizaron una vez, con este mismo patrón y este mismo número: al
 * subir el tope de las notas de 2.000 a 20.000 (ADR 0047) el server cambió y el
 * front siguió diciendo 2.000. **No rompe nada** — y ése es el problema: la
 * pantalla deja escribir de más, el server rechaza, y el aviso explica el rechazo
 * con una cifra que no rige en ningún lado. El mensaje SUENA correcto, así que
 * nadie lo reporta como bug.
 *
 * ⚠️ **`import.meta.glob` y NUNCA `node:fs`.** Con `fs` el test pasa en vitest y
 * **falla el typecheck** de `tsconfig.app.json`, que no lleva los tipos de node
 * (la cicatriz es `etapas.test.ts`, ADR 0049). Por eso acá el archivo del server
 * se lee como TEXTO y no se importa: además de los tipos, es otro `tsconfig` y
 * otro sistema de módulos — importarlo arrastraría medio server adentro de la
 * suite del navegador.
 */

/**
 * El archivo del server como texto crudo.
 *
 * ⚠️ Es una ruta literal, no un patrón: el glob acepta las dos formas, y con un
 * comodín un archivo renombrado devolvería un mapa vacío en vez de fallar acá,
 * que es donde se lee mejor.
 */
const SERVER: Record<string, string> = import.meta.glob('../../../server/src/correos/limites.ts', {
  eager: true,
  query: '?raw',
  import: 'default',
});

/**
 * 🔴 **UN GLOB QUE NO ENCUENTRA NADA APRUEBA EN SILENCIO, y eso ya pasó acá al
 * lado.** `seleccionVisible.test.ts` leía `''` porque vitest servía el CSS como
 * cadena vacía y el test pasaba sin mirar un solo píxel — el mismo falso verde que
 * este archivo viene a evitar. Por eso «no se pudo leer el server» es un fallo con
 * nombre propio y no una comparación que da true por vacío.
 */
function fuenteDelServer(): string {
  const entradas = Object.values(SERVER);
  expect(
    entradas.length,
    'el glob no encontró server/src/correos/limites.ts — ¿se movió el archivo? Sin fuente este test aprueba sin comparar nada',
  ).toBe(1);
  const fuente = entradas[0] ?? '';
  expect(fuente.length, 'el archivo del server se leyó vacío: el candado estaría comparando la nada').toBeGreaterThan(0);
  return fuente;
}

/** El número que el server declara, aceptando el separador `_` de TS (`20_000`). */
function topeDelServer(): number {
  const m = fuenteDelServer().match(/export const TOPE_CUERPO\s*=\s*([\d_]+)/);
  expect(m, 'no se encontró `export const TOPE_CUERPO` en el server — ¿se renombró?').toBeTruthy();
  return Number(m![1].replace(/_/g, ''));
}

describe('TOPE_CUERPO — front y server dicen el mismo número', () => {
  it('el tope del front es exactamente el del server', () => {
    const delServer = topeDelServer();
    expect(
      TOPE_CUERPO,
      `el front dice ${TOPE_CUERPO} y el server ${delServer}: la pantalla explicaría el tope con un número que no rige`,
    ).toBe(delServer);
  });

  /**
   * ⚠️ **Lo que la vendedora LEE es la parte que se rompe sin que nada falle.** Que
   * las dos constantes coincidan no alcanza si el motivo se redacta con otro número
   * —una cifra escrita a mano en el `.tsx`, un `toLocaleString` que en un runtime
   * con `small-icu` devuelve `20,000`—: ahí el aviso sigue sonando correcto y sigue
   * siendo falso. Se afirma sobre la frase que sale a la pantalla, no sobre la
   * constante que la alimenta.
   */
  it('el motivo que se muestra nombra ese mismo número', () => {
    const delServer = topeDelServer();
    const estado: EstadoDeCorreos = {
      conectado: true,
      desde: 'escuela@goberna.us',
      remitentes: [],
      sinRemitentes: true,
    };

    const veredicto = motivoParaNoEnviar(
      {
        para: 'ana@correo.com',
        asunto: 'El temario',
        cuerpo: 'x'.repeat(delServer + 1),
        remitenteId: null,
      },
      estado,
    );

    expect(veredicto.puede).toBe(false);
    expect(veredicto.puede === false && veredicto.motivo).toContain(conMiles(delServer));
  });

  /**
   * 🔴 **EL BORDE EXACTO TIENE QUE SER EL MISMO, y la asimetría que lo rompe es un
   * `trim()` de un solo lado.** Un cuerpo de exactamente el tope más tres Enter al
   * final pasaría de un lado y rebotaría del otro: la pantalla diría que entra y el
   * server que sobran tres. Acá se fija la mitad del front —mide la cadena CRUDA— y
   * `limites.paridad.test.ts` fija la del server.
   */
  it('el front mide la cadena cruda: el tope justo entra y uno más no', () => {
    const estado: EstadoDeCorreos = {
      conectado: true,
      desde: 'escuela@goberna.us',
      remitentes: [],
      sinRemitentes: true,
    };
    const campos = (cuerpo: string) => ({
      para: 'ana@correo.com',
      asunto: 'El temario',
      cuerpo,
      remitenteId: null,
    });

    // Justo en el tope, con espacios al final que un `trim()` se comería.
    const justo = 'x'.repeat(TOPE_CUERPO - 3) + '\n\n\n';
    expect(justo.length).toBe(TOPE_CUERPO);
    expect(motivoParaNoEnviar(campos(justo), estado).puede).toBe(true);
    expect(motivoParaNoEnviar(campos(justo + 'x'), estado).puede).toBe(false);
  });
});
