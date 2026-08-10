import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '../../index.css';
import { VistaEmbudo } from './VistaEmbudo';

/**
 * LA GALERÍA DEL PIPELINE — la evidencia de la ficha al costado, sin server ni base.
 *
 * Entry APARTE de Vite (`galeria-embudo.html` en la raíz): **no entra al bundle
 * de la app** —`vite build` toma solo `index.html`— y no habla con ningún server.
 *
 *     npx vite --port 5199 → http://localhost:5199/galeria-embudo.html
 *     …/galeria-embudo.html?ficha=1 → con la hoja de la ficha abierta
 *
 * Existe por la regla dura #2, y sobre todo para poder mirar UNA cosa a
 * 1280×720: el `GRID` del tablero declara mínimos que suman **1.000 px** y la
 * hoja se lleva 360. Ése es el ancho donde se decide si la hoja podía empujar
 * las columnas o tenía que superponerse — y la captura es la única forma de
 * verificar que la respuesta elegida no rompe el tablero.
 */

const PARAMS = new URLSearchParams(location.search);

/**
 * Las columnas, con la forma real de producción (medida el 10-ago-2026).
 *
 * ⚠️ **`sin_respuesta` ya no está**: desde el 10-ago dejó de ser columna
 * (decisión del dueño — era el 65 % de la mesa y nadie la trabajaba). Sigue
 * derivándose en el server, así que si alguien la vuelve a poner acá la galería
 * mentiría sobre lo que la pantalla dibuja.
 */
const POR_ETAPA: Record<string, number> = {
  interesado: 377,
  contactado: 217,
  cotizado: 798,
  cierre: 12,
  perdido: 47,
};

/**
 * CUÁNTAS DEJA CADA RECORTE — medido en producción el 8-ago-2026, y es lo que
 * hace que esta galería sirva de evidencia y no de dibujo: el punto del frente es
 * que «Para seguir 82» sea drásticamente más chico que «3.051».
 */
const POR_RECORTE: Record<string, Record<string, number>> = {
  // ⚠️ En «Te esperan» el chip «En ventana» daría CASI EL TOTAL —te escribieron
  // recién, por definición—, y ahí la otra mitad de la regla del cero lo esconde
  // sola. Está puesto en el TOTAL a propósito: es el caso que hay que poder ver.
  interesado: { ventana: 377, seguir: 88, precio: 0 },
  contactado: { ventana: 0, seguir: 24, precio: 0 },
  cotizado: { ventana: 2, seguir: 82, precio: 798 },
};

const NOMBRES = [
  ['Javier Peralta Ríos', 'Diplomado en Gestión Pública', true],
  ['Ana Lucía Quispe Mamani', 'Inteligencia y Contrainteligencia', true],
  ['Roberto Carlos Medina', null, false],
  ['María Fernanda Toledo', 'Foro de Estado', true],
  ['Luis Alberto Chávez Rojas', null, false],
  ['Carmen Rosa Huamán', 'Escuela de Gobierno', true],
  ['Jorge Enrique Salazar', null, false],
  ['Patricia Elena Vargas', 'Diplomado en Gestión Pública', true],
] as const;

/** Cada columna arranca en otro bloque de números: ver abajo por qué importa. */
const DESDE: Record<string, number> = {
  interesado: 400,
  contactado: 0,
  cotizado: 100,
  cierre: 200,
  perdido: 300,
};

/** Una tarjeta con la forma que sirve la cola (`/api/conversaciones`). */
function tarjetas(etapa: string, cuantas: number) {
  return Array.from({ length: cuantas }, (_, i) => {
    const [nombre, curso] = NOMBRES[i % NOMBRES.length];
    const horas = 2 + i * 5;
    const cuando = new Date(Date.now() - horas * 3_600_000).toISOString();
    // ⚠️ La clave tiene que ser ÚNICA ENTRE COLUMNAS. `repartirColumnas` pinta
    // cada clave UNA sola vez (así una tarjeta que se está moviendo no se
    // duplica), así que con el mismo teléfono en las cuatro columnas, las tres
    // últimas salían vacías — con su total en la cabecera diciendo 611. La
    // galería habría mostrado el Pipeline roto sin que el Pipeline lo esté.
    const telefono = `5198765${String(4321 + DESDE[etapa] + i)}`;
    /**
     * LOS LEADS DE FORMULARIO comparten columna con quien te escribió: «Te
     * esperan» es «la pelota es nuestra», no «te escribieron por WhatsApp».
     * Se siembran uno de cada tres para que la captura muestre las DOS formas
     * juntas — que es el caso que hay que poder mirar: la tarjeta de un lead no
     * tiene hilo, ni línea, ni reloj de respuesta.
     */
    const esLead = etapa === 'interesado' && i % 3 === 1;
    if (esLead)
      return {
        clave: `lead:${900 + i}`,
        canal: 'landing',
        tipo: 'lead',
        persona_id: telefono,
        persona_nombre: nombre,
        lead_nombre: nombre,
        numero_propio: null,
        // Lo que pidió en el formulario. Es todo lo que sabemos de esta persona.
        texto: curso ?? 'Diplomado en Gestión Pública',
        contexto_texto: null,
        respondida: false,
        ya_le_hablamos: false,
        precio_enviado: false,
        etapa_efectiva: 'interesado',
        interes_curso: null,
        lead_curso: curso,
        ventana_abierta: false,
        // Sin conversación no hay ventana que abrir: hay que ABRIRLE el chat.
        ventana_cierra: null,
        pide_info: false,
        n: 1,
        referencia: cuando,
        ultimo_at: cuando,
        dias: Math.floor(horas / 24),
        etapa_desde: null,
        nivel: 0,
      };
    return {
      clave: `conv:whatsapp:${telefono}:51986394450`,
      canal: 'whatsapp',
      tipo: 'mensaje',
      persona_id: telefono,
      persona_nombre: nombre,
      lead_nombre: nombre,
      numero_propio: '51986394450',
      texto: i % 3 === 0 ? '¿me puede pasar más información del diplomado?' : null,
      contexto_texto: null,
      // En «Te esperan» la pelota es NUESTRA: la persona escribió y nadie le
      // contestó, así que `respondida` es false — es lo que deriva esa etapa.
      respondida: etapa === 'interesado' ? false : i % 2 === 0,
      ya_le_hablamos: true,
      // El precio DERIVA la etapa: si la tarjeta tiene precio, está en Cotizados.
      precio_enviado: etapa === 'cotizado',
      etapa_efectiva: etapa,
      interes_curso: etapa === 'cotizado' ? curso : null,
      lead_curso: curso,
      ventana_abierta: false,
      // La VENTANA (ADR 0041): las primeras de cada columna todavía la tienen
      // abierta, y una entra en las últimas 3 h para que se vea el oro. El resto
      // sin ventana, que es como se ve la mayoría de una columna de seguimiento.
      ventana_cierra:
        i % 4 === 0
          ? new Date(Date.now() + (i === 0 ? 40 * 60_000 : (3 + i) * 3_600_000)).toISOString()
          : null,
      pide_info: i % 3 === 0,
      n: 4 + i,
      referencia: cuando,
      ultimo_at: cuando,
      dias: Math.floor(horas / 24),
      // DESDE CUÁNDO ESTÁ EN LA ETAPA (ADR: `cola/tiempoEnEtapa.ts`). Se escalona
      // a propósito para que la evidencia muestre las tres cosas que la marca
      // tiene que hacer: callarse cuando entró hoy (i=0), callarse cuando repite
      // lo que ya dice el reloj de arriba, y hablar cuando difieren — que es el
      // caso que justifica el frente («recibió el precio hace tres semanas»).
      etapa_desde:
        i === 0
          ? new Date(Date.now() - 4 * 3_600_000).toISOString()
          : new Date(Date.now() - (2 + i * 4) * 86_400_000).toISOString(),
      nivel: i % 2 === 0 ? 4 : 0,
    };
  });
}

/** El desglose que alimenta la bandeja y los conteos por columna. */
const DESGLOSE = [
  // «Te esperan» es columna desde el 10-ago, así que estas dos filas ya no
  // alimentan una tira: alimentan su cabecera («sin abrir» vs «volvieron») y su
  // conteo. `ventana: true` en las dos es lo real —te acaban de escribir— y es
  // lo que hace que el chip «En ventana» dé el total y la regla lo esconda.
  // Las «sin abrir» son 238 y solo una parte está escribiendo AHORA (<24 h). Van
  // en dos filas para que los tres números de la cabecera sean distintos: con
  // `viva` en las 238, decía «238 ahora · 238 sin abrir» y se leía como un bug.
  // ⚠️ En producción hoy `vivas` es 0 —hace días que no escribe nadie—, así que
  // ese segmento no se dibuja; acá se siembra para poder verlo.
  { etapa: 'interesado', yaLeHablamos: false, precio: false, viva: true, ventana: true, paraSeguir: false, n: 12 },
  { etapa: 'interesado', yaLeHablamos: false, precio: false, viva: false, ventana: true, paraSeguir: false, n: 226 },
  { etapa: 'interesado', yaLeHablamos: true, precio: false, viva: false, ventana: true, paraSeguir: true, n: 88 },
  { etapa: 'interesado', yaLeHablamos: true, precio: false, viva: false, ventana: true, paraSeguir: false, n: 51 },
  // ⚠️ Desde el 8-ago-2026 NINGUNA fila de `contactado` puede tener `precio`:
  // `precio_enviado` deriva `cotizado` (`cola/etapaEfectivaSql.ts`), así que esa
  // combinación ya no existe. Por eso el chip «Con precio» desaparece de
  // Contactados solo — la regla «un recorte que daría cero no se ofrece».
  // Los números son los MEDIDOS en producción el 8-ago-2026 (ver `POR_RECORTE`):
  // «en ventana» deja 0 de 544 y 2 de 3.051 —por eso ese chip casi no aparece— y
  // «para seguir» es el único que recorta de verdad.
  { etapa: 'contactado', yaLeHablamos: true, precio: false, viva: false, ventana: false, paraSeguir: true, n: 24 },
  { etapa: 'contactado', yaLeHablamos: true, precio: false, viva: false, ventana: false, paraSeguir: false, n: 193 },
  { etapa: 'cotizado', yaLeHablamos: true, precio: true, viva: false, ventana: true, paraSeguir: false, n: 2 },
  { etapa: 'cotizado', yaLeHablamos: true, precio: true, viva: false, ventana: false, paraSeguir: true, n: 82 },
  { etapa: 'cotizado', yaLeHablamos: true, precio: true, viva: false, ventana: false, paraSeguir: false, n: 714 },
  { etapa: 'cierre', yaLeHablamos: true, precio: true, viva: false, paraSeguir: false, n: 12 },
  { etapa: 'perdido', yaLeHablamos: true, precio: false, viva: false, paraSeguir: false, n: 47 },
];

/** Lo que la hoja de la ficha le pregunta a Cerberus. */
const FICHA_CERBERUS = {
  estado: 'cliente',
  id: 4821,
  nombre: 'Javier Peralta Ríos',
  codigo: 'CL-4821',
  dni: '41287654',
  pais: 'Perú',
  correo: 'javier.peralta@correo.com',
  ventasCount: 2,
  ventas: [
    { folio: 'F001-2291', estado: 'Pagado', monto: '750.00', moneda: 'PEN', fecha: '2026-07-14' },
    { folio: 'F001-1877', estado: 'Pagado', monto: '500.00', moneda: 'PEN', fecha: '2026-04-02' },
  ],
};

/** Todo endpoint responde de mentira: la galería no toca la red ni una vez. */
window.fetch = (async (entrada: RequestInfo | URL) => {
  const url = String(
    typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada : entrada.url,
  );

  // La foto de perfil NO existe en la galería, y decirlo con un 404 es lo
  // correcto: el Avatar cae a las iniciales ante cualquier problema («sin foto →
  // iniciales, nunca un roto»). Un 200 con JSON adentro le daría un blob que no
  // es una imagen, y la evidencia saldría con ocho íconos rotos.
  if (url.includes('/api/whatsapp/foto/')) {
    return new Response(null, { status: 404 });
  }

  if (url.includes('/api/conversaciones')) {
    const q = new URL(url, location.origin).searchParams;
    const etapa = q.get('etapa') ?? 'contactado';
    /**
     * ⚠️ EL STUB TIENE QUE RESPETAR EL RECORTE. Si devolviera siempre el total de
     * la etapa, la cabecera diría «82 · de 3.051» sobre una columna que sigue
     * pintando las mismas tarjetas — o sea, la captura probaría lo contrario de
     * lo que el frente hace. Es el mismo cuidado que la clave única por columna.
     */
    const recorte = ['ventana', 'seguir', 'precio'].find((r) => q.get(r) === '1');
    const total = recorte ? (POR_RECORTE[etapa]?.[recorte] ?? 0) : (POR_ETAPA[etapa] ?? 0);
    const cuantas = Math.min(total, etapa === 'contactado' || etapa === 'interesado' ? 8 : 4);
    return respuesta({
      conversaciones: tarjetas(etapa, cuantas),
      total,
      hayMas: total > cuantas,
      conteos: POR_ETAPA,
      desglose: DESGLOSE,
    });
  }

  const cuerpo = url.includes('/api/contactos/ficha')
    ? FICHA_CERBERUS
    : url.includes('/api/contactos/lead')
    ? {
        lead: {
          nombre: 'Javier Peralta Ríos',
          fuente: 'meta',
          campana: 'Gestión Pública · julio',
          anuncio: 'Adquiérelo ahora',
          fecha: '2026-07-02T15:12:00.000Z',
        },
      }
    : url.includes('/api/senales')
    ? { senales: {}, umbralDias: 3 }
    : url.includes('/api/gestiones/intereses')
    ? { lista: [{ curso: 'Diplomado en Gestión Pública', creadoAt: '2026-07-20T10:00:00.000Z' }], derivados: [] }
    : {};
  return respuesta(cuerpo);
}) as typeof fetch;

function respuesta(cuerpo: unknown) {
  return new Response(JSON.stringify(cuerpo), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * `?ficha=1` abre la hoja de la primera tarjeta.
 *
 * Es la evidencia de lo que la vista vino a resolver: hasta hoy, saber quién era
 * esa persona costaba **irse a Mensajes** y perder el tablero.
 */
/**
 * `?seguir=1` toca el chip «Para seguir» de Cotizados — la evidencia del frente:
 * la columna pasa de 3.051 tarjetas a 82, con el total todavía a la vista.
 */
if (PARAMS.has('seguir')) {
  setTimeout(() => {
    const chips = document.querySelectorAll<HTMLElement>('button[aria-pressed]');
    for (const chip of chips) {
      if (chip.textContent?.startsWith('Para seguir 82')) {
        chip.click();
        break;
      }
    }
  }, 400);
}

if (PARAMS.has('ficha')) {
  setTimeout(() => {
    document.querySelector<HTMLElement>('[role="button"][aria-label^="Ver la ficha"]')?.click();
  }, 500);
}

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

createRoot(document.getElementById('galeria')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <div className="flex h-dvh flex-col bg-background text-foreground">
        {/* `onIrAMensajes` va aunque no haga nada: sin él, «Te esperan» no dibuja
            su botón y la captura no probaría que el atajo de la tira sobrevivió
            al volverse columna. */}
        <VistaEmbudo onAbrir={() => {}} onIrAMensajes={() => {}} />
      </div>
    </QueryClientProvider>
  </StrictMode>,
);
