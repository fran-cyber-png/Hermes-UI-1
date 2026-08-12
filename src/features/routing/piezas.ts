import type { CableLienzo, ColumnaLienzo, NodoLienzo } from './reglasDelLienzo';
import type { FotoDeRouting } from './routing';

/**
 * DE LOS DATOS DEL SERVER AL LIENZO — puro, y por eso testeable sin montar nada.
 *
 * 🔴 **Los ids del lienzo llevan namespace** (`campana:`, `curso:`, `prod:`,
 * `v:`) y no es decoración: al soltar un cable hay que saber a qué endpoint va
 * (`/campanas/:id`, `/cursos`, `/productos`) y el nombre de un curso puede
 * parecerse a cualquier cosa. Sin el prefijo, «Diploma…» y una familia no se
 * distinguen y el guardado pega en la ruta equivocada.
 */

export const ID = {
  producto: (familia: string) => `prod:${familia}`,
  campana: (id: string) => `campana:${id}`,
  curso: (curso: string) => `curso:${curso}`,
  vendedora: (v: string) => `v:${v}`,
};

/** Vuelve del id del lienzo al par (tipo, clave). El `slice` y no `split`: los cursos tienen `:` adentro. */
export function leerId(id: string): { tipo: string; clave: string } {
  const corte = id.indexOf(':');
  return corte < 0 ? { tipo: id, clave: '' } : { tipo: id.slice(0, corte), clave: id.slice(corte + 1) };
}

/** Una pieza: una campaña de Meta o un curso de formulario. Es donde vive la regla. */
export interface Pieza {
  id: string;
  titulo: string;
  icono: 'campana' | 'formulario';
  pie: string;
  estado?: 'activa' | 'pausada' | 'desconocido';
  familia: string | null;
  volumen: number;
  vendedoras: string[];
}

/**
 * QUÉ PIEZA ESTÁ ABIERTA Y QUÉ TIENE ADENTRO.
 *
 * 🔴 **TRES ESTADOS, NO DOS: `cargando` · `fallo` · «no hay».** Una campaña
 * cuyos anuncios todavía no llegaron, una a la que no se le pudo preguntar, y
 * una que de verdad no trajo a nadie, **se ven igual desde acá** si el tipo solo
 * distingue lista-vacía de lista-llena. Decir «ningún anuncio suyo trajo gente»
 * cuando el pedido falló es afirmar algo falso sobre la pauta — y sobre eso se
 * decide si un adset se apaga. Es la misma regla que el resto de la casa:
 * «no se pudo preguntar» no es «no hay».
 */
export interface Apertura {
  id: string | null;
  anuncios: readonly { adId: string; titular: string | null; personas: number }[];
  cargando: boolean;
  fallo?: boolean;
}

const CERRADO: Apertura = { id: null, anuncios: [], cargando: false };

const ROTULO_ESTADO = { activa: 'Activa', pausada: 'Pausada', desconocido: 'No se sabe' } as const;

/** Todas las piezas de la foto, en un solo vocabulario. */
export function piezasDe(data: FotoDeRouting): Pieza[] {
  return [
    ...data.campanas.map((c) => ({
      id: ID.campana(c.campanaId),
      titulo: c.nombre,
      icono: 'campana' as const,
      pie: `${ROTULO_ESTADO[c.estado]} · ${c.personas} ${c.personas === 1 ? 'persona' : 'personas'}`,
      estado: c.estado,
      familia: c.familia,
      volumen: c.personas,
      vendedoras: c.vendedoras,
    })),
    ...(data.cursos ?? []).map((c) => ({
      id: ID.curso(c.curso),
      titulo: c.curso,
      icono: 'formulario' as const,
      pie: `${c.leads} ${c.leads === 1 ? 'formulario' : 'formularios'}`,
      familia: c.familia,
      volumen: c.leads,
      vendedoras: c.vendedoras,
    })),
  ];
}

/** Un producto con lo que le entra. Vacío si ninguna de sus piezas llegó a esta línea. */
export interface Producto {
  familia: string;
  nombre: string;
  piezas: Pieza[];
  volumen: number;
}

export function productosDe(data: FotoDeRouting, piezas: Pieza[]): Producto[] {
  return (data.productos ?? [])
    .map((p) => {
      const suyas = piezas.filter((x) => x.familia === p.familia);
      return { ...p, piezas: suyas, volumen: suyas.reduce((n, x) => n + x.volumen, 0) };
    })
    .filter((p) => p.piezas.length > 0)
    // Primero lo que más gente trae. A igualdad, alfabético: dos aperturas de la
    // pantalla no pueden mostrar dos órdenes distintos.
    .sort((a, b) => b.volumen - a.volumen || a.nombre.localeCompare(b.nombre, 'es'));
}

/**
 * LOS CABLES DE REGLA QUE HAY HOY: cada pieza hacia sus vendedoras.
 *
 * 🔴 **EL DESTINO SE RESUELVE CONTRA LA LISTA DE LA COLUMNA, NORMALIZANDO.** En
 * producción el mismo humano tiene dos grafías vivas (`Luz` es lo que empuja
 * Cerberus, `luz` lo que se tipea al entrar; y hay `Usuario1`/`usuario1`). Si el
 * cable guardado dice `Luz` y el nodo de la columna se llama `v:luz`, el cable
 * apunta a un nodo que no existe: **no se dibuja, no se puede cortar, y la fila
 * de la izquierda igual dice que esa campaña es de alguien**. Sin error, sin log.
 *
 * Se compara normalizado y se usa **la grafía de la columna** para el id, que es
 * la que el lienzo conoce. Lo guardado no se toca: reescribirlo rompería el cruce
 * con `gestiones` (la lección de `reparto/destino.ts`).
 *
 * ⚠️ Un cable hacia alguien que **no está en los destinos posibles** se descarta
 * a propósito: dibujarlo obligaría a inventarle un nodo, y ese nodo sería una
 * persona que la pantalla ofrece y el server rechaza con 409.
 */
export function cablesDe(piezas: readonly Pieza[], destinos: readonly string[]): CableLienzo[] {
  const porNormal = new Map(destinos.map((d) => [d.trim().toLowerCase(), d]));
  return piezas.flatMap((p) =>
    p.vendedoras.flatMap((v) => {
      const enLaColumna = porNormal.get(v.trim().toLowerCase());
      return enLaColumna
        ? [{ de: p.id, a: ID.vendedora(enLaColumna), tipo: 'regla' as const }]
        : [];
    }),
  );
}

/**
 * A quién NO se le pudo dibujar el cable. Es lo que evita que la ausencia sea
 * muda: si una pieza tiene una vendedora que no está entre los destinos, la
 * pantalla lo dice en vez de mostrar la pieza como si no tuviera cables.
 */
export function cablesHuerfanos(piezas: readonly Pieza[], destinos: readonly string[]): string[] {
  const porNormal = new Set(destinos.map((d) => d.trim().toLowerCase()));
  return [
    ...new Set(
      piezas.flatMap((p) => p.vendedoras.filter((v) => !porNormal.has(v.trim().toLowerCase()))),
    ),
  ].sort((a, b) => a.localeCompare(b, 'es'));
}

const COL_VENDEDORAS = (destinos: readonly string[]): ColumnaLienzo => ({
  id: 'vendedoras',
  titulo: 'Vendedoras',
  ancho: 12,
  nodos: destinos.map((d) => ({
    id: ID.vendedora(d),
    titulo: nombreCortoLocal(d),
    icono: 'vendedora' as const,
    // Lo único que recibe cables. No tiene salida: acá termina el flujo.
    entrada: true,
  })),
});

/**
 * EL CABLE DEL PRODUCTO ENTERO — existe **solo si TODAS sus piezas lo tienen**.
 *
 * 🔴 **Se DERIVA, no se guarda**, y por eso no hace falta una tercera tabla que
 * se pueda desincronizar: cablear el producto escribe en cada pieza (decisión
 * del dueño en `server/src/routing/producto.ts`), así que «el producto va a
 * Luz» es exactamente «todas sus piezas van a Luz». Es la misma familia de
 * decisiones que la etapa efectiva (ADR 0044) y las señales (ADR 0016).
 *
 * ⚠️ Con una pieza que no lo tiene, el cable del producto **no se dibuja** — y
 * eso es correcto: dibujarlo diría «todas», y sería falso. La mezcla se ve en
 * los cables de cada pieza, que están a la vista al lado.
 */
export function cablesDeProducto(
  producto: Producto,
  cables: readonly CableLienzo[],
): CableLienzo[] {
  if (producto.piezas.length === 0) return [];
  const suyas = producto.piezas.map((p) => p.id);
  const hay = (de: string, a: string) =>
    cables.some((c) => c.tipo === 'regla' && c.de === de && c.a === a);
  const candidatas = [
    ...new Set(cables.filter((c) => c.tipo === 'regla' && suyas.includes(c.de)).map((c) => c.a)),
  ];
  return candidatas
    .filter((a) => suyas.every((id) => hay(id, a)))
    .sort((x, y) => x.localeCompare(y, 'es'))
    .map((a) => ({ de: ID.producto(producto.familia), a, tipo: 'regla' as const }));
}

/** «1 campañas» se lee como un error de la pantalla, no como un dato. */
function cuantas(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`;
}

/** El `nombreCorto` de la libreta vive en un módulo con react-query; acá alcanza esto. */
function nombreCortoLocal(vendedoraId: string): string {
  const sinDominio = vendedoraId.includes('@') ? vendedoraId.slice(0, vendedoraId.indexOf('@')) : vendedoraId;
  return sinDominio.trim() || vendedoraId;
}

/**
 * LAS COLUMNAS DE UN PRODUCTO: él, sus piezas, las vendedoras.
 *
 * ⚠️ El cable producto → pieza es de PERTENENCIA: lo decide el catálogo
 * (`alias_curso`), no una persona. Va punteado y no se puede cortar — dibujarlo
 * igual que una regla haría creer que el catálogo se edita tirando de un cable.
 */
export function columnasDeProducto(
  producto: Producto,
  destinos: readonly string[],
  apertura: Apertura = CERRADO,
): { columnas: ColumnaLienzo[]; pertenencia: CableLienzo[] } {
  const id = ID.producto(producto.familia);
  const campanas = producto.piezas.filter((p) => p.icono === 'campana').length;
  const formularios = producto.piezas.length - campanas;
  return {
    columnas: [
      {
        id: 'producto',
        titulo: 'El producto',
        ancho: 17,
        nodos: [
          {
            id,
            titulo: producto.nombre,
            icono: 'producto',
            pie: `${producto.volumen} leads · ${cuantas(campanas, 'campaña', 'campañas')} · ${cuantas(formularios, 'formulario', 'formularios')}`,
            /**
             * 🔴 **El puerto del producto va DERECHO a la vendedora, saltándose
             * sus piezas** — pedido del dueño el 12-ago-2026: *«si quiero
             * enlazar de frente el producto con la vendedora que se haga las
             * conexiones automáticamente»*. Lo que se guarda sigue siendo un
             * cable por pieza (no hay regla de producto, `producto.ts`), así
             * que al soltar aparecen los N cables de abajo: el gesto es masivo
             * y **el resultado es visible pieza por pieza**.
             */
            salida: true,
          },
        ],
      },
      {
        id: 'piezas',
        titulo: 'Lo que le entra',
        ancho: 17,
        nodos: producto.piezas.map((p) => aNodo(p, apertura)),
      },
      COL_VENDEDORAS(destinos),
    ],
    pertenencia: producto.piezas.map((p) => ({ de: id, a: p.id, tipo: 'pertenencia' as const })),
  };
}

/**
 * Las columnas de una pieza suelta: ella y las vendedoras.
 *
 * ⚠️ Sin columna de producto **a propósito**: acá se cae quien no resuelve
 * ninguna familia (25 de 44 campañas de Meta). Inventarle un producto vacío para
 * que las dos pantallas se vean iguales diría que pertenece a algo.
 */
export function columnasDePieza(
  pieza: Pieza,
  destinos: readonly string[],
  apertura: Apertura = CERRADO,
): ColumnaLienzo[] {
  return [
    { id: 'pieza', titulo: 'Sin producto', ancho: 17, nodos: [aNodo(pieza, apertura)] },
    COL_VENDEDORAS(destinos),
  ];
}

/**
 * UNA PIEZA COMO NODO, con lo que tenga adentro si está abierta.
 *
 * 🔴 **Solo las campañas se abren, y los anuncios NO son un puerto.** No existe
 * una regla por anuncio: el reparto resuelve `ad_id → campaña → vendedoras`, así
 * que el anuncio es de dónde VIENE la persona, no algo que se cablee. Dibujarlo
 * con puerto prometería un control que el server no tiene — por eso `adentro` es
 * una lista de solo lectura dentro del nodo y no una columna con puertos.
 *
 * ⚠️ El pie dice **las vendedoras si las hay**, y el dato de volumen si no: el
 * lienzo existe para contestar «¿a quién le cae esto?», y con el volumen siempre
 * arriba había que seguir el cable con el ojo para saberlo.
 */
function aNodo(p: Pieza, apertura: Apertura = CERRADO): NodoLienzo {
  const abrible = p.icono === 'campana';
  const abierto = abrible && apertura.id === p.id;
  return {
    id: p.id,
    titulo: p.titulo,
    icono: p.icono,
    pie: p.vendedoras.length ? p.vendedoras.map(nombreCortoLocal).join(', ') : p.pie,
    estado: p.estado,
    // Sale hacia las vendedoras. NO recibe: el cable del producto es de
    // pertenencia y lo decide el catálogo, no un arrastre.
    salida: true,
    abrible,
    abierto,
    cargando: abierto && apertura.cargando,
    fallo: abierto && Boolean(apertura.fallo),
    adentro: abierto
      ? apertura.anuncios.map((a) => ({
          id: `anuncio:${a.adId}`,
          titulo: a.titular ?? '(sin titular)',
          pie: `${a.personas} ${a.personas === 1 ? 'persona' : 'personas'}`,
        }))
      : undefined,
  };
}
