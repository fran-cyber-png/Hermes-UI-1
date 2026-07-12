// Meta Graph / Marketing API client — TS port of the client already proven in
// goberna-dashboard (core/services/meta_client.py). Single source of truth for
// talking to the Graph API from meta-escuela; keep the API version and error
// shape aligned with that reference implementation.

export const META_API_VERSION = "v25.0";

export class MetaGraphError extends Error {
  httpCode?: number;
  errorCode?: number;
  subcode?: number;
  /** El mensaje que Meta escribe para humanos. Suele ser el ÚNICO útil. */
  userTitle?: string;
  userMessage?: string;
  body?: string;

  constructor(
    message: string,
    opts: {
      httpCode?: number;
      errorCode?: number;
      subcode?: number;
      userTitle?: string;
      userMessage?: string;
      body?: string;
    } = {},
  ) {
    super(message);
    this.name = "MetaGraphError";
    Object.assign(this, opts);
  }
}

/**
 * Meta devuelve "Invalid parameter" en `message` y esconde la causa real en
 * `error_user_title` / `error_user_msg`. Sin esto, depurar es adivinar.
 */
export function metaErrorFrom(json: any, httpStatus: number): MetaGraphError {
  const e = json?.error ?? {};
  const message = e.error_user_msg || e.message || `HTTP ${httpStatus}`;
  return new MetaGraphError(message, {
    httpCode: httpStatus,
    errorCode: e.code,
    subcode: e.error_subcode,
    userTitle: e.error_user_title,
    userMessage: e.error_user_msg,
    body: JSON.stringify(json),
  });
}

export class MetaGraphClient {
  private token: string;
  private base: string;

  constructor(token: string, version: string = META_API_VERSION) {
    this.token = token;
    this.base = `https://graph.facebook.com/${version}`;
  }

  // POST an urlencoded body to a Graph endpoint (e.g. `act_X/campaigns`).
  // access_token is appended automatically — never pass it in params.
  async post(path: string, params: Record<string, string>): Promise<any> {
    const body = new URLSearchParams({ ...params, access_token: this.token });
    const res = await fetch(`${this.base}/${path}`, { method: "POST", body });
    const json: any = await res.json().catch(() => ({}));

    if (!res.ok) throw metaErrorFrom(json, res.status);
    return json;
  }

  async get(path: string, params: Record<string, string> = {}): Promise<any> {
    const q = new URLSearchParams({ ...params, access_token: this.token });
    const res = await fetch(`${this.base}/${path}?${q.toString()}`);
    const json: any = await res.json().catch(() => ({}));

    if (!res.ok) throw metaErrorFrom(json, res.status);
    return json;
  }

  // GET with paging.next follow-up — returns the concatenated `data[]`.
  async getAll(path: string, params: Record<string, string>): Promise<any[]> {
    const out: any[] = [];
    let resp = await this.get(path, params);
    while (true) {
      out.push(...(resp.data ?? []));
      const nextUrl = resp.paging?.next;
      if (!nextUrl) return out;
      const res = await fetch(nextUrl);
      resp = await res.json().catch(() => ({}));
    }
  }

  /**
   * Sigue la paginación de un edge ANIDADO (ej. `post.comments`) hasta agotarlo.
   *
   * `getAll` solo sigue el `paging.next` del nivel superior. Cuando los comentarios vienen
   * adentro del post (`comments.limit(50){...}`), su `paging.next` propio nunca se seguía —
   * así que TODO post con más de 50 comentarios se truncaba en silencio.
   *
   * Medido: 112 de nuestros 1.873 posts tocan el tope exacto de 50. Entre los posts que sí
   * son atribuibles a un anuncio, 48 de 274 (17,5%) están cortados. Estábamos perdiendo
   * comentarios sin saberlo.
   *
   * Devuelve el `data[]` completo del edge, incluyendo lo que ya venía en la primera página.
   */
  async getAllNested(edge: { data?: any[]; paging?: { next?: string } } | undefined): Promise<any[]> {
    const out: any[] = [...(edge?.data ?? [])];
    let nextUrl = edge?.paging?.next;

    // Tope de seguridad: un post con 200.000 comentarios no debe colgar la ingesta.
    for (let pagina = 0; nextUrl && pagina < 200; pagina++) {
      const res = await fetch(nextUrl);
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok) throw metaErrorFrom(json, res.status);
      out.push(...(json.data ?? []));
      nextUrl = json.paging?.next;
    }
    return out;
  }
}
