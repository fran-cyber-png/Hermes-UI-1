import { useState } from 'react';
import { MessageCircle } from 'lucide-react';
import type { Conversacion } from '../../dominio/conversaciones';
import { marcaDeCliente } from '../../dominio/cliente';
import { useFicha } from '../cerberus/useFicha';
import { BloqueTerritorio } from '../territorio/BloqueTerritorio';
import type { Ficha } from '../cerberus/ficha';
import { useLeadForm } from '../cerberus/BloqueLeadForm';
import { useIntereses } from '../gestion/Intereses';
import { useSenales } from '../senales/senales';
import { useEventos, useMutacionesEventos } from '../eventos/eventos';
import { useAgenda } from '../agenda/agenda';
import { useFichaLocal } from './fichaLocal';
import { RegistrarEvento } from '../eventos/RegistrarEvento';
import { estadoDelContacto } from './estadoContacto';
import { nombreDelContacto } from './identidad';
import { ensamblarTimeline } from './timeline';
import { EncabezadoTimeline } from './EncabezadoTimeline';
import { EventoLinea } from './EventoLinea';
import { PieAccionTimeline } from './PieAccionTimeline';
import { ZonaPendientes } from './ZonaPendientes';
import { FichaContacto } from '../cerberus/FichaContacto';
import { VentaDesdeElPanel } from '../venta/VentaDesdeElPanel';
import { origenDeLead } from '../cerberus/leadForm';
import { personaEsTelefono } from '../../dominio/canal';
import type { DestinoCorreo } from '../../lib/puente';

function fichaDeCliente(f: Ficha | undefined): Extract<Ficha, { estado: 'cliente' }> | null {
  return f?.estado === 'cliente' ? f : null;
}

function formatearTelefono(raw: string): string {
  const digitos = raw.replace(/\D/g, '');
  if (digitos.length < 8) return raw;
  const cc = digitos.length > 9 ? digitos.slice(0, digitos.length - 9) : '51';
  const resto = digitos.slice(cc.length);
  const grupos = resto.match(/.{1,3}/g) ?? [resto];
  return '+' + [cc, ...grupos].join(' ');
}

export function PanelDerecho({
  conversacion,
  miVendedora,
  esDeCampana = false,
  onMandarCorreo,
  onEscribir,
}: {
  conversacion: Conversacion;
  /**
   * Quién está mirando. Lo usa el timeline para decidir qué eventos podés
   * editar o borrar — solo los tuyos. Opcional porque la galería monta este
   * panel sin sesión: sin esto, `esMio` da `false` y no se dibuja ningún botón,
   * que es la degradación correcta (nunca al revés).
   */
  miVendedora?: string | null;
  /**
   * ¿Quien mira trabaja en el módulo de CAMPAÑAS? (`modulos/modulo.ts`).
   *
   * 🔴 **Apaga las consultas, no sólo el dibujo.** Tres de los bloques de este
   * panel —la ficha de Cerberus, el lead del formulario y los intereses— salen
   * de rutas que para campaña son **403**: sin esto la pantalla se llenaría de
   * errores por pedir cosas que el server ya decidió que no le tocan.
   *
   * ⚠️ Viaja como PROP y no llamando a `useSesion()` acá: ese hook hace su
   * propio fetch al montar, y este panel se monta en tres lugares.
   *
   * ⚠️ Opcional y `false` por default — la galería lo monta sin sesión, y ahí
   * lo correcto es el panel de siempre.
   */
  esDeCampana?: boolean;
  /**
   * Puente a Correos. Sin esto, «Escribirle» no se dibuja (ver el cableado
   * abajo, donde está el porqué de que eso ya haya costado un mes de feature
   * invisible).
   */
  onMandarCorreo?: (destino: DestinoCorreo) => void;
  /** Puente a Mensajes para iniciar un chat nuevo desde la ficha. */
  onEscribir?: (telefono: string) => void;
}) {
  /**
   * El registro de la venta. Vive acá y no adentro del pie porque el pie es
   * presentación: decide cómo se ve el botón, no qué pasa al tocarlo.
   */
  const [vendiendo, setVendiendo] = useState(false);
  /**
   * 🔴 ACÁ LA PREGUNTA ES «¿HAY TELÉFONO?», NO «¿ES WHATSAPP?» — y se llamaba
   * `esWa`, que es lo que rompió la ficha de los leads de formulario.
   *
   * Los seis usos de abajo (la ficha de Cerberus, el lead-form, la banda de
   * estado, su spinner, el número del encabezado y el «cargando» de Meta) son
   * todos la MISMA pregunta, y para un lead de landing la respuesta es SÍ:
   * `cola/leadsCte.ts` emite el teléfono como `persona_id`. Con el nombre viejo,
   * el panel de Raul Duran salía con «Sin ficha · este canal no lo trae» al lado
   * de su propio número — y sin su correo, que es el insumo para cotizarle.
   *
   * ⚠️ Ninguno de los seis es un permiso de ENVÍO ni un pedido de FOTO: esas son
   * las otras dos preguntas, y siguen siendo solo-WhatsApp (ver `canales/canal.ts`).
   */
  const tieneTelefono = personaEsTelefono(conversacion.canal, conversacion.persona_id);
  const telefono = conversacion.persona_id;

  /**
   * 🔴 LAS TRES DE CERBERUS SE APAGAN EN CAMPAÑA, y `senales` NO.
   *
   * `/api/contactos` y `/api/gestiones/intereses` son superficies de `ventas`
   * (`modulos/modulo.ts`): pedirlas desde campaña es un 403 garantizado.
   * `/api/senales` no lo es —«ya le mandaron el precio», «se enfrió» se derivan
   * del hilo y no tocan Cerberus— así que sigue andando para los dos módulos.
   * Que la línea esté acá y no en cada hook es a propósito: es UNA decisión.
   */
  const conCerberus = !esDeCampana;
  const ficha = useFicha(telefono, tieneTelefono && conCerberus);
  const lead = useLeadForm(telefono, tieneTelefono && conCerberus);
  const { data: senales } = useSenales([conversacion.clave]);
  const { data: intereses } = useIntereses(conversacion.clave, conCerberus);
  const { data: delTimeline } = useEventos(conversacion.clave);
  const fichaLocal = useFichaLocal(conversacion.clave);
  const { agenda } = useAgenda();
  const { editar, borrar } = useMutacionesEventos(conversacion.clave);

  const padron = marcaDeCliente(conversacion);
  const estado = estadoDelContacto({
    conTelefono: tieneTelefono,
    cargando: ficha.isPending && tieneTelefono,
    error: ficha.isError,
    ficha: ficha.data,
    /**
     * ⚠️ `?.` DESPUÉS DE `senales`, TAMBIÉN.
     *
     * `senales?.senales[clave]` sólo protege que la RESPUESTA sea undefined; si
     * el cuerpo llega sin la clave `senales` —un cuerpo de error, una forma que
     * cambió— entonces `undefined[clave]` **tumba el panel entero**, y no hay
     * ErrorBoundary en `src/`: se lleva puesta la app.
     *
     * Se encontró abriendo la ficha desde el Dashboard, pero el defecto era de
     * `PanelDerecho` y valía igual en Pipeline y en el padrón.
     */
    enfriada: senales?.senales?.[conversacion.clave]?.enfriamiento?.enfriada ?? false,
    padron: padron?.nivel ?? null,
    sinCerberus: esDeCampana,
  });

  const cliente = fichaDeCliente(ficha.data);

  const nombreData = nombreDelContacto({
    pushname: conversacion.persona_nombre,
    leadNombre: lead.data?.lead?.nombre ?? null,
    cerberusNombre: cliente?.nombre ?? null,
  });

  const timeline = ensamblarTimeline({
    ficha: ficha.data,
    intereses: intereses?.lista,
    senales: senales?.senales?.[conversacion.clave],
    leadForm: lead.data?.lead ? { campana: lead.data.lead.campana ?? undefined, fecha: lead.data.lead.fecha } : undefined,
    conversacion: { persona_nombre: conversacion.persona_nombre ?? undefined, lead_nombre: conversacion.lead_nombre ?? undefined },
    eventos: delTimeline?.eventos ?? [],
    correos: delTimeline?.correos ?? [],
    yo: miVendedora,
    fichaLocal: fichaLocal.data,
    // Sólo los de ESTA conversación: `useAgenda` trae la agenda entera de quien
    // mira (una sola query compartida con el riel y la vista Agenda), y el
    // timeline es de una persona.
    seguimientos: agenda.data?.recordatorios.filter((r) => r.clave === conversacion.clave),
  });

  const nombre = nombreData.principal ?? 'Sin nombre';
  const iniciales = nombre
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');

  const chips: string[] = [];
  if (padron?.nivel === 'vip') {
    chips.push('VIP');
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl bg-card shadow-panel">
      <EncabezadoTimeline
        iniciales={iniciales}
        nombre={nombre}
        telefono={tieneTelefono && telefono ? formatearTelefono(telefono) : ''}
        canal={conversacion.canal}
        acento={estado.acento}
        tituloEstado={estado.titulo}
        compras={estado.compras}
        chips={chips}
        cargandoMeta={tieneTelefono && lead.isPending}
        meta={
          lead.data?.lead
            ? {
                // La MISMA palabra que la fila del radar (`origenDeLead`): acá
                // decía «Web» y la fila «Landing», sobre el mismo hecho.
                origen: origenDeLead(lead.data.lead.fuente),
                campana: lead.data.lead.campana ?? lead.data.lead.anuncio ?? '',
                primerContacto: lead.data.lead.fecha,
                asignadoA: '',
              }
            : null
        }
        resumenIa={null}
      />
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-border">
        {/* ══ DÓNDE VOTA (ADR 0063) ═══════════════════════════════════════════
            Sólo en campaña, y ARRIBA del timeline: el timeline narra qué pasó y
            esto decide qué hacer — es el equivalente de «Qué quiere» en el panel
            de ventas. El componente se apaga solo con `activo={false}`, así que
            en ventas no se monta ni pide nada. */}
        <BloqueTerritorio clave={conversacion.clave} activo={esDeCampana} />
        <div className="px-4 py-2.5">
          {onEscribir && telefono && tieneTelefono && conversacion.n === 0 && (
            <button
              type="button"
              onClick={() => onEscribir(telefono)}
              className="mb-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-navy px-3 py-2 text-xs font-bold text-white transition-[background-color,transform] duration-200 ease-house hover:bg-navy/90 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <MessageCircle size={13} /> Escribirle
            </button>
          )}
          <ZonaPendientes pendientes={timeline.pendientes} progreso={timeline.progreso} />
          <h3 className="text-xs font-semibold text-muted-foreground">Timeline</h3>
          <ol className="mt-1">
            {timeline.grupos.map((grupo) => (
              <li key={grupo.etiqueta}>
                <h4 className="mt-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {grupo.etiqueta}
                </h4>
                <ol className="mt-0.5">
                  {grupo.eventos.map((e, i) => (
                    <EventoLinea
                      key={e.id}
                      e={e}
                      esUltimo={i === grupo.eventos.length - 1}
                      onEditar={(id, nota) => editar.mutate({ id, nota: nota || null, curso: e.valor ?? null })}
                      onBorrar={(id) => borrar.mutate(id)}
                    />
                  ))}
                </ol>
              </li>
            ))}
          </ol>

          {/* ══ REGISTRAR ALGO EN EL TIMELINE ══════════════════════════════
              Va al PIE de la lista y no arriba: la pregunta que contesta es
              «pasó algo más», y esa se hace después de leer lo que ya pasó.

              El mismo componente que el chip de la barra del chat: uno está
              donde la vendedora escribe, el otro donde lee. Dos componentes
              distintos serían dos vocabularios en dos meses. */}
          <div className="mt-3">
            <RegistrarEvento clave={conversacion.clave} variante="bloque" />
          </div>

          {/* ══ LA FICHA DE CERBERUS ══════════════════════════════════════
              `FichaContacto` estaba HUÉRFANO: el componente que muestra DNI,
              correo, código de cliente y los folios con estado, fecha y monto
              existía entero y `grep '<FichaContacto' src/` daba **cero**. Se
              dejó de renderizar cuando el rediseño del timeline reemplazó al
              panel viejo, y solo sobrevivió su hook `useFicha` —que es por lo
              que la banda de arriba seguía diciendo «Cliente» sin que se
              pudiera ver una sola compra.

              Va DEBAJO del timeline y no arriba: el timeline es la narración
              («qué pasó con esta persona») y la ficha es la referencia («cuál
              es su DNI, qué folios tiene»). Se consulta, no se lee de corrido.

              `embebida`: el marco y el encabezado los pone el panel; sin esto
              dibujaría una segunda tarjeta con el nombre repetido. */}
          {conCerberus && (
          <div className="mt-3 border-t border-border pt-3">
            <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">Ficha de Cerberus</h3>
            {/* 🔴 EL SEGUNDO PUENTE MUERTO DE ESTE MISMO COMPONENTE, y el
                diagnóstico es idéntico al de tres líneas más arriba: hasta hoy
                `grep 'onCorreo=' src/` daba **CERO**. `FichaContacto` declaraba
                la prop, dibujaba «Escribirle» solo si le llegaba (o sea: nunca)
                y nadie se la pasaba — así que **la acción no existió en la app
                durante casi un mes**, con el correo del contacto ahí al lado.

                ⚠️ El patrón «prop opcional que esconde la feature cuando falta»
                se rompe SIN un solo síntoma: no hay error, no hay log, no hay
                test rojo y la pantalla se ve perfecta. Es correcto como diseño
                —un botón que no hace nada es peor— pero obliga a que el
                cableado sea lo primero que se verifique, no lo último.

                Acá se le suma la `clave`: la ficha sabe a quién escribirle, y
                sólo el panel sabe DE QUÉ conversación salió. Sin eso el correo
                se guarda con `clave = NULL` y desaparece del timeline de esta
                misma persona (ver `lib/puente.ts`). */}
            <FichaContacto
              conversacion={conversacion}
              embebida
              onCorreo={
                onMandarCorreo
                  ? (destino) =>
                      onMandarCorreo({
                        ...destino,
                        clave: destino.clave ?? conversacion.clave,
                        // El nombre resuelto (Cerberus > formulario > alias de
                        // WhatsApp, #118), no el crudo del canal: es lo que la
                        // vendedora tiene delante de los ojos al tocar el botón.
                        nombre: destino.nombre ?? nombreData.principal ?? undefined,
                      })
                  : undefined
              }
            />
          </div>
          )}
        </div>
      </div>
      {/* ⚠️ EL `onVender` ES LO QUE FALTABA. Sin él, `PieAccionTimeline` no
          dibuja nada —por diseño: nunca un no-op— y el botón de registrar la
          venta era invisible en TODOS los estados, no solo en algunos. */}
      {/* ⚠️ En campaña NO se le pasa `onVender`, y con eso el pie no dibuja el
          botón — es su diseño («nunca un no-op»), así que no hace falta un `if`
          nuevo. Registrar una venta escribe en el ERP de la Escuela
          (`/api/venta`, superficie de `ventas`): ahí el botón existiría para
          contestar 403. */}
      <PieAccionTimeline estado={estado} onVender={conCerberus ? () => setVendiendo(true) : undefined} />
      {vendiendo && (
        <VentaDesdeElPanel conversacion={conversacion} onCerrar={() => setVendiendo(false)} />
      )}
    </div>
  );
}
