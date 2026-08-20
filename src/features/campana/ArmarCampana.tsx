import { useState } from 'react';
import { AlertTriangle, ArrowRight, Check, Users2, X } from 'lucide-react';
import { sectionLabel } from '../../lib/styles';
import { resumirFiltros } from './PantallaListas';
import { useListas, usePlantillas, type Lista, type PlantillaConEstado } from './plantillas';

/**
 * ARMAR UNA CAMPAÑA — elegí la plantilla, elegí la lista, autorizá.
 *
 * ══ TRES PASOS, Y EL TERCERO NO ES UN TRÁMITE ═══════════════════════════════
 *
 * Los dos primeros son elegir. El tercero es **autorizar**, y está separado a
 * propósito: es el momento en que una persona se hace cargo de que mil mensajes
 * salgan desde el número del negocio.
 *
 * Por eso el botón final **dice el número** («Autorizar el envío a 628»), la
 * confirmación **escribe la cifra**, y la fila de auditoría se guarda con quién
 * apretó. ADR 0036, condición 5.
 *
 * ══ LO QUE LA PANTALLA NO DEJA HACER ════════════════════════════════════════
 *
 * **Elegir una plantilla que no esté aprobada.** No se dibujan siquiera: una
 * `PAUSED` en el desplegable es una trampa esperando, y el error llegaría recién
 * al mandar, con un `132015` por destinatario.
 *
 * **Mandar sin ver a cuántos.** El conteo se pide en vivo; si no se pudo
 * preguntar, no se habilita el botón. Autorizar sin saber el número es
 * exactamente lo que este paso existe para impedir.
 */

export function ArmarCampana({ onCerrar }: { onCerrar: () => void }) {
  const plantillas = usePlantillas();
  const listas = useListas();
  const [plantilla, setPlantilla] = useState<PlantillaConEstado | null>(null);
  const [lista, setLista] = useState<Lista | null>(null);

  const enviables = plantillas.data?.plantillas.filter((p) => p.enviable) ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-foreground/20 p-4 backdrop-blur-sm">
      <div className="mt-8 w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-card shadow-panel">
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <h2 className="font-heading text-sm font-bold">Armar una campaña</h2>
          <button
            type="button"
            onClick={onCerrar}
            className="ml-auto rounded-full p-1 text-muted-foreground hover:bg-muted"
            aria-label="Cerrar"
          >
            <X size={16} />
          </button>
        </header>

        <div className="max-h-[70vh] space-y-4 overflow-auto p-4">
          {/* ── 1 · qué se manda ── */}
          <section>
            <p className={sectionLabel}>1 · Qué se manda</p>
            {plantillas.isPending ? (
              <div className="h-10 animate-pulse rounded-lg bg-muted" />
            ) : enviables.length === 0 ? (
              <Aviso texto="No hay ninguna plantilla aprobada para usar. Creá una en la sección Plantillas y esperá a que Meta la revise." />
            ) : (
              <ul className="space-y-1.5">
                {enviables.map((p) => (
                  <li key={`${p.nombre}:${p.idioma}`}>
                    <button
                      type="button"
                      onClick={() => setPlantilla(p)}
                      className={`w-full rounded-lg border p-2.5 text-left transition-colors ${
                        plantilla?.nombre === p.nombre
                          ? 'border-navy bg-navy/5'
                          : 'border-border hover:bg-muted/50'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-sm font-bold">{p.nombre}</span>
                        <span className="text-[11px] text-muted-foreground">{p.idioma}</span>
                        {p.headerDeImagen && (
                          <span className="text-[11px] text-muted-foreground">🖼 pide imagen</span>
                        )}
                        {plantilla?.nombre === p.nombre && (
                          <Check size={14} className="ml-auto text-navy-ink" />
                        )}
                      </span>
                      {p.cuerpo && (
                        <span className="mt-1 block truncate text-xs text-muted-foreground">{p.cuerpo}</span>
                      )}
                      {p.calidad.tono !== 'bien' && (
                        <span className="mt-1 block text-[11px] text-warning-foreground">
                          calidad: {p.calidad.texto} — Meta puede retener parte de los envíos
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── 2 · a quiénes ── */}
          <section>
            <p className={sectionLabel}>2 · A quiénes</p>
            {listas.isPending ? (
              <div className="h-10 animate-pulse rounded-lg bg-muted" />
            ) : (listas.data?.listas.length ?? 0) === 0 ? (
              <Aviso texto="No hay ninguna lista guardada. Armá una en la sección Listas: es el recorte del padrón al que le va a llegar." />
            ) : (
              <ul className="space-y-1.5">
                {listas.data!.listas.map((l) => (
                  <li key={l.id}>
                    <button
                      type="button"
                      onClick={() => setLista(l)}
                      className={`w-full rounded-lg border p-2.5 text-left transition-colors ${
                        lista?.id === l.id ? 'border-navy bg-navy/5' : 'border-border hover:bg-muted/50'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <Users2 size={13} className="text-muted-foreground" />
                        <span className="text-sm font-bold">{l.nombre}</span>
                        {lista?.id === l.id && <Check size={14} className="ml-auto text-navy-ink" />}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {resumirFiltros(l.filtros).join(' · ')}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── 3 · el simulacro ── */}
          {plantilla && lista && <Simulacro plantilla={plantilla} lista={lista} />}
        </div>
      </div>
    </div>
  );
}

/**
 * EL SIMULACRO — todavía no está, y se dice.
 *
 * Es la lección de #166: un dry-run que muestra a quién le va a tocar pero no
 * POR QUÉ califica no verifica nada, sólo tranquiliza. Dibujar un botón
 * «Autorizar» sin la tabla de condiciones sería peor que no tener el botón:
 * daría la sensación de haber revisado.
 */
function Simulacro({ plantilla, lista }: { plantilla: PlantillaConEstado; lista: Lista }) {
  return (
    <section className="rounded-xl border border-warning/40 bg-warning/10 p-3">
      <p className={sectionLabel}>3 · Revisar y autorizar</p>
      <p className="mt-1 text-sm text-warning-foreground">
        Vas a mandar <strong className="font-mono">{plantilla.nombre}</strong> a{' '}
        <strong>{lista.nombre}</strong>.
      </p>
      <div className="mt-2 flex items-start gap-2 text-xs text-warning-foreground">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        <p>
          <strong>El simulacro todavía no está.</strong> Antes de habilitar el botón de autorizar hace
          falta la tabla fila por fila —quién es, cuándo escribió, si dijo que no— con cada fila
          destildable. Es la condición que ADR 0036 pone para reemplazar el «aprobar de a uno», y sin
          ella un botón «Autorizar» daría la sensación de haber revisado sin haber revisado nada.
        </p>
      </div>
      <p className="mt-2 text-xs text-warning-foreground/90">
        Mientras tanto el envío sale por script, con los mismos frenos:{' '}
        <code className="rounded bg-warning/20 px-1">npm run campana</code>.
      </p>
    </section>
  );
}

function Aviso({ texto }: { texto: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/50 p-2.5 text-xs text-muted-foreground">
      <ArrowRight size={13} className="mt-0.5 shrink-0" />
      <p>{texto}</p>
    </div>
  );
}
