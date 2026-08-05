import 'dotenv/config';

/**
 * ¿DÓNDE Y CÓMO APLICA META EL LÍMITE DE TAMAÑO? — medirlo, no suponerlo.
 *
 * ── La pregunta ───────────────────────────────────────────────────────────
 * Un video de 17,9 MB por la línea Cloud API muere con
 * `File Too Large` **en la subida** (`POST /<phone_number_id>/media`), no al
 * mandar el mensaje. Si el tope se aplica ahí y sale del MIME declarado en el
 * form, entonces «mandarlo como documento» —que tendría 100 MB de margen— no
 * se puede hacer sin mentir el MIME, porque en la subida el archivo todavía se
 * declara `video/mp4`.
 *
 * Eso es una inferencia razonable sobre un mensaje de error, y una inferencia
 * no alcanza para decidir un frente de trabajo. Esto lo mide.
 *
 * ── Por qué es seguro correrlo contra la línea de producción ──────────────
 * **NO MANDA NINGÚN MENSAJE.** Solo sube archivos a `/media` y reporta qué
 * contestó Meta. No toca `TransporteWhatsapp`, ni `EnvioControlado`, ni
 * `envios_wa`, ni la base. Un `media_id` que nadie usa caduca solo a los 30
 * días. Ningún lead se entera de nada.
 *
 * Los bytes son ceros (`Buffer.alloc`): no se sube contenido de nadie.
 *
 * ── Uso ───────────────────────────────────────────────────────────────────
 *   cd server && npm run wa:cloud-api:limites          · la matriz completa
 *   cd server && npm run wa:cloud-api:limites -- --mb 30 --mime application/pdf
 *
 * Requiere en `server/.env` (por nombre, nunca pegados — regla dura #1):
 *   WHATSAPP_CLOUD_API_TOKEN · WHATSAPP_CLOUD_API_PHONE_NUMBER_ID
 */

const GRAPH = 'https://graph.facebook.com/v21.0';
const MB = 1024 * 1024;

interface Caso {
  mime: string;
  mb: number;
  nombre: string;
  /** Qué responde esta prueba. Sin esto, la salida es una tabla sin tesis. */
  pregunta: string;
}

/**
 * La matriz mínima que decide el frente. Cada caso está para descartar UNA
 * hipótesis, y el orden importa: el control va primero para que un fallo de
 * credenciales no se lea como «Meta rechazó».
 */
const MATRIZ: Caso[] = [
  {
    mime: 'video/mp4',
    mb: 15,
    nombre: 'control-video-15mb.mp4',
    pregunta: 'CONTROL: ¿la subida funciona? Si esto falla, el resto no dice nada.',
  },
  {
    mime: 'video/mp4',
    mb: 17.9,
    nombre: 'video-17.9mb.mp4',
    pregunta: 'El caso del reporte. ¿El tope de 16 MB se aplica en la SUBIDA?',
  },
  {
    mime: 'application/pdf',
    mb: 17.9,
    nombre: 'documento-17.9mb.pdf',
    pregunta: '¿Con MIME de documento el mismo peso entra? (el margen es 100 MB)',
  },
  {
    mime: 'application/pdf',
    mb: 70,
    nombre: 'documento-70mb.pdf',
    pregunta: '¿Los 100 MB de documento son reales, o el nodo /media corta en 64?',
  },
  {
    mime: 'image/png',
    mb: 9,
    nombre: 'imagen-9mb.png',
    pregunta: '¿Los 5 MB de imagen se aplican en la subida, como el video?',
  },
];

interface Resultado {
  caso: Caso;
  aceptado: boolean;
  detalle: string;
}

async function subir(caso: Caso, phoneNumberId: string, token: string): Promise<Resultado> {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', caso.mime);
  form.append('file', new Blob([Buffer.alloc(Math.round(caso.mb * MB))], { type: caso.mime }), caso.nombre);

  const r = await fetch(`${GRAPH}/${phoneNumberId}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = (await r.json().catch(() => ({}))) as {
    id?: string;
    error?: { message?: string; error_data?: { details?: string } };
  };

  if (r.ok && data.id) return { caso, aceptado: true, detalle: `media_id ${data.id} (sin usar; caduca solo)` };
  const detalle = data.error?.error_data?.details ?? data.error?.message ?? `HTTP ${r.status}`;
  return { caso, aceptado: false, detalle };
}

function leerOpciones(argv: string[]): Caso[] {
  const i = argv.indexOf('--mb');
  const j = argv.indexOf('--mime');
  if (i < 0 && j < 0) return MATRIZ;
  const mb = i >= 0 ? Number(argv[i + 1]) : 10;
  const mime = j >= 0 ? (argv[j + 1] ?? 'video/mp4') : 'video/mp4';
  return [{ mime, mb, nombre: `prueba-${mb}mb`, pregunta: 'caso a mano' }];
}

async function main(): Promise<void> {
  const token = process.env.WHATSAPP_CLOUD_API_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_CLOUD_API_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    console.error(
      '[limites] faltan WHATSAPP_CLOUD_API_TOKEN y WHATSAPP_CLOUD_API_PHONE_NUMBER_ID en server/.env.',
    );
    process.exit(1);
  }

  const casos = leerOpciones(process.argv.slice(2));
  console.log('── LÍMITES DE `POST /media` DE LA CLOUD API ──');
  console.log('Esto NO manda ningún mensaje: solo sube y reporta qué dijo Meta.\n');

  const resultados: Resultado[] = [];
  for (const caso of casos) {
    process.stdout.write(`  ${caso.mime.padEnd(18)} ${String(caso.mb).padStart(5)} MB … `);
    const r = await subir(caso, phoneNumberId, token);
    resultados.push(r);
    console.log(r.aceptado ? '✓ ACEPTADO' : '✗ rechazado');
    console.log(`      ${caso.pregunta}`);
    console.log(`      → ${r.detalle}\n`);
  }

  // ── EL CONTROL MANDA ──
  // Sin esta guarda el script mentía: con el token vencido los cinco casos dan
  // «rechazado» por Authentication Error y la lectura de abajo concluía «ni
  // siquiera como documento entra», que es una afirmación sobre Meta hecha
  // sobre cinco fallas de credencial. Un dry-run que muestra el RESULTADO y no
  // las CONDICIONES no verifica nada — por eso el control existe, y por eso
  // tiene que poder frenar la conclusión.
  const control = resultados.find((r) => r.caso.nombre.startsWith('control-'));
  if (control && !control.aceptado) {
    console.log('── NO SE PUEDE CONCLUIR NADA ──');
    console.log(`El CONTROL falló: ${control.detalle}`);
    console.log('Un archivo que Meta debería aceptar tampoco entró, así que los rechazos de');
    console.log('arriba no dicen nada sobre los límites — dicen que la credencial no sirve.');
    if (/auth/i.test(control.detalle)) {
      console.log('\nEl token de la Cloud API caduca. El vivo está en VPS1:');
      console.log("  ssh deploy@161.132.39.165 'cd /srv/hermes/server && npm run wa:cloud-api:limites'");
    }
    process.exitCode = 1;
    return;
  }

  // La lectura, no solo la tabla: el script existe para decidir algo.
  const video18 = resultados.find((r) => r.caso.mime.startsWith('video/') && r.caso.mb > 16);
  const doc18 = resultados.find((r) => r.caso.mime === 'application/pdf' && r.caso.mb > 16);
  if (video18 && doc18) {
    console.log('── QUÉ SIGNIFICA ──');
    if (!video18.aceptado && doc18.aceptado) {
      console.log('El tope se aplica EN LA SUBIDA y SEGÚN EL MIME declarado.');
      console.log('⇒ «Mandarlo como documento» exigiría declarar un MIME que no es el del');
      console.log('  archivo. Al lead le llegaría un adjunto mal rotulado, que WhatsApp no');
      console.log('  sabe reproducir. La salida honesta para un video pesado es COMPRIMIRLO.');
    } else if (!video18.aceptado && !doc18.aceptado) {
      console.log('Ni siquiera con MIME de documento entra: el tope no depende del tipo.');
      console.log('⇒ «Mandarlo como documento» no existe como opción. Solo comprimir.');
    } else if (video18.aceptado) {
      console.log('⚠️  El video de más de 16 MB SÍ subió: el tope no se aplica acá,');
      console.log('  o cambió. Revisar `whatsapp/limitesMedia.ts` antes de seguir.');
    }
  }
}

main().catch((e: unknown) => {
  console.error('[limites]', e);
  process.exit(1);
});
