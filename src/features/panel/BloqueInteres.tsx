import { useState } from 'react';
import { Search, Target } from 'lucide-react';
import { sectionLabel } from '../../lib/styles';
import type { Conversacion } from '../canales/conversaciones';
import { Intereses, useIntereses } from '../gestion/Intereses';
import { resumirIntereses } from './resumenInteres';

/**
 * «LE INTERESA» — el bloque donde se traba el CRM, y el que da contexto a todo
 * lo demás.
 *
 * ══ POR QUÉ ESTÁ ACÁ ARRIBA, FUERA DE LAS PESTAÑAS ═══════════════════════════
 *
 * **611 conversaciones con precio enviado y UN interés registrado.** La
 * compuerta de «Cotizado» pide interés y nadie lo carga, así que el embudo
 * miente todos los días. Antes «Le interesa» aparecía TRES veces —la ficha, la
 * pestaña Curso y la barra del chat— y en las tres se leía tarde, escondido
 * detrás de la pestaña que quedara abierta.
 *
 * Y no es un dato más: *«los intereses mejor posicionados, también es progresivo
 * y ayuda a dar contexto a todo»* (dueño, 2026-07-25). Es lo que explica por qué
 * el panel sugiere estas respuestas y no otras, qué precio corresponde, y en qué
 * columna del Pipeline va a caer. Por eso va segundo, justo después de quién es.
 *
 * ══ QUÉ PONE ESTE ARCHIVO Y QUÉ NO ═══════════════════════════════════════════
 *
 * Los chips —los registrados con su línea de tiempo y **la propuesta derivada
 * del anuncio o del formulario, con su botón «Confirmar»** (#102)— los pinta
 * `gestion/Intereses`, que es el mismo componente que usan la cola, el Pipeline
 * y el modal de la compuerta. Duplicar acá esa lógica habría sido tener dos
 * lugares que empiezan iguales y se separan en tres semanas (la lección de #37).
 *
 * Lo que agrega este bloque es **el escenario**: el rótulo, el acceso al
 * buscador, la lectura en una línea de la evolución (`resumenInteres.ts`, pura y
 * con tests) y —cuando no hay nada— un vacío que dice **por qué importa** en vez
 * de dejar un `+` mudo.
 */

export function BloqueInteres({ conversacion }: { conversacion: Conversacion }) {
  const { data } = useIntereses(conversacion.clave);
  const [abrirBuscador, setAbrirBuscador] = useState(0);

  const lista = data?.lista ?? [];
  const propuesta = data?.propuesta ?? null;
  const resumen = resumirIntereses(lista);
  const vacio = lista.length === 0 && !propuesta;

  return (
    <section className="shrink-0 border-t border-border px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className={'flex items-center gap-1.5 ' + sectionLabel}>
          <Target size={12} /> Le interesa
        </h3>
        <button
          type="button"
          onClick={() => setAbrirBuscador((n) => n + 1)}
          className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-primary transition-colors hover:text-primary-hover"
        >
          <Search size={10} /> Buscar curso
        </button>
      </div>

      <div className="mt-1.5">
        <Intereses clave={conversacion.clave} compacto senalAbrir={abrirBuscador} />
      </div>

      {vacio ? (
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
          Nadie anotó qué curso quiere, y tampoco vino de un anuncio que lo diga. Sin esto la etapa
          «Cotizado» no abre y el precio que le pases no queda atado a nada.
        </p>
      ) : (
        resumen.linea && (
          <p className="mt-1.5 text-[10px] tabular-nums text-muted-foreground">{resumen.linea}</p>
        )
      )}
    </section>
  );
}
