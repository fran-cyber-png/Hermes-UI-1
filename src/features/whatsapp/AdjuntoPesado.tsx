import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Play, X } from 'lucide-react';
import { pesoLegible } from './pegarAdjunto';
import { leerMetadatosVideo } from './metadatosVideo';
import { duracionAproximada, planDeCompresion, type Plan } from './planDeCompresion';
import { boton } from '../../lib/styles';

/**
 * UN VIDEO QUE NO ENTRA — y qué se puede hacer al respecto.
 *
 * ── Por qué esto no es un cartel de error ────────────────────────────────
 * Antes, un video de 17,9 MB por la línea del bot terminaba en «El video pesa
 * 17,9 MB y por esta línea entran hasta 16 MB» y ahí moría: la vendedora tenía
 * que irse a otra app, comprimirlo, volver y adjuntarlo de nuevo. El dato que
 * da vuelta esa decisión se midió sobre el video real: **le sobraba un 11 %**,
 * y ya venía en H.264 + AAC. O sea que la app tenía todo para resolverlo y
 * mandaba a la persona a resolverlo afuera.
 *
 * ── Y por qué el resultado SE MIRA antes de mandarlo ─────────────────────
 * Comprimir es destructivo y lo que sale va a un lead. Un flyer con el precio
 * ilegible es peor que un video que no se mandó: el segundo se nota, el primero
 * no. Por eso el paso de vista previa no es un lujo — es la única forma de que
 * la persona que se hace responsable del mensaje vea lo que está mandando.
 * Es la misma regla del composer: pegar no envía, comprimir tampoco.
 */

export type EstadoAdjuntoPesado =
  | { fase: 'analizando' }
  | { fase: 'no_se_puede'; motivo: string }
  | { fase: 'ofrecer'; plan: Extract<Plan, { tipo: 'comprimir' }> }
  | { fase: 'comprimiendo'; progreso: number }
  | { fase: 'listo'; comprimido: File }
  | { fase: 'fallo'; motivo: string };

/** La vista previa del resultado: se mira, se escucha, y recién ahí se usa. */
function VistaPreviaComprimido({
  archivo,
  original,
  onUsar,
  onDescartar,
}: {
  archivo: File;
  original: File;
  onUsar: () => void;
  onDescartar: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(archivo);
    setUrl(u);
    return () => {
      URL.revokeObjectURL(u);
      setUrl(null);
    };
  }, [archivo]);

  const ahorro = Math.round((1 - archivo.size / original.size) * 100);

  return (
    <div className="mb-2 rounded-xl border border-success/30 bg-success/[0.06] p-2.5">
      <p className="mb-2 text-[11px] font-semibold text-foreground">
        Quedó en <b>{pesoLegible(archivo.size)}</b>{' '}
        <span className="font-normal text-muted-foreground">
          (era {pesoLegible(original.size)} · −{ahorro}%). Miralo antes de mandarlo.
        </span>
      </p>
      {url && (
        <video
          src={url}
          controls
          playsInline
          className="mb-2 max-h-56 w-full rounded-lg bg-black object-contain"
        />
      )}
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={onDescartar}
          className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          Descartar
        </button>
        <button
          type="button"
          onClick={onUsar}
          className={boton()}
        >
          Usar este
        </button>
      </div>
    </div>
  );
}

/**
 * El bloque completo, desde «no entra» hasta «usá este».
 *
 * Recibe el archivo y el tope y se encarga del resto. El composer no sabe nada
 * de bitrates ni de wasm: le llega un `File` que entra, o nada.
 */
export function AdjuntoPesado({
  archivo,
  topeBytes,
  motivo,
  onListo,
  onCerrar,
}: {
  archivo: File;
  topeBytes: number;
  /** El «pesa X, entran Y» que ya calculó el composer. */
  motivo: string;
  /** El video comprimido, listo para el composer. */
  onListo: (comprimido: File) => void;
  onCerrar: () => void;
}) {
  const [estado, setEstado] = useState<EstadoAdjuntoPesado>({ fase: 'analizando' });
  const abortRef = useRef<AbortController | null>(null);

  // Analizar es barato y NO baja el motor: la duración sale del `<video>`. Un
  // video de media hora se descarta al instante, sin 32 MB de por medio.
  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const meta = await leerMetadatosVideo(archivo);
        if (!vivo) return;
        const plan = planDeCompresion({ bytes: archivo.size, ...meta }, topeBytes);
        if (plan.tipo === 'comprimir') setEstado({ fase: 'ofrecer', plan });
        else if (plan.tipo === 'imposible') setEstado({ fase: 'no_se_puede', motivo: plan.motivo });
        else setEstado({ fase: 'no_se_puede', motivo: 'Este video ya entra: no hay nada que comprimir.' });
      } catch {
        // Este catch cubre UNA sola cosa —el `<video>` no pudo abrir el
        // archivo— porque `leerMetadatosVideo` ya no arrastra el motor. Cuando
        // sí lo arrastraba, un fallo al resolver el wasm salía por acá y decía
        // «no se pudo leer el video»: un mensaje sobre el archivo de la
        // vendedora por un problema de nuestro empaquetado.
        if (vivo) setEstado({ fase: 'no_se_puede', motivo: 'No se pudo leer el video: puede estar dañado.' });
      }
    })();
    return () => {
      vivo = false;
    };
  }, [archivo, topeBytes]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function comprimir(plan: Extract<Plan, { tipo: 'comprimir' }>) {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setEstado({ fase: 'comprimiendo', progreso: 0 });
    try {
      const { comprimirVideo } = await import('./comprimirVideo');
      const salida = await comprimirVideo(archivo, plan, {
        alProgresar: (f) => setEstado({ fase: 'comprimiendo', progreso: f }),
        senal: ctrl.signal,
      });
      // El encoder no clava el bitrate: si aun así no entra, se dice — mandarlo
      // sería repetir el rebote de Meta después de un minuto de espera.
      if (salida.size > topeBytes) {
        setEstado({
          fase: 'fallo',
          motivo: `Quedó en ${pesoLegible(salida.size)} y sigue sin entrar. Recortalo y probá de nuevo.`,
        });
        return;
      }
      setEstado({ fase: 'listo', comprimido: salida });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        onCerrar();
        return;
      }
      // Acá el fallo es del MOTOR (bajar 32 MB, instanciar el wasm, encodear),
      // no del archivo. Decirlo distinto importa: «no se pudo leer el video»
      // manda a la vendedora a revisar un archivo que está bien.
      console.error('[comprimir] falló el motor de compresión', e);
      setEstado({ fase: 'fallo', motivo: 'No se pudo achicar el video acá. Probá mandarlo más corto.' });
    } finally {
      abortRef.current = null;
    }
  }

  if (estado.fase === 'listo') {
    return (
      <VistaPreviaComprimido
        archivo={estado.comprimido}
        original={archivo}
        onUsar={() => onListo(estado.comprimido)}
        onDescartar={onCerrar}
      />
    );
  }

  return (
    <div className="mb-2 rounded-lg border border-warning/30 bg-warning/10 p-2 text-xs text-warning-foreground">
      <div className="flex items-start gap-1.5">
        <AlertTriangle size={13} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p>{estado.fase === 'no_se_puede' || estado.fase === 'fallo' ? estado.motivo : motivo}</p>

          {estado.fase === 'analizando' && (
            <p className="mt-1 text-muted-foreground">Viendo si se puede achicar…</p>
          )}

          {estado.fase === 'ofrecer' && (
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void comprimir(estado.plan)}
                className={boton()}
              >
                <Play size={12} /> Achicarlo acá
              </button>
              <span className="text-[11px] text-muted-foreground">
                Queda en ~{pesoLegible(estado.plan.bytesEstimados)}
                {estado.plan.bajaResolucion
                  ? ` · baja a ${estado.plan.ladoCorto}p`
                  : ' · sin perder resolución'}
                . Tarda {duracionAproximada(estado.plan.segundosEstimados)} y después lo ves.
              </span>
            </div>
          )}

          {estado.fase === 'comprimiendo' && (
            <div className="mt-1.5">
              <div className="flex items-center gap-2">
                <Loader2 size={13} className="shrink-0 animate-spin" />
                <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-warning/20">
                  <div
                    className="h-full rounded-full bg-navy transition-[width] duration-300 ease-house"
                    style={{ width: `${Math.round(estado.progreso * 100)}%` }}
                  />
                </div>
                <span className="shrink-0 font-mono text-[11px] tabular-nums">
                  {Math.round(estado.progreso * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => abortRef.current?.abort()}
                  className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold underline-offset-2 hover:underline"
                >
                  Cancelar
                </button>
              </div>
              {/* Se dice que la app sigue viva: un minuto sin explicación se lee
                  como colgada, y ahí la vendedora cierra la ventana. */}
              <p className="mt-1 text-[11px] text-muted-foreground">
                Pasa acá en tu compu, no se sube nada todavía. Podés seguir escribiendo.
              </p>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onCerrar}
          title="Entendido"
          className="shrink-0 rounded p-0.5 transition-colors hover:bg-warning/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
