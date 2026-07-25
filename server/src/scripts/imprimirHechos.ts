import { CATALOGO_POR_DEFECTO } from "../hechos/catalogo.js";
import { elegirHechos } from "../hechos/elegir.js";
import { MOMENTOS_DE_VENTA } from "../sugerencias/estado.js";

/**
 * Imprime, para cada momento de la venta, exactamente lo que devolvería
 * `GET /api/hechos`. Sin base y sin red: sirve para revisar el catálogo de un
 * vistazo y para armar la evidencia del panel sin depender del deploy.
 */
for (const m of MOMENTOS_DE_VENTA) {
  console.log(
    JSON.stringify({
      momento: m,
      hechos: elegirHechos(CATALOGO_POR_DEFECTO, m),
      editable: true,
      origen: "defecto",
    }),
  );
}
