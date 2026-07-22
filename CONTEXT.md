# Hermes

El CRM de la Escuela de Goberna. Una vendedora atiende desde una sola pantalla a toda la gente
que levantó la mano por Facebook, Instagram, Messenger y WhatsApp, y registra la venta contra
Cerberus.

Este archivo es un **glosario y nada más**: qué significa cada palabra del negocio. Las
decisiones viven en `docs/adr/`, el estado en `docs/estado.md`.

## Language

### El turno de la conversación

**Deuda**:
Una conversación cuyo último mensaje es de la persona. La respuesta la debemos nosotros.
_Evitar_: pendiente, sin responder, sin atender — ninguno dice **de quién es el turno**, que es
lo único que importa para decidir qué hacer.

**Silencio**:
Una conversación cuyo último mensaje es nuestro y la persona no volvió.
_Evitar_: seguimiento — en Hermes un seguimiento es un recordatorio agendado, otra cosa distinta.
_Evitar_: sin respuesta — se confunde con Deuda, que es exactamente lo contrario.

Deuda y Silencio son **estados opuestos** que piden acciones opuestas. Toda superficie que liste
conversaciones tiene que distinguirlos; mezclarlos es lo que vuelve ilegible una lista.

### El paso del tiempo

**Ventana**:
Los **7 días** que da Meta para responder **en privado** al comentario público de una persona en
Facebook o Instagram. Es un plazo duro: cuando se cierra, esa puerta se cierra de verdad.
**En WhatsApp no existe ninguna ventana** — el número está vinculado como dispositivo de un
teléfono real, no como cuenta de negocio, así que ahí no hay nada que se cierre.
_Evitar_: ventana de 24 h — esa es la regla de la API de negocios de Meta, que Hermes no usa.

**Enfriamiento**:
La pérdida de valor de un lead por el tiempo que pasa sin respuesta. **No es un plazo**: no vence
nada, pero cada hora que pasa vale menos. Es lo que ordena a las conversaciones de WhatsApp, donde
no hay ventana.
_Evitar_: caliente y frío como estados binarios; «relevancia».

**Vencido**:
Un seguimiento cuya fecha ya pasó. Es el otro plazo duro del sistema, y es el único que se pone
la vendedora a sí misma.

### Cómo entra la gente

**Persona**:
El ser humano del otro lado, con una identidad estable a través de todos los canales. No es la
cuenta, ni el teléfono, ni el nombre que se puso en WhatsApp — ese nombre suele ser un emoji.
_Evitar_: contacto, lead, usuario cuando se habla del ser humano.

**Conversación**:
El hilo con una persona por un canal y un número propio. La unidad de trabajo de la vendedora: se
atiende una conversación, no un mensaje suelto.
_Evitar_: interacción — una interacción es un hecho individual (un mensaje, un comentario), y una
conversación agrupa muchos.

**Comentario**:
Un mensaje público en una publicación de Facebook o Instagram. A diferencia de una conversación,
sigue siendo individual: cada comentario es su propia fila, y es lo único que tiene Ventana.
