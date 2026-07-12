import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertTriangle, Camera, MessageCircle, MessagesSquare } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { API_URL } from '../config';
import { useLocalStorage } from '../lib/useLocalStorage';
import type {
  CanalesResponse,
  EstadoCanal,
  Intencion,
  Interaccion,
  Rango,
  TipoFiltro,
} from '../features/canales/types';
import { useInteracciones, useInvalidarBandeja } from '../features/canales/useInteracciones';
import RangoPicker from '../features/canales/RangoPicker';
import FilaInteraccion from '../features/canales/FilaInteraccion';
import ResponderPanel from '../features/canales/ResponderPanel';
import Volver from '../layout/Volver';

interface Ficha {
  nombre: string;
  color: string;
  icono: LucideIcon;
  /** Qué se puede hacer aquí, de verdad. Nada de promesas. */
  puedes: string;
  /** Qué NO se puede, y por qué. Si falta algo, se dice. */
  bloqueado?: string;
}

const FICHAS: Record<string, Ficha> = {
  facebook: {
    nombre: 'Facebook',
    color: '#1877F2',
    icono: MessagesSquare,
    puedes:
      'Responder en público siempre. Y en privado solo si el comentario tiene menos de 7 días: pasado ese plazo Meta cierra la puerta y ya no hay forma.',
  },
  instagram: {
    nombre: 'Instagram',
    color: '#C13584',
    icono: Camera,
    puedes: 'Responder en público a los comentarios de las publicaciones.',
    bloqueado:
      'Los mensajes privados de Instagram necesitan que Meta apruebe la revisión de la app. Hasta entonces no se pueden leer ni responder desde aquí.',
  },
  whatsapp: {
    nombre: 'WhatsApp',
    color: '#25D366',
    icono: MessageCircle,
    puedes: 'Nada todavía.',
    bloqueado:
      'Sin conectar. Es el canal donde se cierra la venta, y hay una decisión pendiente: usar la API oficial de Meta (Cloud API), o conectar lo que ya está corriendo hoy en el CRM.',
  },
};

const TIPOS: { valor: TipoFiltro; label: string }[] = [
  { valor: '', label: 'Todo' },
  { valor: 'comentario', label: 'Comentarios' },
  { valor: 'mensaje', label: 'Mensajes' },
];

const INTENCIONES: { valor: Intencion; label: string }[] = [
  { valor: '', label: 'Todos' },
  { valor: 'pide-info', label: 'Piden información' },
  { valor: 'puedo-escribirle', label: 'Les puedo escribir hoy' },
];

/**
 * Un canal, a fondo.
 *
 * Existe porque los canales NO son intercambiables, y meterlos todos en una sola
 * cola escondía justamente eso: en Facebook puedes mandar un privado (durante 7
 * días); en Instagram no, y no por falta de ganas sino porque Meta no aprobó la
 * revisión; en WhatsApp no hay nada porque no está conectado.
 *
 * La bandeja del home sirve para trabajar rápido a quien se le vence el reloj.
 * Esta pantalla sirve para entender un canal: qué entra, de qué tipo, y qué se
 * puede hacer con eso.
 */
export default function CanalPage() {
  const { canal = '' } = useParams();
  const ficha = FICHAS[canal];

  const [rango, setRango] = useLocalStorage<Rango>('meta-escuela.rango', '90d');
  const [tipo, setTipo] = useState<TipoFiltro>('');
  const [intencion, setIntencion] = useState<Intencion>('');
  const [abierta, setAbierta] = useState<Interaccion | null>(null);
  const invalidarBandeja = useInvalidarBandeja();

  // `respondida` NO es un estado del cliente: es una derivación de `status`, que el servidor
  // ya persiste y la API ya devuelve. Antes esto era un `useState<number[]>([])` que se vaciaba
  // en cada recarga — respondías, apretabas F5, y el trabajo hecho se volvía invisible.
  const [estado, setEstado] = useState<EstadoCanal | null>(null);
  const [cargandoEstado, setCargandoEstado] = useState(true);

  useEffect(() => {
    setCargandoEstado(true);
    fetch(`${API_URL}/api/interactions/canales?rango=${rango}`)
      .then((r) => r.json())
      .then((d: CanalesResponse) => {
        setEstado(d.interacciones.find((c) => c.canal === canal) ?? null);
        setCargandoEstado(false);
      })
      .catch(() => {
        setEstado(null);
        setCargandoEstado(false);
      });
  }, [canal, rango]);

  const { items, total, hayMas, cargando, cargandoMas, cargarMas } = useInteracciones({
    canal,
    tipo,
    intencion,
    rango,
  });

  if (!ficha) {
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-5">
        <Volver a="/" texto="Volver al inicio" />
        <p className="text-sm text-muted-foreground">No conocemos ese canal.</p>
      </div>
    );
  }

  const Icono = ficha.icono;

  // Sin conexión no hay nada que filtrar. Mostrar los filtros y un "no hay nada
  // que coincida" echaría la culpa a los filtros, cuando la causa es otra: el
  // canal no está enchufado. Se dice eso y nada más.
  const sinConectar = !cargandoEstado && estado === null;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <Volver a="/" texto="Volver al inicio" />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <span
            className="flex size-11 shrink-0 items-center justify-center rounded-xl text-white"
            style={{ backgroundColor: ficha.color }}
          >
            <Icono size={20} />
          </span>
          <div>
            <h1 className="font-heading text-2xl font-bold text-navy">{ficha.nombre}</h1>
            <p className="text-sm text-muted-foreground">{ficha.puedes}</p>
          </div>
        </div>
        <RangoPicker valor={rango} onChange={setRango} />
      </div>

      {/* Si el canal tiene algo bloqueado, va arriba y con todas las letras.
          Una pantalla vacía sin explicación se lee como "no pasó nada", cuando
          lo que pasa es que no podemos ver nada. */}
      {ficha.bloqueado && (
        <div className="flex items-start gap-3 rounded-2xl border border-gold/40 bg-gold/10 px-5 py-4">
          <AlertTriangle size={17} className="mt-0.5 shrink-0 text-gold-ink" />
          <p className="text-sm text-foreground">{ficha.bloqueado}</p>
        </div>
      )}

      {!sinConectar && estado && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { n: estado.total, label: 'en total' },
            { n: estado.comentarios, label: 'comentarios' },
            { n: estado.mensajes, label: 'mensajes privados' },
            { n: estado.pide_info, label: 'piden información', destacar: true },
          ].map((c) => (
            <div key={c.label} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <p
                className={
                  'font-heading text-2xl font-extrabold tabular-nums ' +
                  (c.destacar ? 'text-gold-ink' : 'text-foreground')
                }
              >
                {c.n.toLocaleString('es')}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{c.label}</p>
            </div>
          ))}
        </div>
      )}

      {!sinConectar && (
        <>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Tipo
          </span>
          <div className="flex gap-1 rounded-xl border border-border bg-card p-1">
            {TIPOS.map((t) => (
              <button
                key={t.valor}
                type="button"
                onClick={() => setTipo(t.valor)}
                className={
                  'rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ' +
                  (tipo === t.valor
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted')
                }
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Intención
          </span>
          <div className="flex gap-1 rounded-xl border border-border bg-card p-1">
            {INTENCIONES.map((f) => (
              <button
                key={f.valor}
                type="button"
                onClick={() => setIntencion(f.valor)}
                className={
                  'rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ' +
                  (intencion === f.valor
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted')
                }
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {!cargando && (
          <span className="ml-auto text-xs font-semibold tabular-nums text-muted-foreground">
            {total.toLocaleString('es')} {total === 1 ? 'resultado' : 'resultados'}
          </span>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        {cargando ? (
          <p className="px-5 py-12 text-center text-sm text-muted-foreground">Cargando...</p>
        ) : items.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-muted-foreground">
            No hay nada que coincida con estos filtros.
          </p>
        ) : (
          items.map((i) => (
            <FilaInteraccion
              key={i.id}
              i={i}
              respondida={i.status !== 'nuevo'}
              onAbrir={setAbierta}
              mostrarCanal={false}
            />
          ))
        )}
      </div>

      {hayMas && (
        <button
          type="button"
          onClick={cargarMas}
          disabled={cargandoMas}
          className="mx-auto rounded-xl border border-border bg-card px-5 py-2 text-xs font-bold text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-50"
        >
          {cargandoMas ? 'Cargando...' : 'Ver más'}
        </button>
      )}
        </>
      )}

      <ResponderPanel
        interaccion={abierta}
        onCerrar={() => setAbierta(null)}
        onRespondido={invalidarBandeja}
      />
    </div>
  );
}
