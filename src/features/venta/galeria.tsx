import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FormularioVenta } from './FormularioVenta';
import '../../index.css';

/**
 * EL FORMULARIO DE VENTA REAL, SIN SERVER NI CERBERUS.
 *
 *     npx vite --port 5199  →  http://localhost:5199/galeria-venta.html
 *
 * Monta `FormularioVenta` TAL CUAL lo usa la app: lo único falso es el `fetch`.
 *
 * 🔴 **Sirve los valores REALES de producción, no un caso lindo.** En este repo
 * una galería con el caso ideal ya escondió tres defectos (ver el frente del
 * radar de leads): acá los datos son los de la captura con la que el dueño
 * reportó el problema —Julio Patricio Quijano Villaorduña, PEN, Perú, preventa,
 * «Foro De Estado Perú 2026» a 199.00— y los locales son los que Cerberus
 * filtra por país.
 *
 * Los casos:
 *   (sin nada)      el caso de la captura: una cuota que vence hoy
 *   `?cuotas=3`     🔴 EL CASO FEO: 199 en 3 no divide exacto (66.34 · 66.33 ·
 *                   66.33). El centavo va a la PRIMERA, igual que en Cerberus.
 *   `?descuento=1`  un precio pactado por debajo del catálogo, y dos cursos
 *   `?sinlocal=1`   Cerberus mudo: `locales: null` y se cae a la lista completa
 */

const CLIENTE = 'Julio Patricio Quijano Villaorduña';
const TELEFONO = '51987654321';

const q = new URLSearchParams(location.search);
const CUOTAS = Number(q.get('cuotas') ?? '1');
const CON_DESCUENTO = q.has('descuento');
const SIN_LOCAL = q.has('sinlocal');

/** Los almacenes que Cerberus tiene activos, con su país — por eso el filtro. */
const LOCALES_PE = [
  { id: '1', nombre: 'Almacén Lima — Jesús María' },
  { id: '4', nombre: 'Almacén Lima — San Isidro' },
];
const LOCALES_TODOS = [
  ...LOCALES_PE,
  { id: '2', nombre: 'Almacén Ciudad de México' },
  { id: '3', nombre: 'Almacén Quito' },
];

const PRODUCTOS = [
  { id: '881', sku: 'FORO-2026', nombre: 'Foro De Estado Perú 2026', precioNormal: 249, precioPromocion: 199, moneda: '' },
  { id: '742', sku: 'DIP-INT', nombre: 'Diploma de Inteligencia y Contrainteligencia', precioNormal: 590, precioPromocion: 490, moneda: '' },
];

window.fetch = (async (entrada: RequestInfo | URL) => {
  const url = String(typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url);
  const json = (cuerpo: unknown, status = 200) =>
    new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });

  if (url.includes('/api/venta/formulario'))
    return json({
      monedas: [
        { id: '1', nombre: 'PEN' },
        { id: '2', nombre: 'USD' },
        { id: '3', nombre: 'MXN' },
      ],
      paises: [
        { id: '1', nombre: 'Perú' },
        { id: '2', nombre: 'México' },
        { id: '3', nombre: 'Ecuador' },
      ],
      locales: LOCALES_TODOS,
      medios: [],
      origenes: [],
    });
  // `locales: null` es «no se pudo preguntar», no «no hay»: la pantalla degrada
  // a la lista completa del formulario en vez de dejar la venta imposible.
  if (url.includes('/api/venta/locales')) return json({ locales: SIN_LOCAL ? null : LOCALES_PE });
  if (url.includes('/api/venta/productos')) return json({ productos: PRODUCTOS });
  if (url.includes('/api/whatsapp/conversacion/')) return json({ origen: { fuente: 'anuncio' } });
  if (url.includes('/api/dashboard'))
    return json({ embudo: { interesado: 377, sin_respuesta: 2576, contactado: 217, cotizado: 790, cierre: 13 } });
  return json({}, 404);
}) as typeof fetch;

const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });

/**
 * El estado de arranque se arma tocando la UI, no por prop: el formulario no
 * acepta líneas ni cuotas de afuera, y falsearle un estado interno sería
 * fotografiar algo que la vendedora no puede alcanzar.
 */
function prepararEscena() {
  const clic = (el: Element | null | undefined) => (el as HTMLElement | undefined)?.click();
  const escribir = (el: HTMLInputElement, v: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const botones = () => [...document.querySelectorAll('button')];

  setTimeout(() => {
    // Moneda y local, que la app precarga de la ficha y del localStorage.
    const selects = [...document.querySelectorAll('select')];
    for (const [i, valor] of [
      [0, '1'],
      [1, '1'],
      [2, '1'],
    ] as const) {
      const s = selects[i];
      if (!s) continue;
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
      setter.call(s, valor);
      s.dispatchEvent(new Event('change', { bubbles: true }));
    }

    setTimeout(() => {
      const buscador = document.querySelector<HTMLInputElement>('input[placeholder^="Buscar curso"]');
      if (buscador) escribir(buscador, 'foro');
      setTimeout(() => {
        clic(botones().find((b) => b.textContent?.includes('Foro De Estado')));
        if (CON_DESCUENTO) {
          const otro = document.querySelector<HTMLInputElement>('input[placeholder^="Buscar curso"]');
          if (otro) escribir(otro, 'diploma');
          setTimeout(() => {
            clic(botones().find((b) => b.textContent?.includes('Diploma de Inteligencia')));
            setTimeout(() => {
              // El precio pactado: 199 → 149. El regular del catálogo no se toca.
              const precio = document.querySelector<HTMLInputElement>('input[aria-label^="Precio de Foro"]');
              if (precio) escribir(precio, '149');
            }, 60);
          }, 120);
        }
        for (let i = 1; i < CUOTAS; i++) {
          setTimeout(() => clic(botones().find((b) => b.textContent?.includes('Agregar cuota'))), 200 + i * 40);
        }
      }, 150);
    }, 60);
  }, 250);
}

createRoot(document.getElementById('galeria')!).render(
  <StrictMode>
    <QueryClientProvider client={cliente}>
      <FormularioVenta
        clienteId={40821}
        clienteNombre={CLIENTE}
        telefono={TELEFONO}
        canal="whatsapp"
        paisNombre="Perú"
        clave={`conv:whatsapp:${TELEFONO}:51984429504`}
        personaNombre={CLIENTE}
        numeroPropio="51984429504"
        onCerrar={() => {}}
      />
    </QueryClientProvider>
  </StrictMode>,
);

prepararEscena();
