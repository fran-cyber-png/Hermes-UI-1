import { Link } from 'react-router-dom';
import { ArrowRight, Camera, FileText, MessageCircle, MessagesSquare } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { CanalesResponse } from './types';

const CANALES: { clave: string; nombre: string; color: string; icono: LucideIcon }[] = [
  { clave: 'facebook', nombre: 'Facebook', color: '#1877F2', icono: MessagesSquare },
  { clave: 'instagram', nombre: 'Instagram', color: '#C13584', icono: Camera },
  { clave: 'whatsapp', nombre: 'WhatsApp', color: '#25D366', icono: MessageCircle },
];

/**
 * Por dónde entra la gente. Lo primero que se ve, y obedece al filtro de fechas.
 *
 * Cada tarjeta es una puerta: lleva a la pantalla del canal, donde se separan
 * comentarios de mensajes y se ve qué se puede hacer con cada uno.
 *
 * WhatsApp aparece aunque no esté conectado, y su puerta también abre — a una
 * pantalla que explica qué falta. Esconderlo sería fingir que el mapa está
 * completo: es el canal donde se cierra la venta, y que falte es el dato más
 * importante de esta fila.
 */
export default function CanalesStrip({ estado }: { estado: CanalesResponse | null }) {
  const porCanal = (c: string) => estado?.interacciones.find((x) => x.canal === c);
  const formularios = estado?.formularios;

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {CANALES.map(({ clave, nombre, color, icono: Icono }) => {
        const datos = porCanal(clave);
        const conectado = datos !== undefined;

        return (
          <Link
            key={clave}
            to={`/canal/${clave}`}
            className={
              'group flex flex-col rounded-2xl border bg-card p-5 shadow-sm transition-colors hover:border-primary ' +
              (conectado ? 'border-border' : 'border-dashed border-border')
            }
          >
            <div className="flex items-center gap-2">
              <Icono size={15} className="shrink-0" style={{ color }} />
              <span className="text-sm font-bold text-foreground">{nombre}</span>
              <ArrowRight
                size={13}
                className="ml-auto shrink-0 text-primary opacity-0 transition-opacity group-hover:opacity-100"
              />
            </div>

            {conectado ? (
              <>
                <p className="mt-2 font-heading text-3xl font-extrabold tabular-nums text-foreground">
                  {datos.total.toLocaleString('es')}
                </p>
                {/* El desglose que importa: un comentario y un mensaje privado no
                    se atienden igual, ni permiten lo mismo. */}
                <p className="text-xs text-muted-foreground">
                  {datos.comentarios.toLocaleString('es')} comentarios ·{' '}
                  {datos.mensajes.toLocaleString('es')} mensajes
                </p>
                <p className="mt-1 text-xs font-semibold text-gold-ink">
                  {datos.pide_info.toLocaleString('es')} piden información
                </p>
              </>
            ) : (
              <>
                <p className="mt-2 font-heading text-lg font-extrabold text-muted-foreground">
                  Sin conectar
                </p>
                <p className="text-xs text-muted-foreground">
                  Es donde se cierra la venta. Falta decidir si va la API oficial.
                </p>
              </>
            )}
          </Link>
        );
      })}

      {/* Los formularios son otra clase de entrada: traen el dato ya estructurado
          (nombre, teléfono, correo). Por eso cierran la fila en vez de mezclarse
          con los canales, y su puerta lleva a otra pantalla. */}
      <Link
        to="/leads"
        className="group flex flex-col rounded-2xl border border-border bg-card p-5 shadow-sm transition-colors hover:border-primary"
      >
        <div className="flex items-center gap-2">
          <FileText size={15} className="shrink-0 text-navy" />
          <span className="text-sm font-bold text-foreground">Formularios</span>
          <ArrowRight
            size={13}
            className="ml-auto shrink-0 text-primary opacity-0 transition-opacity group-hover:opacity-100"
          />
        </div>
        <p className="mt-2 font-heading text-3xl font-extrabold tabular-nums text-foreground">
          {(formularios?.total ?? 0).toLocaleString('es')}
        </p>
        <p className="text-xs text-muted-foreground">Traen nombre, teléfono y correo</p>
        <p className="mt-1 text-xs font-semibold text-gold-ink">
          {(formularios?.sin_atender ?? 0).toLocaleString('es')} sin contactar
        </p>
      </Link>
    </div>
  );
}
