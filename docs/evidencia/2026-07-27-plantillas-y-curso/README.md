# Evidencia — revisión de plantillas + el curso del Dashboard (27-jul-2026)

Regla dura #2: ningún cambio de UI se reporta terminado sin verlo. Estas cinco capturas
son de la app corriendo, no maquetas.

## Cómo se sacaron, y por qué NO contra producción

**Producción corre el server viejo.** Todo lo que hay que mostrar acá —el bloque «Para
revisar», la familia inferida, la atribución por anuncio— vive en el server de este PR, así
que apuntar el front a `hermes-api.goberna.us` mostraría el bug, no el arreglo. Y desplegar
para sacar una captura es exactamente lo que N5 existe para que nadie haga de apuro.

Así que la evidencia es de **la rama corriendo entera, contra una Postgres efímera propia**
(contenedor aparte, puerto 5441 — ni la de dev ni la de prod ni la de tests), sembrada con
la foto de producción: las dos propuestas del minado con su respaldo real (418 y 296) y 31
conversaciones repartidas como llegan de verdad.

Dos decisiones a propósito:

- **`CERBERUS_BASE_URL` apunta a un puerto muerto.** La evidencia no toca ningún servicio
  vivo, y —más importante— así ninguna captura se lleva el nombre y el teléfono de un
  cliente real a un archivo que se commitea. Lo que se ve es la degradación honesta que el
  panel ya tenía escrita («No se pudo saber», «Cerberus no respondió»).
- **Los teléfonos son sintéticos** (`5190001xxxx`), no recortes de la base.

Efecto lateral visible: sin Cerberus no hay catálogo de cursos, así que el desplegable
muestra `DIPICOT (el que dedujo el minado)` en vez del nombre largo del diploma. Es el
fallback escrito en `RevisionPropuesta.tsx` — con Cerberus arriba dice «Inteligencia y
Contrainteligencia».

---

## 1 · `dashboard-negocio-por-curso.png` — el bug 2, arreglado

**El negocio → Por curso.** Antes: «Sin curso identificado: 68 de 70 (97 %)». Ahora, sobre
las mismas 31 conversaciones:

| | |
|---|---|
| Inteligencia y Contrainteligencia | **22** (por el anuncio, que antes no se miraba) |
| Ciberinteligencia y Ciberdefensa | **4** (por el formulario) |
| Adquiérelo ahora | **3** (el gap honesto: anuncio sin curso en el texto, sale crudo) |
| Sin curso identificado | **2 de 31 (6 %)** |

Y la nota al pie dice la verdad nueva: «El curso sale del interés que la vendedora
registró, del formulario que la persona llenó o del anuncio por el que escribió — en ese
orden, el mismo del chip de la cola».

## 2 · `cola-chips-de-curso.png` — la otra mitad de la paridad

La misma atribución, vista desde la cola: los chips dicen `Inteligencia Estratég…`,
`Ciberinteligencia y …` y `Adquiérelo ahora` sobre las mismas conversaciones que el
Dashboard agrupa arriba. Las dos pantallas ya no se contradicen — y lo que impide que
vuelvan a separarse es `dashboard/curso.paridad.test.db.ts`, no esta captura.

## 3 · `revision-propuesta-abierta.png` — el bug 1, arreglado

Pestaña **Enviar** del panel derecho, con el bloque **«Para revisar 2»** que antes no
existía: la propuesta abierta muestra sus dos pasos con el texto completo, el aviso de
«Falta la imagen» y el desplegable **«¿De qué curso es?»** ya en la familia que dedujo el
minado.

## 4 · `revision-acciones.png` — las tres salidas

El panel entero: **Aprobar · Editar antes · Descartar**, con «Lo dedujo el minado del
propio texto. Confirmalo o cambialo.» debajo del desplegable. Abajo, la segunda propuesta
(296 conversaciones) y el estado honesto «Todavía no hay ninguna secuencia aprobada».

## 5 · `revision-despues-de-aprobar.png` — aprobada

Después de aprobar la primera: «Para revisar» baja a **1** y la aprobada aparece en
**«Listas para mandar»**, con su tira de pasos.

> El clic de Aprobar en el navegador lo intercepta el arnés de Playwright (devuelve
> `{"ok":true,"simulado":true}` sin llegar al server: las mutaciones están mockeadas por
> política). Para que la captura muestre un estado real y no uno pintado, la aprobación se
> hizo contra el server local por HTTP y la pantalla se recargó.

## Las dos guardas, verificadas contra el server

```
$ curl -X POST .../api/plantillas/1/aprobar -d '{"familiaCurso":"DIPICOT"}'
{"ok":true,"plantilla":{...,"familiaCurso":"DIPICOT","estado":"aprobada",...}}

$ curl -X POST .../api/plantillas/2/aprobar -d '{}'
{"ok":false,"codigo":"falta_familia","message":"elegí a qué curso corresponde esta
 secuencia, o marcá «sirve para cualquier curso»: sin eso no puede matchear con ninguna
 conversación"}
```

Y la visibilidad de equipo: las propuestas las guardó el script bajo
`vendedora-del-script`, y `GET /api/plantillas` con el token de **`Usuario1`** las devuelve
igual — que es el bug de fondo por el que el dueño veía «Todavía no hay secuencias».
