import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '../../index.css';
import { VistaDashboard } from './VistaDashboard';

/**
 * LA GALERÍA DEL DASHBOARD PERSONAL — la evidencia, sin server ni base.
 *
 * Entry APARTE de Vite (`galeria-dashboard.html` en la raíz): **no entra al
 * bundle de la app** —`vite build` toma solo `index.html`— y no habla con ningún
 * server.
 *
 *     npx vite --port 5199 → http://localhost:5199/galeria-dashboard.html
 *     …?supervisor=1 → lo que ve quien reparte (todo, con «El negocio»)
 *     …?vacio=1      → sin nada asignado todavía
 *
 * Existe por la regla dura #2 y para poder mirar de una las tres cosas que este
 * frente tiene que resolver **sin que nadie lea**: que «El negocio» no esté para
 * quien no le toca, que los chips de lo que no tiene dueño no aparezcan como
 * ceros, y sobre todo que **un radar vacío diga su motivo** — porque medido en
 * prod el 5-ago, cuatro vendedoras lo abrirían casi vacío.
 */

const PARAMS = new URLSearchParams(location.search);
const SUPERVISOR = PARAMS.has('supervisor');
const VACIO = PARAMS.has('vacio');

const NOMBRES = [
  ['Javier Peralta Ríos', '51987654321', 'Perú', 'me interesa el diplomado, ¿cuánto cuesta?'],
  ['Ana Lucía Quispe Mamani', '51984429504', 'Perú', '¿se puede pagar en dos cuotas?'],
  ['Roberto Carlos Medina', '52984429641', 'México', 'buenas, quisiera más información'],
  ['María Fernanda Toledo', '59384429778', 'Ecuador', '¿el certificado tiene validez acá?'],
  ['Luis Alberto Chávez Rojas', '51984429915', 'Perú', 'ya hice la transferencia'],
  ['Carmen Rosa Huamán', '59184430052', 'Bolivia', '¿cuándo empieza la próxima edición?'],
] as const;

/** Un chat del radar, con la forma que sirve `/api/dashboard`. */
function chats(cuantos: number) {
  return NOMBRES.slice(0, cuantos).map(([nombre, telefono, pais, texto], i) => {
    const horas = 2 + i * 7;
    const cuando = new Date(Date.now() - horas * 3_600_000).toISOString();
    return {
      clave: `conv:whatsapp:${telefono}:51984429504`,
      fuente: 'chat',
      canal: 'whatsapp',
      tipo: 'mensaje',
      persona_id: telefono,
      persona_nombre: nombre,
      numero_propio: '51984429504',
      texto,
      texto_clase: null,
      texto_origen: null,
      contexto_texto: null,
      telefono,
      pais_dato: pais,
      pide_info: i % 2 === 0,
      ventana_dias: null,
      ventana_abierta: false,
      respondida: i % 3 === 0,
      referencia: cuando,
      cayo_at: cuando,
      seguimiento_en: null,
      seguimiento_nota: null,
      nivel: i % 3 === 0 ? 4 : 0,
      orden: i,
    };
  });
}

/** Los leads de formulario: SOLO los ve el supervisor (no tienen dueño posible). */
function formularios() {
  /**
   * Los valores REALES de producción (8-ago-2026): los de landing entran con
   * `platform='web'` y su curso vive en `campaign_name` — «Diploma Internacional
   * del Consultor Político» son 49 de los 87 leads de los últimos 14 días.
   * Hasta hoy esta galería mostraba el caso ideal y por eso nunca reflejó el
   * defecto: la fila decía «icarus:landing» y se etiquetaba «Lead Ad».
   */
  return [
    ['Edward Rodríguez Acevedo', '18294430463', 'República Dominicana', 'Diploma Internacional del Consultor Político'],
    ['GROVER ZAPANA ZARATE', '59171234567', 'Bolivia', 'Diploma Internacional de Inteligencia y Contrainteligencia'],
  ].map(([nombre, telefono, pais, producto], i) => {
    const cuando = new Date(Date.now() - (3 + i * 9) * 3_600_000).toISOString();
    return {
      clave: `lead:${900 + i}`,
      // Los dos son de LANDING: es lo que dice `platform='web'` una vez que
      // `dashboard/fuenteLead.ts` lo traduce bien.
      fuente: 'landing',
      canal: 'web',
      persona_nombre: nombre,
      telefono,
      correo: `${nombre.split(' ')[0].toLowerCase()}@correo.com`,
      pais_dato: pais,
      producto,
      campana: producto,
      flyer: null,
      es_organico: false,
      estado_lead: 'nuevo',
      cayo_at: cuando,
      nivel: 0,
      orden: 10 + i,
    };
  });
}

const SERIE = (base: number) =>
  Array.from({ length: 14 }, (_, i) => ({
    dia: new Date(Date.UTC(2026, 6, 23 + i)).toISOString().slice(0, 10),
    n: Math.max(0, base + ((i * 7) % 9) - 3),
  }));

const EQUIPO_COMPLETO = [
  { vendedora: 'luz', conversaciones_hoy: 14, mensajes_hoy: 58, ventas_hoy: 2, conversaciones_7d: 71, mensajes_7d: 305, ventas_7d: 9 },
  { vendedora: 'ventas11@grupogoberna.com', conversaciones_hoy: 6, mensajes_hoy: 23, ventas_hoy: 1, conversaciones_7d: 28, mensajes_7d: 119, ventas_7d: 3 },
  { vendedora: 'ventas12@grupogoberna.com', conversaciones_hoy: 4, mensajes_hoy: 17, ventas_hoy: 0, conversaciones_7d: 19, mensajes_7d: 82, ventas_7d: 2 },
  { vendedora: 'ventas13@grupogoberna.com', conversaciones_hoy: 3, mensajes_hoy: 11, ventas_hoy: 0, conversaciones_7d: 12, mensajes_7d: 46, ventas_7d: 1 },
];

/** Todo endpoint responde de mentira: la galería no toca la red ni una vez. */
window.fetch = (async (entrada: RequestInfo | URL) => {
  const url = String(
    typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada : entrada.url,
  );

  // La foto de perfil no existe acá: 404, para que el Avatar caiga a iniciales
  // («sin foto → iniciales, nunca un roto») en vez de dibujar un blob que no es
  // una imagen.
  if (url.includes('/api/whatsapp/foto/')) return new Response(null, { status: 404 });

  /**
   * LO QUE LA FICHA DE UN LEAD DE FORMULARIO PREGUNTA. Desde el 8-ago-2026 un
   * clic en una fila de landing abre la hoja al costado en vez de mandar al
   * buscador, así que la galería tiene que responder estos dos o la evidencia
   * mostraría una ficha vacía y no se vería lo que el frente vino a resolver:
   * **de dónde vino y cuándo llenó**.
   *
   * El `campana` es el que sale del arreglo de `dashboard/fuenteLead.ts` — el
   * nombre del diploma, no el `icarus:landing` que se veía antes.
   */
  if (url.includes('/api/contactos/lead')) {
    return respuesta({
      lead: {
        nombre: 'Edward Rodríguez Acevedo',
        // ⚠️ `web` es el valor REAL del contrato (`gente/emparejar.ts`), no
        // `landing`: el vocabulario interno y la palabra que se lee son dos
        // cosas, y `origenDeLead` es quien traduce. Poner acá un valor que el
        // server no manda hacía que la ficha dijera «Meta Ads» sobre un lead de
        // landing — o sea, la galería probaba un caso que no existe.
        fuente: 'web',
        campana: 'Diploma Internacional del Consultor Político',
        anuncio: null,
        fecha: new Date(Date.now() - 3 * 3_600_000).toISOString(),
      },
    });
  }
  // Un lead de formulario que todavía no compró: Cerberus no lo conoce, y eso
  // es un estado normal —no un error— que la ficha tiene que saber dibujar.
  if (url.includes('/api/contactos/ficha')) return respuesta({ estado: 'no_encontrado' });
  if (url.includes('/api/senales')) return respuesta({ senales: {}, umbralDias: 3 });
  if (url.includes('/api/gestiones/intereses')) return respuesta({ lista: [], derivados: [] });
  if (url.includes('/api/eventos')) return respuesta({ eventos: [] });

  const cuerpo = url.includes('/api/agenda')
    ? { recordatorios: [] }
    : url.includes('/api/dashboard/negocio')
    ? // Solo el supervisor llega acá: la vendedora ni lo pide (la solapa no existe)
      // y el server le respondería 403.
      { porCurso: [], porAnuncio: [], totales: null, periodo: '7d' }
    : {
        chats: VACIO ? [] : chats(SUPERVISOR ? 6 : 3),
        // 🔴 Los formularios NO viajan con recorte personal: un lead de
        // formulario no tiene dueño posible.
        formularios: SUPERVISOR ? formularios() : [],
        etapas: {},
        etiquetas: {},
        porVendedora: SUPERVISOR ? EQUIPO_COMPLETO : [EQUIPO_COMPLETO[1]],
        automaticos: SUPERVISOR ? { mensajes_hoy: 412, mensajes_7d: 2103, quienes: ['bot', 'goberna-admin'] } : null,
        embudo: VACIO
          ? {}
          : SUPERVISOR
            ? { interesado: 476, contactado: 1389, cotizado: 611, cierre: 12, perdido: 47 }
            : { interesado: 4, contactado: 22, cotizado: 9, cierre: 1, perdido: 2 },
        cursos: VACIO
          ? []
          : SUPERVISOR
            ? [
                { curso: 'Diplomado en Gestión Pública', n: 84 },
                { curso: 'Inteligencia y Contrainteligencia', n: 61 },
                { curso: 'Foro de Estado', n: 22 },
              ]
            : [
                { curso: 'Diplomado en Gestión Pública', n: 6 },
                { curso: 'Foro de Estado', n: 2 },
              ],
        // ⚠️ Con `?vacio=1` las series van en CERO, no vacías: el server manda
        // siempre los 14 puntos (los días sin datos en 0, «el front no inventa
        // continuidad»). Una lista vacía dispara el aviso «todavía no llega ·
        // para sistemas», que es un mensaje de cableado roto — y le estaría
        // mintiendo a una vendedora nueva sobre un estado que es normal.
        series: VACIO
          ? {
              leads_dia: SERIE(0).map((p) => ({ dia: p.dia, chats: 0, comentarios: 0, formularios: 0 })),
              envios_dia: SERIE(0).map((p) => ({ dia: p.dia, n: 0 })),
              ventas_dia: SERIE(0).map((p) => ({ dia: p.dia, n: 0 })),
            }
          : {
          leads_dia: SERIE(SUPERVISOR ? 18 : 4).map((p) => ({
            dia: p.dia,
            chats: p.n,
            comentarios: SUPERVISOR ? Math.floor(p.n / 3) : 0,
            formularios: SUPERVISOR ? Math.floor(p.n / 4) : 0,
          })),
          envios_dia: SERIE(SUPERVISOR ? 40 : 12),
          ventas_dia: SERIE(SUPERVISOR ? 4 : 1),
        },
        // De quién es lo que viajó. La pantalla no lo decide: lo dibuja.
        supervisor: SUPERVISOR,
        ...(SUPERVISOR ? {} : { soloMisAsignadas: true }),
      };

  return respuesta(cuerpo);
}) as typeof fetch;

function respuesta(cuerpo: unknown) {
  return new Response(JSON.stringify(cuerpo), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

createRoot(document.getElementById('galeria')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <div className="flex h-dvh flex-col bg-background text-foreground">
        <VistaDashboard
          onAbrir={() => {}}
          onBuscarPersona={() => {}}
          onIrAgenda={() => {}}
          miVendedora={SUPERVISOR ? 'ventas10@grupogoberna.com' : 'ventas11@grupogoberna.com'}
        />
      </div>
    </QueryClientProvider>
  </StrictMode>,
);
