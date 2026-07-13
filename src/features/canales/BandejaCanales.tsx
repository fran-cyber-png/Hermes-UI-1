import { Link } from 'react-router-dom';
import { Camera, Check, Clock, MessageCircle, MessagesSquare, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Accionable } from '../../lib/datos/overview';
import type { CanalesResponse, EstadoCanal } from './types';

/**
 * LA BANDEJA, POR CANAL — la estación CONVERSA.
 *
 * Los canales NO son intercambiables, y una sola cola lo escondía. En Facebook mandás un privado,
 * pero solo por 7 días. En Instagram no mandás privados en absoluto —Meta no aprobó la revisión—,
 * solo respondés comentarios en público. En WhatsApp no hay nada porque no está conectado, y es
 * justo donde se cierra la venta.
 *
 * El color de canal está CONFINADO a un punto chico (no un ícono gigante en un círculo de color,
 * que es puro cliché). WhatsApp va en gris "helado" hasta que se conecte: el color dice el estado.
 *
 * Dos modos: `plano` (columnas separadas por líneas finas, para vivir dentro del panel del embudo)
 * y completo (tarjetas con el detalle de qué se puede y qué no, para la pantalla /bandeja).
 */

type Ficha = {
  clave: string;
  nombre: string;
  color: string;
  icono: LucideIcon;
  permite: string[];
  bloqueado?: string;
};

const HELADO = '#64748B';

const FICHAS: Ficha[] = [
  {
    clave: 'instagram',
    nombre: 'Instagram',
    color: '#C13584',
    icono: Camera,
    permite: ['Responder comentarios en público'],
    bloqueado: 'Los mensajes privados esperan la revisión de la app por Meta.',
  },
  {
    clave: 'facebook',
    nombre: 'Facebook',
    color: '#1877F2',
    icono: MessagesSquare,
    permite: ['Responder en público siempre', 'Mensaje privado dentro de los 7 días'],
  },
  {
    clave: 'whatsapp',
    nombre: 'WhatsApp',
    color: '#25D366',
    icono: MessageCircle,
    permite: [],
    bloqueado: 'Sin conectar. Es donde se cierra la venta y el 77% de la inversión. Falta la Cloud API.',
  },
];

function horas(h: number | null): string | null {
  if (h == null) return null;
  if (h < 1) return 'menos de 1 h';
  if (h < 24) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} días`;
}

function Canal({
  f,
  estado,
  esperan,
  reloj,
  plano,
}: {
  f: Ficha;
  estado: EstadoCanal | undefined;
  esperan: number;
  reloj: string | null;
  plano: boolean;
}) {
  const Icono = f.icono;
  const conectado = estado !== undefined;
  // El punto de estado lleva el color del canal si está conectado; gris "helado" si no.
  const puntoColor = conectado ? f.color : HELADO;

  return (
    <div
      className={
        plano
          ? 'px-4 py-4 first:pt-0 last:pb-0 sm:py-0 sm:first:pl-0 sm:last:pr-0'
          : 'rounded-xl border border-border bg-card p-4'
      }
    >
      {/* Cabecera: ícono chico monocromo + nombre + punto de estado. */}
      <div className="flex items-center gap-2">
        <Icono size={15} className="shrink-0 text-navy/70" />
        <span className="font-heading text-sm font-bold text-navy">{f.nombre}</span>
        <span
          className={'ml-auto inline-block size-2 rounded-full ' + (conectado ? '' : 'ring-1')}
          style={conectado ? { background: puntoColor } : { borderColor: HELADO, background: 'transparent' }}
        />
      </div>

      {conectado ? (
        <div className="mt-3">
          <p className="font-heading text-3xl font-extrabold tabular-nums text-navy">
            {esperan.toLocaleString('es')}
          </p>
          <p className="text-xs text-muted-foreground">
            {esperan === 1 ? 'espera respuesta' : 'esperan respuesta'}
          </p>
          {reloj && (
            <p className="mt-1.5 flex items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#C2410C' }}>
              <Clock size={11} className="shrink-0" />
              al más urgente le quedan {reloj}
            </p>
          )}
        </div>
      ) : (
        <div className="mt-3">
          <p className="font-heading text-lg font-extrabold" style={{ color: HELADO }}>
            Sin conectar
          </p>
        </div>
      )}

      {/* Qué se puede y qué no — solo en el modo completo. */}
      {!plano && (
        <div className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3">
          {f.permite.map((p) => (
            <p key={p} className="flex items-start gap-2 text-xs text-foreground">
              <Check size={13} className="mt-0.5 shrink-0 text-emerald-600" />
              {p}
            </p>
          ))}
          {f.bloqueado && (
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <X size={13} className="mt-0.5 shrink-0" style={{ color: HELADO }} />
              {f.bloqueado}
            </p>
          )}
          {conectado && estado && (
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-navy/45">
              {estado.comentarios.toLocaleString('es')} coment · {estado.mensajes.toLocaleString('es')} msj ·{' '}
              {estado.pide_info.toLocaleString('es')} piden info
            </p>
          )}
        </div>
      )}

      <Link
        to={`/canal/${f.clave}`}
        className="group mt-3 flex items-center gap-1 font-mono text-[11px] font-semibold uppercase tracking-wide text-navy/60 hover:text-navy"
      >
        {conectado ? (esperan > 0 ? 'Responder →' : 'Ver canal →') : 'Qué falta →'}
      </Link>
    </div>
  );
}

export default function BandejaCanales({
  canales,
  accionable,
  plano = false,
}: {
  canales: CanalesResponse;
  accionable: Accionable;
  plano?: boolean;
}) {
  const esperanPorCanal = new Map(accionable.porCanal.map((c) => [c.canal, c.n]));
  const estadoPorCanal = new Map<string, EstadoCanal>(canales.interacciones.map((c) => [c.canal, c]));
  const restante = horas(accionable.horasRestantesMasUrgente);

  return (
    <div className={plano ? 'grid grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0' : 'grid grid-cols-1 gap-4 sm:grid-cols-3'}>
      {FICHAS.map((f) => (
        <Canal
          key={f.clave}
          f={f}
          estado={estadoPorCanal.get(f.clave)}
          esperan={esperanPorCanal.get(f.clave) ?? 0}
          // El reloj de la ventana solo aprieta en Facebook: es el único con privados a plazo.
          reloj={f.clave === 'facebook' && (esperanPorCanal.get(f.clave) ?? 0) > 0 ? restante : null}
          plano={plano}
        />
      ))}
    </div>
  );
}
