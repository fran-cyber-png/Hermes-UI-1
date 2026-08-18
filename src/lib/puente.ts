/**
 * EL PUENTE — cómo una vista le pasa el mando a otra sin router (ADR 0002).
 *
 * App.tsx guarda un único `puente` y la vista destino lo consume como prop
 * inicial, limpiándolo al usarlo. Sin API nueva: es estado local del shell.
 */

/**
 * A QUIÉN SE LE ESCRIBE, Y DESDE QUÉ CONVERSACIÓN.
 *
 * 🔴 **`clave` NO ES DECORACIÓN: es la columna que `correos` tiene desde el
 * 21-jul-2026 y que NUNCA se llenó.** Las 3 filas que hay en producción la
 * tienen `NULL`, y el motivo es exactamente éste: el front mandaba
 * `{para, asunto, cuerpo}` y nada más. La columna existía, la intención estaba
 * escrita en el schema, y el dato no existió nunca.
 *
 * Lo que cuesta que falte no se ve en la pantalla de Correos —el correo sale
 * igual—: se ve en todo lo demás. Sin `clave`, ese correo **no aparece en el
 * timeline del contacto** (ADR 0037), **no entra en ninguna medición** de qué
 * se le mandó a quién (ADR 0022) y **no se cruza con la venta** (`atribucion/`).
 * O sea que el canal escribe y el CRM no se entera.
 *
 * ⚠️ **`clave` es opcional a propósito y no puede dejar de serlo**: se puede
 * escribir un correo desde la vista Correos a secas, sin conversación de
 * origen. Lo que no puede pasar es que el puente la TENGA y no la mande.
 * `nombre` es solo para saludar en la pantalla; nunca viaja al server como
 * identidad.
 */
export type DestinoCorreo = { para: string; clave?: string; nombre?: string };

export type Puente =
  | { tipo: 'chat'; telefono: string } // → Mensajes: abre (o crea) el chat con ese número
  | { tipo: 'persona'; telefono: string } // → Contactos: busca la ficha
  | { tipo: 'correo'; para: string; clave?: string; nombre?: string } // → Correos: prellena el Para y ata el correo a su conversación
  | { tipo: 'agenda'; telefono: string | null; nota?: string }; // → Agenda: abre Crear precargado (p. ej. bienvenida post-venta)
