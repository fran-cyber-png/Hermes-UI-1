import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Camera, Check, Clock, MessageCircle, MessagesSquare, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Accionable } from '../../lib/datos/overview';
import type { CanalesResponse, EstadoCanal } from './types';

/**
 * LA BANDEJA, POR CANAL — la estación CONVERSA del embudo.
 *
 * Antes todo caía en una sola cola, y esa cola escondía lo único que de verdad importa: los
 * canales NO son intercambiables. En Facebook puedes mandar un privado, pero solo por 7 días.
 * En Instagram no puedes mandar privados en absoluto —Meta no aprobó la revisión de la app—,
 * solo responder comentarios en público. En WhatsApp no hay nada porque no está conectado, y
 * es justo donde se cierra la venta.
 *
 * Tres tarjetas grandes, lado a lado, cada una diciendo la verdad de su canal: qué se puede
 * hacer, qué no, y por qué. Un canal sin conectar dice "sin conectar", no un cero que engaña.
 *
 * Se usa en dos lados con la misma verdad: compacta en el home, completa en /bandeja.
 */

type Ficha = {
  clave: string;
  nombre: string;
  color: string;
  icono: LucideIcon;
  /** Lo que sí se puede hacer en este canal, sin promesas. */
  permite: string[];
  /** Lo que no se puede, y por qué. Si falta algo, se dice con todas las letras. */
  bloqueado?: string;
};

const FICHAS: Ficha[] = [
  {
    clave: 'instagram',
    nombre: 'Instagram',
    color: '#C13584',
    icono: Camera,
    permite: ['Responder comentarios en público'],
    bloqueado: 'Los mensajes privados necesitan que Meta apruebe la revisión de la app.',
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
    bloqueado: 'Sin conectar. Es donde se cierra la venta y el 77% de la inversión. Falta migrar a la Cloud API de Meta.',
  },
];

function horas(h: number | null): string | null {
  if (h == null) return null;
  if (h < 1) return 'menos de 1 hora';
  if (h < 24) return `${Math.round(h)} horas`;
  return `${Math.round(h / 24)} días`;
}

export default function BandejaCanales({
  canales,
  accionable,
  compacto = false,
}: {
  canales: CanalesResponse;
  accionable: Accionable;
  compacto?: boolean;
}) {
  const esperanPorCanal = new Map(accionable.porCanal.map((c) => [c.canal, c.n]));
  const estadoPorCanal = new Map<string, EstadoCanal>(
    canales.interacciones.map((c) => [c.canal, c]),
  );
  const restante = horas(accionable.horasRestantesMasUrgente);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {FICHAS.map((f) => {
        const Icono = f.icono;
        const estado = estadoPorCanal.get(f.clave);
        const conectado = estado !== undefined;
        const esperan = esperanPorCanal.get(f.clave) ?? 0;
        // El reloj de la ventana solo aprieta en Facebook: es el único con privados a plazo.
        const mostrarReloj = f.clave === 'facebook' && esperan > 0 && restante;

        return (
          <div
            key={f.clave}
            className={
              'flex flex-col rounded-2xl border bg-card p-5 shadow-sm ' +
              (conectado ? 'border-border' : 'border-dashed border-border')
            }
          >
            {/* Cabecera: el canal, con su color. */}
            <div className="flex items-center gap-2.5">
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded-xl text-white"
                style={{ backgroundColor: f.color }}
              >
                <Icono size={18} />
              </span>
              <span className="font-heading text-base font-bold text-navy">{f.nombre}</span>
            </div>

            {/* El número grande: cuántos esperan, o el estado de "sin conectar". */}
            {conectado ? (
              <div className="mt-4">
                <p className="font-heading text-4xl font-extrabold tabular-nums text-foreground">
                  {esperan.toLocaleString('es')}
                </p>
                <p className="text-sm text-muted-foreground">
                  {esperan === 1 ? 'espera respuesta' : 'esperan respuesta'}
                </p>
                {mostrarReloj && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-primary">
                    <Clock size={13} className="shrink-0" />
                    Al más urgente le quedan {restante}
                  </p>
                )}
              </div>
            ) : (
              <div className="mt-4">
                <p className="flex items-center gap-1.5 font-heading text-lg font-extrabold text-gold-ink">
                  <AlertTriangle size={17} className="shrink-0" />
                  Sin conectar
                </p>
              </div>
            )}

            {/* Qué se puede y qué no. La honestidad del canal, no un adorno. */}
            {!compacto && (
              <div className="mt-4 flex flex-col gap-1.5 border-t border-border pt-4">
                {f.permite.map((p) => (
                  <p key={p} className="flex items-start gap-2 text-xs text-foreground">
                    <Check size={14} className="mt-0.5 shrink-0 text-emerald-600" />
                    {p}
                  </p>
                ))}
                {f.bloqueado && (
                  <p className="flex items-start gap-2 text-xs text-muted-foreground">
                    <X size={14} className="mt-0.5 shrink-0 text-gold-ink" />
                    {f.bloqueado}
                  </p>
                )}
              </div>
            )}

            {/* Datos del período, solo en la versión completa. */}
            {!compacto && conectado && estado && (
              <p className="mt-3 text-xs text-muted-foreground">
                {estado.comentarios.toLocaleString('es')} comentarios ·{' '}
                {estado.mensajes.toLocaleString('es')} mensajes ·{' '}
                <span className="font-semibold text-gold-ink">
                  {estado.pide_info.toLocaleString('es')} piden info
                </span>
              </p>
            )}

            {/* La puerta: a trabajar el canal, o a ver qué falta. */}
            <Link
              to={`/canal/${f.clave}`}
              className="group mt-4 flex items-center gap-1.5 text-sm font-bold text-primary"
            >
              {conectado ? (esperan > 0 ? 'Responder' : 'Ver el canal') : 'Qué falta'}
              <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        );
      })}
    </div>
  );
}
