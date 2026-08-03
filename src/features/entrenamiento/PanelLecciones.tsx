import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check } from 'lucide-react';
import { api, ErrorApi } from '../../lib/datos/cliente';

/**
 * LAS LECCIONES — lo único que se le puede ENSEÑAR al bot en caliente (#259).
 *
 * La línea que esta pantalla materializa: **lo que el bot SABE** se edita sin
 * desplegar; **lo que el bot ES** —su identidad y sus 13 reglas duras— se cambia
 * con revisión y con test. Por eso acá no hay forma de tocar el prompt: mover
 * esas reglas a la base desactivaría los candados del PR #251.
 *
 * Una Lección nace en BORRADOR y el bot vivo no la ve. Publicar es un acto
 * aparte, con confirmación y firmado — el patrón de la plantilla `propuesta`
 * (ADR 0019): verla es seguro, aprobarla es hacerse cargo.
 */

interface Leccion {
  id: number;
  texto: string;
  motivo: string | null;
  estado: string;
  numeroPropio: string | null;
  creadaPor: string;
  publicadaPor: string | null;
  publicadaEn: string | null;
}

export function PanelLecciones() {
  const qc = useQueryClient();
  const [texto, setTexto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [confirmando, setConfirmando] = useState<number | null>(null);

  const lista = useQuery({
    queryKey: ['lecciones'],
    queryFn: () => api<{ lecciones: Leccion[] }>('/api/entrenamiento/lecciones'),
  });

  const escribir = useMutation({
    mutationFn: () =>
      api('/api/entrenamiento/lecciones', {
        method: 'POST',
        body: JSON.stringify({ texto: texto.trim(), motivo: motivo.trim() || undefined }),
      }),
    onSuccess: () => {
      setTexto('');
      setMotivo('');
      void qc.invalidateQueries({ queryKey: ['lecciones'] });
    },
  });

  const publicar = useMutation({
    mutationFn: (id: number) =>
      api(`/api/entrenamiento/lecciones/${id}/publicar`, { method: 'PUT' }),
    onSuccess: () => {
      setConfirmando(null);
      void qc.invalidateQueries({ queryKey: ['lecciones'] });
    },
  });

  const retirar = useMutation({
    mutationFn: (id: number) =>
      api(`/api/entrenamiento/lecciones/${id}/retirar`, { method: 'PUT' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['lecciones'] }),
  });

  const err = [escribir.error, publicar.error].find((e) => e instanceof ErrorApi) as
    | ErrorApi
    | undefined;
  const puedeEscribir = texto.trim().length >= 5 && !escribir.isPending;
  const todas = lista.data?.lecciones ?? [];

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <div className="rounded-md border border-border p-4">
          <h2 className="mb-1 text-sm font-medium">Enseñarle algo</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Queda en borrador: el bot no la lleva puesta hasta que la publiques. Probala antes con
            una corrida.
          </p>
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={2}
            placeholder="Cuando pregunten por la fecha de inicio, decí el día exacto y no «en agosto»."
            className="mb-2 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Por qué: qué le viste hacer"
            className="mb-3 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          />
          <button
            type="button"
            onClick={() => escribir.mutate()}
            disabled={!puedeEscribir}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-40"
          >
            Guardar como borrador
          </button>
        </div>

        {err && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
            {err.message}
          </p>
        )}

        {todas.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Todavía no le enseñaste nada. El bloque de lecciones del prompt está vacío.
          </p>
        )}

        {todas.map((l) => (
          <div key={l.id} className="rounded-md border border-border">
            <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
              <Estado estado={l.estado} />
              <span className="ml-auto text-muted-foreground">
                {l.publicadaPor ? `publicada por ${l.publicadaPor}` : `escrita por ${l.creadaPor}`}
              </span>
            </div>
            <div className="px-3 py-2">
              <p className="text-sm">{l.texto}</p>
              {l.motivo && <p className="mt-1 text-xs text-muted-foreground">{l.motivo}</p>}
            </div>
            <div className="flex items-center gap-2 border-t border-border px-3 py-2">
              {l.estado === 'borrador' && confirmando !== l.id && (
                <button
                  type="button"
                  onClick={() => setConfirmando(l.id)}
                  className="rounded-md border border-border px-2.5 py-1 text-sm hover:bg-muted"
                >
                  Publicar
                </button>
              )}
              {/*
                La confirmación no es ceremonia: publicar es la única acción de
                esta pantalla que cambia lo que el bot le dice a personas reales.
              */}
              {confirmando === l.id && (
                <>
                  <AlertTriangle className="size-4 shrink-0 text-amber-600" aria-hidden />
                  <span className="text-sm">
                    El bot va a llevar esto puesto en todas sus conversaciones. ¿Seguro?
                  </span>
                  <button
                    type="button"
                    onClick={() => publicar.mutate(l.id)}
                    disabled={publicar.isPending}
                    className="ml-auto flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-sm text-primary-foreground disabled:opacity-40"
                  >
                    <Check className="size-3.5" aria-hidden />
                    Sí, publicar
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmando(null)}
                    className="rounded-md border border-border px-2.5 py-1 text-sm hover:bg-muted"
                  >
                    No
                  </button>
                </>
              )}
              {l.estado === 'publicada' && (
                <button
                  type="button"
                  onClick={() => retirar.mutate(l.id)}
                  className="rounded-md border border-border px-2.5 py-1 text-sm hover:bg-muted"
                >
                  Retirar
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Estado({ estado }: { estado: string }) {
  if (estado === 'publicada') {
    return <span className="rounded bg-emerald-600/10 px-1.5 py-0.5 text-emerald-700">El bot la lleva puesta</span>;
  }
  if (estado === 'retirada') {
    return <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">Retirada</span>;
  }
  return <span className="rounded border border-dashed border-border px-1.5 py-0.5">Borrador — el bot no la ve</span>;
}
