/**
 * LA CAMPANITA DE UN MENSAJE ENTRANTE.
 *
 * Dos tonos cortos y ascendentes, sintetizados con Web Audio API — sin archivo
 * de audio: nada que cargar, nada de CORS, y el mismo código sirve en el
 * navegador y en el webview de Tauri (es una API web estándar, no pasa por el
 * ACL de comandos de Tauri — ver CLAUDE.md §El navegador vive ADENTRO de la
 * mesa, que es sobre OTRA cosa: comandos `invoke()`, no esto).
 *
 * Un solo `AudioContext` para toda la sesión: crear uno por mensaje los deja
 * sin recolectar hasta el próximo GC y en Safari hay tope de instancias vivas.
 */
let contexto: AudioContext | null = null;

function contextoAudio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!contexto) contexto = new Ctor();
  return contexto;
}

function tono(ctx: AudioContext, frecuencia: number, cuando: number, duracion: number): void {
  const osc = ctx.createOscillator();
  const ganancia = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = frecuencia;
  // Envolvente corta: ataque de 10ms y caída exponencial, para que suene a
  // "ding" y no a un pitido sostenido.
  ganancia.gain.setValueAtTime(0, cuando);
  ganancia.gain.linearRampToValueAtTime(0.2, cuando + 0.01);
  ganancia.gain.exponentialRampToValueAtTime(0.0001, cuando + duracion);
  osc.connect(ganancia);
  ganancia.connect(ctx.destination);
  osc.start(cuando);
  osc.stop(cuando + duracion);
}

export function reproducirSonidoMensaje(): void {
  const ctx = contextoAudio();
  if (!ctx) return;
  try {
    // Los navegadores suspenden el AudioContext hasta el primer gesto del
    // usuario (login ya es uno): reintentar el resume acá es gratis y cubre el
    // caso en que el contexto se creó suspendido.
    if (ctx.state === 'suspended') void ctx.resume();
    const ahora = ctx.currentTime;
    tono(ctx, 880, ahora, 0.12);
    tono(ctx, 1175, ahora + 0.11, 0.16);
  } catch {
    // Sin sonido no se rompe nada: es una campanita, no una alerta crítica.
  }
}
