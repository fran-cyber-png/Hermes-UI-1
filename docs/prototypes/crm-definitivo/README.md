# Mockups — Hermes CRM definitivo

> 4 vistas navegables (los links del header funcionan). Son **HTML estático con los tokens
> reales** de goberna-design-system — no imagegen — para que lo que se apruebe acá sea
> literalmente trasladable a Tailwind. Verlos: `python3 -m http.server 8930` en esta carpeta
> → `http://localhost:8930/bandeja.html`. Capturas en `../img-mock-*.png`.

| Archivo | Vista | Qué muestra |
|---|---|---|
| `bandeja.html` | **Bandeja** (la casa, 90% del tiempo) | Cola con búsqueda/filtros/claim/etiquetas · comentario FB des-modalizado con privado-antes-que-público y nota interna · **el panel de contexto nuevo** (publicación + curso con fuente declarada + historial + etiquetas) |
| `embudo.html` | **Embudo** | Las mismas conversaciones como kanban por etapas fijas (Nuevo → Respondido → Interesado → Venta registrada → Se enfría), conversión por etapa, arrastre |
| `personas.html` | **Personas** | Búsqueda por teléfono + ficha 360: Cerberus, compras, "por dónde llegó", notas, recordatorio, marca de agua + log de consultas |
| `tablero.html` | **Tablero** | Cifra héroe de espera (dorado = tiempo), frescura por fuente, 1ra respuesta y conversión por vendedora, embudo canal→venta, cobertura honesta de atribución |

## La auditoría del "antes" (2026-07-21)

Evidencia: `../img-cola-conversaciones.png`, `../img-ficha.png`, `../img-form-venta.png`,
`../img-login.png` (capturas commiteadas del estado actual).

**Lo que ya estaba bien (se conserva tal cual):** la honestidad como estética — "Datos al día ·
hace N min" en el header, "Se envía solo a esta persona… Nada masivo, nada automático" bajo la
caja, el banner ámbar de origen del anuncio, los 4 estados de la ficha. Eso es identidad, no
se toca.

**Lo genérico que el rediseño corrige:**
1. Sin marca: "HERMES" en texto plano → `[escudo dorado]│HERMES` (Montserrat 800) + vistas.
2. Tarjetas "borde+blanco+sombra" uniformes → doble bisel sobrio (marco exterior tenue + núcleo)
   con sombras teñidas de navy, radios concéntricos.
3. Avatares círculo gris → squircles con inicial Montserrat + badge de canal.
4. Jerarquía plana en las filas → nombre Montserrat 600, extracto sutil, hora/folios en **mono**,
   chips con semántica (PIDE INFO azul, ventana dorada, etiquetas finas).
5. ALL-CAPS en cada label → kickers chicos y espaciados solo como rótulo de sección.
6. Modal para la venta y para responder → todo vive en las columnas (des-modalizado).
7. Botones lavados (login "Entrar" celeste) → primarios azul plenos con icono anidado en disco,
   hover con física (translate + sombra), `active: scale(.98)`, focus ring visible.
8. Cero estados de interacción → hover en filas/tarjetas, focus-within en inputs, entrada
   escalonada sobria (respetando `prefers-reduced-motion`).
9. Banda de urgencia monocroma → temperatura con significado: verde = vivo (comprando ahora),
   **dorado = ventana que se muere** (único uso del oro), gris-azul = espera.

## Reglas que los mockups obedecen

- **El dorado significa tiempo que se acaba. Nada más.** (chips de ventana, frescura atrasada,
  la cifra héroe de espera). CTAs = azul `#2563EB`; estructura = navy `#0E2A52`.
- Una acción primaria por vista: Enviar / mover de etapa / registrar venta / ninguna.
- Cada inferencia declara su fuente; cada hueco de datos se dice ("Messenger 0% hasta S11").
- Números, teléfonos, folios y horas en monoespaciada con `tabular-nums`.

## Qué es de qué horizonte (para no confundir el mockup con el backlog)

- **H1**: panel de contexto completo (bandeja.html, columna derecha) + botón "Registrar venta"
  precargado.
- **H2**: búsqueda, filtros, "Sin asignar", claim en la fila, etiquetas, notas internas, atajos
  `/precio`.
- **H3**: embudo.html y tablero.html completos + recordatorios ("⏰ lunes 27").
- **H4**: marca de agua + "cada consulta queda registrada" (personas.html) + cobertura CTWA 72%
  (tablero.html — hoy ese número no existe: llega con la Cloud API).
- **H5**: el bloque Ivi no aparece en estos mockups a propósito — Estephano decidió F1
  determinista primero; el diseño de F2 está en `../plan-panel-contexto.md` §7.
