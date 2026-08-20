import logoGobernita from '../assets/logo-gobernita.png';

/**
 * La marca en pantalla: [escudo dorado] │ HERMES.
 *
 * El escudo es el emblema institucional de Goberna (columnas + frontis) en
 * dorado. Es la ÚNICA pieza dorada permanente de la interfaz: el resto del oro
 * significa tiempo que se acaba, nunca decoración.
 */
export function Escudo({ size = 26 }: { size?: number }) {
  return (
    <img
      src={logoGobernita}
      width={size}
      height={size}
      alt="Escudo Goberna"
      style={{ width: size, height: size }}
    />
  );
}

export function Marca({ escudo = 24 }: { escudo?: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <Escudo size={escudo} />
      <span className="h-5 w-px bg-border" aria-hidden="true" />
      <span className="font-heading text-sm font-extrabold tracking-[0.04em] text-navy-ink">HERMES</span>
    </div>
  );
}
