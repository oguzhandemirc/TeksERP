// SENARYO L — HTTP istemcileri: fabrika API'si (oturum düşerse yeniden giriş) ve satıcı portalı
// (parola + TOTP; TOTP satıcının KAYDIRILMIŞ saatiyle üretilir). `test_` öneki yok → bekçi değil.
import { createHmac, randomUUID } from "node:crypto";

export interface Yanit {
  readonly status: number;
  readonly json: Record<string, unknown>;
  /** `data` alanı (başarı zarfı). */
  readonly veri: Record<string, unknown>;
  /** `details.code` — `body.code` okunmaz. */
  readonly kod: string | undefined;
  readonly details: Record<string, unknown>;
}

async function jsonIstek(url: string, g: { yontem: string; govde?: unknown; basliklar?: Record<string, string> }): Promise<Yanit> {
  const r = await fetch(url, {
    method: g.yontem,
    headers: { ...(g.govde === undefined ? {} : { "content-type": "application/json" }), ...(g.basliklar ?? {}) },
    ...(g.govde === undefined ? {} : { body: typeof g.govde === "string" ? g.govde : JSON.stringify(g.govde) }),
  });
  const metin = await r.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(metin) as Record<string, unknown>;
  } catch {
    json = { _metin: metin.slice(0, 300) };
  }
  const details = (json.details ?? {}) as Record<string, unknown>;
  const veri = (json.data && typeof json.data === "object" ? json.data : {}) as Record<string, unknown>;
  return { status: r.status, json, veri, kod: typeof details.code === "string" ? details.code : undefined, details };
}

// ---------------------------------------------------------------- fabrika
export class FabrikaIstemcisi {
  private token: string | null = null;

  constructor(
    public url: string,
    private readonly kullanici: { username: string; password: string },
    private readonly istemciTuru: "electron" | "mobile" = "electron",
  ) {}

  async giris(): Promise<Yanit> {
    const y = await jsonIstek(`${this.url}/api/auth/login`, {
      yontem: "POST",
      govde: { ...this.kullanici, clientType: this.istemciTuru, confirmKick: true },
    });
    if (y.status === 200) this.token = String((y.veri as { token?: string }).token);
    return y;
  }

  /** Kimlikli istek; 401'de bir kez yeniden giriş (saat kaydırması JWT'yi eskitir). */
  async istek(yontem: string, yol: string, govde?: unknown): Promise<Yanit> {
    if (!this.token) await this.giris();
    let y = await jsonIstek(`${this.url}${yol}`, { yontem, govde, basliklar: { authorization: `Bearer ${this.token}` } });
    if (y.status === 401) {
      await this.giris();
      y = await jsonIstek(`${this.url}${yol}`, { yontem, govde, basliklar: { authorization: `Bearer ${this.token}` } });
    }
    return y;
  }

  /** Kimliksiz (ya da verilen ham başlıkla) istek. */
  anonim(yontem: string, yol: string, govde?: unknown, basliklar: Record<string, string> = {}): Promise<Yanit> {
    return jsonIstek(`${this.url}${yol}`, { yontem, govde, basliklar });
  }

  async detay(): Promise<LisansDetayi> {
    const y = await this.istek("GET", "/api/license/detay");
    if (y.status !== 200) throw new Error(`detay ${y.status} ${y.kod ?? ""}`);
    return y.veri as unknown as LisansDetayi;
  }

  /** Ek-7: etkinleştirmeden önce panelin sözleşme kabul adımı — güncel metnin bütün kutularıyla (201 beklenir). */
  async sozlesmeyiKabulEt(g: { adSoyad?: string; unvan?: string } = {}): Promise<Yanit> {
    const v = await this.istek("GET", "/api/license/kabul");
    if (v.status !== 200) return v;
    const metin = (v.veri as { metin: { kimlik: string; ozet: string; kutular: string[] } }).metin;
    return this.istek("POST", "/api/license/kabul", {
      clientToken: randomUUID(),
      metinKimligi: metin.kimlik,
      metinOzeti: metin.ozet,
      kutular: metin.kutular,
      adSoyad: g.adSoyad ?? "Senaryo Yetkili",
      unvan: g.unvan ?? "Genel Müdür",
    });
  }

  async yokla(): Promise<{ outcome: string; code?: string }> {
    const y = await this.istek("POST", "/api/license/yokla");
    return y.veri as { outcome: string; code?: string };
  }

  /** Koşul sağlanana dek detayı okur; geçen süre (ms) ya da zaman aşımında null. */
  async bekle(kosul: (d: LisansDetayi) => boolean, ms: number, aralik = 150): Promise<{ ms: number | null; detay: LisansDetayi }> {
    const t0 = Date.now();
    let d = await this.detay();
    while (!kosul(d)) {
      if (Date.now() - t0 > ms) return { ms: null, detay: d };
      await new Promise((r) => setTimeout(r, aralik));
      d = await this.detay();
    }
    return { ms: Date.now() - t0, detay: d };
  }
}

/** `/api/license/detay` yanıtının senaryonun okuduğu kısmı (sözleşme: protokol belgesi §14). */
export interface LisansDetayi {
  hazir: boolean;
  kurulum: { kurulumId: string | null; veritabaniKimligi?: string | null; anahtarKimligi: string | null; etkin: boolean };
  depo: { durumKaydi: { gecerli: boolean; sira: number | null } };
  durum: {
    gecerlilik: string;
    nedenler: Array<{ kod: string; ayrinti?: string | null }>;
    kip: string;
    hesaplananKademe: string;
    uygulananKademe: string;
    hesaplanan: { bant: { metin: string; ton: string } | null; guncellemeIzni: boolean; modulTavani: { applies: boolean; allowed?: string[] | null; denied?: string[] } };
    uygulanan: { bant: { metin: string; ton: string } | null; guncellemeIzni: boolean; modulTavani: { applies: boolean; allowed?: string[] | null; denied?: string[] } };
    ekSureKalanGun: number | null;
    kisitlamaKalanGun: number | null;
    devredildi: boolean;
    yaptirimKademesi: string | null;
    saat: { guvenilir: string; kaynak: string; bulgu: string | null; bulguKaynagi: string | null };
    /** v2 süre çapası P (`null` = belgeler P taşımıyor, eski çapa). */
    odenmisTarih: { tarih: string | null; kaynak: string; sozlesmeSonu: boolean } | null;
    baglanti: { sonAlisveris: string | null; internetVar: boolean };
  };
  hak: { hakId: string; surum: number; lisansNo: string; kalici: boolean; moduller: string[]; bakimBitis: string; bayiId: string | null } | null;
  kira: { kiraId: string; bitis: string; zorlama: boolean; gecerlilikBitis: string | null; devredildi: boolean; yaptirim: { kademe: string | null; guncellemeDonuk: boolean; donmusModuller: string[] } } | null;
  parmakIzi: { karar: string | null; eslesen: number | null; olculebilen: number | null; uyusmayan: string[] };
  yoklama: { sonHataKodu: string | null; zil: { bagli: boolean } };
  gozlem: { reddedilecekIstek: number; reddedilecekModul: number };
  tasima: { talepId: string; durum?: "BEKLIYOR" | "ONAYLANDI" } | null;
}

// ---------------------------------------------------------------- satıcı portalı
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Coz(girdi: string): Buffer {
  let bit = 0;
  let deger = 0;
  const cikti: number[] = [];
  for (const ch of girdi.toUpperCase().replace(/[=\s-]/g, "")) {
    deger = (deger << 5) | B32.indexOf(ch);
    bit += 5;
    if (bit >= 8) {
      cikti.push((deger >>> (bit - 8)) & 0xff);
      bit -= 8;
    }
  }
  return Buffer.from(cikti);
}

/** RFC 6238 (SHA-1, 6 hane, 30 sn) — portalın doğruladığı standart. */
export function totpKodu(sir: string, adim: number): string {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(adim));
  const d = createHmac("sha1", base32Coz(sir)).update(b).digest();
  const o = d[d.length - 1]! & 0x0f;
  const n = ((d[o]! & 0x7f) << 24) | (d[o + 1]! << 16) | (d[o + 2]! << 8) | d[o + 3]!;
  return String(n % 1_000_000).padStart(6, "0");
}

export class PortalIstemcisi {
  private cerez: string | null = null;
  private sonAdim = -1;

  constructor(
    private readonly taban: string,
    private readonly onEk: "/portal/api" | "/bayi/api",
    private readonly kimlik: { kullaniciAdi: string; parola: string; sir: string },
    /** Satıcının saati (kaydırılmış) — TOTP adımı ondan. */
    private readonly saticiSaati: () => number,
  ) {}

  async giris(): Promise<Yanit> {
    // Aynı adımın kodu ikinci kez kabul edilmez (tekrar kilidi): gerekirse bir sonraki adım (±1 pencere).
    let adim = Math.floor(this.saticiSaati() / 30_000);
    if (adim <= this.sonAdim) adim = this.sonAdim + 1;
    if (adim > Math.floor(this.saticiSaati() / 30_000) + 1) {
      await new Promise((r) => setTimeout(r, 30_000));
      adim = Math.floor(this.saticiSaati() / 30_000);
    }
    const r = await fetch(`${this.taban}${this.onEk}/oturum/ac`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kullaniciAdi: this.kimlik.kullaniciAdi, parola: this.kimlik.parola, totp: totpKodu(this.kimlik.sir, adim) }),
    });
    this.sonAdim = adim;
    const setCookie = r.headers.get("set-cookie");
    if (r.status === 200 && setCookie) this.cerez = setCookie.split(";")[0]!.trim();
    const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    const details = (json.details ?? {}) as Record<string, unknown>;
    return { status: r.status, json, veri: (json.data ?? {}) as Record<string, unknown>, kod: details.code as string | undefined, details };
  }

  /** Yazmalara `clientToken` eklenir (işlem kimliği); 401'de bir kez yeniden giriş. */
  async istek(yontem: string, yol: string, govde?: Record<string, unknown>): Promise<Yanit> {
    if (!this.cerez) await this.giris();
    const beden = govde === undefined ? undefined : { clientToken: randomUUID(), ...govde };
    const gonder = (): Promise<Yanit> => jsonIstek(`${this.taban}${this.onEk}${yol}`, { yontem, govde: beden, basliklar: this.cerez ? { cookie: this.cerez } : {} });
    let y = await gonder();
    if (y.status === 401) {
      await this.giris();
      y = await gonder();
    }
    return y;
  }
}
