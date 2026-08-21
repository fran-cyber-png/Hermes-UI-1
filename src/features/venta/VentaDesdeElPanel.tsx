import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, ShoppingCart, UserPlus, X } from 'lucide-react';
import { useEscape } from '../../lib/teclado/useEscape';
import { boton, fieldClass, sectionLabel } from '../../lib/styles';
import { ErrorApi } from '../../lib/datos/cliente';
import { useFicha } from '../cerberus/useFicha';
import { FormularioVenta } from './FormularioVenta';
import { useCrearCliente, usePaisesCliente, type ProductoElegido } from './useVenta';
import type { Conversacion } from '../../dominio/conversaciones';

/**
 * REGISTRAR LA VENTA DESDE EL PANEL DERECHO — el destino del botón que estaba
 * clavado al pie y **nunca aparecía**.
 *
 * ── El defecto que esto cierra ──
 * `PieAccionTimeline` exige un handler para dibujar el botón —«sin handler no
 * hay botón, nunca un no-op»—, y `PanelDerecho` lo montaba sin pasarle ninguno.
 * O sea que la guarda hacía exactamente lo que promete y el botón **no podía
 * existir en ningún estado**, ni siquiera para un cliente. Nadie llegó a
 * cablearlo cuando el rediseño del timeline reemplazó a `AccionesContacto`.
 *
 * ── Por qué existe este componente y no se reusa `ModalVentaCierre` ──
 * Aquél es del Pipeline, y su salida para un lead que todavía no es cliente en
 * Cerberus dice **«abrí la conversación»** — que desde el panel derecho es un
 * consejo circular: la conversación ya está abierta, es la de al lado. Un modal
 * que manda a donde ya estás es un callejón sin salida con forma de ayuda.
 *
 * ── La regla del botón: SIEMPRE está ──
 * Decisión del dueño (4-ago-2026): *«que siempre esté ahí el botón para
 * comprar»*. No se condiciona al estado de la ficha, porque el estado de la
 * ficha es justo lo que la vendedora no puede adivinar antes de necesitarlo —
 * y una venta puede caer en cualquier conversación. Lo que cambia según el
 * estado es a dónde lleva, no si está.
 */

function Modal({
  titulo,
  onCerrar,
  children,
  ancho = 'max-w-md',
}: {
  titulo: string;
  onCerrar: () => void;
  children: React.ReactNode;
  /** El alta de cliente necesita más aire que el aviso simple — nunca el mismo ancho para todo. */
  ancho?: string;
}) {
  useEscape(onCerrar);
  return (
    <>
      <div className="fixed inset-0 z-40 bg-navy/30 backdrop-blur-[2px]" onClick={onCerrar} aria-hidden="true" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={titulo}
          className={`flex max-h-[90vh] w-full ${ancho} flex-col overflow-hidden rounded-2xl bg-card shadow-panel`}
        >
          <header className="flex shrink-0 items-center justify-between border-b border-border bg-navy px-5 py-3 text-white">
            <div className="flex items-center gap-2 font-heading text-sm font-bold">
              <ShoppingCart size={16} /> {titulo}
            </div>
            <button type="button" aria-label="Cerrar" onClick={onCerrar} className="rounded-lg p-1 hover:bg-white/10">
              <X size={16} />
            </button>
          </header>
          {children}
        </div>
      </div>
    </>
  );
}

/**
 * DAR DE ALTA AL CLIENTE, SIN SALIR DE HERMES — el reemplazo del texto que
 * mandaba a la vendedora a Cerberus y de vuelta.
 *
 * Nombre + Apellido + País son los tres campos que `ClienteForm` exige de
 * verdad (correo, DNI, dirección quedan vacíos — Cerberus los acepta así); el
 * teléfono es fijo, es el de esta conversación y es lo único que Hermes sabe
 * con certeza. Al crear, invalida la ficha (`useCrearCliente`) y el panel
 * pasa SOLO al formulario de venta — no hay un paso intermedio que cerrar.
 */
function CampoAlta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className={sectionLabel}>{label}</span>
      {children}
    </label>
  );
}

function AltaCliente({ telefono, nombreSugerido }: { telefono: string; nombreSugerido: string | null }) {
  const [nombre, setNombre] = useState(nombreSugerido ?? '');
  const [apellido, setApellido] = useState('');
  const [paisId, setPaisId] = useState('');
  const [fechaNacimiento, setFechaNacimiento] = useState('');
  const [dni, setDni] = useState('');
  const [tratamiento, setTratamiento] = useState('');
  const [ocupacion, setOcupacion] = useState('');
  const [telefonoTipo, setTelefonoTipo] = useState('Personal');
  const [telefonoPrefijo, setTelefonoPrefijo] = useState('');
  const [telefonoNumero, setTelefonoNumero] = useState('');
  const [correoActivo, setCorreoActivo] = useState(false);
  const [correoTipo, setCorreoTipo] = useState('personal');
  const [correoValor, setCorreoValor] = useState('');

  // Para no pisar lo que la vendedora ya tocó cuando la sugerencia llega después.
  const paisTocado = useRef(false);
  const telefonoTocado = useRef(false);

  const { data: form, isPending: cargandoForm, isError: formError, error: formErrorObj } = usePaisesCliente(telefono, true);
  const crear = useCrearCliente();

  useEffect(() => {
    if (!form) return;
    if (form.paisIdSugerido && !paisTocado.current) {
      setPaisId((v) => v || form.paisIdSugerido!);
    }
    if (!telefonoTocado.current) {
      if (form.telefonoSugerido) {
        // `prefijo: null` es un +1 ambiguo (EE. UU./Canadá/Rep. Dominicana):
        // el número sí se precarga, el prefijo se deja para que la vendedora
        // elija — preseleccionar cualquiera de los tres sería afirmar algo
        // que Hermes no sabe.
        if (form.telefonoSugerido.prefijo) {
          setTelefonoPrefijo((v) => v || form.telefonoSugerido!.prefijo!);
        }
        setTelefonoNumero((v) => v || form.telefonoSugerido!.numero);
      } else {
        // No se pudo adivinar el prefijo (número raro, o fuera de la lista de
        // Cerberus): al menos el número queda precargado para que la
        // vendedora complete el prefijo a mano en vez de tipear todo de cero.
        setTelefonoNumero((v) => v || telefono.replace(/\D/g, ''));
      }
    }
  }, [form, telefono]);

  const puedeCrear =
    Boolean(nombre.trim() && apellido.trim() && paisId && telefonoTipo && telefonoPrefijo && telefonoNumero) &&
    !crear.isPending;

  function crearAhora() {
    crear.mutate({
      nombre: nombre.trim(),
      apellido: apellido.trim(),
      paisId,
      fechaNacimiento: fechaNacimiento || undefined,
      dni: dni.trim() || undefined,
      tratamiento: tratamiento.trim() || undefined,
      ocupacion: ocupacion.trim() || undefined,
      telefonoTipo,
      telefonoPrefijo,
      telefonoNumero,
      correo: correoActivo && correoValor.trim() ? { tipo: correoTipo, valor: correoValor.trim() } : undefined,
    });
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-3">
      <p className="flex items-center gap-1.5 text-xs font-bold text-foreground">
        <UserPlus size={13} /> Crear cliente en Cerberus
      </p>

      {/* Antes esto fallaba MUDO: sin `isError`, un 409 (sesión de Cerberus
          vencida) dejaba el país y el teléfono vacíos sin decir por qué, y se
          leía como «no funciona» en vez de «hay que volver a entrar». */}
      {formError && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-xs text-warning-foreground">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          {formErrorObj instanceof ErrorApi
            ? formErrorObj.message
            : 'No se pudo cargar el formulario de Cerberus. Probá salir de Hermes y volver a entrar.'}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <CampoAlta label="Nombre">
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} className={fieldClass} autoFocus />
        </CampoAlta>
        <CampoAlta label="Apellido">
          <input value={apellido} onChange={(e) => setApellido(e.target.value)} className={fieldClass} />
        </CampoAlta>
      </div>

      <CampoAlta label="País">
        <select
          value={paisId}
          onChange={(e) => {
            paisTocado.current = true;
            setPaisId(e.target.value);
          }}
          disabled={cargandoForm}
          className={fieldClass}
        >
          <option value="">{cargandoForm ? 'Cargando…' : 'Elegí un país'}</option>
          {form?.paises.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </select>
        {/* Adivinado por el prefijo del teléfono — nunca un hecho, siempre editable. */}
        {form?.paisIdSugerido && paisId === form.paisIdSugerido && (
          <span className="text-[11px] text-muted-foreground">
            adivinado por el prefijo — cambialo si hace falta
          </span>
        )}
      </CampoAlta>

      <div className="grid grid-cols-2 gap-2">
        <CampoAlta label="Fecha de nacimiento (opcional)">
          <input
            type="date"
            value={fechaNacimiento}
            onChange={(e) => setFechaNacimiento(e.target.value)}
            className={fieldClass}
          />
        </CampoAlta>
        <CampoAlta label="DNI (opcional)">
          <input value={dni} onChange={(e) => setDni(e.target.value)} className={fieldClass} />
        </CampoAlta>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <CampoAlta label="Tratamiento (opcional)">
          <input value={tratamiento} onChange={(e) => setTratamiento(e.target.value)} className={fieldClass} />
        </CampoAlta>
        <CampoAlta label="Ocupación (opcional)">
          <input value={ocupacion} onChange={(e) => setOcupacion(e.target.value)} className={fieldClass} />
        </CampoAlta>
      </div>

      {/* El teléfono viene de esta conversación, pero tipo/prefijo/número son
          una elección de Cerberus (no algo que se adivine a ciegas): los tres
          quedan editables, precargados con lo que Hermes pudo inferir. */}
      <div className="space-y-2">
        <span className={sectionLabel}>Teléfono</span>
        <div className="grid grid-cols-2 gap-2">
          <CampoAlta label="Tipo">
            <select
              value={telefonoTipo}
              onChange={(e) => {
                telefonoTocado.current = true;
                setTelefonoTipo(e.target.value);
              }}
              className={fieldClass}
            >
              {(form?.tiposTelefono ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre}
                </option>
              ))}
            </select>
          </CampoAlta>
          <CampoAlta label="Prefijo">
            <select
              value={telefonoPrefijo}
              onChange={(e) => {
                telefonoTocado.current = true;
                setTelefonoPrefijo(e.target.value);
              }}
              disabled={cargandoForm}
              className={fieldClass}
            >
              <option value="">{cargandoForm ? 'Cargando…' : 'Elegí un prefijo'}</option>
              {/* Hay prefijos con el MISMO valor (+1 es Canadá, EE. UU. y Rep.
                  Dominicana): la key lleva el índice porque el value repetido es
                  intencional — Cerberus los distingue por label, no por value. */}
              {(form?.prefijosTelefono ?? []).map((p, i) => (
                <option key={`${p.id}-${i}`} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </CampoAlta>
        </div>
        <CampoAlta label="Número">
          <input
            value={telefonoNumero}
            onChange={(e) => {
              telefonoTocado.current = true;
              setTelefonoNumero(e.target.value.replace(/\D/g, ''));
            }}
            placeholder="Número"
            className={fieldClass}
          />
        </CampoAlta>
        {form?.telefonoSugerido && !form.telefonoSugerido.prefijo && !telefonoPrefijo ? (
          // El +1 es de tres países reales (EE. UU., Canadá, Rep. Dominicana):
          // sin código de área no hay forma de saber cuál, así que acá no se
          // adivina nada — a diferencia de arriba, esto no es un error de
          // carga, es la vendedora la que tiene que decidir.
          <span className="text-[11px] text-muted-foreground">
            el +1 es de varios países (EE. UU., Canadá, Rep. Dominicana) — elegí cuál es
          </span>
        ) : (
          form?.telefonoSugerido &&
          form.telefonoSugerido.prefijo &&
          telefonoPrefijo === form.telefonoSugerido.prefijo &&
          telefonoNumero === form.telefonoSugerido.numero && (
            <span className="text-[11px] text-muted-foreground">
              adivinado del número de esta conversación — cambialo si hace falta
            </span>
          )
        )}
      </div>

      {correoActivo ? (
        <div className="grid grid-cols-2 gap-2">
          <CampoAlta label="Tipo de correo">
            <select value={correoTipo} onChange={(e) => setCorreoTipo(e.target.value)} className={fieldClass}>
              {(form?.tiposCorreo ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre}
                </option>
              ))}
            </select>
          </CampoAlta>
          <CampoAlta label="Correo">
            <input
              type="email"
              value={correoValor}
              onChange={(e) => setCorreoValor(e.target.value)}
              className={fieldClass}
            />
          </CampoAlta>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCorreoActivo(true)}
          className="text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          + Agregar correo (opcional)
        </button>
      )}

      {crear.isError && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          {crear.error instanceof ErrorApi ? crear.error.message : 'No se pudo crear el cliente.'}
        </div>
      )}
      <button
        type="button"
        onClick={crearAhora}
        disabled={!puedeCrear}
        className={boton() + ' w-full'}
      >
        {crear.isPending ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />}
        Crear cliente en Cerberus
      </button>
    </div>
  );
}

export function VentaDesdeElPanel({
  conversacion,
  onCerrar,
  carritoInicial,
}: {
  conversacion: Conversacion;
  onCerrar: () => void;
  /** Lo que ya eligió en el «Carrito» de la ficha (`CarritoDeseado`), si eligió algo. */
  carritoInicial?: ProductoElegido[];
}) {
  const telefono = conversacion.persona_id ?? '';
  // La MISMA query que ya tiene el panel (misma `queryKey`): react-query la
  // comparte, así que abrir esto no dispara una segunda llamada a Cerberus —
  // que es la que tiene el techo de 12 s.
  const { data, isPending, isError } = useFicha(telefono, Boolean(telefono));

  // Es cliente: el formulario de venta de siempre, con el precio de Cerberus y
  // la conversación precargada (la venta mueve el embudo sola, server-side).
  if (data?.estado === 'cliente') {
    return (
      <FormularioVenta
        clienteId={data.id}
        clienteNombre={data.nombre}
        telefono={telefono}
        canal={conversacion.canal}
        clave={conversacion.clave}
        personaNombre={conversacion.persona_nombre}
        numeroPropio={conversacion.numero_propio}
        paisNombre={data.pais}
        onCerrar={onCerrar}
        lineasIniciales={carritoInicial}
      />
    );
  }

  return (
    <Modal titulo="Registrar venta" onCerrar={onCerrar} ancho={telefono ? 'max-w-xl' : 'max-w-md'}>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
        {isPending ? (
          <>
            <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-9 animate-pulse rounded-lg bg-muted" />
            <p className="text-xs text-muted-foreground">Buscando la ficha en Cerberus…</p>
          </>
        ) : isError || data?.estado === 'error' ? (
          /* «No se pudo preguntar» NO es «no es cliente»: son cosas opuestas y
             la vendedora actúa distinto en cada una. Nunca se colapsan. */
          <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs text-warning-foreground">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>
              Cerberus no respondió, así que no se puede registrar la venta ahora. No es que no sea
              cliente: es que la ficha no cargó. Probá de nuevo en un rato.
            </span>
          </div>
        ) : !telefono ? (
          <p className="text-sm text-foreground">
            Esta conversación no trae teléfono, y la ficha de Cerberus se busca por teléfono. La venta
            hay que registrarla desde Cerberus.
          </p>
        ) : (
          <>
            <p className="flex items-start gap-2 text-sm text-foreground">
              <UserPlus size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
              <span>
                <b>{conversacion.persona_nombre ?? telefono}</b> todavía no está como cliente en
                Cerberus, y la venta necesita el cliente creado.
              </span>
            </p>
            <AltaCliente telefono={telefono} nombreSugerido={conversacion.persona_nombre ?? null} />
          </>
        )}
      </div>
      <footer className="flex shrink-0 justify-end border-t border-border p-4">
        <button
          type="button"
          onClick={onCerrar}
          className={boton('secundario')}
        >
          Cerrar
        </button>
      </footer>
    </Modal>
  );
}
