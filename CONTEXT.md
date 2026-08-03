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
> **Y esto vale también para el bot** (decisión del 3-ago-2026, al diseñar la página de
> entrenamiento). Hoy el bot dice «lead» en todos lados —el prompt, `bot_memoria_lead`, sus docs—,
> y eso es deuda que se paga renombrando de a poco, no un dialecto aparte. Toda superficie nueva
> dice **persona**.

**Conversación**:
El hilo con una persona por un canal y un número propio. La unidad de trabajo de la vendedora: se
atiende una conversación, no un mensaje suelto.
_Evitar_: interacción — una interacción es un hecho individual (un mensaje, un comentario), y una
conversación agrupa muchos.

**Comentario**:
Un mensaje público en una publicación de Facebook o Instagram. A diferencia de una conversación,
sigue siendo individual: cada comentario es su propia fila, y es lo único que tiene Ventana.

### El bot y lo que se le enseña

**Lo que el bot sabe** · **lo que el bot es**:
Los dos lados del contenido del bot, y la línea que los separa decide quién puede cambiar qué.
**Sabe** es el material con el que trabaja —los datos que puede afirmar, las lecciones— y cambia
seguido, sin desplegar. **Es** son su identidad y sus reglas duras: cambian con revisión, porque un
error ahí no se nota hasta que ya salió.
_Evitar_: «configuración» y «parámetros» para el conjunto — esconden que una mitad se toca en
caliente y la otra no.

**Lección**:
Una instrucción que se le agrega al bot a partir de algo que se vio que hizo mal. Es lo único que se
le puede *enseñar* en caliente. No es una regla dura: una regla define lo que el bot es y se cambia
con revisión; una lección corrige un comportamiento y se escribe mientras se lo mira trabajar.
_Evitar_: ejemplo, corrección, ajuste — ninguno dice que el bot la lleva puesta en cada conversación
siguiente.

**Replay**:
Volver a correr una conversación que ya pasó, con el bot tal como está hoy, para ver qué diría
ahora. No reproduce el pasado: enfrenta a la persona real de entonces con el bot de ahora.
_Evitar_: simulación, test — una simulación inventa el caso y acá el caso es real; un test pasa o
falla y esto casi siempre pide un juicio.

**Calificación**:
El veredicto de una vendedora sobre una respuesta del bot: si sirve para vender y por qué. Es el
único dato que ninguna regla automática puede dar, y por eso lo da quien vende, y lo da **donde
atiende** — no en una pantalla aparte a la que hay que ir.
_Evitar_: puntaje, rating, feedback — el valor está en el porqué, no en el número.

**Corrida**:
Un replay entero, con nombre e identidad: contra qué borrador se corrió, qué contestó el bot en cada
conversación y qué dijeron de eso las reglas. Es la unidad que se compara — «la corrida de ayer
contra la de hoy»—, y por eso una respuesta de corrida **nunca** se guarda junto a las que el bot le
mandó a una persona: mezclarlas corrompe la medición y borra la diferencia entre lo que pasó y lo
que habría pasado.
_Evitar_: ejecución, batch, experimento — no dicen que el resultado es comparable con otro.
