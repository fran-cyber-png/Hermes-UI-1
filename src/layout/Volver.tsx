import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

/**
 * La salida de cualquier subpantalla. Sin pestañas arriba, esto no es un adorno:
 * es la única forma de volver, y por eso va primero y siempre en el mismo lugar.
 */
export default function Volver({ a = '/', texto = 'Volver a la bandeja' }: { a?: string; texto?: string }) {
  return (
    <Link
      to={a}
      className="inline-flex w-fit items-center gap-1.5 text-xs font-bold text-muted-foreground transition-colors hover:text-primary"
    >
      <ArrowLeft size={13} />
      {texto}
    </Link>
  );
}
