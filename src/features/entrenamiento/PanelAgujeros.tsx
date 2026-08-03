import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, HelpCircle } from 'lucide-react';
import { api } from '../../lib/datos/cliente';

/**
 * LO QUE EL BOT NO SUPO CONTESTAR (#261).
 *
 * Lo primero que se ve del conocimiento del bot es **lo que le falta**. El
 * catálogo completo se puede leer con un `SELECT`; lo que ninguna pantalla hacía
 * es la vuelta contraria — qué le preguntaron y no supo.
 *
 * El dato viene existiendo solo: cada escalada por `sin_respuesta_en_catalogo` es
 * un agujero que el bot detectó, y estaban en la base sin que nadie los mirara.
 *
 * El botón de arreglar está AL LADO a propósito. Separar el hallazgo del arreglo
 * a dos clicks es cómo se pierde: este repo ya vio dos veces que el juicio que
 * cuesta no se da (ADR 0018 con la BandejaRevision, 0019 con las plantillas).
 */

interface Agujero {
  clave: string;
  pregunta: string | null;
  respuesta: string | null;
  cuando: string;
  clase: 'no_supo' | 'supo_y_escalo';
  lectura: string;
}

export function PanelAgujeros({ linea }: { linea: string | null }) {
  const qc = useQueryClient();
  const [escribiendo, setEscribiendo] = useState<string | null>(null);
  const [texto, setTexto] = useState('');

  const lista = useQuery({
    queryKey: ['agujeros', linea],
    queryFn: () => api<{ agujeros: Agujero[] }>(`/api/entrenamiento/agujeros?numero=${linea}`),
    enabled: linea !== null,
  });

  const enseniar = useMutation({
    mutationFn: (motivo: string) =>
      api('/api/entrenamiento/lecciones', {
        method: 'POST',
        body: JSON.stringify({ texto: texto.trim(), motivo }),
      }),
    onSuccess: () => {
      setEscribiendo(null);
      setTexto('');
      void qc.invalidateQueries({ queryKey: ['lecciones'] });
    },
  });

  const agujeros = lista.data?.agujeros ?? [];
  const faltantes = agujeros.filter((a) => a.clase === 'no_supo');

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <div>
          <h2 className="text-sm font-medium">Lo que no supo contestar</h2>
          <p className="text-xs text-muted-foreground">
            Cada vez que el bot escala porque le falta un dato, queda anotado acá. Son{' '}
            {faltantes.length} huecos del catálogo
            {agujeros.length > faltantes.length &&
              ` y ${agujeros.length - faltantes.length} donde el que sobra es el escalado`}
            .
          </p>
        </div>

        {agujeros.length === 0 && (
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            El bot no escaló ninguna vez por falta de datos en esta línea.
          </p>
        )}

        {agujeros.map((a) => (
          <div key={`${a.clave}-${a.cuando}`} className="rounded-md border border-border">
            <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
              <span className={a.clase === 'no_supo' ? 'text-amber-700' : 'text-muted-foreground'}>
                {a.lectura}
              </span>
              <span className="ml-auto font-mono text-muted-foreground">
                {a.clave.split(':')[2]}
              </span>
            </div>

            <div className="px-3 py-2">
              <div className="mb-1 flex items-start gap-1.5">
                <HelpCircle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <p className="text-sm font-medium">{a.pregunta ?? '(no se pudo recuperar la pregunta)'}</p>
              </div>
              {a.respuesta && (
                <p className="pl-5 text-xs text-muted-foreground">Contestó: «{a.respuesta}»</p>
              )}
            </div>

            <div className="border-t border-border px-3 py-2">
              {escribiendo === a.clave ? (
                <div className="flex flex-col gap-2">
                  <textarea
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    rows={2}
                    placeholder="El dato que le faltaba, tal como querés que lo diga."
                    className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  />
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      Queda en borrador: probalo con una corrida antes de publicarlo.
                    </span>
                    <button
                      type="button"
                      onClick={() => enseniar.mutate(`Le preguntaron: «${a.pregunta ?? '—'}» y no supo.`)}
                      disabled={texto.trim().length < 5 || enseniar.isPending}
                      className="ml-auto flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-sm text-primary-foreground disabled:opacity-40"
                    >
                      <Check className="size-3.5" aria-hidden />
                      Guardar borrador
                    </button>
                    <button
                      type="button"
                      onClick={() => setEscribiendo(null)}
                      className="rounded-md border border-border px-2.5 py-1 text-sm hover:bg-muted"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setEscribiendo(a.clave);
                    setTexto('');
                  }}
                  className="rounded-md border border-border px-2.5 py-1 text-sm hover:bg-muted"
                >
                  Enseñarle esto
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
