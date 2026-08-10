/**
 * EL HTML DE LA PÁGINA PÚBLICA — puro, sin base (ADR 0047).
 *
 * ⚠️ **Separado del router a propósito**, igual que `meta/metaPayload.ts` está
 * separado de su handler: `routes/publico.ts` importa `db/client.js`, que exige
 * `DATABASE_URL` al cargarse, así que un test puro no puede ni importarlo.
 *
 * Y acá el test puro es lo que más importa de todo el frente: **este es el único
 * lugar de Hermes donde texto escrito por una persona se convierte en HTML para
 * un desconocido sin credencial.** El escape no es higiene, es la diferencia
 * entre una página y un vector.
 */

/** Escapa lo que va adentro del HTML. La página se arma con texto de una persona. */
export function escapar(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * El HTML de la página.
 *
 * ⚠️ **Se pinta desde `texto`, NO desde `doc`.** Renderizar el documento de
 * BlockNote del lado del server pediría su runtime (o reimplementar su
 * serialización, que es la segunda implementación de siempre), y con eso entraría
 * a esta ruta —la anónima— la superficie más grande del sistema. El texto plano
 * conserva los renglones, que es lo que una página de precios necesita.
 *
 * Sin marca fuerte de Goberna a propósito: una página que parece un documento
 * oficial invita a reenviarla como si lo fuera.
 */
export function paginaHtml(titulo: string, texto: string): string {
  const cuerpo = escapar(texto)
    .split('\n')
    .map((linea) => (linea.trim() === '' ? '<p class="v"></p>' : `<p>${linea}</p>`))
    .join('\n');

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapar(titulo || 'Nota')}</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; padding: 2.5rem 1.25rem;
    font: 16px/1.65 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #f7f8fa; color: #1a1f2b;
  }
  main { max-width: 42rem; margin: 0 auto; background: #fff; border-radius: 12px;
         padding: 2rem 1.75rem; box-shadow: 0 1px 3px rgba(16,24,40,.06); }
  p { margin: 0 0 .65rem; white-space: pre-wrap; word-wrap: break-word; }
  p.v { height: .65rem; margin: 0; }
  footer { max-width: 42rem; margin: 1rem auto 0; font-size: .8125rem; color: #6b7280; }
  @media (prefers-color-scheme: dark) {
    body { background: #0f1420; color: #e6e9ef; }
    main { background: #161c2b; box-shadow: none; }
    footer { color: #8a93a5; }
  }
</style>
</head>
<body>
<main>${cuerpo}</main>
<footer>Goberna · solo lectura</footer>
</body>
</html>`;
}

/**
 * LA PÁGINA PUENTE de un link `goberna` — y lo que NO tiene es el punto.
 *
 * 🔴 **No lleva una sola letra del contenido.** Una navegación del navegador no
 * manda el token de Hermes (la sesión vive en `localStorage`, no en una cookie),
 * así que acá el server **no sabe quién sos** — y servir contenido «porque el
 * link dice que es interno» sería confiar en el link, no en la identidad.
 *
 * Consecuencia, que es la garantía del frente: **el contenido de un link interno
 * nunca sale por la ruta anónima.** Sale por `/api/notas/por-link/:token`, que
 * está detrás del perímetro.
 *
 * Tampoco dice el título, ni de qué espacio es: quien no tenga sesión no aprende
 * nada más que «existe algo y es del equipo».
 */
export function paginaPuente(urlApp: string): string {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Abrir en Hermes</title>
<style>
 body{margin:0;display:grid;place-items:center;min-height:100vh;background:#f7f8fa;
 font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1a1f2b;padding:1.5rem}
 .c{max-width:24rem;text-align:center}
 h1{font-size:1.1rem;margin:0 0 .4rem;font-weight:600}
 p{margin:0 0 1.25rem;color:#6b7280;font-size:.95rem}
 a{display:inline-block;background:#1b3a6b;color:#fff;text-decoration:none;
 padding:.6rem 1.1rem;border-radius:8px;font-weight:600;font-size:.95rem}
 @media (prefers-color-scheme:dark){body{background:#0f1420;color:#e6e9ef}p{color:#8a93a5}
 a{background:#4d7fd4}}
</style></head>
<body><div class="c">
<h1>Esta página es del equipo</h1>
<p>Entrá a Hermes para verla.</p>
<a href="${escapar(urlApp)}">Abrir en Hermes</a>
</div></body></html>`;
}

export const NO_EXISTE = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>No disponible</title>
<style>body{margin:0;display:grid;place-items:center;min-height:100vh;
font:16px/1.6 system-ui,sans-serif;background:#f7f8fa;color:#6b7280}</style>
</head><body><p>Este link ya no está disponible.</p></body></html>`;
