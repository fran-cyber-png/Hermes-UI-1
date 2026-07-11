/**
 * La temperatura del dato. No es decoración: codifica el problema central del
 * negocio — cada día que un lead espera respuesta, baja su probabilidad de
 * convertir. Un lead de 65 días no es "un lead viejo", es un lead perdido.
 */
export type Temperature = 'fresco' | 'tibio' | 'frio' | 'helado';

export function temperatureOf(createdTime: string): Temperature {
  const days = (Date.now() - new Date(createdTime).getTime()) / 86_400_000;
  if (days < 1) return 'fresco';
  if (days < 3) return 'tibio';
  if (days < 14) return 'frio';
  return 'helado';
}

export function daysSince(createdTime: string): number {
  return Math.floor((Date.now() - new Date(createdTime).getTime()) / 86_400_000);
}

export const TEMPERATURE_META: Record<Temperature, { label: string; bar: string; text: string; bg: string }> = {
  fresco: { label: 'A tiempo', bar: 'bg-temp-fresco', text: 'text-temp-fresco', bg: 'bg-temp-fresco/10' },
  tibio: { label: 'Enfriándose', bar: 'bg-temp-tibio', text: 'text-temp-tibio', bg: 'bg-temp-tibio/10' },
  frio: { label: 'Frío', bar: 'bg-temp-frio', text: 'text-temp-frio', bg: 'bg-temp-frio/10' },
  helado: { label: 'Perdido', bar: 'bg-temp-helado', text: 'text-temp-helado', bg: 'bg-temp-helado/10' },
};
