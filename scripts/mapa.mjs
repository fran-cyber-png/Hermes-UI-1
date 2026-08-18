#!/usr/bin/env node
// El mapa de Hermes: se DERIVA del árbol, nunca se escribe.
//
// `node scripts/mapa.mjs`             regenera docs/mapa.md
// `node scripts/mapa.mjs --verificar` no escribe; sale con 1 si algo está mal
//
// El modo --verificar hace DOS cosas, y la segunda es la que impide que este mapa
// repita la historia de docs/arquitectura.md (escrito a mano, 8x desactualizado a
// los nueve días):
//   1. falla si hay violaciones de las reglas de arquitectura.json
//   2. falla si docs/mapa.md no es IDÉNTICO al que se generaría hoy
// O sea que mover un archivo sin regenerar pone el CI rojo.
//
// Por eso este archivo NO imprime fechas ni contadores de corrida: cualquier dato
// que cambie solo haría fallar la comparación byte a byte.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, resolve, relative, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// 🔴 EN WINDOWS `relative()` DEVUELVE BACKSLASHES, Y TODO LO DEMÁS ACÁ —los
// prefijos de `arquitectura.json`, los que arma `${carpeta}/${entrada}`, lo
// que se imprime en el mapa— usa `/`. Sin normalizar, CADA comparación de
// prefijo falla en silencio: `duenoDe` no encuentra dueño para ningún
// archivo y el mapa sale con 0 módulos, 0 archivos, en TODAS las zonas —
// medido corriendo el script tal cual en Windows, no una hipótesis.
const relPosix = (p) => relative(RAIZ, p).split(sep).join('/')
const SALIDA = join(RAIZ, 'docs', 'mapa.md')
const CONFIG = JSON.parse(sinComentarios(leer(join(RAIZ, 'arquitectura.json'))))

const EXT_CODIGO = new Set(['.ts', '.tsx', '.mjs', '.js', '.rs'])
const IGNORAR = new Set(['node_modules', 'dist', '.git', 'target', 'drizzle', 'scratchpad'])

// ─────────────────────────────────────────────────────────────── utilidades

function leer(p) {
  return readFileSync(p, 'utf8')
}

// arquitectura.json lleva claves "$comentario" con el porqué de cada regla; se
// quitan antes de parsear nada que las trate como datos.
function sinComentarios(txt) {
  return txt
}

function archivosDe(dir, acc = []) {
  if (!existsSync(dir)) return acc
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (IGNORAR.has(e.name)) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) archivosDe(p, acc)
    else if (EXT_CODIGO.has(extname(e.name))) acc.push(p)
  }
  return acc
}

const esTest = (p) => /\.test\.|\.test$|\/pruebas\//.test(p) || p.includes('.test.')

// Las galerías (`src/features/<x>/galeria*.tsx`) son ARTEFACTOS DE EVIDENCIA, la misma
// categoría que los tests: cada una se sirve por su propio `galeria-*.html` y NINGUNA la
// importa la app. Se excluyen del grafo por el mismo motivo que los tests — una galería
// mira a cualquiera a propósito (sirve los casos feos de tres features para poder
// fotografiarlos), así que contarla inventa dependencias entre features que el producto
// no tiene. Medido el 16-ago-2026: son 15 archivos, y sacarlas baja el nudo de módulos
// del front de 7 a 3. O sea que más de la mitad de ese nudo eran pantallas de demo.
// ⚠️ Siguen contando en `lineas`: no son tests, son código del módulo. Lo que se excluye
//    son las ARISTAS, no el módulo.
const esGaleria = (p) => /\/src\/features\/[^/]+\/galeria[^/]*\.tsx$/.test(p)

const fueraDelGrafo = (p) => esTest(p) || esGaleria(p)

function lineasDe(p) {
  return leer(p).split('\n').length
}

// ────────────────────────────────────────────────── de qué módulo es cada archivo

// Se arma una lista de (moduloId, prefijo) y cada archivo cae en el prefijo MÁS
// LARGO que lo contenga: así `src/features/canales/x.ts` es de front/canales y no
// del comodín de la zona.
function descubrirModulos() {
  const prefijos = []
  const modulos = new Map()

  const alta = (id, zona) => {
    if (!modulos.has(id)) modulos.set(id, { id, zona, archivos: [], usa: new Set(), loUsan: new Set() })
    return modulos.get(id)
  }

  for (const [zona, cfg] of Object.entries(CONFIG.zonas)) {
    for (const [nombre, m] of Object.entries(cfg.modulos ?? {})) {
      const id = `${zona}/${nombre}`
      alta(id, zona)
      for (const r of m.rutas) prefijos.push({ id, prefijo: r })
    }
    if (cfg.modulosPorCarpeta) {
      const base = join(RAIZ, cfg.modulosPorCarpeta)
      if (!existsSync(base)) continue
      for (const e of readdirSync(base, { withFileTypes: true })) {
        if (!e.isDirectory() || IGNORAR.has(e.name)) continue
        const ruta = `${cfg.modulosPorCarpeta}/${e.name}`
        if (prefijos.some((p) => p.prefijo === ruta)) continue // ya declarado a mano
        const id = `${zona}/${e.name}`
        alta(id, zona)
        prefijos.push({ id, prefijo: ruta })
      }
    }
  }

  prefijos.sort((a, b) => b.prefijo.length - a.prefijo.length)
  return { modulos, prefijos }
}

function duenoDe(rutaAbs, prefijos) {
  const rel = relPosix(rutaAbs)
  for (const { id, prefijo } of prefijos) {
    if (rel === prefijo || rel.startsWith(prefijo + '/')) return id
  }
  return null
}

// ───────────────────────────────────────────────────────────────── los imports

const RE_IMPORT = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g

// El server importa con extensión `.js` aunque el archivo sea `.ts` (ESM), y el
// front importa sin extensión. Se prueban las dos formas contra el árbol real.
function resolverImport(desdeArchivo, spec) {
  let base
  if (spec.startsWith('.')) base = resolve(dirname(desdeArchivo), spec)
  else if (spec.startsWith('@/')) base = join(RAIZ, 'src', spec.slice(2))
  else return null // paquete de npm

  const candidatos = [base]
  if (base.endsWith('.js')) candidatos.push(base.slice(0, -3))
  const raiz = candidatos[candidatos.length - 1]
  for (const ext of ['.ts', '.tsx', '.mjs', '.js']) {
    candidatos.push(raiz + ext, join(raiz, 'index' + ext))
  }
  for (const c of candidatos) {
    if (existsSync(c) && statSync(c).isFile()) return c
  }
  return raiz // no resuelve a un archivo, pero alcanza para saber de qué módulo es
}

// ─────────────────────────────────────────────── ciclos (componentes fuertemente conexos)

function ciclos(nodos, aristas) {
  let idx = 0
  const indice = new Map(), bajo = new Map(), enPila = new Set(), pila = []
  const grupos = []

  const visitar = (v) => {
    indice.set(v, idx); bajo.set(v, idx); idx++
    pila.push(v); enPila.add(v)
    for (const w of aristas.get(v) ?? []) {
      if (w === v) continue
      if (!indice.has(w)) { visitar(w); bajo.set(v, Math.min(bajo.get(v), bajo.get(w))) }
      else if (enPila.has(w)) bajo.set(v, Math.min(bajo.get(v), indice.get(w)))
    }
    if (bajo.get(v) === indice.get(v)) {
      const grupo = []
      let w
      do { w = pila.pop(); enPila.delete(w); grupo.push(w) } while (w !== v)
      if (grupo.length > 1) grupos.push(grupo.sort())
    }
  }

  for (const v of nodos) if (!indice.has(v)) visitar(v)
  return grupos.sort((a, b) => a[0].localeCompare(b[0]))
}

// ─────────────────────────────────────────────────────────────────── el análisis

function analizar() {
  const { modulos, prefijos } = descubrirModulos()

  const zonas = Object.entries(CONFIG.zonas)
  const todos = []
  for (const [, cfg] of zonas) todos.push(...archivosDe(join(RAIZ, cfg.raiz)))
  const unicos = [...new Set(todos)].sort()

  // 1. cada archivo a su módulo
  for (const f of unicos) {
    const id = duenoDe(f, prefijos)
    if (id) modulos.get(id).archivos.push(f)
  }

  // 2. las aristas del grafo, ignorando los imports de los tests y de las galerías:
  //    los dos PUEDEN mirar a cualquiera (los candados leen el árbol entero a
  //    propósito, y una galería sirve los casos feos de varias features para poder
  //    fotografiarlos), y contarlos haría que todo el repo pareciera un solo ciclo
  //    gigante. Ver `fueraDelGrafo`.
  const detalle = new Map() // "a→b" -> Set(spec)
  for (const f of unicos) {
    if (fueraDelGrafo(f)) continue
    const de = duenoDe(f, prefijos)
    if (!de) continue
    const txt = leer(f)
    for (const m of txt.matchAll(RE_IMPORT)) {
      const destino = resolverImport(f, m[1])
      if (!destino) continue
      const a = duenoDe(destino, prefijos)
      if (!a || a === de) continue
      modulos.get(de).usa.add(a)
      modulos.get(a).loUsan.add(de)
      const k = `${de}→${a}`
      if (!detalle.has(k)) detalle.set(k, new Set())
      detalle.get(k).add(`${relPosix(f)} → ${m[1]}`)
    }
  }

  // 2b. el MISMO grafo a nivel de archivo. No es un refinamiento: es la medición
  //     que decide qué se puede exigir. Medido el 16-ago-2026, el grafo de MÓDULOS
  //     daba un nudo de 18 y otro de 22 — y el de ARCHIVOS, tres ciclos de dos
  //     archivos cada uno. O sea que el código es un DAG y lo que se enreda es
  //     cómo están agrupadas las carpetas. Exigir cero ciclos de archivo es
  //     alcanzable hoy; exigir cero entre módulos obligaría a mudar 18 features
  //     para arreglar algo que el código no tiene.
  const grafoArchivo = new Map(unicos.filter((f) => !fueraDelGrafo(f)).map((f) => [f, []]))
  const specArchivo = new Map()
  for (const f of grafoArchivo.keys()) {
    for (const m of leer(f).matchAll(RE_IMPORT)) {
      const d = resolverImport(f, m[1])
      if (d && grafoArchivo.has(d) && d !== f) {
        grafoArchivo.get(f).push(d)
        specArchivo.set(`${f}|${d}`, m[1])
      }
    }
  }

  // 3. métricas por módulo
  for (const m of modulos.values()) {
    m.nArchivos = m.archivos.length
    m.nTests = m.archivos.filter(esTest).length
    m.lineas = m.archivos.filter((f) => !esTest(f)).reduce((s, f) => s + lineasDe(f), 0)
    m.lineasTest = m.archivos.filter(esTest).reduce((s, f) => s + lineasDe(f), 0)
    m.responsabilidad = CONFIG.responsabilidades[m.id] ?? null
  }

  const vivos = [...modulos.values()].filter((m) => m.nArchivos > 0)
  const aristas = new Map(vivos.map((m) => [m.id, [...m.usa].sort()]))

  const ciclosArchivo = ciclos([...grafoArchivo.keys()], grafoArchivo).map((g) =>
    g.map((f) => ({
      archivo: relPosix(f),
      hacia: grafoArchivo.get(f)
        .filter((d) => g.includes(d))
        .map((d) => ({ a: relPosix(d), spec: specArchivo.get(`${f}|${d}`) })),
    }))
  )

  // Lo excluido del grafo se CUENTA para poder decirlo en el mapa: una exclusión
  // silenciosa es indistinguible de un bug del que la aplica (cicatriz de
  // `docsSinRutasMuertas`, que reportó su propio defecto antes que el del repo).
  const galerias = unicos.filter(esGaleria).map((f) => relative(RAIZ, f))

  return { modulos, vivos, aristas, detalle, prefijos, unicos, ciclosArchivo, galerias }
}

// ────────────────────────────────────────────────────────────────── las reglas

function verificar(a) {
  const fallas = []
  const R = CONFIG.reglas

  if (R.sinCiclosDeArchivo?.activa) {
    for (const g of a.ciclosArchivo) {
      fallas.push({
        regla: 'sinCiclosDeArchivo',
        que: g.map((x) => x.archivo).join('  ↔  '),
        detalle: g.flatMap((x) => x.hacia.map((h) => `      ${x.archivo} → '${h.spec}'`)),
      })
    }
  }

  if (CONFIG.capas) {
    // ⚠️ **Un módulo sin nivel queda SIN RESTRICCIÓN, y eso es lo que hace falta honrar
    // `capaPorDefecto`.** Declarar sólo los extremos —como hace el front, donde el piso de
    // negocio son las features y no tiene nivel— alcanza cuando lo que se quiere vigilar es
    // que el núcleo no dependa de una pantalla. En el server no: con ~45 módulos de negocio
    // sin nivel, la regla miraría 8 de las 260 aristas y daría 0 violaciones pasara lo que
    // pasara. La zona declara su piso (`zonas.server.capaPorDefecto`) y entonces la regla
    // muerde: un módulo de negocio que importe de `routes/` o del `index` se pone rojo.
    // El `??` no colapsa el 0: `CONFIG.capas['server/db']` es 0 y 0 no es nullish.
    const porDefecto = (id) => CONFIG.zonas[id.split('/')[0]]?.capaPorDefecto
    const nivel = (id) => CONFIG.capas[id] ?? porDefecto(id)
    for (const m of a.vivos) {
      const n = nivel(m.id)
      if (n === undefined) continue
      for (const d of [...m.usa].sort()) {
        const nd = nivel(d)
        if (nd !== undefined && n < nd) {
          fallas.push({ regla: 'capas', que: `${m.id} (capa ${n}) importa de ${d} (capa ${nd})`, detalle: [] })
        }
      }
    }
  }

  if (R.handlersEnvueltos?.activa) {
    // Un handler es `<algo>Router.<verbo>(…, async (`. Se mira sólo la CABECERA —los
    // primeros 250 caracteres desde el `.get(`— porque ahí está todo lo que decide:
    // los middlewares que van antes y si la función async viene envuelta en `ruta(`.
    // Leer el cuerpo entero traería el `async` de cualquier callback de adentro.
    const dir = join(RAIZ, R.handlersEnvueltos.aplicaA)
    for (const f of archivosDe(dir)) {
      if (esTest(f)) continue
      const txt = leer(f)
      const re = /\w*[Rr]outer\s*\.\s*(get|post|put|patch|delete|use)\s*\(/g
      const posiciones = []
      let m
      while ((m = re.exec(txt))) posiciones.push(m.index)
      let sueltos = 0
      for (let i = 0; i < posiciones.length; i++) {
        const hasta = i + 1 < posiciones.length ? posiciones[i + 1] : txt.length
        const cabecera = txt.slice(posiciones[i], Math.min(hasta, posiciones[i] + 250))
        if (!/async\s*\(/.test(cabecera)) continue // handler sincrónico: no aplica
        if (!/\bruta\(/.test(cabecera)) sueltos++
      }
      if (sueltos > 0) {
        fallas.push({
          regla: 'handlersEnvueltos',
          que: `${relPosix(f)} — ${sueltos} handler(s) async sin ruta()`,
          detalle: [],
        })
      }
    }
  }

  if (R.routersSinSqlInline?.activa) {
    const dir = join(RAIZ, R.routersSinSqlInline.aplicaA)
    for (const f of archivosDe(dir)) {
      if (esTest(f)) continue
      const rel = relPosix(f)
      if (R.routersSinSqlInline.excepciones.includes(rel)) continue
      const txt = leer(f)
      const nSql = (txt.match(/\bsql`/g) ?? []).length
      const nQ = (txt.match(/\bdb\.(select|insert|update|delete)\b/g) ?? []).length
      if (nSql + nQ > 0) {
        fallas.push({ regla: 'routersSinSqlInline', que: `${rel} — ${nSql} sql\`\` + ${nQ} db.query`, detalle: [] })
      }
    }
  }

  if (R.docsSinRutasMuertas?.activa) {
    for (const [ruta, citada] of rutasCitadasEnDocs()) {
      // Un doc puede citar la ruta relativa al SERVER (`src/pruebas/base.ts` cuando el
      // comando de al lado es `cd server && …`). Eso no es una ruta muerta: es la misma
      // ruta escrita desde el otro directorio, y contarla como error entrena a ignorar
      // la regla. Medido el 16-ago-2026: 10 de las 118 «muertas» eran esto.
      if (existsSync(join(RAIZ, ruta)) || existsSync(join(RAIZ, 'server', ruta))) continue
      fallas.push({ regla: 'docsSinRutasMuertas', que: `${ruta}  (citada en ${citada})`, detalle: [] })
    }
  }

  if (R.moduloDeclarado?.activa) {
    for (const m of a.vivos) {
      if (!m.responsabilidad) {
        fallas.push({ regla: 'moduloDeclarado', que: `${m.id} — ${m.nArchivos} archivos y ninguna responsabilidad escrita`, detalle: [] })
      }
    }
  }

  return fallas
}

// ⚠️ **`tsx` VA ANTES QUE `ts` Y NO ES ESTILO.** La alternancia de una regex prueba en
// orden y se queda con la PRIMERA que entra: con `(?:ts|tsx)`, `Avatar.tsx` matchea como
// `Avatar.ts` y la `x` queda afuera. El efecto es que la regla reporta como «ruta muerta»
// cada archivo `.tsx` que un doc cita bien — 60 de las 108 «muertas» del 16-ago-2026 eran
// esto, y el defecto no se ve leyendo la lista: se ve abriendo el archivo y encontrándolo.
// ⚠️ **Y el lookbehind tampoco es estilo.** Sin él, `src/` matchea DENTRO de una ruta de
// dependencia: `node_modules/@blocknote/core/types/src/editor/BlockNoteEditor.d.ts` se
// reportaba como la ruta muerta `src/editor/BlockNoteEditor.d.ts`, sobre un doc que la
// tenía escrita perfecta. Fueron 3 el 16-ago-2026, y son el tercer falso positivo de esta
// misma regla — el patrón se repite: **la regla reporta su propio bug antes que el del repo.**
const RE_RUTA = /(?<![\w/@.-])((?:server\/src|src-tauri\/src|src|scripts|deploy)\/[A-Za-z0-9_@./-]+\.(?:tsx|ts|rs|sql|mjs|sh))\b/g

let saltadas = 0

function rutasCitadasEnDocs() {
  const R = CONFIG.reglas.docsSinRutasMuertas
  const exc = R.excepciones ?? []
  const excluido = (p) => {
    const rel = relPosix(p)
    return exc.some((e) => rel === e || rel.startsWith(e + '/'))
  }
  const fuentes = []
  for (const d of R.aplicaA) {
    const p = join(RAIZ, d)
    if (!existsSync(p)) continue
    if (statSync(p).isDirectory()) {
      const md = []
      const anda = (dir) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          if (IGNORAR.has(e.name)) continue
          const q = join(dir, e.name)
          if (excluido(q)) { saltadas++; continue }
          if (e.isDirectory()) anda(q)
          else if (e.name.endsWith('.md')) md.push(q)
        }
      }
      anda(p)
      fuentes.push(...md.sort())
    } else if (!excluido(p)) fuentes.push(p)
  }
  const encontradas = new Map()
  for (const f of fuentes) {
    for (const m of leer(f).matchAll(RE_RUTA)) {
      if (!encontradas.has(m[1])) encontradas.set(m[1], relPosix(f))
    }
  }
  return [...encontradas.entries()].sort()
}

// ─────────────────────────────────────────────────────────────────── el markdown

const n = (x) => x.toLocaleString('es-PE')

function tabla(mods) {
  const filas = mods
    .slice()
    .sort((a, b) => b.lineas - a.lineas || a.id.localeCompare(b.id))
    .map((m) => {
      const nom = m.id.split('/').slice(1).join('/')
      const usa = m.usa.size, loUsan = m.loUsan.size
      const resp = m.responsabilidad ?? '⚠️ **sin declarar**'
      return `| \`${nom}\` | ${resp} | ${n(m.nArchivos)} | ${n(m.lineas)} | ${n(m.nTests)} | ${loUsan} | ${usa} |`
    })
  return [
    '| Módulo | De qué es responsable | Arch. | Líneas | Tests | Lo usan | Usa |',
    '|---|---|--:|--:|--:|--:|--:|',
    ...filas,
  ].join('\n')
}

function generar(a, fallas) {
  const L = []
  const porZona = (z) => a.vivos.filter((m) => m.zona === z)
  const suma = (ms, k) => ms.reduce((s, m) => s + m[k], 0)

  L.push('# El mapa de Hermes')
  L.push('')
  L.push('> 🤖 **GENERADO — no se edita a mano.** Se regenera con `npm run mapa`, y `npm run mapa:verificar`')
  L.push('> (que corre en **N1 del CI**) falla si este archivo no coincide con el árbol de hoy.')
  L.push('> Lo único escrito a mano es `arquitectura.json`: las reglas y la responsabilidad de cada módulo.')
  L.push('>')
  L.push('> **Existe porque `docs/arquitectura.md` describía un repo 8 veces más chico a los nueve días**')
  L.push('> de escrito. Un mapa que se escribe, envejece; uno que se deriva, no puede.')
  L.push('')
  L.push('## Cuánto es')
  L.push('')
  L.push('| Zona | Módulos | Archivos | Líneas de código | Líneas de test |')
  L.push('|---|--:|--:|--:|--:|')
  for (const z of Object.keys(CONFIG.zonas)) {
    const ms = porZona(z)
    L.push(`| ${z} | ${n(ms.length)} | ${n(suma(ms, 'nArchivos'))} | ${n(suma(ms, 'lineas'))} | ${n(suma(ms, 'lineasTest'))} |`)
  }
  L.push(`| **total** | **${n(a.vivos.length)}** | **${n(suma(a.vivos, 'nArchivos'))}** | **${n(suma(a.vivos, 'lineas'))}** | **${n(suma(a.vivos, 'lineasTest'))}** |`)
  L.push('')

  for (const z of Object.keys(CONFIG.zonas)) {
    L.push(`## ${z === 'front' ? 'Front — `src/`' : 'Server — `server/src/`'}`)
    L.push('')
    L.push(tabla(porZona(z)))
    L.push('')
  }

  L.push('## Quién depende de quién')
  L.push('')
  L.push('Los módulos con más entradas son los que no se pueden tocar sin mirar a todo el resto.')
  L.push('')
  const hubs = a.vivos.slice().sort((x, y) => y.loUsan.size - x.loUsan.size).filter((m) => m.loUsan.size > 0).slice(0, 15)
  L.push('| Módulo | Lo importan | Quiénes |')
  L.push('|---|--:|---|')
  for (const m of hubs) {
    const q = [...m.loUsan].sort().map((x) => `\`${x.split('/').slice(1).join('/')}\``).join(' · ')
    L.push(`| \`${m.id}\` | ${m.loUsan.size} | ${q} |`)
  }
  L.push('')

  const nudos = ciclos(a.vivos.map((m) => m.id), a.aristas)
  L.push('## Los nudos entre módulos (informativo, no es una regla)')
  L.push('')
  L.push('Un grupo acá NO quiere decir que haya una dependencia circular en el código: el grafo de')
  L.push('ARCHIVOS es un DAG salvo por lo que liste `sinCiclosDeArchivo`. Quiere decir que **las')
  L.push('fronteras de las carpetas no siguen la forma de las dependencias** — que hay archivos')
  L.push('agrupados bajo un módulo que en realidad pertenecen a otra capa. Es el termómetro de si')
  L.push('los módulos están bien dibujados, y baja sacando el núcleo compartido a su propia capa.')
  L.push('')
  L.push(`**Qué queda afuera del grafo** (acá y en «Quién depende de quién»): los tests, y las`)
  L.push(`**${n(a.galerias.length)} galerías** \`src/features/*/galeria*.tsx\`. Las dos cosas por el mismo`)
  L.push('motivo: miran a cualquiera a propósito y ninguna la importa la app — cada galería se sirve por')
  L.push('su propio `galeria-*.html` y existe para poder fotografiar los casos feos. Contarlas inventaba')
  L.push('dependencias entre features que el producto no tiene: sacarlas bajó este nudo de 7 a 3.')
  L.push('Siguen contando en `Líneas`: no son tests, son código del módulo.')
  L.push('')
  if (!nudos.length) L.push('✅ ninguno.')
  for (const g of nudos) {
    L.push(`- **${g.length} módulos**: ${g.map((x) => `\`${x}\``).join(' ↔ ')}`)
  }
  L.push('')

  const huerfanos = a.vivos.filter((m) => m.loUsan.size === 0 && m.usa.size === 0)
  if (huerfanos.length) {
    L.push('## Módulos que no importan a nadie y nadie importa')
    L.push('')
    L.push('No significa que estén muertos —pueden ser puntos de entrada o scripts—, pero es la lista donde mirar primero.')
    L.push('')
    for (const m of huerfanos) L.push(`- \`${m.id}\` — ${n(m.nArchivos)} archivos, ${n(m.lineas)} líneas`)
    L.push('')
  }

  L.push('## Las reglas y cómo están hoy')
  L.push('')
  const porRegla = new Map()
  for (const f of fallas) porRegla.set(f.regla, [...(porRegla.get(f.regla) ?? []), f])
  const capasDeclaradas = Object.entries(CONFIG.capas)
    .filter(([k]) => !k.startsWith('$'))
    .map(([k, v]) => `\`${k}\`=${v}`)
    .join(' · ')
  const porDefectoDeZona = Object.entries(CONFIG.zonas)
    .filter(([, z]) => z.capaPorDefecto !== undefined)
    .map(([z, cfg]) => `\`${z}\`=${cfg.capaPorDefecto}`)
    .join(' · ')
  const nombres = {
    ...CONFIG.reglas,
    capas: {
      porQue:
        'Un módulo no puede importar de una capa más alta que la suya: el núcleo compartido no puede depender de una pantalla. ' +
        `Declaradas: ${capasDeclaradas}.` +
        (porDefectoDeZona
          ? ` Y por zona, el piso de lo no declarado: ${porDefectoDeZona} — sin eso un módulo sin nivel queda sin restricción, ` +
            'y la regla vigilaría los extremos sin poder ponerse roja nunca.'
          : ''),
    },
  }
  for (const [regla, cfg] of Object.entries(nombres)) {
    const f = porRegla.get(regla) ?? []
    L.push(`### ${f.length === 0 ? '✅' : '🔴'} \`${regla}\` — ${f.length === 0 ? 'sin violaciones' : `${f.length} violación${f.length > 1 ? 'es' : ''}`}`)
    L.push('')
    L.push(`> ${cfg.porQue}`)
    L.push('')
    if (cfg.excepciones?.length) {
      L.push(`**No se revisan** (el porqué está en \`arquitectura.json\`): ${cfg.excepciones.map((e) => `\`${e}\``).join(' · ')}`)
      L.push('')
    }
    for (const x of f) {
      L.push(`- ${x.que}`)
      for (const d of x.detalle) L.push(`  - \`${d.trim()}\``)
    }
    if (f.length) L.push('')
  }

  return L.join('\n') + '\n'
}

// ──────────────────────────────────────────────────────────────────────── main

const a = analizar()
const fallas = verificar(a)
const md = generar(a, fallas)
const soloVerificar = process.argv.includes('--verificar')

if (!soloVerificar) {
  writeFileSync(SALIDA, md)
  console.log(`✅ docs/mapa.md regenerado — ${a.vivos.length} módulos, ${fallas.length} violaciones`)
  if (fallas.length) console.log('   (el mapa las lista; `npm run mapa:verificar` falla mientras existan)')
  process.exit(0)
}

let malo = false

const enDisco = existsSync(SALIDA) ? leer(SALIDA) : ''
if (enDisco !== md) {
  console.error('🔴 docs/mapa.md está DESACTUALIZADO respecto del árbol.')
  console.error('   Corré `npm run mapa` y commiteá el resultado.')
  malo = true
}

if (fallas.length) {
  console.error(`\n🔴 ${fallas.length} violación(es) de arquitectura:\n`)
  const porRegla = new Map()
  for (const f of fallas) porRegla.set(f.regla, [...(porRegla.get(f.regla) ?? []), f])
  for (const [regla, fs] of porRegla) {
    console.error(`  ${regla} (${fs.length}):`)
    for (const f of fs) {
      console.error(`    - ${f.que}`)
      for (const d of f.detalle) console.error(d)
    }
    console.error('')
  }
  console.error('   El porqué de cada regla está en arquitectura.json.')
  malo = true
}

if (!malo) console.log('✅ el mapa está al día y no hay violaciones de arquitectura')
process.exit(malo ? 1 : 0)
