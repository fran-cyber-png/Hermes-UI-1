import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { api, ErrorApi } from '../../lib/datos/cliente';
import {
  compararRespuesta,
  costoAproximado,
  LECTURA_CAMBIO,
  resumirCorrida,
  type Cambio,
  type Corrida,
  type RespuestaDeCorrida,
} from './corridas';

/**
 * LAS CORRIDAS — el Replay sobre conversaciones que ya pasaron (#257).
 *
 * Responde «si esta persona escribiera hoy, ¿qué le diría?». No reproduce el
 * pasado: enfrenta a la persona real de entonces con el bot de AHORA.
 *
 * Por eso cada Corrida muestra **contra qué corrió** y cuánto costó: dos
 * corridas con resultados distintos no dicen si el bot mejoró si no se sabe si
 * cambió el bot o cambió el catálogo debajo.
 */
export function PanelCorridas({ linea }: { linea: string | null }) {
  const qc = useQueryClient();
  const [abierta, setAbierta] = useState<number | null>(null);
  const [rotulo, setRotulo] = useState('');
  const [limite, setLimite] = useState(25);

  const lista = useQuery({
    queryKey: ['corridas'],
    queryFn: () => api<{ corridas: Corrida[] }>('/api/entrenamiento/corridas'),
    // Mientras haya una corriendo hay que volver a preguntar: la Corrida se
    // lanza y sigue de fondo, así que el estado cambia sin que nadie toque nada.
    refetchInterval: (q) =>
      (q.state.data?.corridas ?? []).some((c) => c.estado === 'corriendo') ? 5_000 : false,
  });

  const lanzar = useMutation({
    mutationFn: () =>
      api('/api/entrenamiento/corridas', {
        method: 'POST',
        body: JSON.stringify({ rotulo: rotulo.trim(), numeroPropio: linea, limite }),
      }),
    onSuccess: () => {
      setRotulo('');
      void qc.invalidateQueries({ queryKey: ['corridas'] });
    },
  });

  const detalle = useQuery({
    queryKey: ['corrida', abierta],
    queryFn: () =>
      api<{ corrida: Corrida; respuestas: RespuestaDeCorrida[] }>(
        `/api/entrenamiento/corridas/${abierta}`,
      ),
    enabled: abierta !== null,
  });

  const puedeLanzar = rotulo.trim().length > 0 && linea !== null && !lanzar.isPending;
  const errorLanzar = lanzar.error instanceof ErrorApi ? lanzar.error : null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-wrap items-end gap-3 border-b border-border px-6 py-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Cómo la vas a reconocer después</span>
          <input
            value={rotulo}
            onChange={(e) => setRotulo(e.target.value)}
            placeholder="con el precio partido por país"
            className="w-72 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Conversaciones</span>
          <input
            type="number"
            min={1}
            max={300}
            value={limite}
            onChange={(e) => setLimite(Number(e.target.value))}
            className="w-24 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={() => lanzar.mutate()}
          disabled={!puedeLanzar}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-40"
        >
          <Play className="size-3.5" aria-hidden />
          Correr
        </button>
        <p className="text-xs text-muted-foreground">
          Corren de a una, en serie: {limite} conversaciones son unos minutos.
        </p>
      </div>

      {errorLanzar && (
        <p className="mx-6 mt-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
          {errorLanzar.message}
        </p>
      )}

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-72 shrink-0 overflow-y-auto border-r border-border">
          {(lista.data?.corridas ?? []).length === 0 && (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              Todavía no corriste ninguna.
            </p>
          )}
          {(lista.data?.corridas ?? []).map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setAbierta(c.id)}
              className={`block w-full border-b border-border px-4 py-3 text-left text-sm hover:bg-muted ${
                abierta === c.id ? 'bg-muted' : ''
              }`}
            >
              <div className="font-medium">{c.rotulo}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {c.estado === 'corriendo' ? (
                  <span>corriendo… {c.corridas}/{c.pedidas}</span>
                ) : (
                  <span>
                    {c.corridas} conversaciones · ~US$
                    {costoAproximado(c.tokensEntrada, c.tokensSalida).toFixed(2)}
                  </span>
                )}
              </div>
            </button>
          ))}
        </aside>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {abierta === null && (
            <p className="text-sm text-muted-foreground">
              Elegí una corrida para ver, conversación por conversación, qué dijo el bot entonces y
              qué diría ahora.
            </p>
          )}
          {detalle.data && <Detalle respuestas={detalle.data.respuestas} />}
        </div>
      </div>
    </div>
  );
}

const COLOR: Record<Cambio, string> = {
  igual: 'text-muted-foreground',
  cambio: 'text-foreground',
  'ahora-calla': 'text-destructive',
  'antes-callaba': 'text-foreground',
  'sin-datos': 'text-muted-foreground',
};

function Detalle({ respuestas }: { respuestas: RespuestaDeCorrida[] }) {
  const resumen = resumirCorrida(respuestas);

  return (
    <div className="flex flex-col gap-5">
      {/* El resumen primero: «diría otra cosa en 40 de 255» es la lectura, no la lista. */}
      <div className="flex flex-wrap gap-2 text-xs">
        {(Object.keys(resumen) as Cambio[])
          .filter((k) => resumen[k] > 0)
          .map((k) => (
            <span key={k} className={`rounded border border-border px-2 py-1 ${COLOR[k]}`}>
              {LECTURA_CAMBIO[k]}: <strong className="tabular-nums">{resumen[k]}</strong>
            </span>
          ))}
      </div>

      {respuestas.map((r) => {
        const cambio = compararRespuesta(r);
        return (
          <div key={r.id} className="rounded-lg border border-border">
            <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
              <span className={COLOR[cambio]}>{LECTURA_CAMBIO[cambio]}</span>
              <span className="ml-auto font-mono text-muted-foreground">
                {r.clave.split(':')[2]}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-px bg-border md:grid-cols-2">
              <div className="bg-card px-3 py-2">
                <div className="mb-1 text-xs text-muted-foreground">Dijo entonces</div>
                <p className="whitespace-pre-wrap text-sm">
                  {r.textoOriginal ?? <span className="text-muted-foreground">— no habló —</span>}
                </p>
              </div>
              <div className="bg-card px-3 py-2">
                <div className="mb-1 text-xs text-muted-foreground">Diría ahora</div>
                <p className="whitespace-pre-wrap text-sm">
                  {r.texto ?? (
                    <span className="text-muted-foreground">
                      — no habla — {r.motivo ? `(${r.motivo})` : `(${r.estado})`}
                    </span>
                  )}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
