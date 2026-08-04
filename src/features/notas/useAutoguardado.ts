import { useEffect, useRef, useState } from 'react';
import { QUIETO, motivoDelFallo, type EstadoGuardado } from './guardado';
import type { Nota } from './notas';

/** Cuánto se espera después de la última tecla para guardar. */
export const ESPERA_AUTOGUARDADO_MS = 800;

/** Lo que el hook necesita del mundo. Inyectado para poder testearlo sin server. */
export interface PuertasDeGuardado {
  /** Actualiza una página que ya existe. */
  actualizar(v: { id: number; doc: unknown }): Promise<unknown>;
  /** Crea la página en blanco recién cuando se escribió algo. */
  crear(v: { doc: unknown }): Promise<{ nota: Nota }>;
}

export interface Autoguardado {
  estado: EstadoGuardado;
  /** Lo llama el editor en cada cambio. Agenda el guardado y lo agrupa. */
  alCambiar(doc: unknown): void;
}

/**
 * EL AUTOGUARDADO DE LA LIBRETA — con espera, con adelanto al salir, y con el
 * fallo VISIBLE.
 *
 * Vivía suelto adentro de `Libreta.tsx`, y de ahí salieron tres defectos que
 * ningún test podía ver porque no había nada que interrogar:
 *
 *  1. **El error se tragaba.** Un `catch {}` y un renglón de estado sin rama de
 *     fallo: pasado el tope de 2.000 caracteres, todos los guardados fallaban y
 *     la pantalla decía «Guardado». Ahora el fallo es un estado, y quién lo lee
 *     es una función pura (`renglonDeEstado`).
 *  2. **La doble creación.** `guardar` decidía crear-o-actualizar mirando la
 *     selección, y la selección recién cambiaba cuando resolvía el POST —que a
 *     su vez espera el refetch de la lista—. Dos disparos dentro de esa ventana
 *     creaban **dos páginas**. Acá lo cierra `creando`, que es un ref y no un
 *     estado a propósito: tiene que valer YA, en el mismo tick, no en el
 *     próximo render.
 *  3. **Lo pendiente se perdía al salir.** El cleanup solo limpiaba el
 *     temporizador. Como vista del riel se sale con ⌘1..⌘8 y con un clic en
 *     cualquier ícono, así que la ventana de 800 ms se abre de par en par.
 *     Ahora el desmontaje ADELANTA lo que estaba por guardarse.
 */
export function useAutoguardado({
  idActual,
  puertas,
  alCrear,
}: {
  /** `null` = página nueva todavía sin fila en la base. */
  idActual: number | null;
  puertas: PuertasDeGuardado;
  /** Avisa qué id le tocó a la página recién creada, para que la lista la siga. */
  alCrear(id: number): void;
}): Autoguardado {
  const [estado, setEstado] = useState<EstadoGuardado>(QUIETO);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Lo que el temporizador va a hacer cuando venza. Existe para poder ADELANTARLO. */
  const pendiente = useRef<(() => Promise<void>) | null>(null);
  /** ¿Hay un POST de creación en vuelo? Ref y no estado: tiene que valer en el mismo tick. */
  const creando = useRef(false);

  // Lo último que se sabe, leído dentro del closure del temporizador: sin esto,
  // un guardado agendado antes de cambiar de página escribiría en la anterior.
  const idRef = useRef(idActual);
  idRef.current = idActual;

  /**
   * EL ID DE LA PÁGINA QUE ACABAMOS DE CREAR, sin esperar al render.
   *
   * `idActual` llega por props y solo cambia cuando React vuelve a pintar. Entre
   * que el POST resuelve y ese repintado ocurre hay una ventana —chica pero
   * real— en la que un guardado nuevo ve `idActual === null` y **crea una
   * segunda página**. Con `creando` sola no alcanza: para entonces el POST ya
   * terminó, así que la bandera está en `false`.
   *
   * Lo encontró el test de la doble creación, no la lectura del código.
   */
  const idCreado = useRef<number | null>(null);

  // Cambió la página desde afuera (otra nota, o «Nueva página»): lo que
  // habíamos creado localmente ya no aplica. Sin esto, empezar una página nueva
  // después de crear una escribiría encima de la anterior.
  const idPrevio = useRef(idActual);
  if (idPrevio.current !== idActual) {
    idPrevio.current = idActual;
    idCreado.current = null;
  }
  const alCrearRef = useRef(alCrear);
  alCrearRef.current = alCrear;
  const puertasRef = useRef(puertas);
  puertasRef.current = puertas;

  /**
   * AL IRSE, LO QUE ESTABA POR GUARDARSE SE GUARDA.
   *
   * Se dispara y no se espera: el desmontaje no puede esperar a la red. La
   * mutación sale igual porque el `QueryClient` es el de la app, no el del
   * componente — sobrevive a que este se vaya (fijado en `guardadoAlSalir.test.tsx`).
   */
  useEffect(
    () => () => {
      if (temporizador.current) clearTimeout(temporizador.current);
      void pendiente.current?.();
    },
    [],
  );

  function alCambiar(doc: unknown) {
    if (temporizador.current) clearTimeout(temporizador.current);
    setEstado({ tipo: 'guardando' });

    const guardar = async () => {
      pendiente.current = null;
      // El de afuera manda; si todavía no llegó, vale el que acabamos de crear.
      const id = idRef.current ?? idCreado.current;

      // Segundo disparo mientras el primero está en vuelo: si se dejara pasar,
      // los dos verían `id === null` y crearían una página cada uno.
      if (id === null && creando.current) return;

      try {
        if (id !== null) {
          await puertasRef.current.actualizar({ id, doc });
        } else {
          creando.current = true;
          try {
            const r = await puertasRef.current.crear({ doc });
            // Primero el ref, DESPUÉS el aviso: entre el aviso y el repintado
            // hay una ventana en la que otro guardado podría volver a crear.
            idCreado.current = r.nota.id;
            alCrearRef.current(r.nota.id);
          } finally {
            creando.current = false;
          }
        }
        setEstado({ tipo: 'guardado' });
      } catch (e) {
        // Se DICE. Lo escrito no se pierde —el editor conserva su documento—,
        // pero la vendedora tiene que saber que no está guardado.
        setEstado({ tipo: 'fallo', motivo: motivoDelFallo(e) });
      }
    };

    pendiente.current = guardar;
    temporizador.current = setTimeout(guardar, ESPERA_AUTOGUARDADO_MS);
  }

  return { estado, alCambiar };
}
