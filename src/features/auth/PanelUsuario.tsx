import { useCallback, useRef, useState } from 'react';
import { AlertTriangle, Check, LogOut, Smartphone, UserRound } from 'lucide-react';
import { usePopover } from '../../lib/teclado/usePopover';
import { useLineas } from '../../dominio/lineas';
import { VincularMiWhatsapp } from '../whatsapp/VincularMiWhatsapp';
import { tieneSesionDeCerberus } from './identidad';
import type { Vendedora } from './sesion';

/**
 * QUIÉN SOY, EN ESTA APP — el panel que abre el avatar del riel.
 *
 * ── Por qué existe ──
 * El avatar era un `<span>` con un `title`: la única forma de saber con qué
 * usuario estabas era pasarle el mouse por encima y esperar el tooltip del
 * sistema. Con **cinco vendedoras nuevas compartiendo una línea** eso dejó de ser
 * un detalle: «¿por qué no veo los leads de fulana?» y «¿entré con el usuario que
 * era?» son la misma pregunta, y hasta hoy no había dónde contestarla.
 *
 * ── Qué dice, y por qué esas cuatro cosas ──
 * Las que responden las preguntas que una vendedora se hace cuando algo no
 * cuadra, en ese orden:
 *
 *   1. **Con qué usuario entró.** El `vendedoraId` ES el username de Cerberus, y
 *      es la clave con la que el reparto le asigna conversaciones. Si está mal
 *      escrito no ve sus asignados y **nada avisa** — este panel es el único
 *      lugar donde eso se puede notar sin entrar a la base.
 *   2. **Si Hermes todavía puede actuar como ella en Cerberus.** Son dos vidas
 *      distintas: el token de Hermes dura 14 días, la cookie de Cerberus se
 *      renueva al entrar. Sin esto, se enteraba al registrar una venta, con un 409.
 *   3. **Qué líneas atiende.** Es lo que decide qué cola ve.
 *   4. **Salir**, que ya estaba suelto abajo del avatar y ahora vive donde
 *      corresponde: adentro de «quién soy».
 *
 * ── Lo que NO hace ──
 * No edita nada de la IDENTIDAD: cambiar quién sos es salir y volver a entrar.
 * El mapa de líneas lo sigue dueñando Cerberus para todo lo demás — Escuela,
 * campaña, cualquier línea de otra vendedora.
 *
 * ── La ÚNICA excepción, desde el 15-ago-2026 ──
 * Sin líneas asignadas, el panel ofrece «Vincular tu WhatsApp»: la
 * auto-vinculación (`VincularMiWhatsapp`, D13 deja de ser solo consola de
 * operador). Es angosta a propósito — solo 1 línea, solo si todavía no tenés
 * ninguna — y por eso vive acá y no abre la puerta a editar nada más desde
 * este panel.
 */

export function PanelUsuario({
  vendedora,
  cerberusVivo,
  onSalir,
}: {
  vendedora: Vendedora;
  /** `null` = no se sabe (server viejo o todavía no contestó). Solo `false` se denuncia. */
  cerberusVivo: boolean | null;
  onSalir: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  // Vive ACÁ y no en `ContenidoUsuario`: si conviviera con el popover, dos
  // listeners de Escape en captura sobre `window` (el de `usePopover` y el de
  // `useEscape` del modal) competirían por la MISMA tecla — `stopPropagation`
  // no frena a un listener HERMANO en el mismo elemento, solo a los de más
  // arriba. Al abrir el modal se cierra el popover (`cerrar()`), así que su
  // listener se desregistra y solo queda uno escuchando.
  const [vinculando, setVinculando] = useState(false);
  const disparador = useRef<HTMLButtonElement>(null);
  const { lineas } = useLineas();

  const cerrar = useCallback(() => {
    setAbierto(false);
    disparador.current?.focus();
  }, []);
  const { propsOverlay } = usePopover(abierto, cerrar, { z: 'z-30' });

  const mias = lineas.filter((l) => l.mias === true);
  // La del EQUIPO no habilita ni deshabilita nada: lo que decide si puede
  // traer la suya es no tener NINGUNA propia. Misma regla que el server.
  const tienePropia = mias.some((l) => l.compartida !== true);

  return (
    <span className="relative">
      <button
        ref={disparador}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={abierto}
        onClick={() => setAbierto((v) => !v)}
        title={`${vendedora.nombre} — tocá para ver tu información`}
        className={
          'flex size-9 items-center justify-center rounded-lg font-heading text-[11px] font-bold ' +
          'transition-[background-color,transform] duration-200 ease-house active:scale-[0.96] ' +
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ' +
          (abierto ? 'bg-navy text-white' : 'bg-secondary text-navy hover:bg-navy hover:text-white')
        }
      >
        {iniciales(vendedora.nombre)}
      </button>

      {abierto && (
        <>
          <div {...propsOverlay} />
          {/* Se abre a la DERECHA y anclado abajo: el riel está pegado al borde
              izquierdo y el avatar al pie, así que cualquier otra dirección se
              sale de la pantalla. */}
          <div
            role="dialog"
            aria-label="Tu información"
            className="absolute bottom-0 left-full z-40 ml-2 w-64 rounded-xl border border-border bg-card p-3 shadow-panel"
          >
            <ContenidoUsuario
              vendedora={vendedora}
              cerberusVivo={cerberusVivo}
              mias={mias}
              tienePropia={tienePropia}
              onSalir={onSalir}
              onVincular={() => {
                cerrar();
                setVinculando(true);
              }}
            />
          </div>
        </>
      )}

      {vinculando && <VincularMiWhatsapp onCerrar={() => setVinculando(false)} />}
    </span>
  );
}

/**
 * LO QUE EL PANEL DICE, separado de CÓMO se abre.
 *
 * Exportado a propósito: la galería lo pinta abierto sin simular un click, y así
 * la evidencia de la regla dura #2 no depende de un navegador que sepa hacer
 * click. Además la mecánica del popover (Escape, clic afuera, foco) queda de un
 * lado y el contenido del otro, que es la división de siempre en esta casa.
 */
export function ContenidoUsuario({
  vendedora,
  cerberusVivo,
  mias,
  tienePropia,
  onSalir,
  onVincular,
}: {
  vendedora: Vendedora;
  cerberusVivo: boolean | null;
  mias: { numero: string; etiqueta: string; compartida?: boolean }[];
  /** ¿Tiene alguna línea que NO comparta? Si no, se le ofrece traer la suya. */
  tienePropia?: boolean;
  onSalir: () => void;
  /** Ausente = la galería, que pinta el panel solo (sin el modal detrás). */
  onVincular?: () => void;
}) {
  return (
    <>
            <div className="flex items-center gap-2">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-navy font-heading text-[11px] font-bold text-white">
                {iniciales(vendedora.nombre)}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold text-foreground">{vendedora.nombre}</span>
                {/* El usuario, en mono y completo: es la clave con la que el
                    reparto le asigna las conversaciones, así que tiene que poder
                    leerse carácter por carácter y compararse con Cerberus. */}
                <span className="block truncate font-mono text-[11px] text-muted-foreground" title={vendedora.id}>
                  {vendedora.id}
                </span>
              </span>
            </div>

            {/* LA SESIÓN DE CERBERUS. Solo `false` se denuncia: `null` es «no se
                sabe» —server viejo o todavía sin respuesta— y pintar eso de rojo
                sería inventar un problema.

                🔴 Y ANTES QUE NADA SE PREGUNTA SI A ESTA IDENTIDAD LE CORRESPONDE
                UNA. Una identidad de Centurión no tiene sesión de Cerberus ni la
                va a tener nunca, así que el aviso de arriba le miente en las tres
                palabras que importan: «perdió» (nunca la tuvo), «no registrar una
                venta» presentado como transitorio, y «hasta que vuelvas a entrar»
                (volver a entrar no la produce). Para ella el hecho es permanente,
                así que se dice como hecho y en gris, no como avería en ámbar.
                Es el mismo criterio que ya aplica `AvisoCerberus`. */}
            <p
              className={
                'mt-2.5 flex items-start gap-1.5 rounded-lg px-2 py-1.5 text-[11px] leading-snug ' +
                (cerberusVivo === false && tieneSesionDeCerberus(vendedora.id)
                  ? 'bg-warning/10 text-warning-foreground'
                  : 'bg-muted/60 text-muted-foreground')
              }
            >
              {!tieneSesionDeCerberus(vendedora.id) ? (
                <span>Esta cuenta entra con Centurión: no registra ventas en Cerberus.</span>
              ) : cerberusVivo === false ? (
                <>
                  <AlertTriangle size={12} className="mt-px shrink-0" />
                  <span>
                    Hermes perdió tu sesión de Cerberus. Vas a poder chatear, pero{' '}
                    <b>no registrar una venta</b> hasta que vuelvas a entrar.
                  </span>
                </>
              ) : cerberusVivo ? (
                <>
                  <Check size={12} className="mt-px shrink-0 text-success" />
                  <span>Conectada a Cerberus: podés registrar ventas.</span>
                </>
              ) : (
                <>
                  <UserRound size={12} className="mt-px shrink-0" />
                  <span>No se pudo confirmar la sesión de Cerberus.</span>
                </>
              )}
            </p>

            <div className="mt-2.5">
              <p className="text-[11px] font-semibold text-muted-foreground">Tus líneas</p>
              {mias.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {mias.map((l) => (
                    <li key={l.numero} className="flex items-center gap-1.5 text-[11px] text-foreground">
                      <Smartphone size={11} className="shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{l.etiqueta}</span>
                      {/* Decir cuál es del equipo importa: es la que explica por
                          qué le sigue apareciendo «Vincular tu WhatsApp». */}
                      {l.compartida === true && (
                        <span className="shrink-0 text-[10px] text-muted-foreground">del equipo</span>
                      )}
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{l.numero}</span>
                    </li>
                  ))}
                </ul>
              )}
              {mias.length === 0 && (
                <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                  No tenés ninguna asignada.
                </p>
              )}
              {/* 🔴 EL BOTÓN LO DECIDE «NO TENER PROPIA», NO «NO TENER NINGUNA».
                  Con la condición vieja (`mias.length === 0`) las SIETE personas
                  que comparten `51984429504` —Luz, Sindy y las cinco ventas1X@,
                  o sea el equipo entero— no veían este botón. Y no veían un
                  rechazo: no veían nada. Es la misma regla que el tope del
                  server (`numeros/autoVinculacion.ts`); si divergen, el botón
                  aparece y el POST contesta 409. */}
              {tienePropia !== true && (
                <button
                  type="button"
                  onClick={() => onVincular?.()}
                  className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-border py-1.5 text-[11px] font-bold text-foreground transition-colors hover:border-primary/50 hover:text-primary"
                >
                  <Smartphone size={12} /> Vincular tu WhatsApp
                </button>
              )}
            </div>

      <button
        type="button"
        onClick={onSalir}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-border py-1.5 text-[11px] font-bold text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive"
      >
        <LogOut size={12} /> Cerrar sesión
      </button>
    </>
  );
}

/** Las iniciales del nombre: dos letras, que es lo que entra en 36 px. */
function iniciales(nombre: string): string {
  return nombre
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}
