import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifica la firma HMAC-SHA256 de un webhook.
 *
 * Es la única cosa que separa "una venta real de Cerberus" de "cualquiera que descubrió la URL".
 * Sin esto, alguien podría inventarnos ventas falsas y envenenar la optimización de Meta con
 * conversiones que nunca ocurrieron.
 *
 * Dos reglas que la hacen segura:
 *   · Compara con `timingSafeEqual` — no con `===`. Comparar strings con `===` filtra, por el
 *     tiempo que tarda, cuántos caracteres del principio coinciden; un atacante paciente puede
 *     adivinar la firma byte a byte. `timingSafeEqual` tarda lo mismo siempre.
 *   · Falla CERRADO. Sin secreto configurado, o con cualquier duda, devuelve false. Nunca se
 *     abre la puerta por un descuido de configuración.
 */
export function firmaValida(
  cuerpoCrudo: string,
  firmaRecibida: string | null | undefined,
  secreto: string | undefined,
): boolean {
  // Sin secreto, la puerta está cerrada. Punto. (Falla cerrado, no abierto.)
  if (!secreto) return false;
  if (!firmaRecibida) return false;

  // El emisor puede o no anteponer "sha256=". Aceptamos ambas formas.
  const recibida = firmaRecibida.startsWith("sha256=") ? firmaRecibida.slice(7) : firmaRecibida;

  const esperada = createHmac("sha256", secreto).update(cuerpoCrudo, "utf8").digest("hex");

  // Si los largos no coinciden, `timingSafeEqual` tira — así que lo chequeamos antes y devolvemos
  // false en vez de explotar. Un largo equivocado ya es firma inválida.
  if (recibida.length !== esperada.length) return false;

  return timingSafeEqual(Buffer.from(recibida, "hex"), Buffer.from(esperada, "hex"));
}
