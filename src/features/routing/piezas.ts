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
  /** Solo las campañas se pueden abrir: son las únicas que tienen anuncios adentro. */
  entrar?: string;
}

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
      entrar: ID.campana(c.campanaId),
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

/** Los cables de REGLA que hay hoy: cada pieza hacia sus vendedoras. */
export function cablesDe(piezas: readonly Pieza[]): CableLienzo[] {
  return piezas.flatMap((p) =>
    p.vendedoras.map((v) => ({ de: p.id, a: ID.vendedora(v), tipo: 'regla' as const })),
  );
}

const COL_VENDEDORAS = (destinos: readonly string[]): ColumnaLienzo => ({
  id: 'vendedoras',
  titulo: 'Vendedoras',
  ancho: 12,
  nodos: destinos.map((d) => ({
    id: ID.vendedora(d),
    titulo: nombreCortoLocal(d),
    icono: 'vendedora' as const,
  })),
});

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
): { columnas: ColumnaLienzo[]; pertenencia: CableLienzo[] } {
  const id = ID.producto(producto.familia);
  return {
    columnas: [
      {
        id: 'producto',
        ancho: 13,
        nodos: [
          {
            id,
            titulo: producto.nombre,
            icono: 'producto',
            pie: `${producto.piezas.filter((p) => p.icono === 'campana').length} campañas · ${producto.piezas.filter((p) => p.icono === 'formulario').length} formularios`,
          },
        ],
      },
      { id: 'piezas', titulo: 'Lo que le entra', ancho: 16, nodos: producto.piezas.map(aNodo) },
      COL_VENDEDORAS(destinos),
    ],
    pertenencia: producto.piezas.map((p) => ({ de: id, a: p.id, tipo: 'pertenencia' as const })),
  };
}

/** Las columnas de una pieza suelta: ella y las vendedoras. */
export function columnasDePieza(pieza: Pieza, destinos: readonly string[]): ColumnaLienzo[] {
  return [
    { id: 'pieza', ancho: 16, nodos: [aNodo(pieza)] },
    COL_VENDEDORAS(destinos),
  ];
}

/**
 * EL NIVEL DE ADENTRO DE UNA CAMPAÑA: sus anuncios, ella, y las vendedoras.
 *
 * 🔴 **Los anuncios van A LA IZQUIERDA de la campaña, y no a la derecha.** El
 * lienzo se lee en el sentido del flujo, y el flujo real es
 * `anuncio → campaña → vendedora`: el anuncio es de donde VIENE la persona. Con
 * los anuncios a la derecha, el cable de la regla tendría que cruzarlos para
 * llegar a las vendedoras, y el dibujo diría que la campaña le manda algo al
 * anuncio.
 *
 * ⚠️ **Sin puerto de salida conectable**: no existe una regla por anuncio (el
 * reparto resuelve `ad_id → campaña → vendedoras`), así que el cable
 * anuncio → campaña es de PERTENENCIA. Dibujarlo conectable prometería un
 * control que el server no tiene.
 */
export function columnasDeCampanaAdentro(
  campana: Pieza,
  anuncios: readonly { adId: string; titular: string | null; personas: number }[],
  destinos: readonly string[],
): { columnas: ColumnaLienzo[]; pertenencia: CableLienzo[] } {
  const idAnuncio = (adId: string) => `anuncio:${adId}`;
  return {
    columnas: [
      {
        id: 'anuncios',
        titulo: 'Sus anuncios',
        ancho: 15,
        nodos: anuncios.map((a) => ({
          id: idAnuncio(a.adId),
          titulo: a.titular ?? '(sin titular)',
          icono: 'campana' as const,
          pie: `${a.personas} ${a.personas === 1 ? 'persona' : 'personas'}`,
        })),
      },
      { id: 'campana', titulo: 'La campaña', ancho: 16, nodos: [aNodo({ ...campana, entrar: undefined })] },
      COL_VENDEDORAS(destinos),
    ],
    pertenencia: anuncios.map((a) => ({
      de: idAnuncio(a.adId),
      a: campana.id,
      tipo: 'pertenencia' as const,
    })),
  };
}

function aNodo(p: Pieza): NodoLienzo {
  return {
    id: p.id,
    titulo: p.titulo,
    icono: p.icono,
    pie: p.vendedoras.length ? p.vendedoras.map(nombreCortoLocal).join(', ') : p.pie,
    estado: p.estado,
    entrar: p.entrar,
  };
}
