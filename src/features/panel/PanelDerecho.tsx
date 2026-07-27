import { useState } from 'react';
import { History, Search, Zap } from 'lucide-react';
import { sectionLabel } from '../../lib/styles';
import type { Conversacion } from '../canales/conversaciones';
import { marcaDeCliente } from '../canales/cliente';
import { useFicha } from '../cerberus/FichaContacto';
import type { Ficha } from '../cerberus/ficha';
import { useLeadForm } from '../cerberus/BloqueLeadForm';
import { Intereses, useIntereses } from '../gestion/Intereses';
import { DosRespuestas } from '../sugerencias/DosRespuestas';
import { BloqueHechos } from '../hechos/BloqueHechos';
import { useSenales } from '../senales/senales';
import { BandaEstado } from './BandaEstado';
import { estadoDelContacto } from './estadoContacto';
import { hitosDe } from './hitos';
import { TimelineContacto } from './TimelineContacto';

/**
 * EL PANEL DERECHO — rediseño en curso (dueño, 27-jul-2026).
 *
 * ══ QUÉ REEMPLAZA, Y POR PEDIDO DE QUIÉN ═════════════════════════════════════
 *
 * Reemplaza al panel de cinco zonas de **ADR 0017** (banda · interés · qué
 * mandarle · cuatro pestañas · acciones). La instrucción del dueño, textual:
 * *«la parte derecha, el sidebar, lo vamos a rediseñar completamente. Para
 * empezar lo único que debe estar horita es la ficha del contacto con su
 * historial de compras y sus intereses, nada más, en timeline; y un apartado de
 * enviar rápido que te sugiere un envío según el chat»*.
 *
 * Así que son DOS bloques y nada más:
 *
 *   1. **QUIÉN ES Y QUÉ PASÓ ANTES** — la banda de identidad + un timeline único
 *      con compras e intereses mezclados en orden. Antes eran dos cosas en dos
 *      planos: lo que compró vivía DENTRO de la pestaña Ficha (invisible salvo
 *      que la fueras a buscar) y lo que le interesa, en un bloque aparte arriba.
 *      Son la misma pregunta, y separadas obligaban a rearmar el orden de memoria.
 *   2. **QUÉ LE MANDO YA** — la sugerencia que sale del chat.
 *
 * ══ LO QUE SE FUE, PARA QUE NADIE LO BUSQUE ══════════════════════════════════
 *
 * Las cuatro pestañas (Ficha · Enviar · Notas · Curso) y `AccionesContacto` con
 * su **«Registrar venta»**. Es una decisión explícita del dueño para esta etapa,
 * no un olvido — y es la parte que más conviene mirar de cerca al probar, porque
 * hasta ayer ese botón era el que cerraba la venta. Las notas y el registro de
 * venta siguen existiendo en el server y en la `BarraGestion` del chat; lo que
 * desapareció es su entrada por acá.
 *
 * ⚠ Cuando este rediseño se cierre hay que escribir su ADR y archivar el 0017,
 * como manda la regla dura #3. Todavía no: esto es el primer paso de varios.
 */

/** La rama «cliente» de la ficha, o `null`. Acota el union una sola vez. */
function fichaDeCliente(f: Ficha | undefined): Extract<Ficha, { estado: 'cliente' }> | null {
  return f?.estado === 'cliente' ? f : null;
}

export function PanelDerecho({
  conversacion,
}: {
  conversacion: Conversacion;
  /** Aceptados y sin usar en esta etapa: el shell los sigue pasando. */
  onCorreo?: (para: string) => void;
  onAgendarBienvenida?: (telefono: string | null) => void;
}) {
  const [abrirBuscador, setAbrirBuscador] = useState(0);

  const esWa = conversacion.canal === 'whatsapp';
  const telefono = conversacion.persona_id;

  const ficha = useFicha(telefono, esWa);
  const lead = useLeadForm(telefono, esWa);
  const { data: senales } = useSenales([conversacion.clave]);
  const { data: intereses } = useIntereses(conversacion.clave);

  const estado = estadoDelContacto({
    conTelefono: esWa,
    cargando: ficha.isPending && esWa,
    error: ficha.isError,
    ficha: ficha.data,
    enfriada: senales?.senales[conversacion.clave]?.enfriamiento.enfriada ?? false,
    padron: marcaDeCliente(conversacion)?.nivel ?? null,
  });

  const cliente = fichaDeCliente(ficha.data);
  const hitos = hitosDe({ ventas: cliente?.ventas, intereses: intereses?.lista });

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl bg-card shadow-panel">
      {/* 1 — quién es. Se queda clavada arriba: es la identidad, no contenido. */}
      <BandaEstado
        conversacion={conversacion}
        estado={estado}
        cerberusId={cliente?.id ?? null}
        cerberusNombre={cliente?.nombre ?? null}
        leadNombre={lead.data?.lead?.nombre ?? null}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {/* 1b — QUÉ PASÓ ANTES: compras e intereses en una sola línea. */}
        <section className="shrink-0 border-t border-border px-3 py-2.5">
          <h3 className={'flex items-center gap-1.5 ' + sectionLabel}>
            <History size={12} /> Su historia
          </h3>
          <div className="mt-2">
            <TimelineContacto
              hitos={hitos}
              cargando={esWa && ficha.isPending}
              error={esWa && ficha.isError}
            />
          </div>
        </section>

        {/* 1c — y cómo se le AGREGA un interés. Va acá y no en un bloque propio:
            sin una forma de anotar, el timeline es de solo lectura para siempre
            y nunca se llena. Los chips los pinta el MISMO componente que la cola
            y el Pipeline (`gestion/Intereses`) — duplicarlo sería tener dos
            lugares que empiezan iguales y se separan en tres semanas (#37). */}
        <section className="shrink-0 border-t border-border px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className={sectionLabel}>Le interesa</h3>
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
        </section>

        {/* 2 — ENVIAR RÁPIDO: lo que el chat sugiere mandar, ahora.
            Adentro van los dos calibres de la misma pregunta — la secuencia
            entera (un clic la manda) y la frase suelta que desatasca (tocarla NO
            envía: cae en el composer, regla de #45). Si el bloque tiene que ser
            solo el primero, se saca `BloqueHechos` y listo. */}
        {esWa && (
          <section className="shrink-0 border-t border-border">
            <div className="px-3 pt-2.5">
              <h3 className={'flex items-center gap-1.5 ' + sectionLabel}>
                <Zap size={12} /> Enviar rápido
              </h3>
            </div>
            <div className="px-3 py-2.5">
              <DosRespuestas conversacion={conversacion} />
            </div>
            <BloqueHechos conversacion={conversacion} />
          </section>
        )}
      </div>
    </div>
  );
}
