import { useState } from 'react';
import { Building2, Check, Loader2, Mail, Phone, UserPlus, X } from 'lucide-react';
import { avisar } from '../../lib/avisos';
import { useEscape } from '../../lib/teclado/useEscape';
import type { Conversacion } from '../../dominio/conversaciones';
import { personaEsTelefono } from '../../dominio/canal';
import { useFicha } from '../cerberus/useFicha';
import type { Ficha } from '../cerberus/ficha';
import { useLeadForm } from '../cerberus/BloqueLeadForm';
import { Intereses } from '../gestion/Intereses';
import { boton } from '../../lib/styles';
import {
  faltaLoMinimo,
  prellenar,
  useFichaLocal,
  useGuardarFicha,
  type DatosFicha,
  type FichaLocal,
  type Prioridad,
} from './fichaLocal';

/**
 * EL REGISTRO RÁPIDO — la ficha del contacto SIN salir del chat.
 *
 * La meta es de segundos, no de campos: el drawer abre con todo lo que la
 * conversación ya sabe puesto (nombre, apellido, empresa y teléfono salen del
 * alias de WhatsApp; el correo, de Cerberus o del formulario), así que en el
 * caso normal la vendedora sólo mira y guarda.
 *
 * Lo que NO se duplica acá: el INTERÉS se compone del mismo componente de la
 * barra (`gestion/Intereses`) porque `intereses` es la única fuente de verdad de
 * «qué curso quiere» (#37), y el ASESOR no se toca —eso es del reparto, que
 * tiene su propio rastro de quién decidió qué (`PasarConversacion`).
 */

/** El estrechamiento de la unión, con nombre: `Ficha` sólo trae datos si es cliente. */
function fichaDeCliente(f: Ficha | undefined): Extract<Ficha, { estado: 'cliente' }> | null {
  return f?.estado === 'cliente' ? f : null;
}

const PRIORIDADES: { id: Prioridad; rotulo: string; punto: string }[] = [
  { id: 'normal', rotulo: 'Normal', punto: 'bg-muted-foreground/40' },
  { id: 'media', rotulo: 'Media', punto: 'bg-warning' },
  { id: 'alta', rotulo: 'Alta', punto: 'bg-destructive' },
];

function Campo({
  icono,
  children,
}: {
  icono?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-center gap-2.5 px-4 py-2">
      <span className="w-4 shrink-0 text-muted-foreground">{icono}</span>
      {children}
    </label>
  );
}

const CLASE_INPUT =
  'min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-sm outline-none transition-colors hover:border-border focus:border-primary focus:bg-muted/30';

export function FichaRapida({
  conversacion,
  onCerrar,
  onAbrirOtra,
}: {
  conversacion: Conversacion;
  onCerrar: () => void;
  /**
   * Ir al chat del contacto que YA estaba registrado. Lo resuelve el shell —
   * abrir una conversación es suyo— y **puede no existir**: sin WhatsApp
   * conectado no hay chat que abrir, y ahí el botón no se dibuja en vez de
   * prometer algo que no va a pasar.
   */
  onAbrirOtra?: (o: { clave: string; telefono: string | null }) => void;
}) {
  useEscape(onCerrar);

  const tieneTelefono = personaEsTelefono(conversacion.canal, conversacion.persona_id);
  const ficha = useFichaLocal(conversacion.clave);
  const cerberus = useFicha(conversacion.persona_id, tieneTelefono);
  const lead = useLeadForm(conversacion.persona_id, tieneTelefono);
  const guardar = useGuardarFicha(conversacion.clave);

  const cliente = fichaDeCliente(cerberus.data);
  const inicial = prellenar({
    ficha: ficha.data,
    nombreCerberus: cliente?.nombre,
    correoCerberus: cliente?.correo,
    nombreLead: lead.data?.lead?.nombre,
    correoLead: lead.data?.lead?.email,
    aliasChat: conversacion.persona_nombre,
    telefono: conversacion.persona_id,
  });

  /**
   * El formulario arranca del prellenado y desde ahí es de quien escribe: si el
   * estado se recalculara con cada respuesta que llega (la ficha de Cerberus
   * tarda hasta 12 s), una tecleada podría quedar pisada a mitad de palabra.
   * Por eso `useState` con inicializador y no un `useEffect` que sincroniza.
   */
  const [datos, setDatos] = useState<DatosFicha>(inicial);
  const [duplicada, setDuplicada] = useState<FichaLocal | null>(null);

  const cambiar = (campo: keyof DatosFicha) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDatos((d) => ({ ...d, [campo]: e.target.value }));

  async function enviar(forzar = false) {
    const r = await guardar.mutateAsync({ ...datos, forzar });
    if (r.ok) {
      avisar(ficha.data ? 'Ficha actualizada' : 'Contacto registrado');
      onCerrar();
      return;
    }
    setDuplicada(r.duplicada);
  }

  const yaRegistrado = ficha.data != null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-navy/20" onClick={onCerrar} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={yaRegistrado ? 'Ficha del contacto' : 'Registrar contacto'}
        // Ancho de la ficha (22,5rem) + aire: el drawer se para sobre el panel
        // derecho y deja la conversación entera a la vista, que es la regla —
        // ninguna de estas acciones saca a la vendedora del chat.
        className="fixed inset-y-0 right-0 z-50 flex w-[25rem] max-w-full animate-entrar flex-col bg-card shadow-panel"
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
          <UserPlus size={16} className="text-primary" />
          <h2 className="min-w-0 flex-1 truncate text-sm font-bold text-foreground">
            {yaRegistrado ? 'Ficha del contacto' : 'Registrar contacto'}
          </h2>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onCerrar}
            className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X size={16} />
          </button>
        </header>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void enviar();
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
            <div className="grid grid-cols-2 gap-x-1 px-0 py-1">
              <Campo>
                <input
                  value={datos.nombre}
                  onChange={cambiar('nombre')}
                  autoFocus
                  placeholder="Nombre"
                  aria-label="Nombre"
                  className={CLASE_INPUT}
                />
              </Campo>
              <Campo>
                <input
                  value={datos.apellido}
                  onChange={cambiar('apellido')}
                  placeholder="Apellido"
                  aria-label="Apellido"
                  className={CLASE_INPUT}
                />
              </Campo>
            </div>

            <Campo icono={<Phone size={15} />}>
              <input
                value={datos.telefono}
                onChange={cambiar('telefono')}
                inputMode="tel"
                placeholder="Teléfono"
                aria-label="Teléfono"
                className={CLASE_INPUT + ' font-mono text-xs'}
              />
            </Campo>

            <Campo icono={<Building2 size={15} />}>
              <input
                value={datos.empresa}
                onChange={cambiar('empresa')}
                placeholder="Empresa (opcional)"
                aria-label="Empresa"
                className={CLASE_INPUT}
              />
            </Campo>

            <Campo icono={<Mail size={15} />}>
              <input
                value={datos.email}
                onChange={cambiar('email')}
                type="email"
                placeholder="Email (opcional)"
                aria-label="Email"
                className={CLASE_INPUT}
              />
            </Campo>

            <section className="px-4 py-3">
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Prioridad
              </h3>
              <div className="flex gap-1.5">
                {PRIORIDADES.map((p) => {
                  const activa = datos.prioridad === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={activa}
                      onClick={() => setDatos((d) => ({ ...d, prioridad: activa ? null : p.id }))}
                      className={
                        'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ' +
                        (activa
                          ? 'border-navy bg-navy text-white'
                          : 'border-border text-muted-foreground hover:border-primary hover:text-foreground')
                      }
                    >
                      <span className={'size-1.5 rounded-full ' + p.punto} />
                      {p.rotulo}
                    </button>
                  );
                })}
              </div>
            </section>

            {/* El interés NO se reimplementa: es el mismo componente de la barra
                y de la cola, contra la misma tabla. Con dos, la ficha y el chat
                dirían dos cosas sobre qué quiere la misma persona (#37). */}
            <section className="px-4 py-3">
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Qué le interesa
              </h3>
              <Intereses clave={conversacion.clave} compacto />
            </section>
          </div>

          {duplicada && (
            <div className="shrink-0 border-t border-border bg-warning/10 px-4 py-2.5 text-[11px]">
              <p className="font-semibold text-warning-foreground">Este contacto ya está registrado</p>
              <p className="mt-0.5 text-muted-foreground">
                {[duplicada.nombre, duplicada.apellido].filter(Boolean).join(' ') || duplicada.telefono} — en otra
                conversación.
              </p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {onAbrirOtra && (
                  <button
                    type="button"
                    onClick={() => {
                      onAbrirOtra({ clave: duplicada.clave, telefono: duplicada.telefono });
                      onCerrar();
                    }}
                    className="rounded-full border border-border bg-card px-2.5 py-1 font-semibold text-foreground transition-colors hover:border-primary"
                  >
                    Abrir contacto
                  </button>
                )}
                <button
                  type="button"
                  disabled={guardar.isPending}
                  onClick={() => void enviar(true)}
                  className="rounded-full border border-border bg-card px-2.5 py-1 font-semibold text-foreground transition-colors hover:border-primary disabled:opacity-50"
                >
                  Registrar igual acá
                </button>
              </div>
            </div>
          )}

          {guardar.isError && (
            <p className="shrink-0 border-t border-border px-4 py-2 text-[11px] text-destructive">
              No se guardó — probá de nuevo.
            </p>
          )}

          <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-4 py-3">
            <span className="text-[11px] text-muted-foreground">
              {yaRegistrado ? `Registrado por ${ficha.data?.vendedoraId}` : 'Nada se envía: sólo se guarda.'}
            </span>
            <button
              type="submit"
              disabled={guardar.isPending || faltaLoMinimo(datos)}
              className={boton()}
            >
              {guardar.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              {yaRegistrado ? 'Guardar cambios' : 'Registrar contacto'}
            </button>
          </footer>
        </form>
      </aside>
    </>
  );
}
