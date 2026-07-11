import { NavLink, Outlet } from 'react-router-dom';
import { BarChart3, FileText, Inbox, Megaphone } from 'lucide-react';

const NAV = [
  { to: '/', label: 'Bandeja', end: true, icon: Inbox },
  { to: '/leads', label: 'Formularios', end: false, icon: FileText },
  { to: '/analisis', label: 'Análisis', end: false, icon: BarChart3 },
  { to: '/campanas', label: 'Campañas', end: false, icon: Megaphone },
];

export default function AppShell() {
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-[1600px] items-center gap-6 px-4 py-3 md:px-8">
          <span className="font-heading shrink-0 text-sm font-extrabold tracking-tight text-navy">
            GOBERNA
          </span>
          <nav className="flex items-center gap-1 overflow-x-auto">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ' +
                  (isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground')
                }
              >
                <item.icon size={15} />
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      {/* El shell no impone ancho: cada página elige el suyo. Un tablero de
          3 columnas necesita respirar mucho más que una bandeja de lectura. */}
      <main className="px-4 py-6 md:px-8 md:py-10">
        <Outlet />
      </main>
    </div>
  );
}
