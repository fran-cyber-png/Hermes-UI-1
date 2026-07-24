import { almacenIdb } from './almacenIdb';
import { agrupandoEscrituras, arrancarCache, crearPersistidor, olvidarCache } from './persistencia';
import { queryClient } from './cliente';
import { limpiarBlobsAutenticados } from './blobAutenticado';

/**
 * DÓNDE SE ARMA EL CACHÉ PERSISTENTE: la política de `persistencia.ts` sobre el
 * disco de `almacenIdb.ts`, con el `queryClient` de la app.
 *
 * Existe para que las dos piezas de arriba no se conozcan entre sí — así la
 * política se testea con un almacén de memoria y el disco no sabe qué guarda.
 */
const persistidor = agrupandoEscrituras(crearPersistidor(almacenIdb));

/** Restaura lo último conocido y deja el caché guardándose solo. Se llama ANTES del primer render. */
export const arrancarCacheDeHermes = () => arrancarCache(queryClient, persistidor);

/** Cierre de sesión: lo de una vendedora no lo hereda la siguiente. */
export const olvidarCacheDeHermes = () => {
  // Los blobs de media (fotos, adjuntos) también son de SU sesión.
  limpiarBlobsAutenticados();
  return olvidarCache(queryClient, persistidor);
};
