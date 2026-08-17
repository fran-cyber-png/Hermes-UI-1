import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

interface DarkModeToggleProps {
  containerRef?: React.RefObject<HTMLDivElement | null>;
}

/**
 * Toggle entre Light Mode y Dark Mode
 * Solo aplica dentro del contenedor VistaAgenda
 */
export function DarkModeToggle({ containerRef }: DarkModeToggleProps) {
  const [isDark, setIsDark] = useState(() => {
    // Inicializar desde localStorage
    return localStorage.getItem('agenda-dark-mode') === 'true';
  });

  // Aplicar tema cuando isDark cambia
  useEffect(() => {
    const container = containerRef?.current;
    if (!container) return;

    if (isDark) {
      container.classList.add('agenda-dark-mode');
    } else {
      container.classList.remove('agenda-dark-mode');
    }

    localStorage.setItem('agenda-dark-mode', String(isDark));
  }, [isDark, containerRef]);

  const handleToggle = () => {
    setIsDark(!isDark);
  };

  return (
    <button
      onClick={handleToggle}
      className="rounded-lg border border-border p-2 text-muted-foreground transition-all duration-150 hover:bg-secondary/30 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
      aria-label={isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      title={isDark ? 'Modo claro' : 'Modo oscuro'}
      type="button"
    >
      {isDark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
