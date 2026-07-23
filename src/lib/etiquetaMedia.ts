/**
 * La etiqueta de un mensaje sin texto según su clase de media — «📷 Foto»,
 * «🎤 Audio»… como WhatsApp, en vez de «(sin texto)» (#55). Fuente única para la
 * cola, el hilo y el historial. Devuelve null si la clase no se conoce: el caller
 * decide el fallback (normalmente «(sin texto)»), nunca se inventa un ícono.
 */
const ETIQUETAS: Record<string, string> = {
  imagen: '📷 Foto',
  video: '🎬 Video',
  audio: '🎤 Audio',
  documento: '📄 Documento',
  sticker: '🖼️ Sticker',
};

export function etiquetaDeMedia(clase: string | null | undefined): string | null {
  return clase ? (ETIQUETAS[clase] ?? null) : null;
}
