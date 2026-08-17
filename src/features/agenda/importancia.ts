/**
 * Sistema de importancia/prioridad para recordatorios.
 * Cada nivel tiene un color específico que se muestra en el chip y el timeline.
 */

export type Importancia = 'alta' | 'media' | 'baja';

export const IMPORTANCIA_COLORES: Record<Importancia, { bg: string; border: string; dot: string; label: string }> = {
  alta: {
    bg: 'bg-red-50 dark:bg-red-950',
    border: 'border-red-300 dark:border-red-700',
    dot: 'bg-red-500',
    label: '🔴 Alta',
  },
  media: {
    bg: 'bg-amber-50 dark:bg-amber-950',
    border: 'border-amber-300 dark:border-amber-700',
    dot: 'bg-amber-500',
    label: '🟡 Media',
  },
  baja: {
    bg: 'bg-blue-50 dark:bg-blue-950',
    border: 'border-blue-300 dark:border-blue-700',
    dot: 'bg-blue-500',
    label: '🔵 Baja',
  },
};

export function estiloDeImportancia(importancia?: Importancia): string {
  if (!importancia) return '';
  const colores = IMPORTANCIA_COLORES[importancia];
  return `${colores.bg} border ${colores.border}`;
}

export function colorPuntoImportancia(importancia?: Importancia): string {
  if (!importancia) return 'bg-gray-300';
  return IMPORTANCIA_COLORES[importancia].dot;
}

export function etiquetaImportancia(importancia?: Importancia): string {
  if (!importancia) return '⚪ Sin definir';
  return IMPORTANCIA_COLORES[importancia].label;
}
