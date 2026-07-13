import RelojTesoreria from '../features/tesoreria/RelojTesoreria';

/**
 * El reloj de Tesorería.
 *
 * No reemplaza a Cerberus: la confirmación del voucher sigue ocurriendo allá. Esto solo muestra
 * la misma cola, ordenada al revés — lo más viejo arriba — con el reloj de Meta corriendo.
 */
export default function TesoreriaPage() {
  return <RelojTesoreria />;
}
