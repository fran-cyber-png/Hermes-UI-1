/**
 * QUÉ ES UN LINK — alcance, permiso y vencimiento, puros (ADR 0048).
 *
 * ══ LOS DOS EJES, Y LA INVARIANTE QUE LOS ATA ═══════════════════════════════
 *
 *   ALCANCE   quién lo puede abrir      `publico` · `goberna`
 *   PERMISO   qué puede hacer           `ver` · `editar`
 *
 * 🔴 **`editar` EXIGE `goberna`, y no es una validación: es el tipo.**
 *
 * Decisión del dueño (10-ago-2026): *sin login solo se lee; editar exige estar
 * logueado y tener permiso*. El motivo por el que eso no se puede relajar después
 * con un flag: **sin identidad no hay autoría**. Una página del equipo que un
 * anónimo puede reescribir no tiene a quién atribuirle el cambio, no se puede
 * auditar, y si el link se reenvía a un grupo, todo el grupo la edita. El
 * `ConfiguracionDeLink` de abajo **hace imposible representar ese estado**, en vez
 * de rechazarlo en un `if` que alguien puede mover.
 */

export const ALCANCES = ['publico', 'goberna'] as const;
export type Alcance = (typeof ALCANCES)[number];

export const PERMISOS = ['ver', 'editar'] as const;
export type Permiso = (typeof PERMISOS)[number];

/**
 * Cómo se pide un link. Las dos ramas son la invariante hecha tipo:
 * **no hay forma de escribir `{ alcance: 'publico', permiso: 'editar' }`.**
 */
export type ConfiguracionDeLink =
  | { alcance: 'publico'; permiso: 'ver'; venceAt?: Date | null }
  | { alcance: 'goberna'; permiso: Permiso; venceAt?: Date | null };

/**
 * Normaliza lo que llegó por HTTP a una configuración válida, o dice por qué no.
 *
 * ⚠️ **Un permiso `editar` sobre un alcance `publico` se RECHAZA, no se degrada a
 * `ver`.** Degradar en silencio le daría a la vendedora un link que hace menos de
 * lo que la pantalla le dijo — y en un frente sobre quién puede tocar qué, esa es
 * la clase de sorpresa que después nadie puede explicar.
 */
export function configuracionDeLink(entrada: {
  alcance?: unknown;
  permiso?: unknown;
  venceAt?: unknown;
}): { ok: true; config: ConfiguracionDeLink } | { ok: false; motivo: string } {
  const alcance = entrada.alcance === undefined ? 'publico' : entrada.alcance;
  if (!ALCANCES.includes(alcance as Alcance)) {
    return { ok: false, motivo: `alcance inválido (esperaba ${ALCANCES.join(' o ')})` };
  }
  const permiso = entrada.permiso === undefined ? 'ver' : entrada.permiso;
  if (!PERMISOS.includes(permiso as Permiso)) {
    return { ok: false, motivo: `permiso inválido (esperaba ${PERMISOS.join(' o ')})` };
  }

  if (alcance === 'publico' && permiso === 'editar') {
    return {
      ok: false,
      motivo: 'un link público es de solo lectura: para que alguien edite, tiene que entrar a Hermes',
    };
  }

  const venceAt = fechaDeVencimiento(entrada.venceAt);
  if (venceAt === 'invalida') return { ok: false, motivo: 'la fecha de vencimiento no se entiende' };

  return {
    ok: true,
    config:
      alcance === 'publico'
        ? { alcance: 'publico', permiso: 'ver', venceAt }
        : { alcance: 'goberna', permiso: permiso as Permiso, venceAt },
  };
}

/**
 * `null`/ausente = **no vence**, que es el default y lo que corresponde al link de
 * un lead: uno que se apaga solo se muere justo cuando el lead vuelve a preguntar
 * el precio (ADR 0047 §6). El vencimiento es una elección, no una política.
 */
function fechaDeVencimiento(valor: unknown): Date | null | 'invalida' {
  if (valor === undefined || valor === null || valor === '') return null;
  if (typeof valor !== 'string' && typeof valor !== 'number') return 'invalida';
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? 'invalida' : d;
}

/**
 * ¿Este link todavía sirve?
 *
 * ⚠️ **El reloj se inyecta**, como en `cola/urgencia.ts`: un vencimiento que
 * depende de `new Date()` adentro de la función no se puede testear sin esperar.
 *
 * ⚠️ Y vencido **no se distingue** de inexistente hacia afuera: el 404 es el
 * mismo. Decir «esto venció» le confirma a un desconocido que el token existió.
 */
export function estaVigente(link: { venceAt: Date | null }, ahora: Date): boolean {
  return link.venceAt === null || link.venceAt.getTime() > ahora.getTime();
}

/**
 * ¿Quien abre el link puede EDITAR la página?
 *
 * Pide las dos cosas, y por eso recibe las dos: el permiso guardado en el link
 * **y** que del otro lado haya una sesión de verdad. Un link con `permiso:
 * 'editar'` abierto sin sesión es de solo lectura — que es el caso que ocurre
 * siempre en la práctica, porque un link `goberna` sin sesión ni siquiera llega a
 * ver el contenido.
 */
export function puedeEditarPorLink(link: { alcance: Alcance; permiso: Permiso }, haySesion: boolean): boolean {
  return link.alcance === 'goberna' && link.permiso === 'editar' && haySesion;
}
