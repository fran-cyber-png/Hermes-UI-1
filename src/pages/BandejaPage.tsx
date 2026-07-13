import { useOverview } from '../lib/datos/overview';
import BandejaCanales from '../features/canales/BandejaCanales';
import Bandeja from '../features/canales/Bandeja';
import Volver from '../layout/Volver';

/**
 * La bandeja completa: la estación CONVERSA a fondo.
 *
 * Arriba, las tres tarjetas por canal —Instagram, Facebook, WhatsApp—, cada una honesta sobre lo
 * que se puede hacer ahí: los canales NO son intercambiables, y meterlos en una sola cola escondía
 * justamente eso. Cada tarjeta lleva a su canal, donde se responde de a uno.
 *
 * Abajo, la cola unificada de los más urgentes: para trabajar rápido sin elegir canal, a quien se
 * le está por vencer el reloj.
 *
 * Todo sale de `GET /api/overview` (canales + accionable), cacheado. Ninguna llamada a Meta.
 */
export default function BandejaPage() {
  const { data } = useOverview('todo');

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <Volver a="/" texto="Volver al inicio" />

      <div>
        <h1 className="font-heading text-2xl font-bold text-navy">La bandeja, por canal</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Cada canal permite cosas distintas. Elige por dónde entrar, o trabaja abajo a quien se le
          vence el reloj.
        </p>
      </div>

      {data && <BandejaCanales canales={data.canales} accionable={data.accionable} />}

      {/* La cola unificada: los más urgentes, sin importar el canal. Aquí sí se responde. */}
      <Bandeja />
    </div>
  );
}
