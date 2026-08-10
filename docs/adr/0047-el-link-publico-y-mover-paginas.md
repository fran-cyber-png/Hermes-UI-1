# ADR 0047 — El link público de una página, y mover páginas de lugar

- **Fecha**: 2026-08-10
- **Estado**: aceptada
- **Decide**: Estephano («que también te deje compartir una sola nota con un link, y que puedas mover
  la libreta a un espacio compartido»). Las dos decisiones de forma, en §1.
- **Se apoya en**: **ADR 0046** (los espacios y la regla de visibilidad). No la revierte.
- **Mapa**: `docs/mapa-libreta.md`

## 1 · Las dos decisiones del dueño

1. **El link lo abre cualquiera que lo tenga, sin login — y se puede cortar.**
2. **Mover mueve de verdad, en las dos direcciones**: la página deja de estar donde estaba, y se
   puede traer de vuelta.

## 2 · 🔴 El link es la PRIMERA PUERTA ANÓNIMA de Hermes

`auth/perimetro.ts` es **cerrado por defecto**, y es la cicatriz del issue #36: antes cada router
decidía por su cuenta si pedía token y **19 de 27 quedaron abiertos a internet** —la cola, los hilos,
los adjuntos de clientes reales—. Las tres excepciones de hoy (`/api/auth`, `/api/admin`,
`/api/catalogo`) son **credenciales de servicio**: ninguna sirve contenido a quien no presenta nada.

Ésta sí. Las decisiones que la hacen aceptable, y **ninguna es opcional**:

- **Vive FUERA de `/api`** (`/n/<token>`, `routes/publico.ts`). Una excepción *dentro* de `/api` sería
  un prefijo que el próximo router hereda sin que nadie lo note — la forma exacta que tuvo el #36.
- **El token es aleatorio de 128 bits (`randomBytes`), nunca el id.** Con el id, `/n/1`, `/n/2`, `/n/3`
  es el listado completo de la libreta de todo el mundo, y no hay arreglo posterior que no rompa los
  links ya repartidos.
- **Se descarta lo que no tiene forma de token ANTES de tocar la base**: si no, `/n/<lo que sea>` es
  una consulta gratis por request desde afuera del perímetro.
- **Solo lectura, y solo esa página.** La respuesta lleva `titulo`, `texto` y `doc` — **no** la autora,
  ni el espacio, ni los miembros, ni las fechas, ni el id. Fijado con un test que compara las claves.
- **Cortar es BORRAR la fila**, no marcar un flag: un `activo=false` invita a cachear el «sí» de antes.
  Y hay **un solo link por página** (índice UNIQUE): con dos, cortar uno deja el otro vivo y quien
  apretó «Cortar» cree que cerró la puerta.
- **`noindex, nofollow` + `Referrer-Policy: no-referrer` + `Cache-Control: no-store`.** Sin el primero,
  el primer link pegado en un chat con vista previa termina en Google, y ahí «solo quien tiene el
  link» deja de ser cierto para siempre — incluso después de cortarlo.
- **Un token que no existe, uno cortado y una página archivada contestan LO MISMO** (404, mismo HTML).
  Distinguirlos le diría a un desconocido si un token existió. Es al revés que en `/api/espacios`,
  donde 404 y 403 sí se separan porque del otro lado hay una compañera que necesita entender qué pasó.
- **Archivar una página la saca del link.** Archivar es lo más parecido a «sacala de circulación» que
  tiene la Libreta; si el link sobreviviera, dejaría de significar eso justo para el público más
  amplio que la página tuvo.

### El HTML lo arma el server, y es puro

`espacios/paginaPublica.ts`, **separado del router** porque `routes/publico.ts` importa `db` y un test
puro no podría ni cargarlo. Y acá el test puro es lo que más importa del frente: **es el único lugar
de Hermes donde texto escrito por una persona se convierte en HTML para un desconocido.** El escape no
es higiene — es la diferencia entre una página y un vector.

⚠️ **Se pinta desde `texto`, no desde `doc`**: renderizar BlockNote del lado del server pediría su
runtime (o una segunda implementación de su serialización), y con eso entraría a la ruta anónima la
superficie más grande del sistema. **Y no lleva una sola línea de JavaScript.**

## 3 · Mover es un `UPDATE` de `espacio_id`

La página **no se copia**: conserva id, autoría, fechas y **su link**. Lo único que cambia es quién la
ve.

Se descartó copiar con un motivo concreto: dos copias se editan por separado y a las dos semanas dicen
precios distintos **sin que nada avise cuál vale**. Un CRM no puede tener dos respuestas a «¿cuánto
sale?».

- 🔴 **Se piden los DOS permisos, y son distintos.** `puedeEditar` sobre el origen (si no, mover es la
  puerta de atrás para **leer** lo que la frontera niega: adivinás un id y te la llevás a tu libreta)
  y `puedeEscribirEn` sobre el destino (si no, es la puerta de atrás para **plantar**). No se escribe
  ninguna regla nueva: se componen las de ADR 0046.
- 🔴 **Traer una página del espacio a tu libreta SE LA SACA AL EQUIPO**, y es lo único de este frente
  que nadie espera. La pantalla lo pregunta **nombrando a la gente** («Sindy y ventas10 dejan de
  verla»), no con un «¿estás segura?». Compartir *hacia* un espacio no pregunta nada: no le quita
  nada a nadie.
- ⚠️ **Mover NO toca `editado_at`**: la página no cambió una letra, cambió quién la ve. Si lo tocara,
  «editada» significaría dos cosas y la lista mostraría actividad donde no la hubo.
- Mover a donde ya está no escribe nada y contesta 200: es un clic de más, no un error.

## 4 · El tope de una página: de 2.000 a 20.000

Los 2.000 se eligieron para una **nota pegada a una conversación** (#47). Con espacios compartidos la
unidad pasó a ser **una página del equipo**, y ahí el número estaba mal medido.

> 🔴 **Medido el 10-ago-2026: el playbook que el equipo YA mantiene —los 27 `hechos` activos— son
> 5.267 caracteres.** O sea que lo que la vendedora querría poner en un espacio **no entraba**:
> entraba en tres páginas. Un tope que parte en tres lo único que alguien mantiene no es una guarda,
> es un defecto.

Subirlo es expand-only: nada guardado deja de validar. El tope real contra el abuso sigue siendo
`TOPE_DOC_BYTES` (512 KB del `jsonb`), que es lo que acota lo que entra a la base.

⚠️ **El número vive en dos lados** (server y front, que redacta el aviso) y **ya se desincronizaron el
mismo día**. Candado: `notas/limiteTexto.paridad.test.ts` lee el archivo del front y falla si divergen
— verificado por mutación. El defecto que evita no rompe nada: la pantalla explica el tope con un
número que ya no rige, y el mensaje **suena** correcto.

## 5 · Lo que se cerró de ADR 0046

Dos rutas quedaron sin botón y una sin existir. Van acá porque son lo que hacía inútil el frente
anterior:

- **Archivar un espacio** tenía API y **ningún botón**: un espacio que ya no hacía falta se quedaba en
  la lista para siempre.
- **Renombrar un espacio no existía**: un nombre mal puesto no tenía arreglo desde la app. El nombre
  no es la identidad (esa es el `id`), así que renombrar no rompe links ni membresías.
- **La lista dice cuáles páginas están afuera** (🔗). Sin eso, compartir sería una acción **sin
  inventario**: se abre un link, pasan dos semanas, y ninguna pantalla contesta «¿qué tengo
  publicado?».

## 6 · Lo que NO hace

- **No cuenta visitas.** Sería analítica sobre gente que no dio su consentimiento, y para decidir si
  el link sirve alcanza con saber si se usó más de una vez.
- **No vence solo.** Se evaluó (§ opción 3 de la pregunta) y se descartó: el link que le mandaste a un
  lead se moriría justo cuando vuelve a preguntar por el precio. Se corta a mano, que es explícito.
- **No permite editar ni comentar.** Es una página, no una puerta.
- **No lleva marca fuerte de Goberna**, solo un pie sobrio: una página que parece un documento oficial
  invita a reenviarla como si lo fuera.
- **No hay imágenes** (siguen fuera del editor) ni **papelera** — los dos están en el mapa, con lo que
  cuestan.

## 7 · Cómo se sabe si estuvo bien

Para el link, la única pregunta que importa: **¿se usó más de una vez?** Un link creado y nunca
compartido es un botón bonito.

```sql
SELECT count(*) AS links_vivos, count(DISTINCT nota_id) AS paginas, min(creado_at) AS el_primero
FROM nota_link;
```

Capturas: `docs/evidencia/libreta-link-desktop.png`, `libreta-mover-aviso-desktop.png`.
