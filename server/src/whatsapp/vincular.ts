import "dotenv/config";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@whatsmeow-node/whatsmeow-node";
import QRCode from "qrcode";

/** Dónde se escribe el QR como imagen escaneable. */
const RUTA_QR = join(tmpdir(), "hermes-wa-qr.png");

/**
 * CONSOLA DE VINCULACIÓN — para enlazar un número de ventas y probar.
 *
 * Este script es el "otro entorno" de la decisión D13: vincula UNA vez el número
 * de Goberna a una sesión que vive del lado del servidor, y a partir de ahí queda
 * conectada. No es la app de la vendedora — es la herramienta del operador.
 *
 * Qué hace:
 *   1. Abre (o retoma) una sesión guardada en `.wa-sessions/<numero>.db`.
 *   2. Si el número no está vinculado, pide un CÓDIGO DE 8 DÍGITOS: lo ponés en el
 *      teléfono en WhatsApp → Dispositivos vinculados → "Vincular con número".
 *   3. Una vez conectado, imprime cada mensaje que entra — para ver que funciona.
 *
 * Correr:  npm run wa:vincular -- 51955135507
 *          (el número propio de Goberna, con código de país, solo dígitos)
 *
 * La sesión queda en `.wa-sessions/` (gitignored). Es la credencial de la cuenta:
 * no se commitea, no se comparte.
 */

const numero = process.argv[2]?.replace(/\D/g, "");
if (!numero) {
  console.error("Falta el número. Uso: npm run wa:vincular -- 51955135507");
  process.exit(1);
}

const dir = new URL("../../.wa-sessions/", import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
const store = `${dir}${numero}.db`;

console.log(`\n📱 Vinculando el número ${numero}`);
console.log(`   Sesión: ${store}\n`);

const client = createClient({ store });

// Vinculación por QR: cada vez que WhatsApp emite un código, lo renderizamos como
// PNG para escanear con la cámara del teléfono. El QR se rota cada ~20s hasta que
// se escanea. (El pairCode por número devolvía 400 en este número; el QR es el
// camino robusto.)
client.on("qr", async ({ code }) => {
  try {
    await QRCode.toFile(RUTA_QR, code, { width: 400, margin: 2 });
    console.log(`\n📷 QR listo: ${RUTA_QR}`);
    console.log("En el teléfono: WhatsApp → Ajustes → Dispositivos vinculados →");
    console.log("Vincular un dispositivo → escaneá el QR.\n");
  } catch (err) {
    console.error("No pude generar el QR:", (err as Error).message);
  }
});

// Cada mensaje que entra: el corazón de "ir probando". Mostramos de quién y qué,
// sin guardar nada todavía — esto es solo para ver que el stream llega.
client.on("message", ({ info, message }) => {
  const texto =
    (message as { conversation?: string; extendedTextMessage?: { text?: string } }).conversation ??
    (message as { extendedTextMessage?: { text?: string } }).extendedTextMessage?.text ??
    "(no es texto)";
  const flecha = info.isFromMe ? "→ (yo)" : "←";
  console.log(`${flecha} [${info.pushName || info.chat}] ${texto}`);
});

client.on("connected", ({ jid }) => {
  console.log(`\n✅ Conectado como ${jid}. La sesión quedó guardada.`);
  console.log("   Ahora escribile a este número desde otro teléfono y miralo aparecer acá.\n");
});

client.on("temporary_ban", ({ code, expire }) => {
  console.error(`\n⛔ WhatsApp suspendió temporalmente el número (código ${code}). Se levanta: ${expire}.`);
  console.error("   NO reintentar. Esto es el riesgo de un cliente no oficial: hay que respetarlo.\n");
});

client.on("logged_out", ({ reason }) => {
  console.error(`\n🔌 La sesión se cerró (${reason}). Hay que volver a vincular.\n`);
});

async function main() {
  const { jid } = await client.init();

  if (jid) {
    // Ya estaba vinculado: solo reconectar.
    console.log(`Ya estaba vinculado como ${jid}. Reconectando…`);
    await client.connect();
    return;
  }

  // Vinculación por QR: se activa el canal, y al conectar WhatsApp emite el
  // código, que el handler de arriba convierte en imagen.
  console.log("Conectando con WhatsApp… (esperá el QR)");
  await client.getQRChannel();
  await client.connect();
}

main().catch((err) => {
  console.error("Falló la vinculación:", err);
  client.close();
  process.exit(1);
});
