import { createServer } from 'node:http';

/**
 * STUB DE ROUTING PARA VER LA HOJA DE PRODUCTO SIN SERVER (ADR 0060).
 *
 *   node scratchpad/api-routing-producto.mjs
 *   VITE_API_URL=http://localhost:4199 npx vite --port 5199
 *
 * Y para la sesión, sembrar el token desde el navegador (el front solo decodifica
 * el cuerpo y comprueba que no venció — la firma la mira el server, que acá es
 * esto):
 *
 *   localStorage.setItem('hermes.token',
 *     btoa(`Usuario1|${Date.now() + 6e8}`).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
 *     + '.firma-que-el-front-no-mira')
 *
 * 🔴 **SIRVE LOS DATOS REALES DE PRODUCCIÓN** (18-ago-2026): los 22 cursos de
 * formulario y las 2 campañas que llegan a la línea, con sus familias resueltas
 * tal cual — **incluidos los cuatro formularios enlazados al producto
 * equivocado**, que son el caso que la hoja existe para arreglar. Una galería que
 * sirve el caso ideal no es evidencia: ya escondió tres defectos una vez.
 *
 * ⚠️ Incluye a propósito «Curso Especializado en Contrataciones P?blicas», con el
 * mojibake que tiene la base: es una fila real y la pantalla tiene que soportarla.
 */

const FOTO = {
  "linea": "51984429504",
  "etiqueta": "Ventas Meta",
  "ventanaDias": 30,
  "campanas": [
    {
      "campanaId": "120247748537190016",
      "nombre": "[JUL] INTELIGENCIA | WSP",
      "estado": "pausada",
      "anuncios": 10,
      "personas": 78,
      "ultima": "2026-08-18T15:27:46.674Z",
      "familia": "DIPICOT",
      "origenFamilia": "alias",
      "aliasFamilia": "inteligencia",
      "vendedoras": []
    },
    {
      "campanaId": "120249343592830789",
      "nombre": "[AGO] OSINT - INTERACCIONES - 11 - 31",
      "estado": "activa",
      "anuncios": 4,
      "personas": 37,
      "ultima": "2026-08-18T15:27:46.675Z",
      "familia": "DIPOSOC",
      "origenFamilia": "alias",
      "aliasFamilia": "osint",
      "vendedoras": []
    }
  ],
  "cursos": [
    {
      "curso": "Curso de Especialización en Oratoria e Imagen Política",
      "leads": 3,
      "ultimo": "2026-08-18T14:27:46.675Z",
      "familia": "EPCOORP",
      "origenFamilia": "alias",
      "aliasFamilia": "oratoria",
      "vendedoras": []
    },
    {
      "curso": "Diploma Internacional del Consultor Político",
      "leads": 96,
      "ultimo": "2026-08-18T14:27:46.675Z",
      "familia": "DIPCPOL",
      "origenFamilia": "alias",
      "aliasFamilia": "consultor politico",
      "vendedoras": [
        "Luz",
        "Sindy",
        "Tracy"
      ]
    },
    {
      "curso": "Diploma Internacional de Operaciones Psicológicas y Psicosociales Senior",
      "leads": 1,
      "ultimo": "2026-08-18T14:27:46.675Z",
      "familia": "DIPOPPSS",
      "origenFamilia": "alias",
      "aliasFamilia": "operaciones psicologicas y psicosociales senior",
      "vendedoras": []
    },
    {
      "curso": "Diploma Élite del Gestor Parlamentario",
      "leads": 2,
      "ultimo": "2026-08-18T14:27:46.675Z",
      "familia": "DIPGESPA",
      "origenFamilia": "alias",
      "aliasFamilia": "gestor parlamentario",
      "vendedoras": []
    },
    {
      "curso": "Diploma Internacional de Élite en Criminología y Ciencias Forenses",
      "leads": 1,
      "ultimo": "2026-08-18T14:27:46.676Z",
      "familia": "INCOPIE",
      "origenFamilia": "alias",
      "aliasFamilia": "criminologia y ciencias forenses",
      "vendedoras": []
    },
    {
      "curso": "Curso Especializado en Contrataciones P�blicas",
      "leads": 1,
      "ultimo": "2026-08-18T14:27:46.676Z",
      "familia": null,
      "vendedoras": []
    },
    {
      "curso": "Diploma Internacional en Dirección de Consultoría Política",
      "leads": 1,
      "ultimo": "2026-08-18T14:27:46.676Z",
      "familia": "DIPCPOL",
      "origenFamilia": "alias",
      "aliasFamilia": "consultoria politica",
      "vendedoras": []
    },
    {
      "curso": "Diploma Élite Internacional de Director de Seguridad Corporativo",
      "leads": 4,
      "ultimo": "2026-08-18T14:27:46.676Z",
      "familia": "DIPDIRS",
      "origenFamilia": "alias",
      "aliasFamilia": "director de seguridad",
      "vendedoras": []
    },
    {
      "curso": "Curso Especializado en Contrataciones Públicas",
      "leads": 1,
      "ultimo": "2026-08-18T14:27:46.676Z",
      "familia": null,
      "vendedoras": []
    },
    {
      "curso": "Diploma técnico en Osint & Socmint",
      "leads": 11,
      "ultimo": "2026-08-18T14:27:46.676Z",
      "familia": "DIPOSOC",
      "origenFamilia": "alias",
      "aliasFamilia": "osint socmint",
      "vendedoras": []
    },
    {
      "curso": "Diploma Élite de Director de Comunicaciones",
      "leads": 2,
      "ultimo": "2026-08-18T14:27:46.676Z",
      "familia": "DIPSTC",
      "origenFamilia": "alias",
      "aliasFamilia": "director de comunicaciones",
      "vendedoras": []
    },
    {
      "curso": "Diploma Internacional en Ciberinteligencia y Ciberdefensa",
      "leads": 4,
      "ultimo": "2026-08-18T14:27:46.676Z",
      "familia": "DIPCINTE",
      "origenFamilia": "alias",
      "aliasFamilia": "ciberinteligencia y ciberdefensa",
      "vendedoras": []
    },
    {
      "curso": "Curso de especialización en Estrategia Territorial en campañas electorales",
      "leads": 2,
      "ultimo": "2026-08-18T14:27:46.676Z",
      "familia": "EPCVETC",
      "origenFamilia": "alias",
      "aliasFamilia": "estrategia territorial en campanas electorales",
      "vendedoras": []
    },
    {
      "curso": "Master Agente de Inteligencia Artificial-Para Directivos Y Gerentes",
      "leads": 1,
      "ultimo": "2026-08-18T14:27:46.677Z",
      "familia": "DIPICOT",
      "origenFamilia": "alias",
      "aliasFamilia": "inteligencia",
      "vendedoras": []
    },
    {
      "curso": "Diploma Internacional del Asesor Presidencial",
      "leads": 1,
      "ultimo": "2026-08-18T14:27:46.677Z",
      "familia": "DIPASEPRE",
      "origenFamilia": "alias",
      "aliasFamilia": "asesor presidencial",
      "vendedoras": []
    },
    {
      "curso": "Diploma Internacional del Director de Seguridad",
      "leads": 2,
      "ultimo": "2026-08-18T14:27:46.677Z",
      "familia": "DIPDIRS",
      "origenFamilia": "alias",
      "aliasFamilia": "director de seguridad",
      "vendedoras": []
    },
    {
      "curso": "Diploma Internacional en Marketing Político Digital",
      "leads": 1,
      "ultimo": "2026-08-18T14:27:46.677Z",
      "familia": "DIPIAMP",
      "origenFamilia": "alias",
      "aliasFamilia": "marketing politico",
      "vendedoras": []
    },
    {
      "curso": "Diploma Internacional de Inteligencia y Contrainteligencia",
      "leads": 35,
      "ultimo": "2026-08-18T14:27:46.677Z",
      "familia": "DIPICOT",
      "origenFamilia": "alias",
      "aliasFamilia": "inteligencia y contrainteligencia",
      "vendedoras": []
    },
    {
      "curso": "Programa Premium ChatGPT Pro para consultoría política 4×4",
      "leads": 3,
      "ultimo": "2026-08-18T14:27:46.677Z",
      "familia": "DIPCPOL",
      "origenFamilia": "alias",
      "aliasFamilia": "consultoria politica",
      "vendedoras": []
    },
    {
      "curso": "Diploma Internacional en IA y Marketing Político",
      "leads": 5,
      "ultimo": "2026-08-18T14:27:46.678Z",
      "familia": "DIPIAMP",
      "origenFamilia": "alias",
      "aliasFamilia": "ia y marketing politico",
      "vendedoras": []
    },
    {
      "curso": "Diploma de Especialización Bicameral para Diputados, Senadores y Equipo Técnico Parlamentario",
      "leads": 1,
      "ultimo": "2026-08-18T14:27:46.678Z",
      "familia": "GEN5C2G3",
      "origenFamilia": "alias",
      "aliasFamilia": "bicameral",
      "vendedoras": []
    },
    {
      "curso": "Diploma Internacional en Inteligencia Operativa Policial y Seguridad Ciudadana",
      "leads": 4,
      "ultimo": "2026-08-18T14:27:46.678Z",
      "familia": "DIPICOT",
      "origenFamilia": "alias",
      "aliasFamilia": "inteligencia",
      "vendedoras": []
    }
  ],
  "productos": [
    {
      "familia": "EPCVETC",
      "nombre": "Curso de especialización en Estrategia Territorial en campañas electorales"
    },
    {
      "familia": "EPCOORP",
      "nombre": "Curso de Especialización en Oratoria e Imagen Política"
    },
    {
      "familia": "GEN5C2G3",
      "nombre": "Diploma de Especialización Bicameral para Diputados, Senadores y Equipo Técnico Parlamentario"
    },
    {
      "familia": "DIPSTC",
      "nombre": "Diploma Élite de Director de Comunicaciones"
    },
    {
      "familia": "DIPGESPA",
      "nombre": "Diploma Élite del Gestor Parlamentario"
    },
    {
      "familia": "DIPDIRS",
      "nombre": "Diploma Élite Internacional de Director de Seguridad Corporativo"
    },
    {
      "familia": "INCOPIE",
      "nombre": "Diploma Internacional de Élite en Criminología y Ciencias Forenses"
    },
    {
      "familia": "DIPICOT",
      "nombre": "Diploma Internacional de Inteligencia y Contrainteligencia"
    },
    {
      "familia": "DIPOPPSS",
      "nombre": "Diploma Internacional de Operaciones Psicológicas y Psicosociales Senior"
    },
    {
      "familia": "DIPASEPRE",
      "nombre": "Diploma Internacional del Asesor Presidencial"
    },
    {
      "familia": "DIPCPOL",
      "nombre": "Diploma Internacional del Consultor Político"
    },
    {
      "familia": "DIPCINTE",
      "nombre": "Diploma Internacional en Ciberinteligencia y Ciberdefensa"
    },
    {
      "familia": "DIPIAMP",
      "nombre": "Diploma Internacional en IA y Marketing Político"
    },
    {
      "familia": "DIPOSOC",
      "nombre": "Diploma técnico en Osint & Socmint"
    }
  ],
  "anunciosSinResolver": 0,
  "campanasEnOtraLinea": 45,
  "actualizadoAt": "2026-08-18T16:27:46.687Z",
  "sinMigracion": false,
  "destinos": [
    "Luz",
    "Sindy",
    "Tracy",
    "ventas10@grupogoberna.com",
    "ventas11@grupogoberna.com",
    "ventas12@grupogoberna.com"
  ]
};


/** Los productos elegibles: las familias conocidas + las que sólo están en Cerberus. */
const ELEGIBLES = {
  familias: [
    { familia: 'DIPCPOL', nombre: 'Diploma Internacional del Consultor Político', conocida: true },
    { familia: 'EPCOGPT', nombre: 'Programa Premium ChatGPT Pro 4x4', conocida: false },
    { familia: 'DIPICOT', nombre: 'Inteligencia y Contrainteligencia', conocida: true },
    { familia: 'DIPIOPS', nombre: 'Inteligencia Operativa Policial y Seguridad Ciudadana', conocida: false },
    { familia: 'DIPOSOC', nombre: 'Osint & Socmint', conocida: true },
    { familia: 'DIPIAMP', nombre: 'IA y Marketing Político', conocida: true },
    { familia: 'DIPCIBE', nombre: 'Ciberdefensa, Hacking Ético e Ingeniería Social', conocida: true },
    { familia: 'DIPECOC', nombre: 'Crimen Organizado', conocida: false },
  ],
  catalogoCaido: false,
};

createServer((req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', '*');
  res.setHeader('access-control-allow-methods', '*');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  const json = (cuerpo, estado = 200) => {
    res.writeHead(estado, { 'content-type': 'application/json' });
    res.end(JSON.stringify(cuerpo));
  };

  const u = req.url.split('?')[0];
  // ⚠️ La forma es `{ vendedora: {...} }`, NO `{ vendedoraId }`: `sesion.ts:119`
  // hace `setVendedora(r.vendedora)`, así que con la otra forma queda `undefined`
  // y la app muestra el LOGIN — con el token puesto, sano y sin un solo error.
  // Costó una captura entender por qué no entraba.
  if (u === '/api/auth/yo') return json({ vendedora: { id: 'Usuario1', nombre: 'Usuario1' }, cerberus: true });
  if (u === '/api/routing/productos-elegibles') return json(ELEGIBLES);
  if (u === '/api/routing') return json(FOTO);
  if (u === '/api/routing/pieza-producto') return json({ ok: true });

  // Todo lo demás falla, que es lo que mantiene a la pantalla en su estado real.
  return json({ ok: false, message: 'stub' }, 503);
}).listen(4199, () => console.log('stub de routing en :4199 — datos reales del 18-ago-2026'));
