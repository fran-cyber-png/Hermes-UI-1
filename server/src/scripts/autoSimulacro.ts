import 'dotenv/config';
import { consultarCandidatos } from '../autorespuesta/candidatos.js';
import { configDesdeEnv, ventanasEfectivas, type ConfigAutoRespuesta } from '../autorespuesta/config.js';
import type { ConversacionCandidata } from '../autorespuesta/decidir.js';
import { diaLocal, hhmmLocal, proximoMomento } from '../autorespuesta/franja.js';
import { planificar, type PlanCompleto } from '../autorespuesta/planificar.js';
import { repositorioDrizzle } from '../autorespuesta/repositorio.js';

/**
 * EL SIMULACRO — `npm run auto:simulacro`.
 *
 * Imprime el plan de despacho (a quién, con qué plantilla, a qué hora) SIN
 * mandar nada, sin escribir una fila y sin tocar el transporte. Es lo que se
 * corre ANTES de prender esto, y lo que hay que volver a correr cada vez que se
 * toca un límite.
 *
 * Usa la MISMA función que el encolado de verdad (`planificar`): lo que se lee
 * acá es lo que va a pasar, no una aproximación escrita aparte.
 *
 * ── Por qué cada renglón dice CUÁNDO ESCRIBIÓ y HACE CUÁNTO (#166) ──
 * El 27-jul este script imprimió un plan de 33 mensajes que se veía impecable y
 * estaba mal de siete formas: 25 eran para gente que había escrito en pleno
 * horario de atención y todos arrastraban entre 57 y 72 horas de espera. Nada de
 * eso se veía, porque el plan mostraba la hora a la que SALDRÍA cada mensaje y no
 * la hora a la que había llegado el de la persona. Un simulacro que no deja ver
 * el disparate antes de prender no sirve para lo único que existe. Ahora las dos
 * columnas van primero, y las descartadas se listan una por una con lo mismo.
 *
 *   npm run auto:simulacro                  · contra la base, con el reloj de ahora
 *   npm run auto:simulacro -- --hora 03:00  · «¿y si fueran las 3 de la mañana?»
 *   npm run auto:simulacro -- --demo        · sin base: datos sembrados, para ver el ritmo
 */

interface Opciones {
  demo: boolean;
  hora: string | null;
}

function leerOpciones(argv: string[]): Opciones {
  const demo = argv.includes('--demo');
  const i = argv.indexOf('--hora');
  const hora = i >= 0 ? (argv[i + 1] ?? null) : null;
  return { demo, hora };
}

/**
 * La ÚLTIMA vez que el reloj local marcó `hhmm` — el espejo de `proximoMomento`,
 * y lo que hace falta para sembrar «esta escribió a las 10:47» sin depender de a
 * qué hora se corra el simulacro.
 */
function ultimoMomento(ahora: Date, hhmm: string, zona: string): Date {
  const proximo = proximoMomento(ahora, hhmm, zona);
  return proximo.getTime() > ahora.getTime() ? new Date(proximo.getTime() - 24 * 3_600_000) : proximo;
}

/** Conversaciones de mentira, escalonadas como llegan de verdad de noche. */
function candidatasDeDemo(ahora: Date, zona: string): ConversacionCandidata[] {
  const hace = (minutos: number) => new Date(ahora.getTime() - minutos * 60_000);
  const dias = (n: number, d: Date) => new Date(d.getTime() - n * 24 * 3_600_000);
  const base = (n: number, minutos: number, over: Partial<ConversacionCandidata> = {}): ConversacionCandidata => ({
    clave: `conv:whatsapp:5196150${String(n).padStart(4, '0')}:51986394450`,
    telefono: `5196150${String(n).padStart(4, '0')}`,
    numeroPropio: '51986394450',
    personaNombre: ['Ana', 'Luis', 'Rocío', 'Miguel', 'Silvia', 'Jorge'][n % 6],
    ultimoEntranteEn: hace(minutos),
    ultimoSalienteEn: null,
    textosDelCliente: ['hola, quiero información del diplomado'],
    autoRespuestasHoy: 0,
    salientes: 0,
    curso: null,
    ...over,
  });

  return [
    base(1, 300),
    base(2, 285),
    base(3, 260, { curso: 'Diplomado en Gestión Pública' }),
    base(4, 240),
    base(5, 205, { salientes: 4 }),
    base(6, 180),
    base(7, 150, { textosDelCliente: ['no me interesa, gracias'] }),
    base(8, 130, { autoRespuestasHoy: 1 }),
    base(9, 95),
    base(10, 70, { curso: 'Curso de Comunicación Política' }),
    base(11, 45),
    base(12, 20), // esperó menos de 30 min: todavía no
    base(13, 15, { ultimoSalienteEn: hace(10) }), // ya la atendieron

    // ── LOS TRES DE #166 ──────────────────────────────────────────────────
    // Están sembrados a propósito y con los datos del caso real: hasta el
    // 27-jul los tres entraban al plan y se veían tan sanos como el resto.
    // Si alguna vez vuelven a colarse, se ven acá antes que en un teléfono.

    // Escribió a las 10:47 de la mañana, en pleno horario de atención. Eran 25
    // de los 40 borradores: a esta gente el acuse le dice una frase falsa.
    base(16, 0, { ultimoEntranteEn: ultimoMomento(ahora, '10:47', zona) }),

    // Escribió de madrugada hace tres días. Las esperas reales iban de 57 a 72
    // horas: un «gracias por escribirnos» a esta altura confirma que nadie miró.
    base(17, 0, { ultimoEntranteEn: dias(3, ultimoMomento(ahora, '02:30', zona)) }),

    // La abogada del issue: la atendimos, revisó el material, dijo por qué no le
    // servía y se despidió. Los textos van del más reciente al más viejo.
    base(18, 0, {
      ultimoEntranteEn: ultimoMomento(ahora, '22:10', zona),
      salientes: 2,
      textosDelCliente: [
        'Agradezco mucho la atención prestada',
        'Soy abogada, y no me es de mucha utilidad',
        'Hola, ya revise toda la información',
      ],
    }),

    base(14, 320),
    base(15, 310),
  ];
}

/**
 * La hora local sale de `franja.ts`, el mismo módulo con el que se DECIDE. Un
 * formateador propio acá sería una segunda verdad: bastaría una zona distinta
 * para que el plan diga «escribió 15:47» de una conversación descartada por
 * «escribió 10:47», y nadie sabría cuál de las dos creer.
 */
const hhmmLima = hhmmLocal;

function espera(desde: Date, ahora: Date): string {
  const min = Math.max(0, Math.round((ahora.getTime() - desde.getTime()) / 60_000));
  if (min < 60) return `${min} min`;
  const horas = Math.floor(min / 60);
  // Arriba de un día se dice en días: «57 h» no se lee, «2 d 09 h» sí — y el
  // punto de imprimir esto es que el disparate salte a la vista.
  if (horas >= 24) return `${Math.floor(horas / 24)} d ${String(horas % 24).padStart(2, '0')} h`;
  return `${horas} h ${String(min % 60).padStart(2, '0')} min`;
}

function imprimir(plan: PlanCompleto, cfg: ConfigAutoRespuesta, ahora: Date, encabezado: string[]): void {
  const linea = (s = '') => console.log(s);
  linea('');
  linea('══════════════════════════════════════════════════════════════════════════════');
  linea(' AUTO-RESPUESTA — SIMULACRO. No se manda nada, no se escribe nada.');
  linea('══════════════════════════════════════════════════════════════════════════════');
  for (const l of encabezado) linea(` ${l}`);
  linea(
    ` Límites   · franja de atención ${cfg.franja.desde}–${cfg.franja.hasta} (${cfg.zona}) · espera ${cfg.esperaMinutos} min a ${cfg.maxEsperaHoras} h`,
  );
  linea(
    `           · ventanas de despacho ${ventanasEfectivas(cfg)
      .map((v) => `${dosPuntos(v.desde)}–${dosPuntos(v.hasta)}`)
      .join(' y ')} · espaciado ${cfg.espaciadoSegundos[0]}–${cfg.espaciadoSegundos[1]} s`,
  );
  linea(`           · techos ${cfg.techoPorHora}/hora y ${cfg.techoPorDia}/día, por número propio`);
  linea('');

  linea(` PLAN DE DESPACHO — ${plan.ranuras.length} mensaje(s)`);
  if (plan.ranuras.length === 0) {
    linea('   (nada que mandar)');
  } else {
    // «escribió» y «espera» van PRIMERO, antes de la hora de salida: son las dos
    // columnas con las que un humano detecta que este plan no debería existir.
    linea('   escribió  espera       sale       teléfono        plantilla                          qué dice');
    linea('   ────────  ───────────  ─────────  ──────────────  ─────────────────────────────────  ─────────────────────────');
    let anterior: Date | null = null;
    for (const r of plan.ranuras) {
      const hueco = anterior ? `  (+${Math.round((r.programadoPara.getTime() - anterior.getTime()) / 1000)} s)` : '';
      linea(
        `   ${hhmmLima(r.candidato.desde, cfg.zona).padEnd(8)}  ${espera(r.candidato.desde, ahora).padEnd(11)}  ` +
          `${hhmmLima(r.programadoPara, cfg.zona).padEnd(9)}  ${r.candidato.telefono.padEnd(14)}  ` +
          `${r.candidato.plantillaId.padEnd(33)}  ${r.candidato.texto.slice(0, 25)}…${hueco}`,
      );
      anterior = r.programadoPara;
    }
  }

  linea('');
  linea(` POSTERGADAS — ${plan.postergados.length} (las atiende la vendedora al abrir)`);
  for (const p of plan.postergados.slice(0, 10)) {
    linea(
      `   ${hhmmLima(p.candidato.desde, cfg.zona).padEnd(8)}  ${espera(p.candidato.desde, ahora).padEnd(11)}  ` +
        `${p.candidato.telefono.padEnd(14)}  ${p.motivo}`,
    );
  }
  if (plan.postergados.length > 10) linea(`   … y ${plan.postergados.length - 10} más`);

  linea('');
  linea(` NO CALIFICAN — ${plan.descartadas.length}`);
  const porMotivo = new Map<string, typeof plan.descartadas>();
  for (const d of plan.descartadas) porMotivo.set(d.motivo, [...(porMotivo.get(d.motivo) ?? []), d]);
  for (const [motivo, filas] of [...porMotivo].sort((a, b) => b[1].length - a[1].length)) {
    linea(`   ${String(filas.length).padStart(3)} × ${motivo}`);
    // Hasta cinco POR MOTIVO, con su hora y su antigüedad. El resumen de una
    // línea con un ejemplo suelto era lo que dejaba pasar «25 escribieron en
    // horario»: se leía como una nota al pie y era el titular.
    for (const d of filas.slice(0, 5)) {
      linea(
        `         ${hhmmLima(d.candidata.ultimoEntranteEn, cfg.zona).padEnd(8)}  ` +
          `${espera(d.candidata.ultimoEntranteEn, ahora).padEnd(11)}  ` +
          `${d.candidata.telefono.padEnd(14)}  ${d.detalle}`,
      );
    }
    if (filas.length > 5) linea(`         … y ${filas.length - 5} más`);
  }
  linea('');
}

const dosPuntos = (minutos: number) =>
  `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;

async function main(): Promise<void> {
  const opciones = leerOpciones(process.argv.slice(2));
  // El simulacro planifica SIEMPRE, aunque la feature esté apagada: para eso es.
  const cfg: ConfigAutoRespuesta = { ...configDesdeEnv(), habilitada: true };
  const real = configDesdeEnv();

  const ahora = opciones.hora ? proximoMomento(new Date(), opciones.hora, cfg.zona) : new Date();

  const encabezado = [
    `Reloj     · ${hhmmLima(ahora, cfg.zona)} de Lima (${ahora.toISOString()})${opciones.hora ? '  ← simulado con --hora' : ''}`,
    `Entorno   · AUTO_RESPUESTA=${real.habilitada ? 'on' : 'off'}`,
  ];

  if (opciones.demo) {
    encabezado.push('Datos     · DEMO (sembrados en memoria, sin tocar la base)');
    imprimir(planificar(candidatasDeDemo(ahora, cfg.zona), cfg, ahora), cfg, ahora, encabezado);
    return;
  }

  // Modo real: LECTURA de la base y nada más.
  const { db } = await import('../db/client.js');
  const repo = repositorioDrizzle(db);
  const dia = diaLocal(ahora, cfg.zona);

  const interruptor = await repo.leerInterruptor().catch(() => null);
  encabezado.push(
    `Interruptor · ${interruptor ? interruptor.modo.toUpperCase() : 'sin tabla (falta `npm run db:push`)'}` +
      `${interruptor?.motivo ? ` — ${interruptor.motivo}` : ''}` +
      // En supervisada, el plan de abajo es lo que va a QUEDAR ESPERANDO el OK
      // de la vendedora, no lo que va a salir. Decirlo acá evita leer el
      // simulacro como una amenaza cuando es una propuesta.
      (interruptor?.modo === 'supervisada' ? ' (lo de abajo queda esperando aprobación, no sale solo)' : ''),
  );

  const candidatas = await consultarCandidatos(db, dia);
  const ocupadas = await repo.ocupacionDesde(dia).catch(() => []);
  encabezado.push(`Datos     · ${candidatas.length} conversación(es) esperando · ${ocupadas.length} ya en la cola de hoy`);

  imprimir(planificar(candidatas, cfg, ahora, undefined, ocupadas), cfg, ahora, encabezado);
  process.exit(0);
}

main().catch((err) => {
  console.error('[auto-respuesta] el simulacro falló:', err);
  process.exit(1);
});
