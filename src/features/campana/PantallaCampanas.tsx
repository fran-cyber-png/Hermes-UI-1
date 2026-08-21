import { useState } from 'react';
import { FileText, ListChecks, Megaphone, Send, ShieldCheck } from 'lucide-react';
import { PantallaCorridas } from './PantallaCorridas';
import { PantallaPlantillas } from './PantallaPlantillas';
import { PantallaHistorial } from './PantallaHistorial';
import { PantallaListas } from './PantallaListas';
import { ArmarCampana } from './ArmarCampana';

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

/**
 * `seccionInicial` existe SOLO para la galería (`?seccion=plantillas`), como el
 * `?ficha=1` del embudo: la evidencia de una sección no se puede sacar si la
 * pantalla siempre abre en la primera. En la app nadie la pasa y abre en
 * Corridas, que es a lo que se entra todos los días.
 *
 * Se recibe como `string` y se valida acá, contra la MISMA lista que dibuja las
 * solapas: exportar el validador obligaría a la galería a conocer los ids por su
 * cuenta, que es la segunda lista de siempre.
 */
export function PantallaCampanas({ seccionInicial }: { seccionInicial?: string } = {}) {
  const [seccion, setSeccion] = useState<Seccion>(
    SECCIONES.find((s) => s.id === seccionInicial)?.id ?? 'corridas',
  );
  const [armando, setArmando] = useState(false);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav className="flex shrink-0 items-center gap-1 border-b border-border bg-muted/40 px-4 py-1.5">
        {SECCIONES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSeccion(s.id)}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-normal transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
              seccion === s.id
                ? 'bg-card text-navy-ink shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <s.icono size={12} /> {s.rotulo}
          </button>
        ))}
        {/*
          EL BOTÓN VIVE EN LA BARRA, no adentro de una sección: armar una
          campaña es la acción primaria del lugar, y tenerla que buscar en la
          solapa correcta la escondería detrás de un paso que no aporta nada.
        */}
        <button
          type="button"
          onClick={() => setArmando(true)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-navy px-3 py-1.5 text-sm font-bold text-white transition-colors hover:bg-navy/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <Send size={12} /> Armar una campaña
        </button>
      </nav>

      {seccion === 'corridas' && <PantallaCorridas />}
      {seccion === 'plantillas' && <PantallaPlantillas />}
      {seccion === 'listas' && <PantallaListas />}
      {seccion === 'historial' && <PantallaHistorial />}

      {armando && <ArmarCampana onCerrar={() => setArmando(false)} />}
    </div>
  );
}

