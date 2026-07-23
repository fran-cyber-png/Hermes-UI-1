import type { ReactNode } from "react";
import { abrirExterno } from "../../lib/enlacesExternos";
import { parsearWhatsapp, type NodoFormato } from "../../lib/formatoWhatsapp";

/**
 * Pinta un texto de WhatsApp COMO LO VE EL CLIENTE: *negrita*, _cursiva_,
 * ~tachado~, ```monoespaciado``` y enlaces. Así la vendedora previsualiza lo que
 * manda y lo que recibe, en vez de ver los asteriscos crudos (issue #54).
 *
 * El parseo vive en `lib/formatoWhatsapp` (puro, testeado sin DOM); acá solo se
 * pinta el árbol. El MISMO parser alimenta el preview de los mensajes
 * predeterminados (#45) — por eso está separado.
 *
 * Neutro por diseño: negrita/cursiva del sistema. El oro (tiempo que se acaba)
 * NO resalta texto de mensajes.
 */

function pintar(nodos: NodoFormato[]): ReactNode {
  return nodos.map((n, i) => {
    switch (n.tipo) {
      case "texto":
        return <span key={i}>{n.valor}</span>;
      case "negrita":
        return (
          <strong key={i} className="font-semibold">
            {pintar(n.hijos)}
          </strong>
        );
      case "cursiva":
        return <em key={i}>{pintar(n.hijos)}</em>;
      case "tachado":
        return <s key={i}>{pintar(n.hijos)}</s>;
      case "mono":
        return (
          <code key={i} className="rounded bg-foreground/5 px-1 font-mono text-[0.92em]">
            {n.valor}
          </code>
        );
      case "enlace":
        return (
          <a
            key={i}
            href={n.href}
            onClick={(e) => {
              e.preventDefault();
              abrirExterno(n.href);
            }}
            className="underline decoration-current/40 underline-offset-2 hover:decoration-current"
          >
            {n.valor}
          </a>
        );
    }
  });
}

export function TextoWhatsapp({ texto }: { texto: string }) {
  return <>{pintar(parsearWhatsapp(texto))}</>;
}
