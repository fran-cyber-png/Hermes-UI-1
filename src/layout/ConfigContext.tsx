import { createContext, useContext } from 'react';

/**
 * Abrir la configuración desde cualquier lado.
 *
 * Existe porque las tarjetas que dependen de una config ausente ("elige qué
 * cuentas mirar") tienen que poder abrirla ellas mismas. Mandar al usuario a
 * buscar la tuerca es hacerle adivinar dónde está el problema que le acabas
 * de mostrar.
 */
export const ConfigContext = createContext<{ abrir: () => void }>({ abrir: () => {} });

export const useConfig = () => useContext(ConfigContext);
