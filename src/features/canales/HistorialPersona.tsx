import { useEffect, useState } from 'react';
import { History, UserX } from 'lucide-react';
import { API_URL } from '../../config';

interface Item {
  id: number;
  tipo: string;
  texto: string | null;
  occurred_at: string;
  status: string;
}

/**
 * Contact merge: todo lo que esta persona escribió antes.
 *
 * Cambia por completo cómo se le responde. Alguien que comentó 8 veces no es un
 * lead nuevo — es alguien que te sigue hace rato. Y alguien que preguntó tres
 * veces por el precio sin respuesta no merece la misma plantilla que un
 * primerizo.
 */
export default function HistorialPersona({ interactionId }: { interactionId: number }) {
  const [datos, setDatos] = useState<{ historial: Item[]; anonima: boolean; nombre?: string } | null>(null);

  useEffect(() => {
    setDatos(null);
    fetch(`${API_URL}/api/persona/${interactionId}`)
      .then((r) => r.json())
      .then(setDatos);
  }, [interactionId]);

  if (!datos) return null;

  if (datos.anonima) {
    return (
      <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-border bg-muted/50 p-3.5">
        <UserX size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Meta no nos dice quién es. No podemos saber si ya te había escrito antes — pero igual le puedes responder.
        </p>
      </div>
    );
  }

  // Una sola interacción = no hay historial que contar.
  const otras = datos.historial.filter((h) => h.id !== interactionId);
  if (otras.length === 0) return null;

  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        <History size={12} />
        Ya te había escrito {otras.length} {otras.length === 1 ? 'vez' : 'veces'}
      </div>

      <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-muted/40 p-3">
        {otras.slice(0, 5).map((h) => (
          <div key={h.id} className="flex gap-2 text-xs">
            <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
              {new Date(h.occurred_at).toLocaleDateString('es', { day: '2-digit', month: 'short' })}
            </span>
            <span className="line-clamp-1 text-foreground">{h.texto || '(sin texto)'}</span>
          </div>
        ))}
        {otras.length > 5 && (
          <span className="text-xs text-muted-foreground">y {otras.length - 5} más</span>
        )}
      </div>
    </div>
  );
}
