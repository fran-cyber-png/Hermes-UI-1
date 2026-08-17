import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/datos/cliente';
import { nombreCorto } from './espacios';
import type { Alcance, Permiso } from './notas';

/**
 * EL REGISTRO DE AUDITORÍA DEL LINK — la lectura en castellano, pura.
 *
 * El vocabulario y los números viven en el SERVER (`espacios/auditoriaLink.ts`):
 * acá solo se decide **cómo se dice cada cosa**. Es la misma separación que los
 * motivos del bot (`features/canales/bot.ts`) y los tipos de evento de contacto
 * (ADR 0037), y por el mismo motivo: un `switch` adentro de un componente no se
 * puede interrogar sobre el valor que todavía no existe.
 *
 * 🔴 **NINGUNA función de acá tira ante un valor que no conoce.** Un `evento` o un
 * `motivo` nuevo (server nuevo, front viejo — la ventana entre N4 y N5 dura horas)
 * cae en una frase honesta y genérica. Un registro de auditoría que se rompe con
 * un valor inesperado es un registro que deja de estar justo cuando algo raro pasó.
 */

/** Espejo del server. Copia del vocabulario; el candado es `auditoria.paridad.test.ts`. */
export const EVENTOS_DE_LINK = ['creado', 'reconfigurado', 'usado', 'cortado'] as const;
export type EventoDeLink = (typeof EVENTOS_DE_LINK)[number];

export const MOTIVOS_DE_CORTE = ['sacaron_al_miembro', 'archivaron_el_espacio'] as const;
export type MotivoDeCorte = (typeof MOTIVOS_DE_CORTE)[number];

export interface EventoAnotado {
  id: number;
  notaId: number;
  /** El apodo del link: 6 hex. **No es el token** y no sirve para abrir nada. */
  etiqueta: string;
  evento: EventoDeLink;
  /** `null` = **no se puede saber** (apertura de un link público). Nunca «falta el dato». */
  quien: string | null;
  alcance: Alcance | null;
  permiso: Permiso | null;
  venceAt: string | null;
  motivo: MotivoDeCorte | null;
  at: string;
}

export interface ResumenDeLink {
  etiqueta: string;
  aperturas: number;
  personasDeGoberna: number;
  anonimas: number;
  ultimaApertura: string | null;
  creadoPor: string | null;
  creadoAt: string | null;
  cortadoAt: string | null;
  reconfiguraciones: number;
}

export interface Registro {
  eventos: EventoAnotado[];
  links: ResumenDeLink[];
  personas: string[];
  /**
   * 🔴 `true` = **no se pudo saber**, y la pantalla lo dice con esas palabras.
   * Sin esto, una migración sin aplicar se ve igual que un link que nadie abrió.
   */
  sinRegistro: boolean;
}

/**
 * El registro de una página.
 *
 * ⚠️ **`enabled` con el modal abierto**: es una consulta que no le sirve a nadie
 * mientras la pantalla no se está mirando, y son N filas por página compartida.
 *
 * A propósito NO entra a `PERSISTIBLES` (`lib/datos/persistencia.ts`), como todo
 * lo de la Libreta: un registro de auditoría rehidratado de IndexedDB mostraría
 * «3 aperturas» de la semana pasada como si fueran de ahora, y en esta superficie
 * un número viejo presentado como actual es peor que un spinner.
 */
export function useRegistroDeLink(notaId: number | null, activo: boolean) {
  return useQuery({
    queryKey: ['notas', 'link-historial', notaId],
    queryFn: () => api<{ ok: true } & Registro>(`/api/notas/${notaId}/link/historial`),
    enabled: activo && notaId !== null,
  });
}

/**
 * CÓMO SE NOMBRA A QUIEN HIZO ALGO.
 *
 * `null` NO es «desconocido» ni un hueco: es **alguien sin cuenta**, que es todo
 * lo que se puede saber de quien abre un link público (y todo lo que se quiere
 * saber — ver `db/links.ts` en el server). Se dice así, en positivo.
 */
export function quienSeLee(quien: string | null): string {
  return quien === null ? 'Alguien con el link' : nombreCorto(quien);
}

/** Cómo se lee la configuración de un link, en una línea. */
export function configuracionSeLee(alcance: Alcance | null, permiso: Permiso | null): string {
  if (alcance === null) return '';
  if (alcance === 'publico') return 'cualquiera con el link, solo lectura';
  return permiso === 'editar' ? 'solo gente de Goberna, puede editar' : 'solo gente de Goberna, solo lectura';
}

export interface FraseDeEvento {
  /** El renglón principal, ya armado: «luz creó el link a1b2c3». */
  frase: string;
  /** El renglón chico de abajo, o `''` si no hay nada que agregar. */
  detalle: string;
}

/**
 * QUÉ DICE CADA RENGLÓN del registro.
 *
 * ⚠️ **Los verbos van en PASADO y describen el hecho**, no su interpretación — la
 * misma regla con la que ADR 0049 nombró las etapas y con la que
 * `resultados/medicion.ts` prohíbe las palabras causales. «Se abrió» y no «lo
 * leyeron»: sabemos que la página se sirvió, no que alguien la haya leído.
 */
export function fraseDeEvento(e: EventoAnotado): FraseDeEvento {
  const quien = quienSeLee(e.quien);
  const config = configuracionSeLee(e.alcance, e.permiso);
  const vence = e.venceAt
    ? `vence el ${new Date(e.venceAt).toLocaleDateString('es-PE', { day: 'numeric', month: 'short' })}`
    : 'no vence';

  switch (e.evento) {
    case 'creado':
      return { frase: `${quien} creó el link ${e.etiqueta}`, detalle: config ? `${config} · ${vence}` : '' };

    case 'reconfigurado':
      // «Cambió los permisos» y no «creó uno nuevo»: el token repartido es el
      // MISMO (ADR 0048). Decir otra cosa haría creer que el link viejo murió.
      return { frase: `${quien} cambió los permisos del link ${e.etiqueta}`, detalle: config ? `${config} · ${vence}` : '' };

    case 'usado':
      // 🔴 «Se abrió», nunca «entró una persona»: una apertura anónima puede ser
      // alguien que recargó la página. Contar personas donde solo hay aperturas es
      // exactamente el número que este frente no puede sostener.
      return {
        frase: e.quien === null ? `Se abrió el link ${e.etiqueta}` : `${quien} abrió el link ${e.etiqueta}`,
        detalle: e.quien === null ? 'sin cuenta: no se sabe quién' : 'con su cuenta de Goberna',
      };

    case 'cortado':
      return { frase: fraseDeCorte(quien, e), detalle: 'el link dejó de servir en ese momento' };

    default:
      // Un evento que este front no conoce se MUESTRA igual, con lo que se sabe de
      // él. Esconderlo sería un agujero en el registro; tirar, un registro caído.
      return { frase: `${quien} hizo algo con el link ${e.etiqueta}`, detalle: String((e as EventoAnotado).evento) };
  }
}

/**
 * Los dos cortes que pasan SIN que nadie apriete el botón (ADR 0048).
 *
 * 🔴 Sin esta distinción, sacar a alguien de un espacio aparece en el registro
 * como si esa persona hubiera ido link por link cortándolos — o peor, con
 * `quien: null` se leería como que se cortaron solos.
 */
function fraseDeCorte(quien: string, e: EventoAnotado): string {
  if (e.motivo === 'archivaron_el_espacio') return `Se cortó el link ${e.etiqueta} al archivar el espacio`;
  if (e.motivo === 'sacaron_al_miembro') return `El link ${e.etiqueta} se cortó al sacar a ${quien} del espacio`;
  return `${quien} cortó el link ${e.etiqueta}`;
}

/**
 * CUÁNDO, en criollo. Discord dice «Last Saturday at 11:45» y para lo reciente
 * eso se lee mejor que una fecha; para lo viejo, al revés.
 */
export function cuandoSeLee(iso: string, ahora: Date = new Date()): string {
  const fecha = new Date(iso);
  const minutos = Math.round((ahora.getTime() - fecha.getTime()) / 60_000);
  const hora = fecha.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });

  if (minutos < 1) return 'recién';
  if (minutos < 60) return `hace ${minutos} min`;

  /**
   * 🔴 **«Hoy» y «ayer» son días del CALENDARIO, no ventanas de 24 y 48 horas.**
   *
   * Con minutos transcurridos, algo de ayer a las 14:00 mirado hoy a las 12:00 son
   * 22 horas y salía **«hoy 14:00»** — una fecha lisa y llanamente falsa, y la
   * clase de falsedad que en un registro de auditoría no se nota nunca, porque la
   * hora que muestra al lado es la correcta.
   */
  const diasDeDiferencia = Math.round(
    (new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()).getTime() -
      new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()).getTime()) /
      86_400_000,
  );
  if (diasDeDiferencia === 0) return `hoy ${hora}`;
  if (diasDeDiferencia === 1) return `ayer ${hora}`;
  return `${fecha.toLocaleDateString('es-PE', { day: 'numeric', month: 'short' })} ${hora}`;
}

/**
 * ══ EL VENCIMIENTO, COMO LO PIDE LA PANTALLA ════════════════════════════════
 *
 * Discord ofrece plazos, no un calendario: nadie quiere elegir el 16 de
 * septiembre, quiere «que dure una semana». El server sigue recibiendo una fecha
 * (`venceAt`), así que la traducción vive acá, pura y con reloj inyectado.
 */
export const PLAZOS = [
  { v: 'nunca', t: 'No vence', horas: null },
  { v: '30m', t: '30 minutos', horas: 0.5 },
  { v: '1h', t: '1 hora', horas: 1 },
  { v: '6h', t: '6 horas', horas: 6 },
  { v: '12h', t: '12 horas', horas: 12 },
  { v: '1d', t: '1 día', horas: 24 },
  { v: '7d', t: '7 días', horas: 24 * 7 },
  { v: '30d', t: '30 días', horas: 24 * 30 },
] as const;

export type Plazo = (typeof PLAZOS)[number]['v'] | 'conservar';

/**
 * El `venceAt` que va al server.
 *
 * 🔴 **`'conservar'` REENVÍA la fecha que el link ya tiene; no manda «nada».**
 *
 * Omitirla parece lo natural y es el bug: el body la manda como `venceAt ?? null`
 * y, del otro lado, `configuracionDeLink` trata `undefined` igual que `null` — o
 * sea **«no vence»**. Con lo natural, abrir este modal para cambiar el ALCANCE de
 * un link que vence el 20 y apretar «Guardar» le sacaba el vencimiento sin que
 * nadie lo pidiera y sin un solo síntoma en la pantalla.
 *
 * Reenviar la misma fecha es idempotente y no necesita que el server aprenda a
 * distinguir `undefined` de `null` — una distinción que en HTTP se pierde sola.
 */
export function venceAtDelPlazo(
  plazo: Plazo,
  /** Lo que el link tiene hoy. Es lo que `'conservar'` devuelve. */
  actual: string | null | undefined,
  ahora: Date = new Date(),
): string | null {
  if (plazo === 'conservar') return actual ?? null;
  const elegido = PLAZOS.find((p) => p.v === plazo);
  if (!elegido || elegido.horas === null) return null;
  return new Date(ahora.getTime() + elegido.horas * 3_600_000).toISOString();
}

/**
 * Con qué plazo abre el desplegable.
 *
 * ⚠️ Un link que ya vence en una fecha **no se mapea al preset más parecido**:
 * arranca en `'conservar'`, y la pantalla muestra esa fecha. Elegir el preset más
 * cercano correría el vencimiento unas horas cada vez que alguien abre el modal y
 * guarda, sin que nadie lo haya pedido.
 */
export function plazoInicial(venceAt: string | null | undefined): Plazo {
  return venceAt ? 'conservar' : 'nunca';
}
