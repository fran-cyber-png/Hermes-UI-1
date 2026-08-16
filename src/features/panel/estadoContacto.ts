import { resumenCompras, type Ficha, type ResumenCompras } from '../cerberus/ficha';
import type { NivelCliente } from '../../dominio/cliente';

/**
 * QUIÉN ES ESTA PERSONA — la primera pregunta del panel, resuelta sin DOM.
 *
 * ── El problema que resuelve ──
 * 124 de las conversaciones abiertas hoy YA COMPRARON (11 de ellas por más de
 * mil dólares) y en pantalla se ven **idénticas a un desconocido**: mismo marco
 * blanco, mismo encabezado, y la diferencia escondida en un texto que hay que
 * leer. Leer cuesta un segundo por conversación y ochenta veces por turno.
 *
 * Acá se decide, de una sola vez, qué dice y de qué color se pinta la banda de
 * arriba. Dos ejes que NO se colapsan:
 *
 *   · **quién es** (`tono`) — cliente / lead nuevo / no se pudo saber. Es de la
 *     PERSONA y sale de Cerberus.
 *   · **cómo va la conversación** (`enfriada`) — es del HILO y sale de las
 *     señales (ADR 0016). Un cliente que se enfrió sigue siendo cliente.
 *
 * `acento` es el arbitraje entre los dos, y está acá —no en el JSX— justamente
 * para poder discutirlo con un test: **quién es manda**; el frío pinta solo
 * cuando no hay nada más fuerte que decir.
 *
 * Sin oro en ninguna rama: en Hermes el oro significa tiempo que se acaba, y ni
 * «cliente» ni «lead nuevo» son un reloj.
 */

export type TonoContacto = 'cliente' | 'nuevo' | 'sin-saber' | 'cargando' | 'otro-canal';

/** El color de la banda. Semántico: el mapeo a clases vive en el componente. */
export type AcentoContacto = 'cliente' | 'frio' | 'alerta' | 'neutro';

export interface EntradaEstadoContacto {
  /** Hay un teléfono con el que buscar en Cerberus (WhatsApp sí, Meta no). */
  conTelefono: boolean;
  cargando: boolean;
  /** La consulta falló (red, 500, timeout). */
  error: boolean;
  ficha: Ficha | undefined;
  /** Señal automática del hilo: cotizada y sin respuesta hace N días. */
  enfriada: boolean;
  /**
   * Lo que la COLA ya sabía de esta persona (#133): el nivel del cruce contra el
   * padrón local, que viaja en la fila. Solo se usa MIENTRAS la ficha viva
   * viaja; en cuanto Cerberus contesta —lo que sea que conteste— manda Cerberus.
   */
  padron?: NivelCliente | null;
}

export interface EstadoContacto {
  tono: TonoContacto;
  acento: AcentoContacto;
  /** Lo que se lee, grande, en la banda. */
  titulo: string;
  /** La cifra que cambia el trato. `null` cuando no hay compras que sumar. */
  compras: ResumenCompras | null;
  /** La línea de abajo. `null` = no hace falta explicar nada. */
  detalle: string | null;
  enfriada: boolean;
}

export function estadoDelContacto(e: EntradaEstadoContacto): EstadoContacto {
  const base = { compras: null, enfriada: e.enfriada } as const;

  if (!e.conTelefono) {
    return {
      ...base,
      tono: 'otro-canal',
      acento: 'neutro',
      titulo: 'Sin ficha',
      detalle: 'La ficha de Cerberus se busca por teléfono, y este canal no lo trae.',
    };
  }

  if (e.cargando) {
    /**
     * EL DATO QUE YA TENÍAMOS (#133). La ficha tiene un techo de 12 s porque
     * Cerberus a veces deja la conexión abierta sin responder; durante esos
     * segundos el panel decía «Buscando…» aunque la fila de la cola YA supiera
     * —del cruce contra el padrón local— que esta persona compró tres veces.
     *
     * Es PROVISIONAL y se dice que lo es: no trae cifras (el padrón local no
     * guarda montos, a propósito) y la llamada viva lo reemplaza entero apenas
     * llega, conteste lo que conteste.
     */
    if (e.padron) {
      return {
        ...base,
        tono: 'cliente',
        acento: 'cliente',
        titulo: 'Cliente',
        detalle: 'Ya te compró. Confirmando con Cerberus…',
      };
    }
    return { ...base, tono: 'cargando', acento: 'neutro', titulo: 'Buscando en Cerberus…', detalle: null };
  }

  // JAMÁS mostrar «no figura» cuando lo que pasó es que la API falló: son cosas
  // opuestas y la vendedora actúa distinto en cada una.
  if (e.error || e.ficha?.estado === 'error') {
    return {
      ...base,
      tono: 'sin-saber',
      acento: 'alerta',
      titulo: 'No se pudo saber',
      detalle: 'Cerberus no respondió. No es que sea nueva: es que la ficha no cargó.',
    };
  }

  if (e.ficha?.estado === 'cliente') {
    const compras = resumenCompras(e.ficha.ventas);
    return {
      tono: 'cliente',
      // Un cliente que se enfrió SIGUE siendo cliente: el verde no cede. Que la
      // conversación esté fría lo dice su etiqueta automática, al lado.
      acento: 'cliente',
      titulo: 'Cliente',
      compras,
      detalle: compras ? null : 'Es cliente, pero sin ventas cargadas.',
      enfriada: e.enfriada,
    };
  }

  if (e.ficha?.estado === 'nuevo') {
    /**
     * «ES UN LEAD NUEVO» ES UNA AFIRMACIÓN, Y PUEDE SER FALSA (#133).
     *
     * Esa frase habla de UNA fuente —el `buscar?q=` de Cerberus por teléfono— y
     * la dice como si hablara de todas. Si el padrón lo tiene como cliente y
     * Cerberus no lo encuentra con ESTE número, lo honesto no es elegir una de
     * las dos: es decir que no cierran. Tratar como desconocido a alguien que ya
     * compró cuesta mucho más que hacer verificar diez segundos.
     */
    if (e.padron) {
      return {
        ...base,
        tono: 'sin-saber',
        acento: 'alerta',
        titulo: 'No figura con este número',
        detalle:
          'Pero ya te compró según el padrón: en Cerberus puede estar cargado con otro teléfono. ' +
          'Verificá antes de tratarlo como nuevo.',
      };
    }
    return {
      ...base,
      tono: 'nuevo',
      // Acá sí: no hay un hecho más fuerte que contar, así que el frío pinta.
      acento: e.enfriada ? 'frio' : 'neutro',
      titulo: 'Lead nuevo',
      detalle: e.enfriada
        ? 'Ya tiene precio y dejó de contestar.'
        : 'Todavía no figura en Cerberus.',
    };
  }

  // Sin datos y sin error: la consulta ni siquiera arrancó (canal sin teléfono
  // ya se atajó arriba). Se dice, no se inventa un estado.
  return { ...base, tono: 'cargando', acento: 'neutro', titulo: 'Buscando en Cerberus…', detalle: null };
}
