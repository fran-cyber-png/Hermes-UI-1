import { Check, ChevronRight, LockOpen } from 'lucide-react';
import type { Interaccion } from './types';
import { TIPO_META, tipoDe } from './tipos';
import { daysSince, temperatureOf, TEMPERATURE_META } from '../leads/temperature';

/**
 * Lo que la persona ESCRIBIÓ es el héroe, no su nombre.
 *
 * Meta oculta el nombre en el 99% de los comentarios de Facebook (11.739 de
 * 11.819). Si el nombre fuera el título, la columna sería un muro de "Sin
 * nombre". El texto siempre está — y es lo que decide si vale una respuesta.
 *
 * El borde izquierdo codifica QUÉ es (info / comentario / chat); el punto de
 * color, hace CUÁNTO espera. Dos señales, dos dimensiones, sin leer una palabra.
 */
export default function InteraccionCard({
  i,
  onClick,
  respondida,
}: {
  i: Interaccion;
  onClick: () => void;
  respondida: boolean;
}) {
  const tipo = tipoDe(i);
  const meta = TIPO_META[tipo];
  const temp = TEMPERATURE_META[temperatureOf(i.occurred_at)];
  const dias = daysSince(i.occurred_at);
  const contactada = respondida || i.status === 'contactado';

  const anonimo = !i.persona_nombre;
  const quien = i.persona_nombre ?? (i.canal === 'facebook' ? 'Usuario de Facebook' : 'Sin nombre');

  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'group flex w-full gap-3 border-b border-l-[3px] border-border px-4 py-3.5 text-left transition-colors last:border-b-0 hover:bg-muted/50 ' +
        meta.borde +
        (contactada ? ' opacity-55' : '')
      }
    >
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${meta.chip}`}>
            <meta.icon size={10} />
            {meta.label}
          </span>
          {contactada && (
            <span className="inline-flex items-center gap-1 rounded-full bg-temp-fresco/15 px-2 py-0.5 text-[11px] font-bold text-temp-fresco">
              <Check size={10} /> Respondido
            </span>
          )}
          {/* La ventana del privado: se cierra a los 7 días, para siempre.
              Solo se muestra cuando está ABIERTA — es la excepción rara y
              valiosa (7 de 14.458), no el estado normal. */}
          {i.ventana_abierta && !contactada && (
            <span
              title="Todavía le puedes escribir por privado. Meta cierra esa puerta a los 7 días."
              className="inline-flex items-center gap-1 rounded-full bg-temp-fresco/15 px-2 py-0.5 text-[11px] font-bold text-temp-fresco"
            >
              <LockOpen size={10} /> Puedes escribirle
            </span>
          )}
          <span className="ml-auto flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${temp.bar}`} aria-hidden="true" />
            <span className={`text-xs font-semibold ${temp.text}`}>{dias}d</span>
          </span>
        </div>

        <p className="line-clamp-3 text-[15px] leading-snug text-foreground">
          {i.texto || <em className="text-muted-foreground">(sin texto)</em>}
        </p>

        <div className="mt-1.5 flex items-center gap-1.5 text-xs">
          <span className={anonimo ? 'italic text-muted-foreground/60' : 'font-semibold text-muted-foreground'}>
            {i.canal === 'instagram' && !anonimo ? '@' : ''}
            {quien}
          </span>
          {i.contexto_texto && (
            <span className="truncate text-muted-foreground/70">· en “{i.contexto_texto}”</span>
          )}
        </div>
      </div>

      <ChevronRight
        size={15}
        className="mt-1 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-primary"
      />
    </button>
  );
}
