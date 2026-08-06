import { useState } from 'react';
import { FileText, ListChecks, Megaphone, ShieldCheck } from 'lucide-react';
import { PantallaCorridas } from './PantallaCorridas';
import { PantallaPlantillas } from './PantallaPlantillas';
import { PantallaHistorial } from './PantallaHistorial';

/**
 * CAMPAÑAS — el lugar donde se administra todo lo de campañas.
 *
 * ══ CUATRO SECCIONES, Y EL ORDEN NO ES ALFABÉTICO ═══════════════════════════
 *
 * Es el de la frecuencia con que se entra:
 *
 *   1. **Corridas** — cómo va lo que está saliendo. Es a lo que se entra todos
 *      los días, y por eso abre acá.
 *   2. **Plantillas** — el catálogo de Meta y crear una nueva. Se toca cuando
 *      hay algo nuevo que decir.
 *   3. **Listas** — a quiénes. Se arma una vez y se reusa.
 *   4. **Quién mandó qué** — la auditoría. Se entra cuando alguien pregunta,
 *      que ojalá sea nunca, pero cuando pasa tiene que estar.
 *
 * ══ POR QUÉ SECCIONES Y NO CUATRO SOLAPAS MÁS EN CONTACTOS ══════════════════
 *
 * Porque las cuatro son la MISMA tarea. Contactos ya tiene «Padrón» y «Buscar
 * por teléfono», que son cosas distintas entre sí; meter cuatro más al mismo
 * nivel diría que armar una plantilla y buscar un teléfono son decisiones
 * comparables, y no lo son.
 */

type Seccion = 'corridas' | 'plantillas' | 'listas' | 'historial';

const SECCIONES: { id: Seccion; rotulo: string; icono: typeof Megaphone }[] = [
  { id: 'corridas', rotulo: 'Corridas', icono: Megaphone },
  { id: 'plantillas', rotulo: 'Plantillas', icono: FileText },
  { id: 'listas', rotulo: 'Listas', icono: ListChecks },
  { id: 'historial', rotulo: 'Quién mandó qué', icono: ShieldCheck },
];

export function PantallaCampanas() {
  const [seccion, setSeccion] = useState<Seccion>('corridas');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav className="flex shrink-0 items-center gap-1 border-b border-border bg-muted/40 px-4 py-1.5">
        {SECCIONES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSeccion(s.id)}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-bold transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
              seccion === s.id
                ? 'bg-card text-navy shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <s.icono size={12} /> {s.rotulo}
          </button>
        ))}
      </nav>

      {seccion === 'corridas' && <PantallaCorridas />}
      {seccion === 'plantillas' && <PantallaPlantillas />}
      {seccion === 'listas' && <PantallaListas />}
      {seccion === 'historial' && <PantallaHistorial />}
    </div>
  );
}

/**
 * LISTAS — todavía no está.
 *
 * Se dibuja el hueco en vez de esconder la sección: una solapa que aparece
 * cuando la feature llega es una sorpresa; un «esto viene» es un plan. Y evita
 * que alguien busque las listas en Plantillas.
 */
function PantallaListas() {
  return (
    <div className="flex flex-col items-center gap-2 p-12 text-center">
      <ListChecks size={26} className="text-muted-foreground/40" />
      <p className="max-w-sm text-sm text-muted-foreground">
        Acá van a vivir las listas: un recorte del padrón guardado con nombre.
      </p>
      <p className="max-w-md text-xs text-muted-foreground/80">
        Se guardan como <strong>filtro</strong>, no como una lista de contactos — así no envejecen
        cuando entran contactos nuevos. Mientras tanto, el recorte se arma en{' '}
        <strong>Contactos → Padrón</strong>.
      </p>
    </div>
  );
}
