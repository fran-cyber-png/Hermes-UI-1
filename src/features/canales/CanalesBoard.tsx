import { useState } from 'react';
import { Camera, MessageCircle, MessagesSquare } from 'lucide-react';
import { useLocalStorage } from '../../lib/useLocalStorage';
import type { CanalesResponse, Intencion, Interaccion, Rango } from './types';
import { useInteracciones } from './useInteracciones';

import CanalColumna from './CanalColumna';
import ResponderPanel from './ResponderPanel';

const COLOR = {
  facebook: '#1877F2',
  instagram: '#C13584',
  whatsapp: '#25D366',
} as const;

const FILTROS: { valor: Intencion; label: string }[] = [
  { valor: 'pide-info', label: 'Piden información' },
  { valor: 'puedo-escribirle', label: 'Les puedo escribir hoy' },
  { valor: '', label: 'Todo' },
];

/**
 * Los canales, uno al lado del otro. El rango lo manda la página: el hero, el
 * gráfico y estas columnas tienen que estar mirando siempre el mismo período,
 * o vuelven a contradecirse como se contradecían Pulso y Canales.
 */
export default function CanalesBoard({
  estado,
  rango,
}: {
  estado: CanalesResponse | null;
  rango: Rango;
}) {
  const [intencion, setIntencion] = useLocalStorage<Intencion>(
    'meta-escuela.canalIntencion',
    'pide-info',
  );
  const [abierta, setAbierta] = useState<Interaccion | null>(null);
  const [respondidas, setRespondidas] = useState<number[]>([]);

  const fb = useInteracciones('facebook', intencion, rango);
  const ig = useInteracciones('instagram', intencion, rango);

  const canal = (c: string) => estado?.interacciones.find((x) => x.canal === c);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Mostrar
        </span>
        <div className="flex gap-1 rounded-xl border border-border bg-card p-1">
          {FILTROS.map((f) => (
            <button
              key={f.valor}
              type="button"
              onClick={() => setIntencion(f.valor)}
              className={
                'rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ' +
                (intencion === f.valor
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted')
              }
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <CanalColumna
          titulo="Facebook"
          subtitulo="Comentarios y Messenger"
          icono={MessagesSquare}
          color={COLOR.facebook}
          interacciones={fb.items}
          total={canal('facebook')?.total ?? 0}
          pideInfo={canal('facebook')?.pide_info ?? 0}
          filtrando={intencion !== ''}
          cargando={fb.cargando}
          hayMas={fb.hayMas}
          cargandoMas={fb.cargandoMas}
          onCargarMas={fb.cargarMas}
          respondidas={respondidas}
          onAbrir={setAbierta}
          nota="Meta oculta el nombre de quien comenta, pero se le puede responder igual: en público siempre, y en privado solo si el comentario tiene menos de 7 días."
        />

        <CanalColumna
          titulo="Instagram"
          subtitulo="Comentarios en publicaciones"
          icono={Camera}
          color={COLOR.instagram}
          interacciones={ig.items}
          total={canal('instagram')?.total ?? 0}
          pideInfo={canal('instagram')?.pide_info ?? 0}
          filtrando={intencion !== ''}
          cargando={ig.cargando}
          hayMas={ig.hayMas}
          cargandoMas={ig.cargandoMas}
          onCargarMas={ig.cargarMas}
          respondidas={respondidas}
          onAbrir={setAbierta}
          nota="Por ahora solo respuesta pública. El mensaje privado necesita que Meta apruebe la revisión de la app."
        />

        <CanalColumna
          titulo="WhatsApp"
          subtitulo="Conversaciones"
          icono={MessageCircle}
          color={COLOR.whatsapp}
          interacciones={[]}
          total={0}
          pideInfo={0}
          filtrando={false}
          cargando={false}
          hayMas={false}
          cargandoMas={false}
          onCargarMas={() => {}}
          respondidas={[]}
          onAbrir={() => {}}
          bloqueado="Sin conectar. Es donde se cierra la venta, y hay una decisión pendiente: usar la API oficial de Meta, o lo que ya está corriendo hoy."
        />
      </div>

      <ResponderPanel
        interaccion={abierta}
        onCerrar={() => setAbierta(null)}
        onRespondido={(id) => setRespondidas((prev) => [...prev, id])}
      />
    </div>
  );
}
