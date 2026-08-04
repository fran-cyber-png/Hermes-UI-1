import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import '../../index.css';
import { queryClient } from '../../lib/datos/cliente';
import { BarraFiltros } from '../canales/BarraFiltros';
import { FilaConversacion } from '../canales/FilaConversacion';
import type { Conversacion } from '../canales/conversaciones';

/**
 * LA GALERÍA DEL REPARTO DE LEADS — la evidencia, sin nada vivo detrás.
 *
 * Entry APARTE de Vite (`galeria-reparto.html` en la raíz): **no entra al bundle
 * de la app** —`vite build` toma solo `index.html`— y no habla con ningún server.
 *
 *     npx vite --port 5199   →  http://localhost:5199/galeria-reparto.html
 *
 * Existe por la regla dura #2 (nada de UI se reporta listo sin captura) y para
 * poder ver de una lo que importa acá: que **una fila con dueño se distinga de
 * una sin dueño en un vistazo**, que «Vos» no se confunda con el nombre de otra
 * persona, y que la píldora no se coma el preview.
 */

const AHORA = Date.now();
const haceHoras = (h: number) => new Date(AHORA - h * 3_600_000).toISOString();

function fila(over: Partial<Conversacion>): Conversacion {
  return {
    clave: `conv:whatsapp:${over.persona_id ?? '51900000000'}:51984429504`,
    canal: 'whatsapp',
    tipo: 'mensaje',
    persona_id: '51900000000',
    persona_nombre: 'Persona',
    numero_propio: '51984429504',
    texto: 'Buenas, quería consultar por el diploma. ¿Cuánto sale y en cuántas cuotas se puede?',
    contexto_texto: null,
    respondida: false,
    ventana_abierta: false,
    pide_info: true,
    n: 2,
    referencia: haceHoras(3),
    ultimo_at: haceHoras(3),
    dias: 0,
    nivel: 0,
    ...over,
  };
}

/** Los cinco estados que hay que poder distinguir sin leer. */
const FILAS: { rotulo: string; c: Conversacion; enMiCola?: boolean }[] = [
  {
    rotulo: 'SIN DUEÑO — no se dibuja nada. Es el estado más común (las 91 anteriores al reparto y las otras tres líneas): una píldora acá sería ruido en 1.900 filas.',
    c: fila({ persona_id: '51900000001', persona_nombre: 'Marta Quispe' }),
  },
  {
    rotulo: 'ES TUYA — «Vos» en navy, el color que en esta fila ya significa «tuyo» (el pin y la estrella).',
    c: fila({ persona_id: '51900000002', persona_nombre: 'Javier Ramos', asignada_a: 'ana' }),
  },
  {
    rotulo: 'ES DE OTRA PERSONA — la señal accionable: no la agarres, ya tiene dueño. Neutro: informa sin gritar.',
    c: fila({ persona_id: '51900000003', persona_nombre: 'Rosa Huamán', asignada_a: 'sindy.rojas' }),
  },
  {
    rotulo: 'DENTRO DE «MÍOS» — lo propio NO se rotula: lo dice el filtro de arriba. Repetirlo en cada fila sería la misma píldora 14 veces.',
    c: fila({ persona_id: '51900000004', persona_nombre: 'Carlos Vega', asignada_a: 'ana' }),
    enMiCola: true,
  },
  {
    rotulo: 'EL PEOR CASO (~4 % de las filas) — dueño + cliente + bot a la vez. El dueño vive arriba, con la identidad, para no comerse el preview: acá lo que cede es el nombre del lead, que trunca (el hover lo devuelve entero). Puesto abajo, con el bot al lado, el preview quedaba en «Bue…» — y eso pasa en la línea del bot, que es justo la que se reparte.',
    c: fila({
      persona_id: '51900000005',
      persona_nombre: 'Lucía Ferrer',
      asignada_a: 'walter',
      cliente_nivel: 'recompro',
      cliente_compras: 3,
      bot_escalada: true,
      bot_motivo: 'por_cerrar',
      bot_temperatura: 'caliente',
    }),
  },
];

const LINEAS = [
  { numero: '51986394450', etiqueta: 'Ventas Perú', estado: 'conectado' },
  { numero: '51941654039', etiqueta: 'Walter Ventas', estado: 'conectado' },
  { numero: '51944531711', etiqueta: 'Venta Peru', estado: 'conectado' },
  { numero: '51984429504', etiqueta: 'Ventas Meta', estado: 'conectado' },
];

const CONTEOS = { pideInfo: 311, sinResponder: 478, yaCompraron: 78, botEscalada: 3, botCaliente: 14 };

function Galeria() {
  return (
    <div className="min-h-screen bg-muted/30 p-8">
      <div className="mx-auto max-w-3xl space-y-8">
        <header>
          <h1 className="text-xl font-bold text-foreground">Reparto de leads — la evidencia</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Siete personas comparten la línea 51984429504. Sin dueño en la fila, el reparto no evita
            ni que dos contesten al mismo lead ni que nadie conteste a otro.
          </p>
        </header>

        <section className="space-y-3">
          <h2 className="text-sm font-bold text-foreground">
            El selector ofrece TUS líneas, no todas las vivas
          </h2>
          <p className="text-xs text-muted-foreground">
            Antes listaba las cuatro. Con cinco vendedoras que atienden una sola, eso les ponía
            adelante tres colas ajenas — y «Ventas Perú» y «Venta Peru» se distinguen por una{' '}
            <code>s</code> y una tilde.
          </p>
          <p className="text-xs text-muted-foreground">Lo que ve una de las 5 (una línea propia): sin selector.</p>
          <div className="rounded-2xl bg-card p-3 shadow-panel">
            <BarraFiltros
              filtroSec=""
              onFiltro={() => {}}
              conteos={CONTEOS}
              categoriaActiva={null}
              onCategoria={() => {}}
              onListas={() => {}}
              lineas={LINEAS.map((l) => ({ ...l, mias: l.numero === '51984429504' }))}
              lineaActiva="51984429504"
              onLinea={() => {}}
              hayMias
              mios={false}
              onMios={() => {}}
              conteoMios={14}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Lo que ve Luz (dos líneas propias): «Las mías» + las suyas, sin «Todas».
          </p>
          <div className="rounded-2xl bg-card p-3 shadow-panel">
            <BarraFiltros
              filtroSec=""
              onFiltro={() => {}}
              conteos={CONTEOS}
              categoriaActiva={null}
              onCategoria={() => {}}
              onListas={() => {}}
              lineas={LINEAS.map((l) => ({
                ...l,
                mias: l.numero === '51984429504' || l.numero === '51986394450',
              }))}
              lineaActiva="mias"
              onLinea={() => {}}
              hayMias
              mios={false}
              onMios={() => {}}
              conteoMios={14}
            />
          </div>

          <h2 className="pt-4 text-sm font-bold text-foreground">
            La barra: «Míos» va antes que los filtros de contenido
          </h2>
          <p className="text-xs text-muted-foreground">
            Los chips de la derecha preguntan «¿qué pasa con esta conversación?»; «Míos» pregunta
            «¿es mía?», que con siete personas en una línea se responde antes. Trae su número, así
            que no se entra a ciegas.
          </p>
          <div className="rounded-2xl bg-card p-3 shadow-panel">
            <BarraFiltros
              filtroSec=""
              onFiltro={() => {}}
              conteos={CONTEOS}
              categoriaActiva={null}
              onCategoria={() => {}}
              onListas={() => {}}
              lineas={LINEAS}
              lineaActiva=""
              onLinea={() => {}}
              mios={false}
              onMios={() => {}}
              conteoMios={14}
            />
          </div>
          <p className="text-xs text-muted-foreground">Con el filtro puesto — se apaga desde su propia ✕:</p>
          <div className="rounded-2xl bg-card p-3 shadow-panel">
            <BarraFiltros
              filtroSec=""
              onFiltro={() => {}}
              conteos={{ ...CONTEOS, pideInfo: 4, sinResponder: 9 }}
              categoriaActiva={null}
              onCategoria={() => {}}
              onListas={() => {}}
              lineas={LINEAS}
              lineaActiva=""
              onLinea={() => {}}
              mios
              onMios={() => {}}
              conteoMios={14}
            />
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-sm font-bold text-foreground">La fila: de quién es, en un vistazo</h2>
          {FILAS.map(({ rotulo, c, enMiCola }) => (
            <div key={c.clave} className="space-y-1.5">
              <p className="text-xs text-muted-foreground">{rotulo}</p>
              {/* 360 px: el ancho real del panel de la cola. Si la píldora no
                  entra acá, no entra en la app. */}
              <div className="w-[22.5rem] overflow-hidden rounded-2xl bg-card shadow-panel">
                <FilaConversacion
                  c={c}
                  seleccionada={false}
                  onAbrir={() => {}}
                  miVendedora="ana"
                  enMiCola={enMiCola}
                  indice={0}
                />
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

createRoot(document.getElementById('galeria')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Galeria />
    </QueryClientProvider>
  </StrictMode>,
);
