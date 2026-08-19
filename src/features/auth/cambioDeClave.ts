import { useMutation } from '@tanstack/react-query';
import { api } from '../../lib/datos/cliente';

/**
 * CAMBIAR MI CONTRASEÑA — lo que se puede saber ANTES de molestar al server.
 *
 * La que juzga es Cerberus (Django, con sus validadores) a través de
 * `POST /api/auth/cambiar-clave`; el server de Hermes hace de manos
 * (`server/src/cerberus/cambiarClave.ts`). Esta función solo evita el viaje
 * cuando el formulario no puede estar bien de ninguna manera, y por eso sus
 * reglas son las que NO dependen de la cuenta: campos vacíos, las dos nuevas
 * que no coinciden, la nueva igual a la actual, y el mínimo de largo.
 *
 * ⚠️ El `8` es el `MinimumLengthValidator` de Django con su default, que es lo
 * que Cerberus tiene configurado hoy (`AUTH_PASSWORD_VALIDATORS`). No es la
 * regla: es un atajo. Si allá cambia, la que manda sigue siendo la del server
 * —su mensaje llega tal cual a la pantalla— y lo peor que pasa acá es un viaje
 * de más o de menos, nunca una clave aceptada que Cerberus rechazaría.
 */
export const LARGO_MINIMO = 8;

export interface CamposDeClave {
  actual: string;
  nueva: string;
  repetir: string;
}

/** `null` = se puede mandar. Si no, el motivo, en la voz de la pantalla. */
export function motivoParaNoCambiar(c: CamposDeClave): string | null {
  if (!c.actual) return 'Escribí tu contraseña actual.';
  if (!c.nueva) return 'Escribí la contraseña nueva.';
  if (c.nueva.length < LARGO_MINIMO) return `La nueva tiene que tener al menos ${LARGO_MINIMO} caracteres.`;
  if (c.nueva === c.actual) return 'La nueva tiene que ser distinta de la actual.';
  if (c.repetir !== c.nueva) return 'Las dos contraseñas nuevas no coinciden.';
  return null;
}

export function useCambiarClave() {
  return useMutation({
    mutationFn: (c: { claveActual: string; claveNueva: string }) =>
      api<{ ok: true }>('/api/auth/cambiar-clave', { method: 'POST', body: JSON.stringify(c) }),
  });
}
