import { Router } from 'express';
import { db } from '../db/client.js';
import { CABECERAS_PUBLICAS } from '../espacios/link.js';
import { NO_EXISTE, paginaHtml } from '../espacios/paginaPublica.js';
import { leerPorToken } from '../espacios/linkRepositorio.js';

/**
 * LA PÁGINA PÚBLICA DE UNA NOTA — `/n/<token>` (ADR 0047).
 *
 * 🔴 **ES LA ÚNICA RUTA DE HERMES QUE SIRVE CONTENIDO SIN CREDENCIAL**, y por eso
 * vive acá, en su propio archivo, y **fuera de `/api`**.
 *
 * Fuera de `/api` no es un detalle de gusto: `auth/perimetro.ts` es cerrado por
 * defecto justamente porque la auth por-router se olvida (issue #36: 19 de 27
 * routers habían quedado abiertos). Meter una excepción DENTRO de `/api` la
 * convierte en un prefijo que el próximo router hereda sin que nadie lo note. Acá
 * la ruta no está exenta de nada: está en otro lado.
 *
 * ⚠️ **Devuelve HTML servido por el server, no la app de React.** La app entera
 * son ~1 MB de bundle, pide sesión al montar y hablaría con `/api` — o sea que
 * para servir 200 palabras a un desconocido habría que abrirle medio Hermes.
 * Acá se arma el HTML mínimo y no hay JavaScript.
 */
export const publicoRouter = Router();

/**
 * ⚠️ **UN TOKEN QUE NO EXISTE, UNO CORTADO Y UNA PÁGINA ARCHIVADA CONTESTAN LO
 * MISMO**: 404 con el mismo HTML. Distinguirlos le diría a un desconocido si un
 * token *existió alguna vez*, que es información que no tiene por qué tener — y
 * es lo contrario de lo que hace `/api/espacios`, donde 404 y 403 sí se separan
 * porque del otro lado hay una compañera de trabajo que necesita entender qué
 * pasó.
 */
publicoRouter.get('/:token', async (req, res) => {
  const pagina = await leerPorToken(db, req.params.token);
  res.set(CABECERAS_PUBLICAS);
  res.type('html');
  if (!pagina) {
    res.status(404).send(NO_EXISTE);
    return;
  }
  res.send(paginaHtml(pagina.titulo, pagina.texto));
});
