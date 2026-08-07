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
  cuerpoCrudo: string | Buffer,
  firmaRecibida: string | null | undefined,
  secreto: string | undefined,
): boolean {
  // Sin secreto, la puerta está cerrada. Punto. (Falla cerrado, no abierto.)
  if (!secreto) return false;
  if (!firmaRecibida) return false;

  // El emisor puede o no anteponer "sha256=". Aceptamos ambas formas.
  const recibida = firmaRecibida.startsWith("sha256=") ? firmaRecibida.slice(7) : firmaRecibida;

  // Hex ESTRICTO de 64, antes de decodificar: `Buffer.from(x, "hex")` trunca en
  // SILENCIO en el primer carácter no-hex, así que 64 zetas pasaban el chequeo
  // de largo y hacían tirar a `timingSafeEqual` — un 500 con stack en el log,
  // disparable desde internet sin credencial. Un hex inválido ya es firma
  // inválida, no una excepción.
  if (!/^[0-9a-f]{64}$/i.test(recibida)) return false;

  // Buffer directo cuando lo hay: la firma es de los BYTES del cable, y pasar
  // por utf8 solo es lossless si el cuerpo era utf8 válido.
  const esperada = createHmac("sha256", secreto).update(cuerpoCrudo).digest("hex");

  return timingSafeEqual(Buffer.from(recibida, "hex"), Buffer.from(esperada, "hex"));
}

/** El body CRUDO que el parser de JSON capturó para el webhook (ver `capturarCuerpoCrudo`). */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      cuerpoCrudo?: Buffer;
    }
  }
}

/**
 * Hook `verify` de `express.json()`: guarda los BYTES EXACTOS que llegaron,
 * solo para el webhook de WhatsApp. La firma HMAC se calcula sobre el crudo —
 * re-serializar `req.body` con `JSON.stringify` da otros bytes y una firma que
 * no casa nunca.
 *
 * `req.path` y en MINÚSCULAS a propósito: Express rutea case-insensitive, y
 * comparar el caso exacto dejaba `/WEBHOOK/whatsapp` ruteando al handler SIN
 * captura — con lo que la firma se validaba contra el vacío, una constante
 * replayable independiente del cuerpo. Es el mismo bug que `perimetro.ts` ya
 * documenta («las mayúsculas esquivaban la guardia»). La igualdad exacta (no
 * `startsWith`) evita además retener el cuerpo de rutas que no lo usan.
 */
const RUTAS_FIRMADAS = new Set(["/webhook/whatsapp", "/webhook/meta"]);

export function capturarCuerpoCrudo(req: Request, _res: Response, buf: Buffer): void {
  if (RUTAS_FIRMADAS.has(req.path.toLowerCase())) req.cuerpoCrudo = Buffer.from(buf);
}

/**
 * La puerta del webhook de la Cloud API (#107): Meta firma cada POST con
 * HMAC-SHA256 del body crudo usando el App Secret (`X-Hub-Signature-256`).
 * Sin firma válida, 403 y el handler NO corre — a la base no llega nada (el
 * parseo de JSON sí corre antes, porque la captura del crudo vive en él).
 *
 * FALLA CERRADO como `firmaValida` — sin `WHATSAPP_APP_SECRET`, todo POST se
 * rebota (medido el 29-jul: 0 POSTs en los logs de nginx de prod y el secreto
 * ausente; la ruta no tiene tráfico real todavía) — y RUIDOSO: el día que #52
 * suscriba el webhook con el secreto ausente, Meta comería 403 en silencio
 * hasta desactivar la suscripción, sin una línea que lo explique. El log dice
 * el MOTIVO; jamás la firma ni el secreto.
 */
export function exigirFirmaMeta(etiqueta: string) {
  return function exigirFirma(req: Request, res: Response, next: NextFunction): void {
  const firma = req.headers["x-hub-signature-256"];
  const rechazar = (motivo: string): void => {
    console.warn(`[${etiqueta}] POST rechazado (403): ${motivo}`, {
      tieneSecreto: Boolean(process.env.WHATSAPP_APP_SECRET),
      tieneFirma: typeof firma === "string",
      tieneCrudo: req.cuerpoCrudo !== undefined,
      path: req.path,
    });
    res.sendStatus(403);
  };

  if (req.cuerpoCrudo === undefined) {
    // «No pude leer el crudo» y «el crudo era vacío» NO son el mismo caso:
    // validar contra "" volvería la firma una constante replayable.
    rechazar("cuerpo_crudo_no_capturado");
    return;
  }
  const ok = firmaValida(
    req.cuerpoCrudo,
    typeof firma === "string" ? firma : undefined,
    process.env.WHATSAPP_APP_SECRET,
  );
  if (!ok) {
    rechazar(process.env.WHATSAPP_APP_SECRET ? "firma_invalida_o_ausente" : "falta_secreto");
    return;
  }
  next();
  };
}

/**
 * Las dos puertas, con el MISMO secreto: `WHATSAPP_APP_SECRET` es el App Secret
 * de la app de Meta (id `1958308695630264`), no algo de WhatsApp — la misma app
 * firma los eventos de la Cloud API, los de las Páginas y los de Instagram. Un
 * secreto por objeto sería otro secreto que mantener sin nada que gane, y en el
 * primer rotado quedaría uno viejo rebotando eventos en silencio.
 *
 * Se distinguen solo por la etiqueta del log: sin eso, un 403 no dice cuál de
 * los dos webhooks se está cayendo.
 */
export const exigirFirmaWhatsapp = exigirFirmaMeta("webhook-whatsapp");
export const exigirFirmaWebhookMeta = exigirFirmaMeta("webhook-meta");
