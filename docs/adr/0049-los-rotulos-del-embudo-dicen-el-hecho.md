# ADR 0049 — Los rótulos del embudo dicen el HECHO, y viven una sola vez

**Fecha**: 10-ago-2026
**Estado**: aceptado — front puro, sale por N4
**Continúa**: **ADR 0044** (el embudo se deriva de lo que hizo el comprador).
**Convive con**: ADR 0009 (la regla vive una vez), ADR 0013 (la etapa efectiva), ADR 0045 (CLAUDE.md
dice lo que frena un error)

---

## El problema

El pedido del dueño fue de una línea: *«quiero que el embudo sea claro, las categorías sean claras
— que sea fácil de entender»*.

El tablero decía `Sin respuesta · Contactados · Cotizados · Cierre · Perdidos`, con `Interesados`
como bandeja. Cuatro de esos seis nombres no dicen ningún hecho: dicen lo que **nosotros** creemos
de esa persona.

### Lo que dice la práctica, y que resultó ser la regla que ya teníamos

Se miraron las etapas por defecto de los CRMs grandes y las guías de pipeline:

| | etapas |
|---|---|
| **Pipedrive** | Qualified · **Contact Made** · **Demo Scheduled** · **Proposal Made** · **Negotiations Started** |
| **HubSpot** | **Appointment scheduled** · Qualified to buy · **Presentation scheduled** · **Decision maker bought-in** · **Contract sent** · Closed won/lost |

Casi todos son **un hecho en pasado**. Y la guía más rigurosa (Avoma) no da solo la lista buena: da
los nombres MALOS, y nombra tres — *«Qualified»*, *«In process»* y, textual, ***«Interested» (too
interpretive)***.

> 🔴 **La bibliografía de ventas usa «Interested» como el ejemplo canónico de etapa mal nombrada, y
> era el nombre de nuestra bandeja.** «Cotizados» es la misma familia.

La otra mitad de esas guías —*el criterio de salida tiene que ser una acción observable del
comprador, no tu optimismo*— es **palabra por palabra la regla de ADR 0044**, que se dedujo
midiendo, sin haber leído nada de esto.

**O sea: el modelo ya era correcto. Lo que estaba mal eran los rótulos.**

### Y el defecto que apareció al ir a cambiarlos

Los nombres vivían en **CINCO lugares y ninguno era canónico**:

| dónde | qué tenía |
|---|---|
| `vistas/tablero.ts` | los títulos de columna, en plural |
| `gestion/BarraGestion.tsx` | `ETAPAS_BARRA`, en singular y sin `perdido` |
| `venta/FormularioVenta.tsx` | un `ETAPA_LABEL` **privado** |
| `gestion/RegistrarGestion.tsx` | **otro `ETAPA_LABEL` privado, idéntico** |
| `dashboard/VistaDashboard.tsx` | **ninguno**: pintaba el **identificador crudo** con un `capitalize` de CSS |

Con ids de una palabra, lo del Dashboard se veía bien **de casualidad** — y por eso nadie lo vio en
meses. 🔴 **El rename lo iba a destapar**: al cambiar el título de la columna, el Dashboard habría
seguido diciendo «Cotizado» sobre la misma conversación que el Pipeline llama «Saben el precio».
Dos nombres para el mismo hecho es peor que un nombre feo. Es #37, otra vez.

---

## La decisión

### 1. Un mapa canónico, con los dos números gramaticales

`ETAPA_ROTULO` en `src/lib/etapas.ts`, y `rotuloEtapa(etapa, 'uno' | 'varios')`. Los seis
consumidores leen de ahí; las dos copias privadas se borraron.

**El valor es un par y no un string** porque una COLUMNA es un montón y una FICHA es una persona:
«Saben el precio» y «Sabe el precio» son la misma etapa en dos números, no dos etapas. Con un solo
string cada consumidor volvía a conjugar por su cuenta — que es exactamente cómo nacieron las cinco
copias.

| id | uno | varios |
|---|---|---|
| `interesado` | Te espera | **Te esperan** |
| `sin_respuesta` | Nunca contestó | **Nunca contestaron** |
| `contactado` | Contestó | **Contestaron** |
| `cotizado` | Sabe el precio | **Saben el precio** |
| `cierre` | Compró | **Compraron** |
| `perdido` | Dijo que no | **Dijeron que no** |

Leído en fila: *te esperan → nunca contestaron → contestaron → saben el precio → compraron*. No
hace falta ningún tooltip.

⚠️ **«Te esperan» no se inventó acá: se adoptó.** `BandejaDeuda` ya lo usaba desde #87 y era el
rótulo más claro de toda la pantalla. Ponerle uno nuevo habría dejado la bandeja diciendo una cosa
y el chip de la ficha otra — el defecto que este ADR viene a cerrar.

### 2. Los IDENTIFICADORES no se tocan

`sin_respuesta`, `cotizado` y compañía viven en `gestiones`, en el SQL, en `?etapa=` y en el caché
de IndexedDB (ADR 0007). **Se cambia lo que se lee, nunca lo que se guarda.** Por eso esto es front
puro: cero migración, cero paridad server↔front que romper, y sale por **N4** sin reiniciar nada.

### 3. Dos etapas no pueden compartir rótulo

🔴 **Es el hallazgo que motivó el candado.** «Sin respuesta» (le escribimos y nunca contestó, deuda
del LEAD, 2.576) y «Sin contestar» (escribió y no le contestamos, deuda NUESTRA, 377) son cosas
**opuestas** y sonaban casi igual — y la segunda es la urgente. Hoy está tapado porque la bandeja se
llama «Interesados»; cualquier rename ingenuo lo destapaba.

`etapas.test.ts` prohíbe que dos etapas compartan rótulo, en los dos números. Con «Te esperan» ya ni
empiezan con la misma palabra.

### 4. Degrada, no tumba

`rotuloEtapa` devuelve el id tal cual si la etapa no está en el mapa. N4 y N5 se despliegan por
separado: el server puede devolver un peldaño nuevo antes de que el front lo conozca, y ahí mostrar
el id es feo pero es cierto. Tirar sería una pantalla en blanco. Es la misma decisión que
`rotuloDeTipo` con un tipo de evento desconocido (ADR 0037).

---

## Lo que esto NO resuelve

🔴 **Falta la primera columna del embudo, y es la más grande de todas.** Medido el 10-ago-2026:
`leads` tiene **26.175** filas (26.050 con teléfono) y **25.386 — el 97,5 % — nunca llegaron a
tener una conversación**. No están en el Pipeline: el universo del tablero son conversaciones, así
que ordena el **2,5 %** del negocio.

Y no es histórico: **el último lead entró hoy** (35 esta semana) mientras el caño de WhatsApp está
cerrado (0 salientes desde el 7-ago). El hueco se agranda solo.

**No es «Te esperan»**, y la distinción es el trabajo: ahí hay un hilo abierto y contestar es
gratis; un lead de landing dejó sus datos y **hay que abrir la conversación en frío**, que tiene un
problema de canal antes que de código (las líneas de las vendedoras son whatsmeow). Va como sexta
columna, **primera**, con el mismo criterio de nombre: **«Llenaron el formulario»**.

Es un frente propio y de otra categoría: toca el server (una rama nueva en la unión de
`consultarCola.ts`, con el precedente de `int:<id>`), **obliga a rehacer la cuenta del grid** —a
1280 los mínimos ya suman 1.020 sobre ~1.256 px— y arrastra la virtualización (25.386 tarjetas
paginadas de a 30 son 846 clics). Ver `docs/plan-pipeline-por-canal.md` §3.1 y §4 #4.

## Evidencia

`docs/evidencia/embudo-rotulos-claros.png` — el tablero a 1280, servido por
`npx vite --port 5199` → `/galeria-embudo.html`.
