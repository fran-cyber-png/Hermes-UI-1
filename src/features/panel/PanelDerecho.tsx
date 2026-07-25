import { useRef, useState } from 'react';
import { BookOpen, NotebookPen, Send, UserRound, type LucideIcon } from 'lucide-react';
import type { Conversacion } from '../canales/conversaciones';
import { PanelContexto } from '../canales/PanelContexto';
import { FichaContacto, useFicha } from '../cerberus/FichaContacto';
import type { Ficha } from '../cerberus/ficha';
import { useLeadForm } from '../cerberus/BloqueLeadForm';
import { PanelNotas } from '../notas/PanelNotas';
import { PanelPlantillas } from '../plantillas/PanelPlantillas';
import { DosRespuestas } from '../sugerencias/DosRespuestas';
import { BloqueHechos } from '../hechos/BloqueHechos';
import { useSenales } from '../senales/senales';
import { ponerEnComposer } from '../whatsapp/puenteComposer';
import { AccionesContacto } from './AccionesContacto';
import { BandaEstado } from './BandaEstado';
import { BloqueInteres } from './BloqueInteres';
import { estadoDelContacto } from './estadoContacto';
import { PanelCurso } from './PanelCurso';
import { pestanaInicial, pestanasDe, type IdPestana } from './pestanas';

/**
 * EL PANEL DERECHO — la mesa de trabajo de 360 px, ordenada por lo que decide
 * una venta.
 *
 * ══ EL ORDEN, Y POR QUÉ ES ESE ═══════════════════════════════════════════════
 *
 * En 360 px de ancho lo que está arriba se lee y lo que está abajo no existe. El
 * orden no es temático (datos / acciones / notas): es el de las preguntas que la
 * vendedora se hace mientras escribe, en el orden en que se las hace.
 *
 *   1. **QUIÉN ES** — `BandaEstado`. Con color, no con un texto que hay que
 *      leer: 124 de las conversaciones abiertas ya compraron y hasta hoy se
 *      veían idénticas a un desconocido. Trae el nombre REAL (el de Cerberus o
 *      el del formulario), no el «🦋W» del pushname, y la cifra de lo que compró.
 *   2. **QUÉ QUIERE** — `BloqueInteres`. 611 conversaciones con precio enviado y
 *      UN interés registrado: el bloque donde se traba el CRM. Si el sistema ya
 *      sabe el curso (formulario o anuncio), lo propone y se asienta con un clic.
 *   3. **QUÉ LE MANDO** — `DosRespuestas` (la secuencia entera, un clic) y
 *      `BloqueHechos` (la frase suelta que desatasca: «se puede en cuotas»,
 *      «el acceso es por un año»). Dos calibres de la misma pregunta.
 *   4. **EL DETALLE**, en pestañas — Ficha · Enviar · Notas · Curso. Lo que se
 *      consulta cuando hace falta, no lo que se mira siempre.
 *   5. **QUÉ HAGO** — `AccionesContacto`, al pie y SIEMPRE visible.
 *
 * ══ QUÉ SE FUE DE LAS PESTAÑAS, Y POR QUÉ ════════════════════════════════════
 *
 * «Registrar venta» vivía DENTRO de la pestaña Ficha: abrir Notas hacía
 * desaparecer el botón que cierra la venta. «Le interesa» estaba TRES veces (la
 * ficha, la pestaña Curso y la barra del chat) y en las tres se leía tarde. Una
 * pestaña sirve para guardar lo que se consulta; nunca para guardar lo que se
 * decide.
 *
 * ══ POR QUÉ PESTAÑAS Y NO ACORDEÓN ═══════════════════════════════════════════
 *
 * Un acordeón con cuatro secciones obliga a plegar lo de arriba para ver lo de
 * abajo y a scrollear para encontrar lo que se usa siempre. Una barra de
 * pestañas cuesta 30 px fijos y deja TODO el alto restante para una sola cosa a
 * la vez — que es como se trabaja un chat.
 */

/** La rama «cliente» de la ficha, o `null`. Acota el union una sola vez. */
function fichaDeCliente(f: Ficha | undefined): Extract<Ficha, { estado: 'cliente' }> | null {
  return f?.estado === 'cliente' ? f : null;
}

const ICONO: Record<IdPestana, LucideIcon> = {
  ficha: UserRound,
  plantillas: Send,
  notas: NotebookPen,
  curso: BookOpen,
};

export function PanelDerecho({
  conversacion,
  onCorreo,
  onAgendarBienvenida,
}: {
  conversacion: Conversacion;
  onCorreo?: (para: string) => void;
  onAgendarBienvenida?: (telefono: string | null) => void;
}) {
  // La preferencia sobrevive al cambio de conversación: el panel no se
  // desmonta, y reordenarle la cabeza a la vendedora en cada chat sería peor
  // que respetarle la última elección.
  const [preferida, setPreferida] = useState<IdPestana | null>(null);
  const bandeja = useRef<HTMLDivElement>(null);

  /**
   * Elegir una pestaña TRAE la bandeja a la vista. Con dos respuestas cargadas,
   * el detalle arranca abajo del pliegue: sin esto, tocar «Notas» parecía no
   * hacer nada. Como la barra de pestañas es pegajosa, la bandeja aterriza justo
   * debajo de ella.
   */
  function elegir(id: IdPestana) {
    setPreferida(id);
    requestAnimationFrame(() => bandeja.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }

  const esWa = conversacion.canal === 'whatsapp';
  const telefono = conversacion.persona_id;
  const pestanas = pestanasDe({ canal: conversacion.canal, conTelefono: Boolean(telefono) });
  const activa = pestanaInicial(pestanas, preferida);

  // Las tres consultas que arman el veredicto de arriba. Todas comparten caché
  // con quien ya las pedía (la ficha con su pestaña, el lead con su bloque), así
  // que subirlas acá no agrega ni un request.
  const ficha = useFicha(telefono, esWa);
  const lead = useLeadForm(telefono, esWa);
  const { data: senales } = useSenales([conversacion.clave]);

  const estado = estadoDelContacto({
    conTelefono: esWa,
    cargando: ficha.isPending && esWa,
    error: ficha.isError,
    ficha: ficha.data,
    enfriada: senales?.senales[conversacion.clave]?.enfriamiento.enfriada ?? false,
  });

  const cliente = fichaDeCliente(ficha.data);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl bg-card shadow-panel">
      {/* 1 — quién es. */}
      <BandaEstado
        conversacion={conversacion}
        estado={estado}
        cerberusId={cliente?.id ?? null}
        cerberusNombre={cliente?.nombre ?? null}
        leadNombre={lead.data?.lead?.nombre ?? null}
      />

      {/* EL ROLLO DE TRABAJO. La banda de arriba y las acciones de abajo están
          clavadas; todo lo del medio vive en UN solo scroll.
          Por qué: en un laptop de 1280×720, con las dos respuestas cargadas, el
          reparto flex empujaba el pie FUERA del panel y «Registrar venta»
          desaparecía sin aviso. Un botón que se va de pantalla según cuántas
          sugerencias haya es peor que no tenerlo. Acá el pie no se mueve nunca y
          lo que sobra se scrollea; la barra de pestañas queda pegajosa, así que
          cambiar de sección sigue estando a un clic sin volver arriba. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {/* 2 — qué quiere. Antes de qué mandarle: lo que se manda depende de esto. */}
        <BloqueInteres conversacion={conversacion} />

        {/* 3 — qué le mando. Solo WhatsApp: es por donde se manda. */}
        {esWa && (
          <div className="shrink-0 border-t border-border px-3 py-2.5">
            <DosRespuestas conversacion={conversacion} onIrAPlantillas={() => elegir('plantillas')} />
          </div>
        )}

        {/* 3b — qué DECIRLE. Va pegado a las respuestas porque es la misma
            pregunta («¿qué le mando?») con dos calibres: la secuencia entera y
            la frase suelta. Debajo, no encima: mandar el material es lo que se
            hace en la mayoría de las conversaciones; el dato suelto es el que
            desatasca las que ya están habladas. */}
        <BloqueHechos conversacion={conversacion} />

        {/* 4 — el detalle. */}
        <nav
          role="tablist"
          aria-label="Secciones del panel"
          className="sticky top-0 z-10 flex shrink-0 gap-0.5 border-y border-border bg-muted/60 px-1.5 backdrop-blur-sm"
        >
        {pestanas.map((p) => {
          const Icono = ICONO[p.id];
          const esActiva = p.id === activa;
          return (
            <button
              key={p.id}
              role="tab"
              aria-selected={esActiva}
              aria-disabled={!p.disponible}
              title={p.motivo}
              onClick={() => p.disponible && elegir(p.id)}
              className={
                'relative flex flex-1 items-center justify-center gap-1 py-2 text-[11px] font-semibold transition-colors ' +
                (!p.disponible
                  ? 'cursor-default text-muted-foreground/40'
                  : esActiva
                    ? 'text-navy'
                    : 'text-muted-foreground hover:text-foreground')
              }
            >
              <Icono size={12} strokeWidth={esActiva ? 2.4 : 1.8} />
              {p.etiqueta}
              {esActiva && (
                <span className="absolute inset-x-1.5 -bottom-px h-0.5 rounded-full bg-navy" />
              )}
            </button>
          );
        })}
        </nav>

        {/* La bandeja del detalle, HUNDIDA a propósito. El panel queda con tres
            planos que se leen sin explicación: blanco arriba (lo que decide),
            bandeja al medio (lo que se consulta), blanco abajo (lo que se hace).
            Sin eso, un contacto con poco detalle dejaba 250 px de blanco muerto
            en el medio del panel, que se lee como «algo no cargó».
            `flex-1` la estira cuando sobra alto; `min-h-[14rem]` le pone piso
            para que las pestañas que miden su propio alto (Curso, Notas) tengan
            contra qué medirse cuando el rollo ya está scrolleando. */}
        <div
          key={activa}
          ref={bandeja}
          className="animate-entrar min-h-[14rem] flex-1 overflow-hidden bg-muted/60 px-3 py-3"
        >
          {activa === 'ficha' ? (
            esWa ? (
              <FichaContacto conversacion={conversacion} onCorreo={onCorreo} embebida />
            ) : (
              <PanelContexto conversacion={conversacion} embebida />
            )
          ) : activa === 'plantillas' ? (
            <PanelPlantillas
              conversacion={conversacion}
              onEditarEnComposer={
                telefono ? (texto) => ponerEnComposer({ telefono, texto }) : undefined
              }
            />
          ) : activa === 'notas' ? (
            <div className="h-full overflow-y-auto">
              <PanelNotas clave={conversacion.clave} siempreAbierto />
            </div>
          ) : (
            <PanelCurso />
          )}
        </div>
      </div>

      {/* 5 — qué hago. Fuera de las pestañas: el botón que cierra la venta no
          puede depender de cuál quedó abierta. */}
      <AccionesContacto
        conversacion={conversacion}
        estado={estado}
        cerberusId={cliente?.id ?? null}
        cerberusNombre={cliente?.nombre ?? null}
        paisNombre={cliente?.pais ?? ''}
        onAgendarBienvenida={onAgendarBienvenida}
      />
    </div>
  );
}
