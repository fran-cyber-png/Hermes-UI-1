import { useState } from 'react';
import { Check, Copy, History, Link2Off, X } from 'lucide-react';
import { useEscape } from '../../lib/teclado/useEscape';
import { PLAZOS, plazoInicial, venceAtDelPlazo, type Plazo } from './auditoria';
import type { Alcance, Nota, Permiso } from './notas';
import { boton } from '../../lib/styles';

/**
 * EL MODAL DEL LINK — configurar la puerta de una página, en una sola pantalla
 * centrada (17-ago-2026; molde: el diálogo de invitación de Discord).
 *
 * ══ QUÉ SE TRAJO DEL MOLDE Y QUÉ NO ═════════════════════════════════════════
 *
 * Se trajo la FORMA: un diálogo centrado, con los controles uno debajo del otro,
 * cada uno con su rótulo arriba, el interruptor con su explicación abajo, y las
 * dos salidas al pie. Reemplaza al panel que se desplegaba dentro del editor, que
 * empujaba el texto hacia abajo cada vez que alguien iba a compartir.
 *
 * No se trajo:
 *
 * - **Los roles.** No existen en la Libreta: quién ve una página lo decide el
 *   espacio (ADR 0046), no un rol.
 * - **El tope de usos.** Hermes no cuenta usos *para frenar*: `nota_link` no tiene
 *   con qué apagarse sola. En ese lugar va **«Quién lo abre»**, que es el eje que
 *   el server sí tiene y el que de verdad decide el riesgo de este link.
 * - **«Generar un link nuevo».** 🔴 Acá reconfigurar **CONSERVA el token** (ADR
 *   0048): el link que ya se repartió sigue sirviendo con las reglas nuevas. Un
 *   botón que prometiera uno nuevo describiría lo contrario de lo que pasa — y lo
 *   que la gente intenta arreglar cuando toca esto es justamente que el link
 *   viejo deje de valer. Por eso dice «Guardar cambios» cuando ya hay uno.
 */

/** El interruptor de Discord: una píldora con su perilla. */
function Interruptor({
  encendido,
  onCambiar,
  deshabilitado,
  etiqueta,
}: {
  encendido: boolean;
  onCambiar: (v: boolean) => void;
  deshabilitado?: boolean;
  etiqueta: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={encendido}
      aria-label={etiqueta}
      disabled={deshabilitado}
      onClick={() => onCambiar(!encendido)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-40 ${
        encendido ? 'bg-primary' : 'bg-muted-foreground/30'
      }`}
    >
      <span
        className={`absolute top-0.5 size-5 rounded-full bg-card shadow transition-all ${
          encendido ? 'left-[1.375rem]' : 'left-0.5'
        }`}
      />
    </button>
  );
}

/** Un campo con su rótulo arriba, como en el molde. */
function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-foreground">{rotulo}</span>
      {children}
    </label>
  );
}

const CLASE_SELECT =
  'h-10 w-full appearance-none rounded-lg border border-input bg-muted/60 px-3 pr-9 text-sm text-foreground outline-none transition focus:border-ring';

export function ModalDeLink({
  nota,
  onCerrar,
  onGuardar,
  onCortar,
  onVerRegistro,
}: {
  nota: Nota;
  onCerrar: () => void;
  onGuardar: (v: { alcance: Alcance; permiso: Permiso; venceAt: string | null }) => void;
  onCortar: () => void;
  onVerRegistro: () => void;
}) {
  const token = nota.token ?? null;

  // Arrancan en lo que el link YA es. ⚠️ Que estos cuatro campos lleguen de verdad
  // depende del LEFT JOIN de `notas/notas.ts` en el server: hasta el 17-ago-2026
  // no viajaban, y este modal habría abierto siempre en «público / solo ver»
  // aunque el link fuera otra cosa.
  const [alcance, setAlcance] = useState<Alcance>(nota.alcance ?? 'publico');
  const [permiso, setPermiso] = useState<Permiso>(nota.permiso ?? 'ver');
  const [plazo, setPlazo] = useState<Plazo>(plazoInicial(nota.venceAt));
  const [copiado, setCopiado] = useState(false);
  /**
   * ⚠️ La confirmación de cortar vive ADENTRO del modal, no en un segundo overlay.
   * Los dos registrarían Escape en captura y el de arriba se comería el del de
   * abajo — la cicatriz de ADR 0024, y acá dejaría un aviso destructivo que no se
   * cierra con la tecla que toda la app usa para eso.
   */
  const [confirmandoCorte, setConfirmandoCorte] = useState(false);

  useEscape(onCerrar);

  /**
   * La URL se compone ACÁ, con el origen del navegador: el server manda **el
   * token**, no la URL — no conoce el origen público (la UI viaja por OTA) y
   * armarla allá con una env sería un lugar más donde puede quedar mal, con el
   * síntoma más caro posible: un link repartido que no abre.
   */
  const url = token ? `${window.location.origin}/n/${token}` : null;

  const venceActual = nota.venceAt
    ? new Date(nota.venceAt).toLocaleDateString('es-PE', { day: 'numeric', month: 'short', year: 'numeric' })
    : null;

  function guardar() {
    // `nota.venceAt` va como segundo argumento y no es opcional: es lo que
    // «conservar» tiene que reenviar. Ver `venceAtDelPlazo`.
    onGuardar({ alcance, permiso, venceAt: venceAtDelPlazo(plazo, nota.venceAt) });
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-navy/25 p-4"
      onClick={onCerrar}
      role="dialog"
      aria-modal="true"
      aria-label="Configuración del link de la página"
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl bg-card shadow-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-6 pt-6">
          <h2 className="font-heading text-sm font-bold text-navy-ink">Configuración del link</h2>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="-mr-1 -mt-1 rounded-lg p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          <Campo rotulo="Vence">
            <div className="relative">
              <select value={plazo} onChange={(e) => setPlazo(e.target.value as Plazo)} className={CLASE_SELECT}>
                {/* 🔴 Va PRIMERA y solo cuando ya hay una fecha: sin esta opción, abrir
                    el modal para cambiar el alcance y guardar le correría —o le
                    sacaría— el vencimiento a un link repartido, sin que nadie lo
                    haya pedido. Ver `venceAtDelPlazo`. */}
                {venceActual && <option value="conservar">La que tiene ({venceActual})</option>}
                {PLAZOS.map((p) => (
                  <option key={p.v} value={p.v}>
                    {p.t}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">▾</span>
            </div>
          </Campo>

          {/* En el molde acá va «Max Number of Uses». Hermes no puede frenar por
              cantidad de usos, y la pregunta que sí decide el riesgo es ésta. */}
          <Campo rotulo="Quién lo abre">
            <div className="relative">
              <select
                value={alcance}
                onChange={(e) => {
                  const v = e.target.value as Alcance;
                  setAlcance(v);
                  // 🔴 Pasar a público APAGA el permiso de editar, y no es una
                  // cortesía: sin identidad no hay autoría, así que esa combinación
                  // NO EXISTE — el server la rechaza con 400 y el tipo del server la
                  // hace imposible de construir (ADR 0048). Dejarla marcada mostraría
                  // un estado que se va a rechazar.
                  if (v === 'publico') setPermiso('ver');
                }}
                className={CLASE_SELECT}
              >
                <option value="publico">Cualquiera con el link</option>
                <option value="goberna">Solo gente de Goberna</option>
              </select>
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">▾</span>
            </div>
          </Campo>

          {/* El interruptor del molde, con su explicación abajo. Acá esa explicación
              hace trabajo de verdad: dice POR QUÉ no se puede prender cuando el
              alcance es público, en vez de dejar un control apagado sin motivo. */}
          <div className="flex items-start justify-between gap-4 border-t border-border pt-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">Puede editar</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {alcance === 'publico'
                  ? 'Un link público es de solo lectura: sin cuenta no hay a quién atribuirle un cambio.'
                  : 'Quien lo abra puede escribir en la página, y queda registrado que fue esa persona.'}
              </p>
            </div>
            <Interruptor
              etiqueta="Puede editar"
              encendido={permiso === 'editar'}
              deshabilitado={alcance === 'publico'}
              onCambiar={(v) => setPermiso(v ? 'editar' : 'ver')}
            />
          </div>

          {url && (
            <div className="space-y-2 border-t border-border pt-4">
              <div className="flex items-center gap-1.5">
                <input
                  readOnly
                  value={url}
                  aria-label="Link de la página"
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-muted px-2.5 text-xs text-foreground outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(url);
                    setCopiado(true);
                  }}
                  className={boton()}
                >
                  {copiado ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copiado ? 'Copiado' : 'Copiar'}
                </button>
              </div>

              {/* 🔴 LO QUE LA PANTALLA TIENE QUE DECIR ANTES DE QUE ALGUIEN PEGUE
                  ESTO EN UN CHAT. Un link público **se abre sin entrar a Hermes**, y
                  si acá no se dice, se manda creyendo que es como compartir adentro
                  de la app — que es la diferencia entre mostrarle un precio a un
                  lead y publicarlo. Cambia con el alcance porque el riesgo es otro. */}
              <p className="text-xs text-muted-foreground">
                {alcance === 'publico'
                  ? 'Lo abre cualquiera que tenga el link, sin entrar a Hermes. Se lee, no se edita.'
                  : permiso === 'editar'
                    ? 'Solo gente de Goberna con su cuenta. Quien lo abra puede editar, y queda registrado quién fue.'
                    : 'Solo gente de Goberna con su cuenta. Se lee, no se edita.'}
              </p>

              {/* La última apertura, del propio listado. El detalle (cuántas veces,
                  quién) vive en el registro; acá alcanza con la respuesta que ADR
                  0048 eligió como la más útil: `null` = no lo abrió nadie. */}
              <p className="text-xs text-muted-foreground">
                {nota.ultimoAccesoAt
                  ? `Se abrió por última vez el ${new Date(nota.ultimoAccesoAt).toLocaleDateString('es-PE', { day: 'numeric', month: 'short' })}.`
                  : 'Todavía no lo abrió nadie.'}
              </p>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={onVerRegistro}
                  className="flex items-center gap-1.5 text-xs font-medium text-primary transition hover:underline"
                >
                  <History className="size-3.5" />
                  Ver el registro
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmandoCorte(true)}
                  className="flex items-center gap-1.5 text-xs font-medium text-destructive transition hover:underline"
                >
                  <Link2Off className="size-3.5" />
                  Cortar el link
                </button>
              </div>

              {/*
                🔴 CORTAR NO SE PUEDE DESHACER, Y NO AVISA A NADIE.
                Se borra la fila (ADR 0047), así que el token queda muerto para
                siempre: quien tenga la URL pegada en un chat abre un 404 sin
                explicación, y no hay forma de resucitarla — un link nuevo es otra
                URL, que hay que volver a repartir.

                Por eso se dice QUÉ pasa y no «¿estás segura?», que no dice nada.
                Es el mismo criterio de `ConfirmarSacarDelEquipo`: cuando la
                consecuencia le cae a otra gente, se nombra la consecuencia.
              */}
              {confirmandoCorte && (
                <div role="alertdialog" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                  <p className="text-sm font-medium text-foreground">
                    {nota.ultimoAccesoAt
                      ? 'Este link ya se abrió: quien lo tenga va a dejar de poder entrar'
                      : 'Quien tenga este link va a dejar de poder entrar'}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    No se puede deshacer. Si después querés compartirla otra vez, va a ser <strong>otra URL</strong> y
                    hay que repartirla de nuevo. El registro de lo que pasó se conserva.
                  </p>
                  <div className="mt-2.5 flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        onCortar();
                        setConfirmandoCorte(false);
                      }}
                      className="rounded-lg bg-destructive px-2.5 py-1 text-xs font-medium text-destructive-foreground transition hover:opacity-90"
                    >
                      Cortarlo igual
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmandoCorte(false)}
                      className={boton('terciario')}
                    >
                      Dejarlo andando
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 bg-muted/50 px-6 py-4">
          <button
            type="button"
            onClick={onCerrar}
            className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition hover:text-foreground"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={guardar}
            className={boton()}
          >
            {/* Ver el docblock: reconfigurar NO genera un link nuevo. */}
            {token ? 'Guardar cambios' : 'Generar el link'}
          </button>
        </div>
      </div>
    </div>
  );
}
