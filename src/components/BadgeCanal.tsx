/**
 * El disco de color que dice por qué canal entró la conversación.
 *
 * El canal es una INSIGNIA, no una columna: la cola es una sola lista mezclada, y
 * el canal se percibe de un vistazo sin ocupar espacio ni partir la lista en
 * secciones. Los colores son de marca externa (excepción documentada, como el
 * `--meta-blue`) — no de la paleta Goberna.
 */
const CANAL = {
  facebook: { nombre: 'Facebook', color: '#1877F2', inicial: 'f' },
  instagram: { nombre: 'Instagram', color: '#C13584', inicial: 'ig' },
  whatsapp: { nombre: 'WhatsApp', color: '#25D366', inicial: 'wa' },
} as const;

export function BadgeCanal({ canal, size = 14 }: { canal: string; size?: number }) {
  const meta = CANAL[canal as keyof typeof CANAL];
  if (!meta) return null;
  // Bajo 18px la inicial sería ruido ilegible: el disco de color alcanza.
  const conInicial = size >= 18;
  return (
    <span
      title={meta.nombre}
      className="inline-flex items-center justify-center rounded-full font-bold text-white ring-2 ring-card"
      style={{ backgroundColor: meta.color, width: size, height: size, ...(conInicial ? { fontSize: Math.max(9, size * 0.5) } : {}) }}
    >
      {conInicial ? meta.inicial : null}
    </span>
  );
}

export function nombreCanal(canal: string): string {
  return CANAL[canal as keyof typeof CANAL]?.nombre ?? canal;
}
