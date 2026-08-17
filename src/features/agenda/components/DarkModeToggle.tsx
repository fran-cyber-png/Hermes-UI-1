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
  const [isDark, setIsDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Cargar preferencia al montar
  useEffect(() => {
    const saved = localStorage.getItem('agenda-dark-mode');
    const shouldBeDark = saved === 'true';
    setIsDark(shouldBeDark);
    applyTheme(shouldBeDark);
    setMounted(true);
  }, []);

  const applyTheme = (dark: boolean) => {
    if (containerRef?.current) {
      if (dark) {
        containerRef.current.classList.add('agenda-dark-mode');
      } else {
        containerRef.current.classList.remove('agenda-dark-mode');
      }
    }
  };

  const toggleTheme = () => {
    const newIsDark = !isDark;
    setIsDark(newIsDark);
    applyTheme(newIsDark);
    localStorage.setItem('agenda-dark-mode', String(newIsDark));
  };

  if (!mounted) return null;

  return (
    <button
      onClick={toggleTheme}
      className="rounded-lg border border-border p-2 text-muted-foreground transition-all duration-150 hover:bg-secondary/30 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
      aria-label={isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      title={isDark ? 'Modo claro' : 'Modo oscuro'}
      type="button"
    >
      {isDark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
