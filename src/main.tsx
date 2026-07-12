import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { queryClient } from './lib/datos/cliente'

/**
 * El caché del estado del SERVIDOR envuelve toda la app.
 *
 * Es lo que hace que navegar entre pantallas no vuelva a pedir todo, que dos componentes que
 * miran el mismo dato compartan una sola llamada, y que las respuestas viejas se cancelen solas
 * al cambiar de pantalla — que era la causa de que una respuesta tardía pisara el borrador que
 * el operador estaba escribiendo.
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
