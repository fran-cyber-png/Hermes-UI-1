import 'dotenv/config';
import { consultarCandidatos } from '../autorespuesta/candidatos.js';
import { configDesdeEnv, ventanasEfectivas, type ConfigAutoRespuesta } from '../autorespuesta/config.js';
import type { ConversacionCandidata } from '../autorespuesta/decidir.js';
import { diaLocal, proximoMomento } from '../autorespuesta/franja.js';
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

/** Conversaciones de mentira, escalonadas como llegan de verdad de noche. */
function candidatasDeDemo(ahora: Date): ConversacionCandidata[] {
  const hace = (minutos: number) => new Date(ahora.getTime() - minutos * 60_000);
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
    base(14, 320),
    base(15, 310),
  ];
}

const hhmmLima = (f: Date, zona: string) =>
  new Intl.DateTimeFormat('es-PE', { timeZone: zona, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(f);

function espera(desde: Date, ahora: Date): string {
  const min = Math.max(0, Math.round((ahora.getTime() - desde.getTime()) / 60_000));
  return min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min` : `${min} min`;
}

function imprimir(plan: PlanCompleto, cfg: ConfigAutoRespuesta, ahora: Date, encabezado: string[]): void {
  const linea = (s = '') => console.log(s);
  linea('');
  linea('══════════════════════════════════════════════════════════════════════════════');
  linea(' AUTO-RESPUESTA — SIMULACRO. No se manda nada, no se escribe nada.');
  linea('══════════════════════════════════════════════════════════════════════════════');
  for (const l of encabezado) linea(` ${l}`);
  linea(
    ` Límites   · franja de atención ${cfg.franja.desde}–${cfg.franja.hasta} (${cfg.zona}) · espera mínima ${cfg.esperaMinutos} min`,
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
    linea('   hora (Lima)  esperó        teléfono        plantilla                          qué dice');
    linea('   ───────────  ────────────  ──────────────  ─────────────────────────────────  ──────────────────────────────');
    let anterior: Date | null = null;
    for (const r of plan.ranuras) {
      const hueco = anterior ? `  (+${Math.round((r.programadoPara.getTime() - anterior.getTime()) / 1000)} s)` : '';
      linea(
        `   ${hhmmLima(r.programadoPara, cfg.zona).padEnd(11)}  ${espera(r.candidato.desde, ahora).padEnd(12)}  ` +
          `${r.candidato.telefono.padEnd(14)}  ${r.candidato.plantillaId.padEnd(33)}  ` +
          `${r.candidato.texto.slice(0, 30)}…${hueco}`,
      );
      anterior = r.programadoPara;
    }
  }

  linea('');
  linea(` POSTERGADAS — ${plan.postergados.length} (las atiende la vendedora al abrir)`);
  for (const p of plan.postergados.slice(0, 10)) {
    linea(`   ${p.candidato.telefono.padEnd(14)}  ${p.motivo}`);
  }
  if (plan.postergados.length > 10) linea(`   … y ${plan.postergados.length - 10} más`);

  linea('');
  linea(` NO CALIFICAN — ${plan.descartadas.length}`);
  const porMotivo = new Map<string, number>();
  for (const d of plan.descartadas) porMotivo.set(d.motivo, (porMotivo.get(d.motivo) ?? 0) + 1);
  for (const [motivo, n] of [...porMotivo].sort((a, b) => b[1] - a[1])) {
    const ejemplo = plan.descartadas.find((d) => d.motivo === motivo)!;
    linea(`   ${String(n).padStart(3)} × ${motivo.padEnd(20)} ej.: ${ejemplo.detalle}`);
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
    imprimir(planificar(candidatasDeDemo(ahora), cfg, ahora), cfg, ahora, encabezado);
    return;
  }

  // Modo real: LECTURA de la base y nada más.
  const { db } = await import('../db/client.js');
  const repo = repositorioDrizzle(db);
  const dia = diaLocal(ahora, cfg.zona);

  const interruptor = await repo.leerInterruptor().catch(() => null);
  encabezado.push(
    `Interruptor · ${interruptor ? (interruptor.encendida ? 'ENCENDIDO' : 'apagado') : 'sin tabla (falta `npm run db:push`)'}` +
      `${interruptor?.motivo ? ` — ${interruptor.motivo}` : ''}`,
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
