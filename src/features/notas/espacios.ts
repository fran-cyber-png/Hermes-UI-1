import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/datos/cliente';

/**
 * LOS ESPACIOS DE TRABAJO DE LA LIBRETA (ADR 0046) — datos y reglas de lectura.
 *
 * Un espacio es DÓNDE VIVE una página, y por lo tanto quién la ve. La libreta
 * privada **no está en esta lista**: es implícita (`espacioId === null`), y por
 * eso el selector la dibuja aparte y siempre primera.
 *
 * A propósito NO entra a `PERSISTIBLES` (`src/lib/datos/persistencia.ts`), como
 * las notas: un espacio del que te sacaron, rehidratado desde IndexedDB, sería
 * un lugar que se ve en la pantalla y responde 403 al abrirlo. Peor que un
 * spinner.
 */

export interface Espacio {
  id: number;
  nombre: string;
  /** Quién lo creó: la única que puede agregar/sacar miembros y archivarlo. */
  creadaPor: string;
  creadoAt: string;
  /** Con la grafía con la que se guardaron — ver `mismoUsuario`. */
  miembros: string[];
}

/**
 * DÓNDE ESTOY PARADA. `null` = mi libreta privada.
 *
 * Es el mismo valor que viaja al server (`?espacio=`), así que no hay una
 * traducción en el medio que se pueda equivocar.
 */
export type DondeEstoy = number | null;

/**
 * ⚠️ **EL MISMO HUMANO TIENE DOS GRAFÍAS VIVAS EN PRODUCCIÓN.** Cerberus empuja
 * `Luz` y ella entra escribiendo `luz`; hay `usuario1` y `Usuario1`. Comparar
 * exacto no da error: da que **Luz no ve los botones de su propio espacio**.
 *
 * Es el gemelo en el front de `mismaVendedora` (server, `reparto/destino.ts`) y
 * de `esMio` en `features/eventos/`. Los tres tienen que decir lo mismo.
 */
export function mismoUsuario(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = (a ?? '').trim().toLowerCase();
  return x !== '' && x === (b ?? '').trim().toLowerCase();
}

/** ¿Puedo administrar este espacio (miembros, archivarlo)? Solo quien lo creó. */
export function puedoAdministrar(espacio: Espacio, vendedoraId: string | null | undefined): boolean {
  return mismoUsuario(espacio.creadaPor, vendedoraId);
}

/**
 * Cómo se nombra a alguien en pantalla. El `vendedora_id` es el username de
 * Cerberus y en cinco de las nueve personas es un correo entero
 * (`ventas10@grupogoberna.com`), que en una fila de 19rem no entra ni de cerca.
 */
export function nombreCorto(vendedoraId: string): string {
  const sinDominio = vendedoraId.includes('@') ? vendedoraId.slice(0, vendedoraId.indexOf('@')) : vendedoraId;
  return sinDominio.trim() || vendedoraId;
}

export function useEspacios() {
  return useQuery({
    queryKey: ['espacios'],
    queryFn: () => api<{ espacios: Espacio[] }>('/api/espacios'),
    select: (d) => d.espacios,
  });
}

/**
 * A QUIÉNES SE PUEDE INVITAR — el padrón que el server arma con la rueda del
 * reparto y `numero_vendedora`.
 *
 * Se pide solo cuando hace falta (`activo`): es la lista de una pantalla de
 * administración que se abre una vez por semana, no algo que la Libreta necesite
 * para dibujar una página.
 */
export function usePadron(activo: boolean) {
  return useQuery({
    queryKey: ['espacios', 'padron'],
    queryFn: () => api<{ personas: string[] }>('/api/espacios/padron'),
    select: (d) => d.personas,
    enabled: activo,
  });
}

export function useMutacionesEspacios() {
  const qc = useQueryClient();
  const invalidar = () => qc.invalidateQueries({ queryKey: ['espacios'] });

  const crear = useMutation({
    mutationFn: (v: { nombre: string; miembros: string[] }) =>
      api<{ ok: true; espacio: Espacio }>('/api/espacios', { method: 'POST', body: JSON.stringify(v) }),
    onSuccess: invalidar,
  });

  const agregarMiembro = useMutation({
    mutationFn: (v: { espacioId: number; vendedoraId: string }) =>
      api<{ ok: true; espacio: Espacio }>(`/api/espacios/${v.espacioId}/miembros`, {
        method: 'POST',
        body: JSON.stringify({ vendedoraId: v.vendedoraId }),
      }),
    onSuccess: invalidar,
  });

  const sacarMiembro = useMutation({
    mutationFn: (v: { espacioId: number; vendedoraId: string }) =>
      api<{ ok: true; espacio: Espacio }>(
        `/api/espacios/${v.espacioId}/miembros/${encodeURIComponent(v.vendedoraId)}`,
        { method: 'DELETE' },
      ),
    onSuccess: invalidar,
  });

  const archivar = useMutation({
    mutationFn: (espacioId: number) =>
      api<{ ok: true }>(`/api/espacios/${espacioId}/archivar`, { method: 'PATCH' }),
    onSuccess: invalidar,
  });

  return { crear, agregarMiembro, sacarMiembro, archivar };
}
