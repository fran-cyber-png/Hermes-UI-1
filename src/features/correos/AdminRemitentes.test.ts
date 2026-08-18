import { describe, expect, it } from 'vitest';
import { ErrorApi } from '../../lib/datos/cliente';
import { dominioAceptado, dominioDe, lecturaDeErrorDeRemitente, motivoParaNoGuardar } from './correos';

/**
 * Las reglas de la pantalla de remitentes, interrogadas SIN montar nada.
 *
 * ⚠️ Por eso viven en `correos.ts` y no adentro de un componente: la pregunta que
 * importa —«¿qué pasa con un dominio que SES no tiene verificado?»— no se puede hacer
 * sobre un `if` metido en el JSX, y la respuesta equivocada no rompe la pantalla: la
 * deja guardar algo que va a fallar tres días después.
 *
 * ⚠️ **Estuvieron exportadas del `.tsx`** —cuatro `react(only-export-components)` de
 * oxlint— hasta que se mudaron. Si aparece una regla nueva de esta pantalla, va al
 * `.ts`: el `.tsx` sólo dibuja.
 */

const VERIFICADOS = ['goberna.us'];

const campos = (parcial: Partial<Parameters<typeof motivoParaNoGuardar>[0]> = {}) => ({
  direccion: 'ventas@goberna.us',
  nombre: 'Escuela Goberna',
  responderA: '',
  firma: '',
  ...parcial,
});

describe('el dominio se juzga antes de mandar el POST', () => {
  it('acepta el dominio verificado', () => {
    expect(dominioAceptado('ventas@goberna.us', VERIFICADOS)).toBe(true);
  });

  it('rechaza grupogoberna.com, que es el caso real que muerde', () => {
    // Tres de las nueve vendedoras tienen su `vendedora_id` en ese dominio, así que
    // es lo primero que alguien va a intentar dar de alta.
    expect(dominioAceptado('ventas10@grupogoberna.com', VERIFICADOS)).toBe(false);
  });

  it('acepta un subdominio: SES los cubre, y acá NO se puede ser más estricto que el server', () => {
    expect(dominioAceptado('avisos@mail.goberna.us', VERIFICADOS)).toBe(true);
  });

  it('no se come un dominio que sólo TERMINA parecido', () => {
    expect(dominioAceptado('x@nogoberna.us', VERIFICADOS)).toBe(false);
  });

  it('compara en minúsculas de los dos lados', () => {
    expect(dominioAceptado('Ventas@GOBERNA.US', ['Goberna.us'])).toBe(true);
  });

  it('sin lista NO valida nada: un server viejo no puede dejar la pantalla muerta', () => {
    expect(dominioAceptado('x@gmail.com', undefined)).toBe(true);
    expect(dominioAceptado('x@gmail.com', [])).toBe(true);
  });

  it('dominioDe descarta lo que no se lee como un correo', () => {
    expect(dominioDe('ventas@goberna.us')).toBe('goberna.us');
    expect(dominioDe('ventas@goberna')).toBe(null);
    expect(dominioDe('ventas, otro@goberna.us')).toBe(null);
  });

  /**
   * 🔴 **La MISMA pregunta tiene que gobernar el alta Y el «Volver a usarlo».** El
   * alta estaba chequeada de los dos lados (acá y `puedeSerRemitente` del server) y
   * reactivar no estaba chequeado de NINGUNO: `PATCH {activo:true}` no mira el
   * dominio —su propio docblock dice que el control existe «al DAR DE ALTA»—, así que
   * retirar y volver a prender era la puerta de atrás a un `From` que SES contesta con
   * 554. Y se llega ahí sin hacer nada raro: el `INSERT` a mano que el runbook del
   * deploy documenta se saltea el control por definición, y
   * `SMTP_DOMINIOS_VERIFICADOS` es una variable de entorno que puede angostarse.
   *
   * Lo que este test fija es la RELACIÓN, no cada mitad: lo que no se puede dar de
   * alta tampoco se puede reactivar. `FilaRemitente` apaga el botón con esta misma
   * función; con un criterio propio adentro del JSX, aflojar uno y no el otro deja la
   * puerta abierta sin que nada falle.
   *
   * ⚠️ **El front NO es la garantía y no se puede leer así.** El server sigue sin
   * chequear el dominio en el PATCH: esto adelanta el aviso a quien administra, y
   * cerrarlo de verdad es un cambio en `routes/correos.ts`.
   */
  it('lo que NO se puede dar de alta tampoco se puede volver a prender', () => {
    for (const direccion of ['ventas@grupogoberna.com', 'x@gmail.com', 'x@nogoberna.us']) {
      const sePuedeDarDeAlta = motivoParaNoGuardar(
        campos({ direccion, nombre: 'Ventas' }),
        VERIFICADOS,
      ).puede;
      expect(dominioAceptado(direccion, VERIFICADOS), direccion).toBe(sePuedeDarDeAlta);
    }
  });
});

describe('motivoParaNoGuardar dice POR QUÉ, y en el orden de la pantalla', () => {
  it('deja guardar el caso normal', () => {
    expect(motivoParaNoGuardar(campos(), VERIFICADOS)).toEqual({ puede: true });
  });

  it('la dirección vacía se nombra antes que el nombre vacío', () => {
    const r = motivoParaNoGuardar(campos({ direccion: '', nombre: '' }), VERIFICADOS);
    expect(r.puede).toBe(false);
    expect(r.puede === false && r.motivo).toMatch(/dirección/i);
  });

  it('el motivo del dominio EXPLICA la consecuencia, no dice sólo «inválido»', () => {
    const r = motivoParaNoGuardar(campos({ direccion: 'yo@gmail.com' }), VERIFICADOS);
    expect(r.puede).toBe(false);
    // Lo que tiene que quedar claro es que el problema aparece al MANDAR, no acá.
    expect(r.puede === false && r.motivo).toMatch(/goberna\.us/);
    expect(r.puede === false && r.motivo).toMatch(/rechaza|proveedor/i);
  });

  it('un «responder a» a medias se rechaza: ahí es donde el lead contesta', () => {
    const r = motivoParaNoGuardar(campos({ responderA: 'ventas10@' }), VERIFICADOS);
    expect(r.puede).toBe(false);
  });

  it('el «responder a» vacío es válido: es opcional', () => {
    expect(motivoParaNoGuardar(campos({ responderA: '   ' }), VERIFICADOS)).toEqual({ puede: true });
  });

  it('con un guardado en vuelo no se puede volver a apretar', () => {
    const r = motivoParaNoGuardar(campos(), VERIFICADOS, true);
    expect(r.puede).toBe(false);
  });
});

describe('lecturaDeErrorDeRemitente', () => {
  it('el 409 NO se lee como «algo que esta versión no reconoce»', () => {
    const texto = lecturaDeErrorDeRemitente(new ErrorApi('conflict', 409));
    expect(texto).toMatch(/ya está dado de alta/i);
    expect(texto).not.toMatch(/no reconoce/i);
  });

  it('lo que no es propio de esta pantalla se delega y sigue siendo específico', () => {
    // El 403 lo lee `lecturaDeError`, y ahí dice «los administra un supervisor» —
    // nunca «no tenés permiso» a secas, que se leería como haber perdido el de enviar.
    expect(lecturaDeErrorDeRemitente(new ErrorApi('nope', 403))).toMatch(/supervisor/i);
  });

  it('ninguna lectura suena a que no pasó nada', () => {
    for (const status of [400, 403, 404, 409, 429, 500, 502, 503]) {
      const texto = lecturaDeErrorDeRemitente(new ErrorApi('x', status));
      expect(texto.trim()).not.toBe('');
      expect(texto).not.toMatch(/^no hay/i);
    }
  });

  it('🔴 NINGUNA lectura de esta pantalla habla de un correo que no salió', () => {
    /**
     * 🔴 **Ésta era la delegación entera a `lecturaDeError`, y por eso el candado es
     * sobre TODOS los casos y no sobre uno.** Aquellas frases están redactadas para un
     * ENVÍO —«El correo no salió», «el correo se manda de nuevo», «el proveedor lo
     * rechazó»— y acá no se está mandando ningún correo: la hoja da de alta, edita,
     * desactiva y LEE la lista. Afirmar un envío fallido sobre cualquiera de esas
     * cuatro cosas es un hecho falso dicho con total seguridad, que es exactamente la
     * familia de defecto que este frente entero vino a arreglar (el pie del composer
     * prometiendo un `Reply-To` que no se mandaba).
     */
    const casos: unknown[] = [
      new Error('boom'),
      new TypeError('Failed to fetch'),
      new ErrorApi('', 400),
      new ErrorApi('', 401),
      new ErrorApi('', 403),
      new ErrorApi('', 404),
      new ErrorApi('', 409),
      new ErrorApi('', 429),
      new ErrorApi('', 500),
      new ErrorApi('x', 502),
      new ErrorApi('', 503),
      new ErrorApi('', 418),
    ];
    for (const c of casos) {
      expect(lecturaDeErrorDeRemitente(c)).not.toMatch(/correo no salió|el correo se manda|proveedor lo rechazó/i);
    }
  });

  it('tampoco afirma que NO se guardó: la misma función lee los fallos de LECTURA', () => {
    // ⚠️ Se usa para los cuatro caminos, y uno de ellos —la lista— no escribe nada.
    // Encima, con un fallo de red ni siquiera se sabe si el server llegó a escribir:
    // «el remitente no se guardó» sería una afirmación que nadie puede sostener.
    expect(lecturaDeErrorDeRemitente(new TypeError('Failed to fetch'))).not.toMatch(/no se guard/i);
    expect(lecturaDeErrorDeRemitente(new TypeError('Failed to fetch'))).toMatch(/no pudo hablar/i);
  });

  it('el 409 de acá y el 409 del envío dicen cosas distintas — el mismo número, dos hechos', () => {
    // 🔴 En el envío el 409 es `remitente_retirado` («el que elegiste voló») y acá es
    // `remitente_repetido` («ese buzón ya está»). Con una sola tabla, la pantalla
    // manda a arreglar algo que está perfectamente bien.
    const aca = lecturaDeErrorDeRemitente(new ErrorApi('', 409, undefined, undefined, 'remitente_repetido'));
    expect(aca).toMatch(/ya está dado de alta/i);
    expect(aca).not.toMatch(/elegí otro/i);
  });

  it('lo transversal SÍ se comparte: la sesión vencida y el SMTP no nombran ningún envío', () => {
    // El criterio para que algo viva en `lecturaCompartida` es que la frase sea cierta
    // en las DOS pantallas; si se rompe, este test se pone rojo antes que la vendedora.
    expect(lecturaDeErrorDeRemitente(new ErrorApi('', 401))).toMatch(/sesión venció/i);
    expect(lecturaDeErrorDeRemitente(new ErrorApi('', 503))).toMatch(/SMTP/);
  });
});
