import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import '../../index.css';
import { queryClient } from '../../lib/datos/cliente';
import { BarraFiltros, SelectorLinea } from '../canales/BarraFiltros';
import { FilaConversacion } from '../canales/FilaConversacion';
import { PanelDerecho } from '../panel/PanelDerecho';
import { ContenidoUsuario } from '../auth/PanelUsuario';
import { PasarConversacion } from './PasarConversacion';
import { VincularMiWhatsapp } from '../whatsapp/VincularMiWhatsapp';
import type { Conversacion } from '../../dominio/conversaciones';

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
    pregunto: true,
    n: 2,
    referencia: haceHoras(3),
    ultimo_at: haceHoras(3),
    dias: 0,
    nivel: 0,
    ...over,
  };
}

/** Los cinco estados que hay que poder distinguir sin leer. */
const FILAS: { rotulo: string; c: Conversacion }[] = [
  {
    rotulo: 'SIN DUEÑO — no se dibuja nada. Es el estado más común (las 91 anteriores al reparto y las otras tres líneas): una píldora acá sería ruido en 1.900 filas.',
    c: fila({ persona_id: '51900000001', persona_nombre: 'Marta Quispe' }),
  },
  {
    rotulo: 'ES DE OTRA PERSONA — la señal accionable: no la agarres, ya tiene dueño. Neutro: informa sin gritar.',
    c: fila({ persona_id: '51900000003', persona_nombre: 'Rosa Huamán', asignada_a: 'sindy.rojas' }),
  },
  {
    rotulo: 'ES TUYA — tampoco se dibuja nada. «Vos» se retiró: quien está en el reparto ve SOLO lo suyo, así que sería la misma píldora en todas las filas.',
    c: fila({ persona_id: '51900000004', persona_nombre: 'Carlos Vega', asignada_a: 'ana' }),
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

const CONTEOS = { preguntoPrecio: 65, teEscribieron: 33, botEscalada: 33, botCaliente: 30 };

// `useLineas()` pide `/api/whatsapp/lineas`. Acá no hay server, así que se le
// siembra la respuesta en el caché: el componente no se entera de la diferencia
// y la galería sigue sin depender de la red.
queryClient.setQueryData(['lineas-whatsapp'], {
  lineas: [{ numero: '51984429504', etiqueta: 'Ventas Meta', estado: 'conectado', mias: true }],
});

// ── El selector de destinos, ANTES y DESPUÉS ────────────────────────────────
// Los destinos son los REALES de producción (medidos el 18-ago-2026), incluidas
// las dos cuentas que Hermes no sabe cómo se llaman: si la galería sirviera un
// caso ideal, escondería justo el borde que este frente tiene que dibujar bien.
const DESTINOS_REALES = [
  'Luz',
  'Sindy',
  'ventas11@grupogoberna.com',
  'ventas12@grupogoberna.com',
  'ventas13@grupogoberna.com',
];
const RUEDA_REAL = [
  { vendedoraId: 'ventas11@grupogoberna.com', asignadas: 11, orden: 1, activa: true },
  { vendedoraId: 'ventas12@grupogoberna.com', asignadas: 11, orden: 2, activa: true },
  { vendedoraId: 'ventas13@grupogoberna.com', asignadas: 1, orden: 3, activa: false },
];

// ANTES (o: un server sin este frente, o una respuesta rehidratada del caché de
// IndexedDB): `nombres` ausente. Cada fila cae a `nombreCorto()`.
queryClient.setQueryData(['reparto-rueda', '51900000000'], {
  linea: '51900000000',
  rueda: RUEDA_REAL,
  destinos: DESTINOS_REALES,
});

// DESPUÉS: lo que sirve `nombresDe` hoy en producción. Ojo que `ventas13@` NO
// está — en Cerberus no tiene nombre y nunca se logueó, así que `equipo.nombre`
// guarda su propio correo y `esNombreDeVerdad` lo descarta. Se sigue viendo
// «Ventas13», que es la verdad: Hermes no sabe cómo se llama.
queryClient.setQueryData(['reparto-rueda', '51984429504'], {
  linea: '51984429504',
  rueda: RUEDA_REAL,
  destinos: DESTINOS_REALES,
  nombres: {
    'ventas11@grupogoberna.com': 'Cielo Huambo',
    'ventas12@grupogoberna.com': 'James',
  },
});

function paraSelector(numeroPropio: string): Conversacion {
  return fila({ persona_id: '51900000009', persona_nombre: 'Lead de prueba', numero_propio: numeroPropio, clave: `conv:whatsapp:51900000009:${numeroPropio}` } as Partial<Conversacion>);
}

function Galeria() {
  const [vinculandoEnGaleria, setVinculandoEnGaleria] = useState(false);
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
            <SelectorLinea
              lineas={LINEAS.map((l) => ({ ...l, mias: l.numero === '51984429504' }))}
              lineaActiva="51984429504"
              onLinea={() => {}}
              hayMias
            />
            <div className="mt-2">
              <BarraFiltros
                filtroSec=""
                onFiltro={() => {}}
                conteos={CONTEOS}
                categoriaActiva={null}
                onCategoria={() => {}}
                onListas={() => {}}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Lo que ve Luz (dos líneas propias): «Las mías» + las suyas, sin «Todas».
          </p>
          <div className="rounded-2xl bg-card p-3 shadow-panel">
            <SelectorLinea
              lineas={LINEAS.map((l) => ({
                ...l,
                mias: l.numero === '51984429504' || l.numero === '51986394450',
              }))}
              lineaActiva="mias"
              onLinea={() => {}}
              hayMias
            />
            <div className="mt-2">
              <BarraFiltros
                filtroSec=""
                onFiltro={() => {}}
                conteos={CONTEOS}
                categoriaActiva={null}
                onCategoria={() => {}}
                onListas={() => {}}
              />
            </div>
          </div>

        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-bold text-foreground">«Quién soy» — el avatar del riel</h2>
          <p className="text-xs text-muted-foreground">
            Era un <code>&lt;span&gt;</code> con un <code>title</code>: la única forma de saber con qué
            usuario estabas era esperar el tooltip del sistema. Con cinco vendedoras compartiendo una
            línea, «¿entré con el usuario que era?» y «¿por qué no veo mis leads?» son la misma
            pregunta. El usuario va en mono y completo porque <b>es la clave con la que el reparto le
            asigna las conversaciones</b>.
          </p>
          <div className="flex gap-4">
            <div className="w-64 rounded-xl border border-border bg-card p-3 shadow-panel">
              <ContenidoUsuario
                vendedora={{ id: 'ventas10@grupogoberna.com', nombre: 'Ventas10' }}
                cerberusVivo={true}
                mias={[{ numero: '51984429504', etiqueta: 'Ventas Meta' }]}
                onSalir={() => {}}
              />
            </div>
            <div className="w-64 rounded-xl border border-border bg-card p-3 shadow-panel">
              <ContenidoUsuario
                vendedora={{ id: 'luz', nombre: 'Luz' }}
                cerberusVivo={false}
                mias={[]}
                onSalir={() => {}}
                // Wireado de verdad (no un no-op): «Vincular tu WhatsApp» abre el
                // modal real (`VincularMiWhatsapp`, 15-ago-2026) — evidencia de que
                // el click de la app llega al mismo lugar que muestra
                // `galeria-mi-linea.html`, no solo que el botón se dibuja.
                onVincular={() => setVinculandoEnGaleria(true)}
              />
            </div>
            {vinculandoEnGaleria && <VincularMiWhatsapp onCerrar={() => setVinculandoEnGaleria(false)} />}
          </div>

          <h2 className="pt-4 text-sm font-bold text-foreground">
            El pie del panel: «Registrar venta», y siempre está
          </h2>
          <p className="text-xs text-muted-foreground">
            El pie exigía un handler para dibujar el botón —bien: nunca un no-op— y{' '}
            <code>PanelDerecho</code> lo montaba sin pasarle ninguno, así que el botón{' '}
            <b>no podía aparecer en ningún estado</b>. Acá va el panel REAL, a 360×720 (el tamaño
            donde el reparto flex ya lo había empujado fuera una vez, ADR 0017). Sin server detrás:
            la ficha falla, y el botón está igual.
          </p>
          <div className="h-[45rem] w-[22.5rem]">
            <PanelDerecho conversacion={FILAS[0]!.c} />
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-bold text-foreground">
            «Pasar la conversación a» — un nombre, no una cuenta de sistema
          </h2>
          <p className="text-xs text-muted-foreground">
            El selector no leía mal el nombre: <b>no leía ninguno</b>. Recortaba el{' '}
            <code>vendedora_id</code>, que para media rueda es el correo de Cerberus. Luz y Sindy se
            veían bien de casualidad — su username ya es su nombre.
          </p>
          <div className="flex gap-10">
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground">
                ANTES · sin <code>nombres</code> (server viejo o caché rehidratado)
              </p>
              <div className="w-[22.5rem] rounded-2xl bg-card p-3 pb-64 shadow-panel">
                <PasarConversacion conversacion={paraSelector('51900000000')} miVendedora="Luz" />
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground">DESPUÉS</p>
              <div className="w-[22.5rem] rounded-2xl bg-card p-3 pb-64 shadow-panel">
                <PasarConversacion conversacion={paraSelector('51984429504')} miVendedora="Luz" />
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            <b>Ventas13 sigue diciendo «Ventas13», y está bien</b>: en Cerberus no tiene nombre
            cargado y nunca se logueó, así que <code>equipo.nombre</code> guarda su propio correo y{' '}
            <code>esNombreDeVerdad</code> lo descarta. Servirlo mostraría{' '}
            <code>ventas13@grupogob…</code> cortado, que es peor. Un hueco no se dibuja nunca.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-sm font-bold text-foreground">La fila: de quién es, en un vistazo</h2>
          {FILAS.map(({ rotulo, c }) => (
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
