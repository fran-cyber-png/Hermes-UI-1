/**
 * La marca en pantalla: [escudo dorado] │ HERMES.
 *
 * El escudo es el emblema institucional de Goberna (columnas + frontis) en el
 * dorado de tinta (#CAA106 — el que contrasta sobre claro; goberna-design-system
 * §2). Es la ÚNICA pieza dorada permanente de la interfaz: el resto del oro
 * significa tiempo que se acaba, nunca decoración.
 */
export function Escudo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" fill="none" aria-label="Escudo Goberna">
      <circle cx="13" cy="13" r="11.5" stroke="var(--gold-ink)" strokeWidth="1.6" />
      <path
        d="M6.5 10.4 13 6.8l6.5 3.6"
        stroke="var(--gold-ink)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M8.4 12v6M11.5 12v6M14.6 12v6M17.7 12v6" stroke="var(--gold-ink)" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M7 19.4h12" stroke="var(--gold-ink)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function Marca({ escudo = 24 }: { escudo?: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <Escudo size={escudo} />
      <span className="h-5 w-px bg-border" aria-hidden="true" />
      <span className="font-heading text-sm font-extrabold tracking-[0.04em] text-navy">HERMES</span>
    </div>
  );
}
