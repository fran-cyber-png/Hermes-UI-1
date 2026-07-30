import 'dotenv/config';

/**
 * SPIKE — probar el envío por WhatsApp Cloud API (Meta) con un número de PRUEBA.
 *
 * Aislado a propósito: no toca `TransporteWhatsapp`, `wiring.ts` ni ninguna línea
 * real (whatsmeow). Es para validar, antes de construir nada serio, que Hermes
 * puede mandar un mensaje por la Cloud API oficial de Meta. El número que manda
 * es el de PRUEBA que da "API Setup" en developers.facebook.com — no una de las
 * tres líneas de venta, y nada de esto pasa por `EnvioControlado` ni queda
 * registrado en `envios_wa`: es un script de mano, no un camino de producción.
 *
 * Requiere en `server/.env` (nunca en el repo, nunca commiteado):
 *   WHATSAPP_CLOUD_API_TOKEN            el token temporal/permanente de Meta
 *   WHATSAPP_CLOUD_API_PHONE_NUMBER_ID  el "Phone number ID" del número de prueba
 *   WHATSAPP_CLOUD_API_TEST_TO          a quién probar (el número que verificaste en Meta)
 *
 * Uso:
 *   npm run wa:cloud-api:probar                     · manda la plantilla hello_world
 *                                                      (abre la ventana de 24h)
 *   npm run wa:cloud-api:probar -- --texto "hola"   · manda texto libre — solo sirve
 *                                                      si la ventana de 24h ya está
 *                                                      abierta (alguien escribió antes)
 *
 * El token de PRUEBA de Meta expira en ~24h: si esto empieza a dar 401, hay que
 * generar uno nuevo desde "API Setup" y pegarlo de nuevo en `server/.env` — nunca
 * en el chat ni en un archivo del repo.
 */

interface Opciones {
  texto: string | null;
}

function leerOpciones(argv: string[]): Opciones {
  const i = argv.indexOf('--texto');
  return { texto: i >= 0 ? (argv[i + 1] ?? null) : null };
}

async function main(): Promise<void> {
  const token = process.env.WHATSAPP_CLOUD_API_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_CLOUD_API_PHONE_NUMBER_ID;
  const to = process.env.WHATSAPP_CLOUD_API_TEST_TO;

  if (!token || !phoneNumberId || !to) {
    console.error(
      '[cloud-api] faltan variables: WHATSAPP_CLOUD_API_TOKEN, WHATSAPP_CLOUD_API_PHONE_NUMBER_ID ' +
        'y WHATSAPP_CLOUD_API_TEST_TO tienen que estar en server/.env.',
    );
    process.exit(1);
  }

  const { texto } = leerOpciones(process.argv.slice(2));

  // Fuera de la ventana de 24h, Meta solo deja mandar una plantilla aprobada:
  // `hello_world` es la que trae el sandbox por defecto, sin que haya que crear
  // ninguna. El texto libre recién funciona después de que el número de prueba
  // te haya escrito a vos (eso abre la ventana).
  const body = texto
    ? { messaging_product: 'whatsapp', to, type: 'text', text: { body: texto } }
    : {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: { name: 'hello_world', language: { code: 'en_US' } },
      };

  console.log(`[cloud-api] mandando ${texto ? 'texto libre' : 'plantilla hello_world'} a ${to}...`);

  const resp = await fetch(`https://graph.facebook.com/v25.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await resp.json();

  if (!resp.ok) {
    console.error(`[cloud-api] FALLÓ (${resp.status}):`, JSON.stringify(data, null, 2));
    process.exit(1);
  }

  console.log('[cloud-api] OK:', JSON.stringify(data, null, 2));
  console.log(
    texto
      ? '[cloud-api] listo — deberías verlo llegar al teléfono de prueba.'
      : '[cloud-api] plantilla mandada. Contestá desde el teléfono de prueba para abrir la ' +
          'ventana de 24h, y ahí ya podés correr con --texto "lo que quieras".',
  );
}

main().catch((err: unknown) => {
  console.error('[cloud-api] error inesperado:', err);
  process.exit(1);
});
