# El mapa de la Libreta — qué hace hoy, qué le falta, y en qué orden

> **10-ago-2026.** Pedido: «mapear bien todas las funciones para que sea útil», más dos frentes
> nuevos (link de una nota, mover páginas entre lugares).
>
> Todo lo de acá está **verificado contra el código y contra producción**, no recordado. Lo que no
> se pudo verificar se dice.

---

## 0 · La foto, en una línea

La Libreta pasó de **privada por autora** (ADR 0012) a **espacios compartidos** (ADR 0046) esta
mañana. Lo que hay hoy alcanza para escribir y compartir; **lo que falta es casi todo lo que hace
que alguien vuelva al día siguiente**.

Y el dato que ordena las prioridades, medido hoy en producción:

```
notas             6 páginas · 65 caracteres en total · todas son pruebas
hechos           27 piezas · 5.267 caracteres · editadas 4 días distintos ← ESTO SÍ SE MANTIENE
```

> 🔴 **El playbook que el equipo YA mantiene son 5.267 caracteres, y el tope de una página es
> 2.000.** Lo que la vendedora querría poner en un espacio compartido **no entra**. Ese tope se
> diseñó para una nota pegada a un chat (#47), no para una página de equipo.

---

## 1 · Qué hace hoy — el inventario completo

Leyenda: ✅ anda · ⚠️ anda a medias o con una trampa · ❌ no existe

### La página

| | Función | Nota |
|---|---|---|
| ✅ | Crear, escribir, autoguardado a los 800 ms | El destino se captura al AGENDAR, no al disparar |
| ✅ | El fallo de guardado **se ve, con su motivo** | `fallo` le gana a `guardado` siempre |
| ✅ | Fijar / desfijar | Sube al tope de su lugar |
| ✅ | Archivar, con **Deshacer** al pie de la lista | |
| ⚠️ | **El título es la primera línea**, no un campo | No se puede renombrar sin editar el cuerpo |
| ❌ | **Ver lo archivado** (papelera) | Pasado el «Deshacer», la página **no se recupera desde la app** |
| ❌ | **Mover de lugar** | ← **se construye ahora** |
| ❌ | **Link para compartir** | ← **se construye ahora** |
| ❌ | Duplicar · exportar · imprimir · historial de versiones | |

### El editor (BlockNote 0.52.1)

| | Función | Nota |
|---|---|---|
| ✅ | Párrafos, 3 niveles de título, listas, checklist, tabla, cita, código | |
| ✅ | Menú `/` y toda la interfaz **en español con voseo** | La locale `es` es peninsular; se pisa a mano |
| ✅ | Un bloque desconocido **no tumba la app** | `soloBloquesConocidos` — sin esto la ventana queda en blanco |
| ❌ | **Imágenes y archivos** | Retirados a propósito: sin `uploadFile` una página que sea solo imagen aplana a vacío y **no se guarda nunca** |
| 🔴 | **Tope de 2.000 caracteres** del texto aplanado | El playbook real son 5.267. **Es el techo que más duele hoy** |
| ✅ | Tope de 512 KB del documento | Frena lo que no es una nota |
| ❌ | Edición simultánea (Yjs) | Decidido como destino; frente propio |

### Los espacios (ADR 0046, de esta mañana)

| | Función | Nota |
|---|---|---|
| ✅ | Crear con miembros elegidos del padrón (9 personas) | Un desconocido es 409 enumerando a quién sí |
| ✅ | Agregar y sacar miembros | Solo quien lo creó |
| ✅ | La creadora **no se puede sacar** | El espacio quedaría imposible de administrar |
| ⚠️ | **Archivar el espacio: la API existe y NO tiene botón** | Ruta huérfana que dejó el PR #327 |
| 🔴 | **Renombrar un espacio: no se puede** | Un nombre mal puesto **no tiene arreglo desde la app** |
| ❌ | Salirte vos misma de un espacio | Solo te saca quien lo creó |
| ❌ | Espacios anidados / carpetas | |

### Buscar y navegar

| | Función | Nota |
|---|---|---|
| ✅ | Búsqueda GIN en español sobre **todo lo visible** | Mi libreta + mis espacios |
| ❌ | Acotar la búsqueda a un espacio | Busca en todo o nada |
| ❌ | Buscar dentro de la página abierta | |
| ✅ | `⌘8` y la tecla `n` · selector de lugares · maestro-detalle en teléfono | |
| ✅ | Orden: fijada → más nueva | Sin orden manual ni arrastrar |

---

## 2 · Los cinco agujeros que la vuelven poco útil

Ordenados por lo que cuesta **no** tenerlos, no por lo que cuesta hacerlos.

1. 🔴 **El tope de 2.000 caracteres.** Medido: el playbook que el equipo mantiene son 5.267. La
   vendedora escribe, choca, y **el aviso llega recién al guardar**. Todo lo demás de esta lista es
   inútil si lo que se quiere escribir no entra.
2. 🔴 **No hay imágenes.** El 42 % de las ventas lleva imagen y el precio muchas veces **vive adentro
   del flyer**. Una página «precios» sin el flyer es media página. ⚠️ Arrastra infraestructura de
   verdad (disco en VPS1 sin GC, sin cuota, sin backup escrito), así que es un frente propio.
3. 🔴 **Archivar no tiene vuelta atrás.** Pasado el «Deshacer» de la lista, la página existe en la
   base y **no hay ninguna pantalla que la muestre**. En una libreta privada es molesto; en un
   espacio compartido es que **alguien archiva algo del equipo y no hay cómo traerlo**.
4. 🔴 **Un espacio no se puede renombrar ni archivar desde la app.** El primer espacio que alguien
   cree con un nombre mal puesto se queda así para siempre.
5. ⚠️ **La página no tiene título propio.** El título es la primera línea, así que renombrar obliga a
   editar el cuerpo, y una página que empieza con una tabla se llama «Sin título».

---

## 3 · Lo que se decidió hoy

### 3.1 · El link de una nota — **público, solo lectura, revocable**

> Decisión del dueño (10-ago): *cualquiera con el link, y se puede cortar.*

🔴 **Esto es la primera puerta ANÓNIMA del perímetro, y hay que tratarla como tal.**
`auth/perimetro.ts` es cerrado por defecto —cicatriz del issue #36, donde 19 de 27 routers habían
quedado abiertos a internet— y sus tres excepciones de hoy (login, `/api/admin`, `/api/catalogo`)
son **credenciales de servicio**, no acceso sin nada. Esta sería la primera ruta que le sirve
contenido de negocio a alguien que no presenta ninguna credencial.

Lo que la hace aceptable, y **ninguna de estas es opcional**:

- **Vive fuera de `/api`** (`/n/<token>`), para no abrirle un agujero al perímetro. Un prefijo
  exento dentro de `/api` sería una excepción que el próximo router hereda sin querer.
- **El token es aleatorio de 128 bits**, no el id de la nota. Con el id, `\n/1`, `\n/2`, `\n/3` es
  el listado entero de la libreta de todo el mundo.
- **Solo lectura y solo esa página.** No expone autora, ni espacio, ni miembros, ni las otras
  páginas: se sirve **texto y documento, nada más**.
- **Se corta en un clic, y cortar es inmediato** (no hay caché entre medio).
- **`noindex` + `nofollow` + `Referrer-Policy`**, o el primer link que alguien pegue en un chat
  público termina en Google.
- **No se puede compartir una página de un espacio del que no sos miembro**, obvio, pero también:
  **el link sobrevive a que te saquen del espacio**, así que cortar los links propios es parte de
  sacar a alguien. Va escrito porque es lo que no se ve.
- **Muestra la versión actual, en vivo.** Editás la página y el link cambia con ella — es una nota,
  no un PDF.

⚠️ **Lo que NO hace**: no permite editar, no pide correo, no cuenta visitas (eso sería analítica de
gente que no dio su consentimiento), y **no lleva la marca de Goberna más allá de un pie sobrio**:
una página que parece oficial invita a reenviarla como si lo fuera.

### 3.2 · Mover una página — **de verdad, en las dos direcciones**

> Decisión del dueño (10-ago): *mueve y deja de estar donde estaba; se puede traer de vuelta.*

- Mover es **un `UPDATE` de `espacio_id`**, y por eso es barato: la página no se copia, no cambia de
  id, no pierde su autoría ni su historial de edición, y **su link sigue funcionando**.
- 🔴 **Traer una página del espacio a tu libreta privada SE LA SACA AL EQUIPO**, y eso es lo único
  de este frente que nadie espera. Se pregunta con las personas nombradas —«Sindy y ventas10 dejan
  de verla»— y no con un «¿estás segura?», que no dice nada.
- **Solo se mueve a un lugar del que sos miembro** (la misma `puedeEscribirEn` que ya existe): si no,
  mover sería la puerta de atrás para plantar una página en un espacio ajeno.
- ⚠️ **Mover NO es archivar.** Una página movida sigue viva; lo que cambia es quién la ve.

---

## 4 · El orden

| | Qué | Por qué acá | Toca server |
|---|---|---|---|
| **1** | **Mover** + **subir el tope** + renombrar/archivar espacio + papelera | Lo barato que quita los frenos. Sin el tope, lo demás no importa | sí |
| **2** | **El link público** | Frente propio: es una puerta anónima y merece su ADR | sí |
| **3** | Imágenes y archivos | Infra de verdad (disco, GC, cuota, backup) | sí |
| **4** | Edición simultánea (Yjs) | nginx de VPS1 + transporte + la trampa de `texto` derivado | sí |

**El 1 y el 2 son lo que pediste.** El 3 y el 4 quedan escritos para que no se pierdan, con lo que
cuesta cada uno medido y no estimado a ojo.

---

## 5 · Lo que este mapa NO propone, y por qué

| | |
|---|---|
| **Jerarquía de páginas / carpetas** | Con 6 páginas en toda la base, es estructura para contenido que no existe. Los espacios ya son un nivel. |
| **Comentarios en la página** | `@blocknote/comments` arrastra `ThreadStore` + notificaciones. Y hoy nadie escribe: comentar sobre lo que nadie escribió es agregar un piso a una casa sin paredes. |
| **Plantillas de página** | Sin una sola observación de qué se escribe, una plantilla es una hipótesis con forma de producto. |
| **Que la Libreta guarde precios «oficiales»** | **`hechos` ya lo hace**, es del equipo por construcción, tiene 27 piezas vivas y pantalla propia desde el 4-ago. Duplicarlo parte la fuente de verdad — y el mapa lo dice justo cuando la tentación es máxima, porque el espacio compartido **se parece** al lugar correcto. |
| **`@blocknote/xl-*` (PDF, DOCX, IA)** | 🔴 `GPL-3.0 OR PROPRIETARY`, y Hermes se distribuye empaquetado. Para PDF: `blocksToFullHTML()` + `window.print()`. |

---

## 6 · Cómo se sabrá si sirvió

La misma pregunta de ADR 0046 §8, que **no** es «¿se creó un espacio?»:

```sql
SELECT e.nombre,
       count(*)                                            AS paginas,
       count(*) FILTER (WHERE n.vendedora_id <> e.creada_por) AS de_otros,
       max(length(n.texto))                                AS la_mas_larga
FROM espacios e JOIN notas n ON n.espacio_id = e.id
GROUP BY 1 ORDER BY 3 DESC;
```

Y para el link, la única que importa: **¿se usó más de una vez?** Un link creado y nunca compartido
es un botón bonito.
