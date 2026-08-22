import { AlertTriangle, Image as Icono, Loader2, Pencil, Send, ServerCrash } from 'lucide-react';
import { ErrorApi } from '../../lib/datos/cliente';
import { sectionLabel } from '../../lib/styles';
import type { Conversacion } from '../../dominio/conversaciones';
import { useEnvioSecuencia } from '../plantillas/useEnvioSecuencia';
import { enviados, estaCorriendo, rotulo } from '../plantillas/secuencia';
import { ponerEnComposer } from '../whatsapp/puenteComposer';
import { useSugerencias, type Sugerencia } from './sugerencias';

/**
 * LAS DOS RESPUESTAS LISTAS — lo primero del panel derecho.
 *
 * «Dejame a la derecha preparado para yo con un clic mandarle al lead la
 * respuesta: 2 opciones» (dueño, 2026-07-25).
 *
 * No es un buscador de plantillas: es **la decisión ya tomada, con dos caminos**.
 * Cada tarjeta dice QUÉ hace («Pasar el precio»), POR QUÉ corresponde ahora («ya
 * vio el material y todavía no sabe cuánto cuesta») y MUESTRA el primer mensaje
 * con las variables resueltas. Dos gestos:
 *
 *   · **Mandar** — sale la secuencia entera, espaciada, con progreso y cancelable
 *     (las reglas de `useEnvioSecuencia`; todo por `EnvioControlado`).
 *   · **tocar el texto** — lo deja en el composer para editarlo antes de mandar.
 *     Poner texto en la caja no es enviar.
 *
 * Si no hay sugerencia clara, no se inventa una: se muestra la salida a las
 * secuencias completas. Un botón en el que no se puede confiar es peor que
 * ningún botón.
 */

function Tarjeta({
  s,
  primaria,
  conversacion,
  corriendoOtra,
  onMandar,
  onIrAPlantillas,
}: {
  s: Sugerencia;
  primaria: boolean;
  conversacion: Conversacion;
  corriendoOtra: boolean;
  onMandar: () => void;
  onIrAPlantillas?: () => void;
}) {
  const telefono = conversacion.persona_id;
  const hayHueco = s.vistaPrevia.faltantes.length > 0;

  return (
    <div
      className={
        'rounded-xl border p-2.5 transition-colors ' +
        (primaria ? 'border-primary/35 bg-secondary/40' : 'border-border bg-card')
      }
    >
      <div className="flex items-baseline gap-1.5">
        <span className="font-heading text-xs font-bold text-navy-ink">{s.rotulo}</span>
        <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">
          {s.totalPasos > 1 ? `${s.totalPasos} mensajes` : '1 mensaje'}
        </span>
        {s.conImagen && <Icono size={10} className="shrink-0 text-muted-foreground" />}
      </div>
      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{s.porque}</p>

      {/* El texto ES el botón de editar: tocarlo lo abre en el composer. */}
      <button
        type="button"
        onClick={() =>
          telefono &&
          ponerEnComposer({
            telefono,
            texto: s.vistaPrevia.texto,
            // La vista previa ES el paso 1 de la secuencia (#169). La MISMA
            // pieza que saldría con «Mandar»: lo que cambia es que acá la
            // vendedora la edita antes, y eso queda marcado, no escondido.
            pieza: {
              clase: 'plantilla',
              ref: `${s.plantillaId}#${s.pasos[0]?.orden ?? 1}`,
              via: 'panel-sugerencia',
            },
          })
        }
        title="Abrirlo en la caja para editarlo antes de mandar"
        // Nombre accesible explícito: sin esto el nombre del botón es su texto
        // entero (que incluye «…antes de mandar») y se vuelve indistinguible del
        // botón de Mandar para quien navega por voz o lector de pantalla.
        aria-label={`Editar en la caja: ${s.rotulo}`}
        className="group mt-1.5 block w-full rounded-lg bg-card/80 p-2 text-left transition-colors hover:bg-card"
      >
        <span className="line-clamp-3 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-foreground">
          {s.vistaPrevia.texto || '(solo archivo)'}
        </span>
        <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-primary opacity-0 transition-opacity group-hover:opacity-100">
          <Pencil size={9} /> Editar antes de mandar
        </span>
      </button>

      {hayHueco && (
        <p className="mt-1 flex items-start gap-1 text-[11px] text-destructive">
          <AlertTriangle size={10} className="mt-px shrink-0" />
          No se pudo traer {s.vistaPrevia.faltantes.join(' ni ')}: completalo a mano.
        </p>
      )}

      <div className="mt-1.5 flex items-center gap-1.5">
        <button
          type="button"
          disabled={corriendoOtra || !telefono}
          onClick={onMandar}
          className={
            'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition-[background-color,transform] duration-200 ease-house active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ' +
            (primaria
              ? 'bg-navy text-white shadow-[0_4px_14px_-6px_rgba(14,42,82,0.6)] hover:bg-navy-hover'
              : 'border border-border text-foreground hover:bg-muted')
          }
        >
          <Send size={11} /> Mandar
        </button>
        {onIrAPlantillas && (
          <button
            type="button"
            onClick={onIrAPlantillas}
            className="ml-auto text-[11px] font-semibold text-muted-foreground transition-colors hover:text-primary"
          >
            Ver secuencia
          </button>
        )}
      </div>
    </div>
  );
}

export function DosRespuestas({
  conversacion,
  onIrAPlantillas,
}: {
  conversacion: Conversacion;
  /** Opcional desde el rediseño del panel: si no hay a dónde ir, el atajo
   *  no se dibuja. Un botón que no lleva a ningún lado enseña a no confiar. */
  onIrAPlantillas?: () => void;
}) {
  const esWa = conversacion.canal === 'whatsapp';
  const { data, isPending, error } = useSugerencias(
    conversacion.clave,
    conversacion.persona_nombre,
    esWa,
  );
  const envio = useEnvioSecuencia(conversacion);
  const corriendo = estaCorriendo(envio.estado);

  if (!esWa) return null;

  if (isPending) {
    return (
      <div className="space-y-1.5">
        <div className="h-[86px] animate-pulse rounded-xl bg-muted" />
        <div className="h-[86px] animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  // FALLAR NO ES «NO HAY NADA QUE DECIR». Un 404 significa que este servidor
  // todavía no tiene la ruta desplegada; mostrarlo como «no hay respuesta clara»
  // haría que la vendedora deje de buscar el botón que sí existe. La misma regla
  // que la ficha: nunca un fallo disfrazado de dato vacío.
  if (error) {
    const status = error instanceof ErrorApi ? error.status : 0;
    return (
      <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-2.5 text-[11px] leading-relaxed text-warning-foreground">
        <ServerCrash size={13} className="mt-0.5 shrink-0" />
        <span>
          {status === 404
            ? 'Este servidor todavía no sirve respuestas sugeridas: falta desplegar.'
            : 'No se pudieron traer las respuestas sugeridas.'}{' '}
          {onIrAPlantillas && (
            <button
              type="button"
              onClick={onIrAPlantillas}
              className="font-bold text-primary hover:underline"
            >
              Ver tus secuencias
            </button>
          )}
        </span>
      </div>
    );
  }

  const sugerencias = data?.sugerencias ?? [];

  if (sugerencias.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-2.5">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {onIrAPlantillas
            ? 'Ninguna secuencia encaja con el momento de esta conversación, así que no se propone una a ciegas.'
            : 'Ninguna secuencia encaja con el momento de esta conversación — y todavía no hay ninguna cargada para elegir a mano.'}
        </p>
        {onIrAPlantillas && (
          <button
            type="button"
            onClick={onIrAPlantillas}
            className="mt-1 text-[11px] font-bold text-primary hover:underline"
          >
            Elegir de tus secuencias
          </button>
        )}
      </div>
    );
  }

  // Mientras una sale, las tarjetas dejan lugar al progreso: es lo único que
  // importa en ese momento, y el botón que hay es cancelar.
  if (envio.estado.fase !== 'lista') {
    const total = 'total' in envio.estado ? envio.estado.total : 0;
    return (
      <div className="rounded-xl border border-primary/35 bg-secondary/40 p-2.5">
        <div className="flex items-center gap-2">
          {corriendo && <Loader2 size={13} className="shrink-0 animate-spin text-primary" />}
          <span className="min-w-0 flex-1 text-[11px] font-bold text-navy-ink">{rotulo(envio.estado)}</span>
          {envio.estado.fase === 'enviando' ? (
            <button
              type="button"
              onClick={envio.cancelar}
              className="shrink-0 rounded-md border border-border bg-card px-2 py-0.5 text-[11px] font-semibold text-foreground transition-colors hover:bg-muted"
            >
              Cancelar
            </button>
          ) : !corriendo ? (
            <button
              type="button"
              onClick={envio.reiniciar}
              className="shrink-0 text-[11px] font-semibold text-primary hover:underline"
            >
              Listo
            </button>
          ) : null}
        </div>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-border">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300 ease-house"
            style={{ width: `${total ? (enviados(envio.estado) / total) * 100 : 0}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className={'mb-1.5 ' + sectionLabel}>Para responder ahora</div>
      <div className="flex flex-col gap-1.5">
        {sugerencias.map((s, i) => (
          <Tarjeta
            key={s.plantillaId}
            s={s}
            primaria={i === 0}
            conversacion={conversacion}
            corriendoOtra={corriendo}
            onIrAPlantillas={onIrAPlantillas}
            onMandar={() =>
              void envio.mandar(
                s.plantillaId,
                s.pasos.map((p) => ({ orden: p.orden, mediaPendiente: false })),
                // Salió de las dos respuestas del panel, no del buscador (#169).
                'panel-sugerencia',
              )
            }
          />
        ))}
      </div>
    </div>
  );
}
