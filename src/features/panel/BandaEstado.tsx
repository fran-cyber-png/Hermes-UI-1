import { AlertTriangle, BadgeCheck, ExternalLink, Snowflake, UserPlus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Conversacion } from '../canales/conversaciones';
import { Avatar } from '../canales/Avatar';
import { BadgeCanal, nombreCanal } from '../canales/BadgeCanal';
import { FranjaEtiquetas } from '../senales/FranjaEtiquetas';
import { nombreDelContacto, PROCEDENCIA } from './identidad';
import type { AcentoContacto, EstadoContacto, TonoContacto } from './estadoContacto';

/**
 * LA BANDA DE ESTADO — los primeros 100 px del panel, y la respuesta a «quién es».
 *
 * ── Por qué no es «el nombre otra vez» ──
 * El nombre de esta persona ya está en la fila de la cola y otra vez en el
 * encabezado del chat: una tercera copia no informa nada. Lo que ninguna de las
 * dos dice —y decide cómo le hablás— es si **ya compró**. Así que la banda
 * dedica su línea grande al nombre REAL (el de Cerberus o el del formulario, que
 * no es el «🦋W» de la cola) y su segunda línea al estado, con acento de color.
 *
 * ── El color, y por qué NO hay oro ──
 * En Hermes el oro significa una sola cosa: tiempo que se acaba. Ni «cliente» ni
 * «lead nuevo» son un reloj. El filete de arriba está SIEMPRE (así su ausencia
 * nunca es un dato) y solo se colorea cuando el color significa algo:
 *
 *   · verde  — ya compró. El hecho más fuerte del panel.
 *   · frío   — cotizada y dejó de contestar (`--temp-frio`, el naranja tostado
 *              de la rampa de temperatura; nunca ámbar, nunca dorado).
 *   · ámbar  — Cerberus no respondió: NO se sabe. Distinto de «es nueva».
 *   · gris   — lead nuevo. Sin novedad, sin ruido.
 *
 * El arbitraje entre los cuatro se decide en `estadoContacto.ts`, con tests.
 */

const ACENTO: Record<AcentoContacto, { filete: string; fondo: string; pastilla: string }> = {
  cliente: { filete: 'bg-success', fondo: 'bg-success/[0.05]', pastilla: 'bg-success/12 text-success' },
  frio: { filete: 'bg-temp-frio', fondo: 'bg-temp-frio/[0.05]', pastilla: 'bg-temp-frio/12 text-temp-frio' },
  alerta: { filete: 'bg-warning', fondo: 'bg-warning/[0.07]', pastilla: 'bg-warning/15 text-warning-foreground' },
  neutro: { filete: 'bg-border', fondo: '', pastilla: 'bg-secondary text-secondary-foreground' },
};

const ICONO: Record<TonoContacto, LucideIcon | null> = {
  cliente: BadgeCheck,
  nuevo: UserPlus,
  'sin-saber': AlertTriangle,
  cargando: null,
  'otro-canal': null,
};

const CERBERUS = import.meta.env.VITE_CERBERUS_URL ?? 'https://app.goberna.us';

export function BandaEstado({
  conversacion,
  estado,
  cerberusId,
  cerberusNombre,
  leadNombre,
}: {
  conversacion: Conversacion;
  estado: EstadoContacto;
  /** Para el link a la ficha completa. `null` = no es cliente todavía. */
  cerberusId: number | null;
  cerberusNombre: string | null;
  leadNombre: string | null;
}) {
  const esWa = conversacion.canal === 'whatsapp';
  const telefono = conversacion.persona_id;
  const acento = ACENTO[estado.acento];
  const Icono = ICONO[estado.tono];

  const nombre = nombreDelContacto({
    pushname: conversacion.persona_nombre,
    leadNombre: leadNombre ?? conversacion.lead_nombre,
    cerberusNombre,
  });
  const arroba = conversacion.canal === 'instagram' && nombre.fuente === 'whatsapp' ? '@' : '';
  const procedencia = PROCEDENCIA[nombre.fuente];

  return (
    <header className="shrink-0">
      {/* El filete está siempre; el color es el que habla. */}
      <div className={'h-[3px] w-full ' + acento.filete} />

      <div className={'px-3 pb-2.5 pt-2.5 ' + acento.fondo}>
        <div className="flex items-start gap-2.5">
          <span className="relative shrink-0">
            <Avatar
              // Las iniciales salen del nombre de la COLA, no del legal: «AV» de
              // «Alejandro Vila» es la cara que la vendedora ya vio en la fila;
              // «DE» de «DR EN DERECHO…» no le dice nada a nadie.
              nombre={conversacion.persona_nombre ?? nombre.principal ?? telefono}
              telefono={esWa ? telefono : null}
              conFoto={esWa}
              className="size-10 rounded-[13px] bg-card font-heading text-xs font-bold text-navy"
            />
            <span className="absolute -bottom-0.5 -right-0.5">
              <BadgeCanal canal={conversacion.canal} />
            </span>
          </span>

          <div className="min-w-0 flex-1">
            {/* Dos líneas, no una truncada: un nombre legal («DR EN DERECHO
                IGNACIO ALEJANDRO VILA CHÁVEZ») cortado en «DR EN DERECHO
                IGNACIO ALEJAND…» no identifica a nadie. */}
            <h2
              title={nombre.principal ?? undefined}
              className="line-clamp-2 font-heading text-sm font-bold leading-tight text-navy"
            >
              {arroba}
              {nombre.principal ?? 'Contacto sin nombre'}
            </h2>
            {/* LA PROCEDENCIA A LA VISTA (#118): el nombre del formulario manda
                sobre el alias de WhatsApp, pero la ficha dice de dónde sale — no
                es lo mismo un nombre que alguien firmó comprando que uno que
                tipeó en un anuncio. Y el alias no se pierde: es como se llama la
                persona en el chat y en la cola. */}
            <p className="mt-0.5 truncate text-[11px] leading-tight text-muted-foreground">
              {nombre.alias ? (
                <>
                  {procedencia && <span className="text-muted-foreground/70">{procedencia} · </span>}
                  <span className="text-muted-foreground/70">en WhatsApp: </span>
                  {nombre.alias}
                </>
              ) : (
                <>
                  {procedencia ? procedencia + ' · ' : ''}
                  {nombreCanal(conversacion.canal)}
                  {conversacion.tipo === 'comentario' ? ' · comentario' : ''}
                </>
              )}
            </p>
          </div>
        </div>

        {/* El estado y la cifra, en UNA línea: es una comparación, no un titular. */}
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className={
              'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ' +
              acento.pastilla
            }
          >
            {Icono && <Icono size={11} strokeWidth={2.4} />}
            {estado.titulo}
          </span>

          {estado.compras && (
            <span className="font-heading text-[15px] font-bold leading-none tabular-nums text-navy">
              {estado.compras.moneda}{' '}
              {estado.compras.total.toLocaleString('es', { maximumFractionDigits: 2 })}
              <span className="ml-1 font-sans text-[11px] font-medium text-muted-foreground">
                · {estado.compras.n} {estado.compras.n === 1 ? 'compra' : 'compras'}
              </span>
            </span>
          )}

          {estado.enfriada && estado.acento !== 'frio' && (
            <span
              title="Ya tiene precio y dejó de contestar"
              className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-temp-frio"
            >
              <Snowflake size={11} /> se enfrió
            </span>
          )}

          {cerberusId !== null && (
            <a
              href={`${CERBERUS}/clientes/${cerberusId}/`}
              target="_blank"
              rel="noreferrer"
              className="ml-auto inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-primary transition-colors hover:text-primary-hover hover:underline"
            >
              Cerberus <ExternalLink size={10} />
            </a>
          )}
        </div>

        {estado.detalle && (
          <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">{estado.detalle}</p>
        )}

        {/* Las etiquetas —automáticas y manuales— cierran el «qué es». */}
        <div className="mt-2 empty:mt-0">
          <FranjaEtiquetas clave={conversacion.clave} />
        </div>
      </div>
    </header>
  );
}
