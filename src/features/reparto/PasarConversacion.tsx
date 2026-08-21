import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, UserRound } from 'lucide-react';
import { usePopover } from '../../lib/teclado/usePopover';
import { ErrorApi } from '../../lib/datos/cliente';
import { marcaDeDueno, rotuloDePersona } from '../../dominio/dueno';
import { useRueda, usePasarConversacion } from './reparto';
import type { Conversacion } from '../../dominio/conversaciones';

/**
 * «PASÁSELA A OTRA PERSONA» — de quién es esta conversación, y cómo cambiarlo.
 *
 * ── Por qué vive en la BarraGestion y no en el menú ▼ de la fila ──
 * El menú de la fila es, por su propio docblock, «la puerta única a las marcas
 * PERSONALES» (fijar · no leído · favoritos): cosas que solo ve quien las pone.
 * Pasar una conversación es lo contrario —una decisión del equipo, visible para
 * todos, con rastro de quién la tomó— y meterla ahí la dejaría a un clic de
 * distancia de tres acciones que no tienen consecuencias para nadie más.
 *
 * Acá, en cambio, está donde se decide qué hacer con ESTA conversación, al lado
 * de la etapa y los intereses, y con el chat a la vista: pasar un lead sin leer
 * de qué venía hablando es cómo se pasa un lead mal.
 *
 * ── Lo que NO es ──
 * **No es un permiso.** Cualquiera puede pasar cualquier conversación, incluso
 * una que no es suya: Hermes no tiene modelo de permisos y fingir uno acá sería
 * una frontera imaginaria (el mismo argumento de `cola/lineas.ts`). Lo que sí hay
 * es rastro — el server guarda quién la pasó.
 *
 * ── Cuándo NO aparece ──
 * Sin línea (un comentario de FB/IG), o si esa línea no tiene reparto configurado.
 * Un botón que abre una lista vacía no es una acción, es una promesa incumplida —
 * y con tres de las cuatro líneas sin reparto, sería la mayoría de las veces.
 */
export function PasarConversacion({
  conversacion,
  miVendedora,
}: {
  conversacion: Conversacion;
  /** Quién está mirando, para poder decir «Vos» en vez de tu propio username. */
  miVendedora?: string | null;
}) {
  const [abierto, setAbierto] = useState(false);
  const disparadorRef = useRef<HTMLButtonElement>(null);
  const numeroPropio = conversacion.numero_propio;
  const { destinos, rueda, nombres, hayReparto } = useRueda(numeroPropio);
  const pasar = usePasarConversacion();

  const cerrar = useCallback(() => {
    setAbierto(false);
    disparadorRef.current?.focus();
  }, []);
  const { propsOverlay } = usePopover(abierto, cerrar, { z: 'z-20' });

  // La barra NO se desmonta al cambiar de conversación: un panel abierto
  // sobreviviría apuntando a la de antes, y sus acciones son escrituras sobre
  // quién atiende a quién. Mismo cuidado que `MenuFila`.
  useEffect(() => {
    setAbierto(false);
    pasar.reset();
    // `pasar` es estable entre renders (react-query); depender de la clave alcanza.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversacion.clave]);

  if (!numeroPropio || !hayReparto) return null;

  const dueno = marcaDeDueno(conversacion, { yo: miVendedora });
  const cargaDe = (id: string) => rueda.find((r) => r.vendedoraId === id);

  return (
    <span className="relative">
      <button
        ref={disparadorRef}
        type="button"
        onClick={() => setAbierto((v) => !v)}
        title={
          dueno
            ? `${dueno.titulo} · tocá para pasársela a otra persona`
            : 'Esta conversación no tiene dueño: tocá para asignarla'
        }
        className={
          'flex h-7 items-center gap-1.5 rounded-md border px-2 text-sm font-normal ' +
          'transition-colors hover:border-primary/60 hover:text-foreground ' +
          (dueno ? 'border-navy/40 text-navy-ink' : 'border-dashed border-border text-muted-foreground')
        }
      >
        <UserRound size={14} className="shrink-0" aria-hidden="true" />
        {/* Sin dueño se dice «Sin asignar», no se deja el botón mudo: acá la
            ausencia SÍ es información —es la acción que falta hacer—, al revés
            que en la fila de la cola, donde serían 1.900 píldoras iguales. */}
        {dueno ? dueno.texto : 'Sin asignar'}
      </button>

      {abierto && (
        <>
          <div {...propsOverlay} />
          <div className="absolute left-0 top-full z-30 mt-1 w-56 rounded-xl border border-border bg-card p-1.5 shadow-panel">
            <p className="px-1.5 pb-1 text-[11px] font-semibold text-muted-foreground">Pasar la conversación a</p>
            {destinos.map((id) => {
              const carga = cargaDe(id);
              const esActual = conversacion.asignada_a === id;
              return (
                <button
                  key={id}
                  type="button"
                  disabled={esActual || pasar.isPending}
                  onClick={() =>
                    pasar.mutate(
                      { clave: conversacion.clave, numeroPropio, vendedoraId: id },
                      { onSuccess: cerrar },
                    )
                  }
                  className={
                    'flex w-full items-center justify-between gap-2 rounded-lg px-1.5 py-1.5 text-left text-xs ' +
                    'transition-colors hover:bg-secondary/60 disabled:opacity-50 disabled:hover:bg-transparent'
                  }
                >
                  {/* El NOMBRE de la persona cuando Hermes lo sabe; si no, su
                      username recortado, que es lo que se veía siempre. El
                      `title` lleva el username completo pase lo que pase: es
                      contra eso que se escribe la fila, y con dos personas de
                      nombre parecido es lo único que desempata. */}
                  <span className="truncate font-medium" title={id}>
                    {id === miVendedora
                      ? `${rotuloDePersona(id, nombres)} (vos)`
                      : rotuloDePersona(id, nombres)}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                    {/* La carga de cada uno, a la vista: pasarle la número 40 a
                        quien ya tiene 40 es exactamente lo que el round-robin
                        evita solo, y a mano no lo evita nadie si no se ve. */}
                    {esActual ? 'la tiene' : (carga?.asignadas ?? 0)}
                  </span>
                </button>
              );
            })}
            {pasar.isPending && (
              <p className="flex items-center gap-1 px-1.5 pt-1 text-[11px] text-muted-foreground">
                <Loader2 size={10} className="animate-spin" /> pasando…
              </p>
            )}
            {/* El 409 del server (username desconocido) se MUESTRA: es la red
                contra el dedazo, y tragárselo devolvería el fallo silencioso que
                esa guarda existe para impedir. */}
            {pasar.isError && (
              <p className="px-1.5 pt-1 text-[11px] text-destructive">
                {pasar.error instanceof ErrorApi ? pasar.error.message : 'No se pudo pasar. Probá de nuevo.'}
              </p>
            )}
          </div>
        </>
      )}
    </span>
  );
}
