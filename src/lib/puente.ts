/**
 * EL PUENTE — cómo una vista le pasa el mando a otra sin router (ADR 0002).
 *
 * App.tsx guarda un único `puente` y la vista destino lo consume como prop
 * inicial, limpiándolo al usarlo. Sin API nueva: es estado local del shell.
 */
export type Puente =
  | { tipo: 'chat'; telefono: string } // → Mensajes: abre (o crea) el chat con ese número
  | { tipo: 'persona'; telefono: string } // → Contactos: busca la ficha
  | { tipo: 'correo'; para: string } // → Correos: prellena el Para
  | { tipo: 'agenda'; telefono: string | null; nota?: string }; // → Agenda: abre Crear precargado (p. ej. bienvenida post-venta)
