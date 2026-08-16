/**
 * «ESTA PERSONA YA TE COMPRÓ» — la marca de la fila de la cola (#133), pura.
 *
 * ── Por qué existe ──
 * 140 de las 1.997 conversaciones vivas son de gente que ya le pagó a Goberna
 * (11 de ellas VIP). En la cola se ven **exactamente igual que un desconocido**,
 * siendo el lead más barato de convertir que hay. La marca es lo que las separa
 * en un vistazo, sin abrir la conversación ni esperar a Cerberus.
 *
 * ── Qué dice, y por qué así ──
 * Tres escalones del MISMO hecho, con la palabra que la vendedora usa:
 *
 *   · `Cliente`   — compró una vez. El «×1» sería ruido: ya lo dice «Cliente».
 *   · `Cliente ×3`— recompró. Acá el número ES el dato: quien volvió a comprar
 *                   tres veces se trata distinto de quien compró una.
 *   · `VIP`       — el escalón que el conteo no puede dar (lo decide el padrón,
 *                   por gasto). Se nombra VIP porque es como se lo llama.
 *
 * ── Lo que NO hace ──
 * No inventa. Una fila sin el campo (el radar y la agenda arman `Conversacion`
 * sin él, y un server sin el `db:push` tampoco lo trae) devuelve `null`: la
 * ausencia de dato NO es «no es cliente». Y un nivel desconocido se ignora en
 * vez de pintar una píldora sin significado.
 *
 * El color y la forma viven en el componente (misma división que
 * `panel/estadoContacto.ts`): acá se decide QUÉ se dice, no cómo se ve.
 */

export type NivelCliente = 'vip' | 'recompro' | 'compro';

const NIVELES: readonly string[] = ['vip', 'recompro', 'compro'];

/** Un nivel que el front no conoce no se pinta: se ignora. */
function esNivel(x: unknown): x is NivelCliente {
  return typeof x === 'string' && NIVELES.includes(x);
}

export interface MarcaCliente {
  nivel: NivelCliente;
  /** Lo que se lee en la píldora. Corto: la fila mide 360 px y ya lleva mucho. */
  texto: string;
  /** El `title`, donde entra el detalle sin gastar ancho. */
  titulo: string;
}

/** Lo mínimo que la marca necesita de una fila de la cola. */
export interface FilaConCliente {
  cliente_nivel?: NivelCliente | string | null;
  cliente_compras?: number | null;
}

export function marcaDeCliente(fila: FilaConCliente): MarcaCliente | null {
  const nivel = fila.cliente_nivel;
  if (!esNivel(nivel)) return null;

  // Un conteo que no llegó (o llegó roto) no se muestra: antes «Cliente» a secas
  // que un «×0» que le dice a la vendedora algo que no es cierto.
  const n = typeof fila.cliente_compras === 'number' && fila.cliente_compras > 0
    ? Math.trunc(fila.cliente_compras)
    : null;
  const veces = n ? `${n} ${n === 1 ? 'vez' : 'veces'}` : null;

  if (nivel === 'vip') {
    return { nivel, texto: 'VIP', titulo: veces ? `Cliente VIP — ya te compró ${veces}` : 'Cliente VIP' };
  }

  if (nivel === 'recompro') {
    return {
      nivel,
      texto: n ? `Cliente ×${n}` : 'Cliente',
      titulo: veces ? `Ya te compró ${veces}` : 'Ya te compró más de una vez',
    };
  }

  return { nivel, texto: 'Cliente', titulo: 'Ya te compró una vez' };
}
