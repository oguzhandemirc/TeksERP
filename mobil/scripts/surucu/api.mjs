// =============================================================================
// BACKEND DOĞRULAMA İSTEMCİSİ — adım sonunda "sunucuda ne oldu" (fetch; Node 18+)
// =============================================================================
// Sürücü ekrana bakar, bu sınıf deftere: ör. D1 sonrası `GET /warp-beams?status=PLANNED`
// listesinde TEST-M1 gövdeli plan var mı. Token klasik `/auth/login` ile (admin/şifre);
// üstbilgi `X-Client-Type: web` (panel yolu) — tabletin oturumuna DOKUNMAZ.
// =============================================================================
export class Api {
  constructor(tabanUrl) {
    this.taban = tabanUrl.replace(/\/$/, '');
    this.token = null;
  }

  async giris(username, password) {
    const r = await this.istek('POST', '/auth/login', { username, password }, { yetkisiz: true });
    this.token = r.data?.token ?? r.token;
    if (!this.token) throw new Error(`login token yok: ${JSON.stringify(r).slice(0, 200)}`);
    return r;
  }

  async istek(yontem, yol, govde, { yetkisiz = false } = {}) {
    const basliklar = { 'Content-Type': 'application/json', 'X-Client-Type': 'web' };
    if (!yetkisiz && this.token) basliklar.Authorization = `Bearer ${this.token}`;
    const r = await fetch(`${this.taban}${yol}`, { method: yontem, headers: basliklar, body: govde ? JSON.stringify(govde) : undefined });
    const metin = await r.text();
    let json;
    try {
      json = JSON.parse(metin);
    } catch {
      json = { ham: metin };
    }
    if (!r.ok) throw new Error(`${yontem} ${yol} → ${r.status} ${json.message ?? metin.slice(0, 200)} ${json.details?.code ? `[${json.details.code}]` : ''}`);
    return json;
  }

  get(yol) {
    return this.istek('GET', yol);
  }

  post(yol, govde) {
    return this.istek('POST', yol, govde);
  }
}
