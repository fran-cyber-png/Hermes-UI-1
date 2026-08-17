import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/datos/cliente';

/**
 * LAS LÍNEAS DE WHATSAPP QUE ESTÁN CORRIENDO (#50) — para poder recortar la cola
 * a una sola.
 *
 * Existe porque el equipo dejó de vender por un solo número: la línea de la
 * Escuela y la de cada vendedora entran a la MISMA cola, y sin forma de
 * separarlas cada una lee la conversación de la otra para llegar a la suya.
 *
 * Lo que llega es lo que el gestor tiene VIVO, no lo que Cerberus registró:
 * ofrecer como filtro una línea que no arrancó daría una cola vacía sin decir
 * por qué (`server/src/routes/whatsapp.ts`).
 */
export interface LineaWhatsapp {
  /** El número propio, canónico (solo dígitos con código de país). */
  numero: string;
  /** El nombre visible («Walter»). Cae al número si nadie lo registró. */
  etiqueta: string;
  estado: string;
  /**
   * ¿`numero_vendedora` le asigna ESTA línea a quien está logueada? Es lo único
   * que el front necesita saber del mapa: los números de «las mías» los resuelve
   * el server (`?mias=1`), acá solo se decide si la opción se ofrece.
   * Opcional: un server viejo no manda el campo → la opción no aparece → se ve
   * todo, que es el comportamiento de siempre.
   */
  mias?: boolean;
  /**
   * ¿La atienden VARIAS personas? La línea de Meta (`51984429504`) tiene siete,
   * y por eso NO es «su línea»: no se la trajo ella y no la puede retirar.
   *
   * 🔴 Es lo que separa «ya tiene línea» de «atiende la del equipo». Sin este
   * campo, el panel le escondía «Vincular tu WhatsApp» a las siete personas que
   * comparten esa línea — o sea a todo el equipo de ventas — y sin decir nada.
   *
   * Opcional: un server viejo no lo manda → `undefined` → se trata como NO
   * compartida, que es el comportamiento anterior. Nunca se asume compartida
   * por defecto: eso ofrecería vincular a quien ya tiene la suya.
   */
  compartida?: boolean;
}

export function useLineas() {
  const q = useQuery({
    queryKey: ['lineas-whatsapp'],
    queryFn: () => api<{ lineas: LineaWhatsapp[] }>('/api/whatsapp/lineas'),
    // Las líneas cambian cuando alguien vincula un número, o sea casi nunca y
    // nunca sin que una persona lo provoque. Refrescarlas con el pulso de la
    // cola sería una consulta por minuto para un dato que dura semanas.
    staleTime: 5 * 60_000,
  });

  const lineas = q.data?.lineas ?? [];
  return {
    lineas,
    /**
     * Con UNA sola línea el filtro no existe: un selector de un solo elemento no
     * es una elección, es ruido en una barra que ya está llena. Aparece solo
     * cuando hay algo que separar — que es también cómo esta app se comportaba
     * antes de que hubiera dos.
     */
    hayVarias: lineas.length > 1,
    /**
     * ¿Tiene sentido ofrecerle «Las mías»? Solo si el mapa le asigna alguna
     * línea VIVA. Sin eso el botón existiría y no cambiaría nada — la misma
     * regla del selector: una opción que no es una elección es ruido. Y como el
     * server ya devuelve `mias: false` cuando no pudo leer el mapa, esto también
     * es el fail-open: sin dato, no hay opción y se ve todo.
     */
    hayMias: lineas.some((l) => l.mias === true),
    /**
     * Sus líneas PROPIAS: las suyas que no comparte con nadie. Es lo que el
     * panel mira para decidir si le ofrece traer una — la línea del equipo
     * no cuenta, misma regla que el tope del server
     * (`numeros/autoVinculacion.ts`). Con dos reglas distintas, el botón
     * aparecería y el POST contestaría 409.
     */
    propias: lineas.filter((l) => l.mias === true && l.compartida !== true),
    cargando: q.isPending,
  };
}
