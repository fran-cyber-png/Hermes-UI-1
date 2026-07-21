import type {
  EstadoSesion,
  MensajeWhatsapp,
  ResultadoEnvio,
  TransporteWhatsapp,
} from './transporte.js';

/**
 * UN TRANSPORTE DE WHATSAPP QUE NO HABLA CON WHATSAPP.
 *
 * ── Para qué existe ──
 * Todo lo que Hermes construye alrededor de WhatsApp — la cola, el hilo de la
 * conversación, la caja de envío, las guardas de "un envío = una acción humana",
 * la ficha del contacto — se puede levantar y testear ENTERO contra esta
 * implementación, sin vincular un número real, sin binario de Go, sin riesgo de
 * ban, y de forma determinista.
 *
 * Es el pago de haber puesto una costura (`TransporteWhatsapp`): la app no sabe
 * si del otro lado hay whatsmeow, la Cloud API, o esta mentira controlada. Y como
 * no hay protocolo real acá adentro, este archivo lo puede escribir Claude —
 * mientras que el transporte whatsmeow (parseo de JID, cliente del protocolo) lo
 * escribe el equipo.
 *
 * ── Lo que simula, y por qué eso importa ──
 * Un transporte de verdad tiene estados que duelen: la sesión que se cae, el
 * `logged_out`, el `temporary_ban`. Un falso que solo simula el camino feliz no
 * sirve para probar que la UI comunica bien lo que duele. Por eso este expone
 * `simularEstado`, `simularEntrante` y `simularBan`: los tests fuerzan el mal
 * tiempo a propósito.
 */
export class TransporteFalso implements TransporteWhatsapp {
  readonly nombre = 'falso' as const;

  private sesion: EstadoSesion = { estado: 'sin-vincular', qr: null, codigo: null };
  private susMensaje: ((m: MensajeWhatsapp) => void)[] = [];
  private susEstado: ((e: EstadoSesion) => void)[] = [];

  /** Todo lo que se "envió", para que los tests verifiquen qué salió y en qué orden. */
  readonly enviados: { telefono: string; texto: string; idExterno: string }[] = [];

  private contador = 0;

  constructor(
    private opciones: {
      /**
       * El número PROPIO con el que arranca "conectado" (la sesión de este
       * transporte). Si falta, arranca sin vincular. Se estampa como
       * `numeroPropio` en cada mensaje que entra o sale por esta sesión.
       */
      telefono?: string;
      /** Reloj inyectable: los tests no dependen de la hora real. */
      ahora?: () => Date;
    } = {},
  ) {
    if (opciones.telefono) {
      this.sesion = { estado: 'conectado', telefono: opciones.telefono };
    }
  }

  /** El número propio de esta sesión. Es lo que se estampa en cada mensaje. */
  private get numeroPropio(): string {
    return this.sesion.estado === 'conectado' ? this.sesion.telefono : (this.opciones.telefono ?? '');
  }

  private reloj(): Date {
    return this.opciones.ahora ? this.opciones.ahora() : new Date();
  }

  /** Ids monótonos y estables: `falso-1`, `falso-2`… — sirven de clave de idempotencia en los tests. */
  private nuevoId(): string {
    this.contador += 1;
    return `falso-${this.contador}`;
  }

  async iniciar(): Promise<void> {
    // Sin número configurado, un transporte real mostraría el QR. El falso emite
    // un QR de mentira para que la UI de "vinculá tu cuenta" tenga algo que pintar.
    if (this.sesion.estado === 'sin-vincular') {
      this.cambiarEstado({ estado: 'sin-vincular', qr: 'FALSO-QR-escaneame', codigo: null });
    }
  }

  estado(): EstadoSesion {
    return this.sesion;
  }

  async vincularConCodigo(_telefono: string): Promise<string> {
    // Un código de emparejamiento de 8 caracteres, como el real, pero fijo.
    return 'FALSO123';
  }

  onMensaje(cb: (m: MensajeWhatsapp) => void): void {
    this.susMensaje.push(cb);
  }

  onEstado(cb: (e: EstadoSesion) => void): void {
    this.susEstado.push(cb);
  }

  async enviarTexto(telefono: string, texto: string): Promise<ResultadoEnvio> {
    // Un transporte no manda contra una sesión que no está conectada. Fallar acá
    // es lo correcto: es donde la guarda de arriba se entera de que no hay línea.
    if (this.sesion.estado !== 'conectado') {
      throw new Error(`No se puede enviar: la sesión está "${this.sesion.estado}", no conectada.`);
    }

    const idExterno = this.nuevoId();
    const ocurridoEn = this.reloj();
    this.enviados.push({ telefono, texto, idExterno });

    // El eco: un envío también es un mensaje del hilo. Emitirlo como `esMio` deja
    // que la conversación se pinte igual que en un transporte real, donde lo que
    // mandás vuelve como parte del stream.
    this.emitirMensaje({
      idExterno,
      numeroPropio: this.numeroPropio,
      telefono,
      esMio: true,
      esGrupo: false,
      ocurridoEn,
      nombreVisible: null,
      texto,
      clase: 'texto',
    });

    return { idExterno, ocurridoEn };
  }

  async marcarLeido(_telefono: string, _idsExternos: string[]): Promise<void> {
    // No-op: marcar leído no cambia nada observable en el falso.
  }

  async detener(): Promise<void> {
    this.cambiarEstado({ estado: 'desconectado', motivo: 'transporte detenido' });
    this.susMensaje = [];
    this.susEstado = [];
  }

  // ── Palancas de prueba: forzar el mundo real desde un test ────────────────

  /** Simula que ENTRÓ un mensaje de alguien. El corazón de casi todos los tests. */
  simularEntrante(telefono: string, texto: string, nombreVisible: string | null = null): MensajeWhatsapp {
    const m: MensajeWhatsapp = {
      idExterno: this.nuevoId(),
      numeroPropio: this.numeroPropio,
      telefono,
      esMio: false,
      esGrupo: false,
      ocurridoEn: this.reloj(),
      nombreVisible,
      texto,
      clase: 'texto',
    };
    this.emitirMensaje(m);
    return m;
  }

  /** Fuerza un cambio de estado arbitrario: caída, cierre de sesión, lo que sea. */
  simularEstado(e: EstadoSesion): void {
    this.cambiarEstado(e);
  }

  /**
   * Simula el `temporary_ban` de WhatsApp. Es el estado que NUNCA se puede
   * esconder: el equipo tiene que verlo o seguirá escribiendo contra un número
   * muerto sin entender por qué nadie responde.
   */
  simularBan(codigo = '191', expira = 'en 24 horas'): void {
    this.cambiarEstado({ estado: 'baneado', codigo, expira });
  }

  private emitirMensaje(m: MensajeWhatsapp): void {
    for (const cb of this.susMensaje) cb(m);
  }

  private cambiarEstado(e: EstadoSesion): void {
    this.sesion = e;
    for (const cb of this.susEstado) cb(e);
  }
}
