import { useState } from 'react';
import { Check, Link2, Lock, MoveRight, Users } from 'lucide-react';
import { AuditoriaDeLink } from './AuditoriaDeLink';
import { ModalDeLink } from './ModalDeLink';
import type { DondeEstoy, Espacio } from './espacios';
import type { Alcance, Nota, Permiso } from './notas';

/**
 * QUÉ SE PUEDE HACER CON UNA PÁGINA — mover de lugar y compartirla con un link
 * (ADR 0047).
 *
 * Va arriba del editor y no en la fila de la lista: las dos acciones se deciden
 * **con la página a la vista**, después de leer lo que dice. En la fila, «mover» y
 * «compartir» serían dos clics sobre un título de tres palabras.
 */

/**
 * EL AVISO QUE NADIE ESPERA.
 *
 * Traer una página del espacio a tu libreta privada **se la saca a todos los
 * demás**, y en la pantalla de ellos simplemente desaparece. Por eso se nombra a
 * la gente en vez de preguntar «¿estás segura?», que no dice nada.
 */
function ConfirmarSacarDelEquipo({
  espacio,
  vendedoraId,
  onSi,
  onNo,
}: {
  espacio: Espacio;
  vendedoraId?: string | null;
  onSi: () => void;
  onNo: () => void;
}) {
  const otros = espacio.miembros.filter((m) => m.trim().toLowerCase() !== (vendedoraId ?? '').trim().toLowerCase());

  return (
    <div role="alertdialog" className="rounded-lg border border-border bg-card p-3 text-sm">
      <p className="font-medium text-foreground">Traerla a tu libreta la saca del espacio</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {otros.length > 0
          ? `${otros.join(', ')} dejan de verla.`
          : 'Nadie más la está viendo, así que no le saca nada a nadie.'}
      </p>
      <div className="mt-2 flex gap-1.5">
        <button
          type="button"
          onClick={onSi}
          className="rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary-hover"
        >
          Traerla igual
        </button>
        <button type="button" onClick={onNo} className="rounded-lg px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted">
          Dejarla acá
        </button>
      </div>
    </div>
  );
}

export function AccionesDePagina({
  nota,
  donde,
  espacios,
  vendedoraId,
  onMover,
  onAbrirLink,
  onCortarLink,
}: {
  nota: Nota;
  donde: DondeEstoy;
  espacios: Espacio[];
  vendedoraId?: string | null;
  onMover: (destino: DondeEstoy) => void;
  onAbrirLink: (v: { alcance: Alcance; permiso: Permiso; venceAt: string | null }) => void;
  onCortarLink: () => void;
}) {
  /**
   * `link` abre el modal de configuración y `registro` el Audit Log. Son estados
   * del MISMO selector y no dos banderas sueltas: con dos booleanos se pueden
   * abrir los dos a la vez, y los dos escuchan Escape en captura — el segundo se
   * comería el del primero (ADR 0024).
   */
  const [abierto, setAbierto] = useState<'mover' | 'link' | 'registro' | null>(null);
  const [confirmar, setConfirmar] = useState<DondeEstoy | 'no'>('no');

  const espacioActual = espacios.find((e) => e.id === donde) ?? null;
  const token = nota.token ?? null;

  function pedirMover(destino: DondeEstoy) {
    // Sacar del equipo es lo único que se pregunta. Compartir hacia un espacio no
    // le quita nada a nadie, así que preguntarlo sería un clic de peaje.
    if (donde !== null && destino === null) {
      setConfirmar(destino);
      return;
    }
    onMover(destino);
    setAbierto(null);
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => setAbierto(abierto === 'mover' ? null : 'mover')}
        className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
      >
        <MoveRight className="size-3.5" />
        Mover
      </button>

      <button
        type="button"
        onClick={() => setAbierto(abierto === 'link' ? null : 'link')}
        aria-pressed={Boolean(token)}
        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition ${
          token
            ? // Compartida: se dice, y se dice siempre. Una página que está afuera y
              // no lo parece es la peor forma de tener esta función.
              'border-primary bg-secondary text-foreground'
            : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
        }`}
      >
        <Link2 className="size-3.5" />
        {token ? 'Compartida con link' : 'Compartir con link'}
      </button>

      {confirmar !== 'no' && espacioActual && (
        <div className="w-full">
          <ConfirmarSacarDelEquipo
            espacio={espacioActual}
            vendedoraId={vendedoraId}
            onSi={() => {
              onMover(confirmar);
              setConfirmar('no');
              setAbierto(null);
            }}
            onNo={() => setConfirmar('no')}
          />
        </div>
      )}

      {abierto === 'mover' && confirmar === 'no' && (
        <div className="w-full rounded-lg border border-border bg-card p-2">
          <p className="mb-1 px-1 text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
            Llevarla a
          </p>
          <div className="space-y-0.5">
            {/* La libreta privada va primera y siempre existe, como en el selector. */}
            <button
              type="button"
              disabled={donde === null}
              onClick={() => pedirMover(null)}
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-40"
            >
              <Lock className="size-3.5 shrink-0" />
              <span className="flex-1 truncate">Mi libreta</span>
              {donde === null && <Check className="size-3.5" />}
            </button>

            {espacios.map((e) => (
              <button
                key={e.id}
                type="button"
                disabled={donde === e.id}
                onClick={() => pedirMover(e.id)}
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-40"
              >
                <Users className="size-3.5 shrink-0" />
                <span className="flex-1 truncate">{e.nombre}</span>
                {donde === e.id && <Check className="size-3.5" />}
              </button>
            ))}

            {espacios.length === 0 && (
              <p className="px-2 py-1 text-xs text-muted-foreground">
                Todavía no tenés espacios. Creá uno para compartir páginas.
              </p>
            )}
          </div>
        </div>
      )}

      {abierto === 'link' && (
        <ModalDeLink
          nota={nota}
          onCerrar={() => setAbierto(null)}
          /**
           * 🔴 **GENERAR EL LINK NO CIERRA EL MODAL, y cerrarlo era un defecto.**
           *
           * Quien aprieta «Generar el link» quiere **el link**: la URL para copiar
           * y pegar. Cerrando ahí, la pantalla hacía justo lo contrario de lo que
           * le pidieron — el link se creaba bien y quedaba invisible, y había que
           * volver a abrir el modal para copiarlo. De paso escondía el acceso al
           * registro, que solo aparece cuando ya hay un link del que hablar.
           *
           * Queda abierto y se repinta solo: la mutación invalida la lista, la
           * página vuelve con su `token`, y el modal pasa a mostrar la URL, el
           * «Ver el registro» y «Cortar el link». Cerrar es de `Cancelar` y de la ✕.
           */
          onGuardar={onAbrirLink}
          onCortar={() => {
            onCortarLink();
            setAbierto(null);
          }}
          // 🔴 Reemplaza el modal en vez de abrirse encima, y no es estética: los
          // dos registran Escape EN CAPTURA, así que apilados el de arriba se come
          // el del de abajo y quedaría una pantalla que no se cierra con la tecla
          // que toda la app usa para eso (ADR 0024).
          onVerRegistro={() => setAbierto('registro')}
        />
      )}

      {abierto === 'registro' && <AuditoriaDeLink notaId={nota.id} onCerrar={() => setAbierto('link')} />}

    </div>
  );
}
