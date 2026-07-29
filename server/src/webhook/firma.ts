import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

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

/** El body CRUDO que el parser de JSON capturó para /webhook/* (ver `capturarCuerpoCrudo`). */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      cuerpoCrudo?: string;
    }
  }
}

/**
 * Hook `verify` de `express.json()`: guarda los BYTES EXACTOS que llegaron,
 * solo para `/webhook/*`. La firma HMAC se calcula sobre el crudo — re-serializar
 * `req.body` con `JSON.stringify` da otros bytes (espacios, orden, unicode) y
 * una firma que no casa nunca. Se acota a /webhook para no retener el cuerpo
 * de cada request de la API sin necesidad.
 */
export function capturarCuerpoCrudo(req: Request, _res: Response, buf: Buffer): void {
  if (req.url.startsWith("/webhook")) req.cuerpoCrudo = buf.toString("utf8");
}

/**
 * La puerta del webhook de la Cloud API (#107): Meta firma cada POST con
 * HMAC-SHA256 del body crudo usando el App Secret (`X-Hub-Signature-256`).
 * Sin firma válida, 403 y el handler NO corre — nada se guarda.
 *
 * FALLA CERRADO como `firmaValida`: sin `WHATSAPP_APP_SECRET` configurado, todo
 * POST se rebota. Hoy eso no rompe nada — medido el 29-jul: 0 POSTs en los logs
 * de nginx de prod y el secreto ausente, o sea que la ruta no tiene tráfico
 * real — y es la condición para activar la vía realtime (#52) sin abrir una
 * puerta que acepta payloads de cualquiera.
 */
export function exigirFirmaWhatsapp(req: Request, res: Response, next: NextFunction): void {
  const firma = req.headers["x-hub-signature-256"];
  const ok = firmaValida(
    req.cuerpoCrudo ?? "",
    typeof firma === "string" ? firma : undefined,
    process.env.WHATSAPP_APP_SECRET,
  );
  if (!ok) {
    res.sendStatus(403);
    return;
  }
  next();
}
