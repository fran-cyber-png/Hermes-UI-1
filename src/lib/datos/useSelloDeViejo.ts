import { useEffect, useState } from 'react';
import { selloDeViejo } from './persistencia';

/**
 * EL SELLO, PERO CON EL RELOJ CORRIENDO.
 *
 * `selloDeViejo` es puro y recibe el instante — por eso se testea. Falta la
 * parte que en React no es gratis: que ese instante AVANCE.
 *
 * Sin esto, `selloDeViejo(traidoEn, Date.now())` se calcula durante el render y
 * ahí se queda: mientras `traidoEn` no cambie, React no tiene motivo para volver
 * a renderizar, y el resultado se congela en el valor que tuvo la primera vez.
 * Medido: con el server caído y la app abierta, el radar seguía diciendo «en
 * vivo» sobre datos de 14 horas a los 90 segundos, a los 5 minutos y para
 * siempre. Justo la mentira que el sello vino a matar, pero de la forma que más
 * dura — porque la vendedora deja Hermes abierto todo el día.
 *
 * El latido de 30 s hace que el sello aparezca como mucho medio minuto tarde. Es
 * un `setState` por minuto en dos vistas: nada, al lado de lo que arregla.
 */
export function useSelloDeViejo(traidoEn: number | undefined): string | null {
  const [ahora, setAhora] = useState(() => Date.now());

  useEffect(() => {
    const latido = setInterval(() => setAhora(Date.now()), 30_000);
    return () => clearInterval(latido);
  }, []);

  return selloDeViejo(traidoEn, ahora);
}
