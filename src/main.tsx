import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { queryClient } from './lib/datos/cliente'
import { arrancarCacheDeHermes } from './lib/datos/cacheDeHermes'
import { conectarEnlacesExternos } from './lib/enlacesExternos'

// En la cáscara Tauri, los target=_blank van al navegador del sistema.
conectarEnlacesExternos()

/**
 * El caché del estado del SERVIDOR envuelve toda la app.
 *
 * Es lo que hace que navegar entre pantallas no vuelva a pedir todo, que dos componentes que
 * miran el mismo dato compartan una sola llamada, y que las respuestas viejas se cancelen solas
 * al cambiar de pantalla — que era la causa de que una respuesta tardía pisara el borrador que
 * el operador estaba escribiendo.
 */
function pintar() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  )
}

/**
 * PRIMERO EL CACHÉ, DESPUÉS EL PRIMER RENDER.
 *
 * El orden es lo importante: si React montara antes de que la restauración
 * termine, las vistas leerían `isPending` y pintarían el skeleton — o sea, el
 * spinner que este arranque vino a sacar. Esperar la lectura de IndexedDB
 * (milisegundos) es lo que hace que la primera pintura ya tenga datos.
 *
 * Si persistir falla —modo privado, cuota, base bloqueada— la app arranca igual,
 * con el caché en memoria de siempre. Nunca al revés.
 */
arrancarCacheDeHermes()
  .catch(() => {})
  .then(pintar)
