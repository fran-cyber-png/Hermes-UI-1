import { useEffect, useRef, useState } from 'react';
import { QUIETO, motivoDelFallo, type EstadoGuardado } from './guardado';
import type { Nota } from './notas';

/** Cuánto se espera después de la última tecla para guardar. */
export const ESPERA_AUTOGUARDADO_MS = 800;

/**
 * A DÓNDE VA LO QUE SE ESTÁ ESCRIBIENDO.
 *
 * `null` = no hay nada editable abierto (nada seleccionado, o una página
 * histórica de `gestiones`, que es de solo lectura y **cuyo id es de otra
 * tabla**: mandarlo a `PATCH /api/notas/:id` escribiría sobre la nota que
 * casualmente tenga ese número).
 */
export type DestinoDeGuardado = { tipo: 'nueva' } | { tipo: 'nota'; id: number } | null;

/**
 * LO QUE SE GUARDA DE UNA PÁGINA: el documento y la capa de anotaciones.
 *
 * Los dos son OPCIONALES y viajan juntos a propósito. Cada uno cambia por su
 * lado —el texto al teclear, la capa al dibujar— pero el guardado es uno solo:
 * con dos autoguardados independientes, escribir y dibujar en la misma página
 * dispararía dos PATCH en la misma ventana de 800 ms sobre la misma fila.
 *
 * Un campo `undefined` **no viaja** (`JSON.stringify` lo omite), y el server
 * trata la ausencia como «no lo toques»: dibujar sobre una página no reescribe
 * su texto, y escribir no borra lo dibujado.
 */
export interface ContenidoDePagina {
  doc?: unknown;
  anotaciones?: unknown;
  /**
   * EL DIAGRAMA de una página `tipo = 'diagrama'`. Va en el MISMO sobre que
   * `doc` y `anotaciones` por el mismo motivo que ellos: un guardado que sólo
   * trae una de las tres no puede pisar las otras dos. Una página es un diagrama
   * O un documento, nunca las dos, pero las anotaciones cruzan a las dos.
   */
  diagrama?: unknown;
}

/** Lo que el hook necesita del mundo. Inyectado para poder testearlo sin server. */
export interface PuertasDeGuardado {
  actualizar(v: { id: number } & ContenidoDePagina): Promise<unknown>;
  crear(v: ContenidoDePagina): Promise<{ nota: Nota }>;
}

export interface Autoguardado {
  estado: EstadoGuardado;
  /** Lo llaman el editor y la capa en cada cambio. Agenda el guardado y lo agrupa. */
  alCambiar(contenido: ContenidoDePagina): void;
}

/**
 * EL AUTOGUARDADO DE LA LIBRETA.
 *
 * ══ LA REGLA QUE LO ORDENA TODO ═════════════════════════════════════════════
 *
 * **El destino se captura cuando se AGENDA, no cuando se dispara.**
 *
 * Parece un detalle y es la causa de cuatro defectos distintos, todos con la
 * misma forma: los 800 ms de espera son tiempo suficiente para que la vendedora
 * cambie de página, y el guardado salía hacia «lo que esté abierto ahora».
 *
 *   · escribo en A, toco B → el texto de A se guardaba **en B**;
 *   · escribo en A, toco «Nueva página» → en vez de guardar A, **duplicaba A**;
 *   · escribo en A, abro una página histórica → `PATCH` con el id de `gestiones`,
 *     que en `notas` es **otra nota mía**;
 *   · escribo en A, la archivo → se creaba una página **fantasma**.
 *
 * Con el destino capturado, cada guardado va a donde se escribió. Punto.
 *
 * ══ Y LO QUE CAE MIENTRAS SE ESTÁ CREANDO NO SE TIRA ════════════════════════
 *
 * La primera vez que se escribe en una página nueva sale un POST. Ese POST
 * espera además el refetch de la lista, así que contra VPS1 pasa de los 800 ms
 * sin esfuerzo — y garantizado en el primer request después de un restart.
 * Lo que se teclee mientras tanto **no se puede crear otra vez** (serían dos
 * páginas), pero tampoco se puede descartar: se guarda como `ultimoContenido` y
 * se manda apenas se sabe el id.
 *
 * Descartarlo en silencio era el mismo falso «Guardado» que este archivo
 * existe para matar, entrando por una puerta más chica.
 */
export function useAutoguardado({
  destino,
  puertas,
  alCrear,
}: {
  destino: DestinoDeGuardado;
  puertas: PuertasDeGuardado;
  /** Avisa qué id le tocó a la página recién creada, para que la lista la siga. */
  alCrear(id: number): void;
}): Autoguardado {
  const [estado, setEstado] = useState<EstadoGuardado>(QUIETO);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Lo que el temporizador va a hacer cuando venza. Existe para poder ADELANTARLO. */
  const pendiente = useRef<(() => Promise<void>) | null>(null);

  /**
   * LA CREACIÓN EN VUELO. `null` = no hay ninguna.
   *
   * `ultimoContenido` es lo que se tecleó —o dibujó— mientras el POST viajaba:
   * se manda apenas vuelve el id, con un `PATCH`. Sin esto se perdía sin aviso.
   */
  const creacion = useRef<{ ultimoContenido: ContenidoDePagina; huboMas: boolean } | null>(null);

  /**
   * EL ID QUE LE TOCÓ A LA PÁGINA NUEVA QUE SE ESTÁ EDITANDO.
   *
   * Hace falta además del destino capturado, y por un motivo distinto: un
   * guardado agendado como `{tipo:'nueva'}` puede vencer DESPUÉS de que el POST
   * ya terminó. Ahí no hay creación en vuelo que lo frene, y sin esto volvería
   * a crear — la doble página otra vez.
   *
   * Se olvida al ENTRAR a una página en blanco (`clave` pasa a `'nueva'`), no
   * en cualquier cambio: entre crear y que la selección pase a `nota`, los
   * guardados tardíos todavía tienen que caer en la que se acaba de crear.
   */
  const ultimaCreada = useRef<number | null>(null);

  const destinoRef = useRef(destino);
  destinoRef.current = destino;
  const alCrearRef = useRef(alCrear);
  alCrearRef.current = alCrear;
  const puertasRef = useRef(puertas);
  puertasRef.current = puertas;

  // Cambió la página: el estado de la anterior no describe a esta. Sin esto,
  // abrir una página nueva mostraba «Guardado» heredado de la que se venía.
  const destinoPrevio = useRef(destino);
  const claveDestino = destino === null ? 'nada' : destino.tipo === 'nueva' ? 'nueva' : `n${destino.id}`;
  const clavePrevia = useRef(claveDestino);
  if (clavePrevia.current !== claveDestino) {
    const empiezaUnaEnBlanco = claveDestino === 'nueva';
    /**
     * `nueva → n42` NO es cambiar de página: es la MISMA que acaba de recibir su
     * id al crearse. Resetear ahí hacía parpadear el indicador a vacío justo
     * después de guardar bien — decía «Guardado» y se borraba solo.
     */
    const esLaMismaQueSeAcabaDeCrear =
      clavePrevia.current === 'nueva' && claveDestino === `n${ultimaCreada.current}`;

    clavePrevia.current = claveDestino;
    destinoPrevio.current = destino;
    if (empiezaUnaEnBlanco) ultimaCreada.current = null;
    if (!esLaMismaQueSeAcabaDeCrear) {
      // No se pisa un FALLO: si lo último que pasó fue que no se pudo guardar,
      // eso sigue siendo verdad y la vendedora tiene que verlo.
      setEstado((e) => (e.tipo === 'fallo' ? e : QUIETO));
    }
  }

  /**
   * AL IRSE, LO QUE ESTABA POR GUARDARSE SE GUARDA.
   *
   * Se dispara y no se espera: el desmontaje no puede esperar a la red. La
   * mutación sale igual porque el `QueryClient` es el de la app, no el del
   * componente (fijado en `guardadoAlSalir.test.tsx`).
   */
  useEffect(
    () => () => {
      if (temporizador.current) clearTimeout(temporizador.current);
      void pendiente.current?.();
    },
    [],
  );

  function alCambiar(contenido: ContenidoDePagina) {
    // EL DESTINO, AHORA. Lo que se escriba va a donde se está escribiendo,
    // aunque la vendedora cambie de página antes de que venza la espera.
    const aDonde = destinoRef.current;
    if (aDonde === null) return; // histórica o nada abierto: no hay dónde guardar

    if (temporizador.current) clearTimeout(temporizador.current);
    setEstado({ tipo: 'guardando' });

    const guardar = async () => {
      pendiente.current = null;
      try {
        if (aDonde.tipo === 'nota') {
          await puertasRef.current.actualizar({ id: aDonde.id, ...contenido });
          setEstado({ tipo: 'guardado' });
          return;
        }

        // ── Página nueva ──
        // Ya se creó y este guardado venía agendado de antes: va como update.
        if (ultimaCreada.current !== null && !creacion.current) {
          await puertasRef.current.actualizar({ id: ultimaCreada.current, ...contenido });
          setEstado({ tipo: 'guardado' });
          return;
        }
        if (creacion.current) {
          // Ya hay un POST viajando: esto no puede crear otra página, pero
          // tampoco se tira. Se manda apenas se sepa el id.
          creacion.current.ultimoContenido = contenido;
          creacion.current.huboMas = true;
          return;
        }

        creacion.current = { ultimoContenido: contenido, huboMas: false };
        try {
          const r = await puertasRef.current.crear(contenido);
          ultimaCreada.current = r.nota.id;
          alCrearRef.current(r.nota.id);
          // Lo que se tecleó mientras el POST viajaba, ahora que hay id.
          if (creacion.current?.huboMas) {
            await puertasRef.current.actualizar({ id: r.nota.id, ...creacion.current.ultimoContenido });
          }
        } finally {
          creacion.current = null;
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
