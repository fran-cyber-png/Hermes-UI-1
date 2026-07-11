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
 * WhatsApp aparece aunque no esté conectado, y lo dice. Esconderlo sería fingir
 * que el mapa está completo: es el canal donde se cierra la venta, y que falte
 * es el dato más importante de esta fila.
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
          <div
            key={clave}
            className={
              'rounded-2xl border bg-card p-5 shadow-sm ' +
              (conectado ? 'border-border' : 'border-dashed border-border')
            }
          >
            <div className="flex items-center gap-2">
              <Icono size={15} className="shrink-0" style={{ color }} />
              <span className="text-sm font-bold text-foreground">{nombre}</span>
            </div>

            {conectado ? (
              <>
                <p className="mt-2 font-heading text-3xl font-extrabold tabular-nums text-foreground">
                  {datos.total.toLocaleString('es')}
                </p>
                <p className="text-xs text-muted-foreground">
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
          </div>
        );
      })}

      {/* Los formularios son otra clase de entrada: traen el dato ya estructurado.
          Por eso cierran la fila en vez de mezclarse con los canales. */}
      <Link
        to="/leads"
        className="group rounded-2xl border border-border bg-card p-5 shadow-sm transition-colors hover:border-primary"
      >
        <div className="flex items-center gap-2">
          <FileText size={15} className="shrink-0 text-navy" />
          <span className="text-sm font-bold text-foreground">Formularios</span>
        </div>
        <p className="mt-2 font-heading text-3xl font-extrabold tabular-nums text-foreground">
          {(formularios?.total ?? 0).toLocaleString('es')}
        </p>
        <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          {(formularios?.sin_atender ?? 0).toLocaleString('es')} sin contactar
          <ArrowRight size={11} className="text-primary opacity-0 transition-opacity group-hover:opacity-100" />
        </p>
      </Link>
    </div>
  );
}
