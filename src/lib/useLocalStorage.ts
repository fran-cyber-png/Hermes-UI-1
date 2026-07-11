import { useEffect, useState } from 'react';

// Persistencia simple por navegador — no hay backend/DB propia para guardar
// configuración de usuario todavía. Ojo: esto es por navegador/dispositivo,
// no se comparte entre el equipo.
export function useLocalStorage<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored !== null ? (JSON.parse(stored) as T) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // localStorage lleno o bloqueado — no es crítico, seguimos en memoria.
    }
  }, [key, value]);

  return [value, setValue] as const;
}
