import 'dotenv/config';

/**
 * PEDIRLE A UNA PERSONA PERMISO PARA LLAMARLA (WhatsApp Calling API).
 *
 * ── Por qué esto existe antes que el audio ───────────────────────────────────
 *
 * Llamar por la Cloud API NO se puede hacer en frío: Meta exige que la persona
 * haya dado permiso ANTES. Ese permiso es, entonces, la variable que decide si
 * todo el frente de llamadas vale la pena — y se puede medir HOY, sin una sola
 * línea de WebRTC ni de SIP. Si la gente no acepta, construir el audio es plata
 * tirada; si acepta, ya sabemos contra qué estamos construyendo.
 *
 * Es la lección de la auto-respuesta del 27-jul, aplicada antes de pagarla: el
 * plan se veía impecable porque nadie miró la condición que lo decidía.
 *
 * ── Lo que este script NO hace ───────────────────────────────────────────────
 *
 * No llama. No puede: sin WebRTC/SIP no hay por dónde salga la voz. Manda el
 * PEDIDO y nada más. Tampoco pasa por `EnvioControlado` ni queda en `envios_wa`:
 * es un script de mano para medir, no un camino de producción.
 *
 * ── Lo que Meta exige y conviene saber antes de correrlo ─────────────────────
 *
 *  · El calling tiene que estar habilitado en el número (`calling.status`
 *    ENABLED en `GET /<PHONE_NUMBER_ID>/settings`). Si no, esto rebota.
 *  · Es un mensaje INTERACTIVO, así que necesita la ventana de 24 h ABIERTA:
 *    la persona tiene que haber escrito primero. Fuera de la ventana, Meta
 *    responde 131047 y se propaga tal cual, no se disfraza.
 *  · Techo por persona: 1 pedido de permiso por día y 2 por semana. No es una
 *    sugerencia — pasarse quema la posibilidad de pedirlo de nuevo.
 *
 * Requiere en `server/.env` (referenciados por nombre, nunca pegados):
 *   WHATSAPP_CLOUD_API_TOKEN            el token de Meta
 *   WHATSAPP_CLOUD_API_PHONE_NUMBER_ID  el "Phone number ID" de la línea
 *
 * Uso:
 *   npm run wa:permiso-llamada -- 51999888777                    · DRY-RUN: imprime
 *                                                                  qué mandaría
 *   npm run wa:permiso-llamada -- 51999888777 --enviar           · manda de verdad
 *   npm run wa:permiso-llamada -- 51999888777 --texto "..." --enviar
 *
 * El dry-run es el default A PROPÓSITO: del otro lado hay una persona real, y un
 * pedido de permiso gastado no se recupera hasta mañana.
 */

/**
 * El texto por default. Dos reglas de la casa metidas en una línea:
 *  · habla del MOTIVO, no de sí mismo (misma regla que las plantillas del acuse nocturno);
 *  · **sin voseo** — el lead es peruano y el «permitís» suena a otro país. Es el mismo
 *    defecto que ya se corrigió en el prompt del bot.
 */
const TEXTO_POR_DEFECTO =
  'Para resolver tus dudas del diploma más rápido, ¿podemos llamarte por WhatsApp?';

interface Opciones {
  numero: string | null;
  texto: string;
  enviar: boolean;
}

function leerOpciones(argv: string[]): Opciones {
  const iTexto = argv.indexOf('--texto');
  return {
    numero: argv.find((a) => !a.startsWith('--') && /^\d{8,15}$/.test(a)) ?? null,
    texto: iTexto >= 0 ? (argv[iTexto + 1] ?? TEXTO_POR_DEFECTO) : TEXTO_POR_DEFECTO,
    enviar: argv.includes('--enviar'),
  };
}

async function main(): Promise<void> {
  const token = process.env.WHATSAPP_CLOUD_API_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_CLOUD_API_PHONE_NUMBER_ID;
  const { numero, texto, enviar } = leerOpciones(process.argv.slice(2));

  if (!token || !phoneNumberId) {
    console.error(
      '[permiso-llamada] faltan WHATSAPP_CLOUD_API_TOKEN y/o WHATSAPP_CLOUD_API_PHONE_NUMBER_ID ' +
        'en server/.env.',
    );
    process.exit(1);
  }
  if (!numero) {
    console.error(
      '[permiso-llamada] falta el número. Uso: npm run wa:permiso-llamada -- 51999888777 [--enviar]',
    );
    process.exit(1);
  }

  const cuerpo = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: numero,
    type: 'interactive',
    interactive: {
      type: 'call_permission_request',
      action: { name: 'call_permission_request' },
      body: { text: texto },
    },
  };

  // El destinatario SIEMPRE a la vista antes de mandar (regla dura #7 de Goberna).
  console.log(`[permiso-llamada] destinatario: +${numero}`);
  console.log(`[permiso-llamada] texto:        «${texto}»`);

  if (!enviar) {
    console.log('\n[permiso-llamada] DRY-RUN — no se mandó nada. Cuerpo que se enviaría:');
    console.log(JSON.stringify(cuerpo, null, 2));
    console.log(
      '\n[permiso-llamada] Para mandarlo de verdad, repetí el comando con --enviar.\n' +
        '                  Recordá: la persona tiene que haberte escrito en las últimas 24 h.',
    );
    return;
  }

  console.log('\n[permiso-llamada] mandando...');
  const resp = await fetch(`https://graph.facebook.com/v25.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  const data = await resp.json();

  if (!resp.ok) {
    console.error(`[permiso-llamada] FALLÓ (${resp.status}):`, JSON.stringify(data, null, 2));
    console.error(
      '\n[permiso-llamada] Los dos rechazos esperables:\n' +
        '  · 131047 → la ventana de 24 h está cerrada (que te escriba primero).\n' +
        '  · 138018 → el calling no está habilitado en este número.',
    );
    process.exit(1);
  }

  console.log('[permiso-llamada] OK:', JSON.stringify(data, null, 2));
  console.log(
    '\n[permiso-llamada] Mandado. Lo que sigue NO es automático: mirá cómo le llega y si acepta.\n' +
      '                  La respuesta entra por el webhook como mensaje interactivo y queda en\n' +
      "                  `events` (source 'meta_wa_msg', campo `interactive` del payload).",
  );
}

main().catch((err: unknown) => {
  console.error('[permiso-llamada] error inesperado:', err);
  process.exit(1);
});
