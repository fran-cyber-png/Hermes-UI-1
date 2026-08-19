import { Clock, Megaphone, MessageSquareQuote, Timer } from 'lucide-react';
import { useConversacionWa } from '../whatsapp/conversacionWa';
import { vencimiento, type MensajeBandeja } from './bandeja';
import { horaCorta } from './estado';
import { loQueDijo, type LoQueDijo } from './loQueDijo';
import { porQueEstaCampana } from './revision';

/**
 * POR QUÉ ESTA RESPUESTA — el panel de la derecha, en modo revisión (ADR 0018).
 *
 * ── La regla ──
 * Una IA que no explica su sugerencia no se puede supervisar: se puede obedecer,
 * que es otra cosa y es justo lo que el modo supervisado viene a evitar. Este
 * panel es esa explicación, y está armado alrededor de una sola yuxtaposición:
 * **lo que ella escribió** contra **lo que se le va a mandar**. Todo lo demás
 * (de qué anuncio vino, de qué eslabón salió la campaña, con qué ritmo sale) es
 * respaldo de esa comparación.
 *
 * ── Por qué lo primero es lo que ella dijo ──
 * Porque es lo único que cambia entre una fila y la siguiente. La plantilla es
 * la misma para toda la campaña; leerla cuarenta veces no agrega nada. Lo que
 * decide si esta corresponde es si contesta lo que esta persona preguntó. #153
 * lo midió al revés: los hechos que cierran ventas («acceso por un año»,
 * «se puede en cuotas», «es para público general, no solo policías») se dijeron
 * 1, 2 y 3 veces en 1.876 conversaciones — y cada vez desbloquearon la venta en
 * el acto. Esas preguntas están ahí, escritas, sin contestar.
 *
 * ── Convivencia ──
 * Este panel NO reemplaza la ficha: se monta ARRIBA de `FichaContacto`, que
 * sigue contestando «quién es» (si ya compró, qué curso, su historial). Es un
 * agregado deliberadamente contenido —un bloque, en la columna que ya existe—
 * para no chocar con el rediseño del panel derecho que corre en paralelo
 * (`feat/panel-multifuncion`): no se tocó ni un archivo de esa rama.
 */
export function PorQueEstaSugerencia({
  sugerencia,
  limites,
}: {
  sugerencia: MensajeBandeja;
  limites?: LimitesRitmo;
}) {
  // Misma clave que el hilo del medio: TanStack la deduplica, no hay pedido de
  // más. Y no dispara nada — `marcarLeido` solo lo llama `HiloWhatsapp` al abrir.
  const { hilo } = useConversacionWa(sugerencia.telefono);
  const dijo = loQueDijo(hilo.data?.mensajes ?? []);
  const origen = hilo.data?.origen ?? null;
  const cadena = porQueEstaCampana(sugerencia.campanaFuente);
  const v = vencimiento(sugerencia.caducaEn, new Date());

  return (
    <section
      aria-label="Por qué esta respuesta"
      className="shrink-0 overflow-hidden rounded-2xl border border-navy/25 bg-card shadow-panel"
    >
      <header className="border-b border-border bg-secondary/60 px-3 py-1.5">
        <h2 className="font-heading text-[11px] font-bold uppercase tracking-wide text-navy-ink">Por qué esta respuesta</h2>
      </header>

      <div className="space-y-3 px-3 py-2.5">
        <LoQuePregunto dijo={dijo} cargando={hilo.isPending} />

        {origen?.fuente === 'anuncio' && (
          <Dato icono={<Megaphone size={12} />} rotulo="Vino del anuncio">
            {origen.anuncio ?? origen.titulo ?? 'sin título'}
            {origen.campana ? <span className="text-muted-foreground"> · {origen.campana}</span> : null}
          </Dato>
        )}

        <Dato icono={<MessageSquareQuote size={12} />} rotulo="Se le manda lo de">
          {sugerencia.campana ?? 'la plantilla genérica'}
          <span className="mt-0.5 block font-normal text-muted-foreground">
            {cadena ? (
              <>
                sale <b className="font-semibold text-foreground">{cadena}</b>
              </>
            ) : (
              // Sin la columna `campana_fuente` (fila vieja): se dice que no se
              // sabe en vez de inventar una procedencia. Es LA pantalla que
              // existe para explicar de dónde sale algo.
              <>no quedó registrado de qué fuente salió</>
            )}
            <span className="mt-0.5 block font-mono text-[10px]">plantilla · {sugerencia.plantillaId}</span>
          </span>
        </Dato>

        <CuandoApruebes limites={limites} />

        {/* EL ORO, y solo acá: lo que de verdad se está acabando. */}
        {v.apura && (
          <p className="flex items-center gap-1.5 rounded-lg bg-gold/15 px-2 py-1.5 font-mono text-[10px] font-bold tabular-nums text-gold-ink">
            <Timer size={12} className="shrink-0" />
            {v.texto} — después caduca sola y esta persona no recibe nada.
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * LO QUE ESCRIBIÓ, textual y con la hora. Textual porque parafrasear acá sería
 * meter una segunda interpretación en la pantalla que existe para poder juzgar
 * la primera.
 */
function LoQuePregunto({ dijo, cargando }: { dijo: LoQueDijo; cargando: boolean }) {
  if (cargando) return <div className="h-14 animate-pulse rounded-xl bg-muted" />;

  if (dijo.clase === 'nada') {
    return (
      <Nota tono="calmo">
        <b>Nunca escribió texto.</b> Llegó y no dijo nada: la plantilla genérica es lo que corresponde.
      </Nota>
    );
  }

  if (dijo.clase === 'sin-texto') {
    return (
      <Nota tono="atento">
        <b>Mandó audio o imagen, sin texto</b> ({horaCorta(new Date(dijo.cuando))}). Hermes no lo puede leer —
        escuchalo en el hilo antes de aprobar.
      </Nota>
    );
  }

  const cuando = new Date(dijo.cuando);
  const esCopy = dijo.clase === 'copy-del-anuncio';

  return (
    <div>
      <p className="flex items-baseline gap-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        <span className="font-sans font-bold not-italic tracking-normal text-navy-ink">
          {esCopy ? 'Lo que llegó' : 'Lo que preguntó'}
        </span>
        <span className="tabular-nums">{horaCorta(cuando)}</span>
      </p>
      <blockquote
        className={
          'mt-1 rounded-xl border-l-[3px] px-2.5 py-1.5 text-[11px] leading-relaxed ' +
          (esCopy ? 'border-border bg-muted/50 text-muted-foreground' : 'border-navy bg-secondary/50 text-foreground')
        }
      >
        «{dijo.texto}»
      </blockquote>
      {esCopy ? (
        <Nota tono="calmo">
          Es el texto <b>pre-rellenado del anuncio</b>: un clic, no una pregunta. La plantilla genérica va bien.
        </Nota>
      ) : (
        <Nota tono="atento">
          Esto <b>lo escribió ella</b>. Si la plantilla no se lo contesta, editala antes de aprobar.
        </Nota>
      )}
    </div>
  );
}

/**
 * EL RITMO, dicho donde se decide. No es letra chica: es la promesa de la casa
 * —un envío a la vez, espaciado, en hora creíble— y la vendedora tiene que
 * poder decirla en voz alta si alguien le pregunta qué acaba de aprobar.
 */
function CuandoApruebes({ limites }: { limites?: LimitesRitmo }) {
  const [min, max] = limites?.espaciadoSegundos ?? [60, 240];
  const ventana = limites?.ventanaDespacho;

  return (
    <div>
      <p className="font-sans text-[11px] font-bold text-navy-ink">Cuando apruebes</p>
      <ul className="mt-1 space-y-0.5 text-[10px] leading-relaxed text-muted-foreground">
        <li>
          · <b className="font-semibold text-foreground">no sale ahora</b>: entra a la cola, una cada{' '}
          <span className="tabular-nums">
            {Math.round(min / 60)}–{Math.round(max / 60)}
          </span>{' '}
          min
        </li>
        {ventana && (
          <li>
            · nunca fuera de <span className="tabular-nums">{ventana.desde}–{ventana.hasta}</span>
          </li>
        )}
        {limites && (
          <li>
            · tope <span className="tabular-nums">{limites.techoPorHora}/hora</span> y{' '}
            <span className="tabular-nums">{limites.techoPorDia}/día</span> por número
          </li>
        )}
        <li>· se cancela sola si contestás vos primero</li>
      </ul>
    </div>
  );
}

function Dato({ icono, rotulo, children }: { icono: React.ReactNode; rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="flex items-center gap-1 font-sans text-[11px] font-bold text-navy-ink">
        <span className="shrink-0 text-muted-foreground">{icono}</span>
        {rotulo}
      </p>
      <div className="mt-0.5 text-[11px] font-semibold leading-snug text-foreground">{children}</div>
    </div>
  );
}

/**
 * La lectura de la máquina, separada del hecho. Nunca dorada: no es tiempo que
 * se acaba, es una advertencia — el oro tiene una sola acepción en Hermes.
 */
function Nota({ tono, children }: { tono: 'calmo' | 'atento'; children: React.ReactNode }) {
  return (
    <p
      className={
        'mt-1.5 flex items-start gap-1.5 rounded-lg px-2 py-1 text-[10px] leading-relaxed ' +
        (tono === 'atento' ? 'bg-navy/[0.06] text-foreground' : 'text-muted-foreground')
      }
    >
      {tono === 'atento' && <Clock size={11} className="mt-px shrink-0 text-navy-ink" aria-hidden="true" />}
      <span>{children}</span>
    </p>
  );
}

/** Los límites que informa `GET /api/autorespuesta`. Todo opcional: el server degrada. */
export interface LimitesRitmo {
  espaciadoSegundos?: [number, number];
  techoPorHora?: number;
  techoPorDia?: number;
  ventanaDespacho?: { desde: string; hasta: string };
}
