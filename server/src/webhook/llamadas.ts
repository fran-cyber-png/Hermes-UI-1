/**
 * LA CLAVE DE IDEMPOTENCIA DE UN EVENTO DE LLAMADA.
 *
 * Vive acá y no dentro de `whatsapp.ts` por la razón de siempre en este repo: `whatsapp.ts`
 * importa `db/client.js`, que se muere sin `DATABASE_URL`. Una regla que no se puede interrogar
 * sin levantar una base no se testea, y esta hay que testearla — el caso que importa es el
 * evento que Meta TODAVÍA NO MANDA.
 */

/**
 * Una misma llamada genera VARIOS webhooks con el MISMO `id`: `connect` cuando se establece,
 * `terminate` cuando corta, y los de estado (RINGING / ACCEPTED / REJECTED). Por eso la clave
 * lleva el evento.
 *
 * ⚠️ Con `externalId = id` a secas, el `onConflictDoNothing` se comía todo lo que llegara
 * después del primero — o sea el `terminate`, que es el único que trae `duration` y por lo
 * tanto el único que dice si la llamada sirvió. Se guardaba el timbre y se perdía el resultado.
 */
export function claveDeLlamada(c: {
  id: string;
  event?: string | null;
  status?: string | null;
}): string {
  return `${c.id}:${c.event ?? c.status ?? "sin_evento"}`;
}
