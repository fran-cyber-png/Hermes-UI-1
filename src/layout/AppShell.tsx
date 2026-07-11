import { useCallback, useMemo, useState } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { Settings } from 'lucide-react';
import ConfiguracionPanel from '../features/config/ConfiguracionPanel';
import { ConfigContext } from './ConfigContext';

/**
 * Sin pestañas.
 *
 * Eran cuatro, y cada una obligaba a que su pantalla se defendiera sola — por
 * eso la bandeja terminó flotando en el vacío y el análisis se contradecía con
 * ella. Ahora el home es el único punto de partida: contiene el trabajo y todo
 * lo que hay que saber. Se sale del home y se vuelve al home.
 *
 * Arriba solo dos cosas: la marca (que lleva al home) y la tuerca.
 */
export default function AppShell() {
  const [config, setConfig] = useState(false);
  const abrir = useCallback(() => setConfig(true), []);
  const valor = useMemo(() => ({ abrir }), [abrir]);

  return (
    <ConfigContext.Provider value={valor}>
      <div className="min-h-dvh bg-background">
        <header className="border-b border-border bg-card">
          <div className="mx-auto flex max-w-[1400px] items-center justify-between px-4 py-3 md:px-8">
            <Link
              to="/"
              className="font-heading text-sm font-extrabold tracking-tight text-navy transition-opacity hover:opacity-70"
            >
              GOBERNA
            </Link>

            <button
              type="button"
              onClick={abrir}
              aria-label="Configuración"
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Settings size={17} />
            </button>
          </div>
        </header>

        <main className="px-4 py-6 md:px-8 md:py-10">
          <Outlet />
        </main>

        <ConfiguracionPanel abierto={config} onCerrar={() => setConfig(false)} />
      </div>
    </ConfigContext.Provider>
  );
}
