import { History } from 'lucide-react';

/**
 * EL SELLO «ESTO ES DE ANTES».
 *
 * Cuando la app arranca con el caché persistido, la pantalla se pinta llena al
 * instante — y por un momento lo que muestra es de la sesión anterior. Mostrarlo
 * sin marcar sería peor que un spinner: el spinner te hace esperar, el dato
 * viejo disfrazado de fresco te hace llamar a alguien que ya compró.
 *
 * Habla en voz de imprenta y en gris: es una aclaración, no una alarma. No lleva
 * dorado — en Hermes el oro es tiempo que se acaba, y acá no se acaba nada.
 * Desaparece solo cuando llega lo fresco (ver `selloDeViejo`).
 */
export function SelloDeAntes({ texto, actualizando }: { texto: string; actualizando: boolean }) {
  return (
    <span
      className="flex shrink-0 items-center gap-1 whitespace-nowrap font-mono text-[11px] text-muted-foreground"
      title={
        actualizando
          ? 'Lo que ves es de la sesión anterior. Ya se está actualizando.'
          : 'Lo que ves es de la sesión anterior.'
      }
    >
      {/* El pulso ES el «actualizando»: la palabra no entra en la cola sin
          empujar los filtros a una segunda línea, y un ícono que late lo dice
          igual de bien y sin mover nada de lugar. */}
      <History size={11} className={actualizando ? 'animate-pulse' : undefined} />
      {texto}
    </span>
  );
}
