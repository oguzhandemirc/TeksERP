// Push köprüsü bekçilerinin ortak düzeneği (`test_bildirim_koprusu`, `test_bildirim_koprusu_sertlik`): sahte satıcı
// iç API'si, sahte kurulum, imzalı istek yardımcıları, süreç günlüğü yakalama. Gerçek Expo/satıcı çağrısı YOK.
import { generateKeyPairSync, randomUUID, type KeyObject } from "node:crypto";
import { gzipSync } from "node:zlib";
import { REQUEST_HEADER, publicKeyX, signRequest } from "../../src/lisans-protokol";
import { PUSH_BRIDGE_PATHS } from "../../src/wire/esitleme";
import type { Ortam, Yanit } from "./test-ortam";

/**
 * Süreç günlüğü (sunucu süreç içinde koşar): çağrıldığı andan sonra stdout + stderr'e yazılan her şey. Erişim günlüğü
 * AÇIKÇA açılır: CI işi `PATRON_ERISIM_GUNLUGU=0` taşır; kapalıyken ✓K sondası (köprü yolu günlükte) düşer ve
 * "metin/belirteç günlükte yok" iddiası boş geçerdi. Bu bekçi süreçlerine özeldir (emsal `test_ip_saklama`).
 */
export function gunlukYakala(): string[] {
  process.env.PATRON_ERISIM_GUNLUGU = "1";
  const gunluk: string[] = [];
  for (const akis of [process.stdout, process.stderr]) {
    const asil = akis.write.bind(akis) as (c: string | Uint8Array, ...r: unknown[]) => boolean;
    akis.write = ((c: string | Uint8Array, ...r: unknown[]) => {
      gunluk.push(typeof c === "string" ? c : Buffer.from(c).toString("utf8"));
      return asil(c, ...r);
    }) as typeof akis.write;
  }
  return gunluk;
}

export const SATICI_BELIRTECI = "bekci-satici-ic-api-belirteci-0123456789abcdef";
export const SATICI = "http://satici.bekci.invalid";

export interface SahteKurulum {
  readonly kurulumId: string;
  readonly tesisId: string;
  readonly privateKey: KeyObject;
  gorunum: Record<string, unknown>;
}

export const satici = new Map<string, SahteKurulum>();
export const saticiDurumu = { kapali: false, cagri: 0 };

export const sahteFetch: typeof fetch = async (input) => {
  saticiDurumu.cagri += 1;
  if (saticiDurumu.kapali) throw new TypeError("fetch failed");
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const id = decodeURIComponent(url.pathname.replace("/ic/v1/kurulum/", ""));
  const k = satici.get(id);
  if (!k) return new Response(JSON.stringify({ success: false }), { status: 404 });
  return new Response(JSON.stringify(k.gorunum), { status: 200, headers: { "Content-Type": "application/json" } });
};

export function kurulum(g: Partial<{ durum: string; aktif: boolean; sinif: string; abonelik: boolean }> = {}): SahteKurulum {
  const kurulumId = randomUUID();
  const tesisId = randomUUID();
  const { privateKey } = generateKeyPairSync("ed25519");
  const k: SahteKurulum = {
    kurulumId,
    tesisId,
    privateKey,
    gorunum: {
      v: 1,
      kurulumId,
      tesis: { id: tesisId, ad: `Köprü Bekçi ${tesisId.slice(0, 6)}` },
      acikAnahtar: publicKeyX(privateKey),
      anahtarKimligi: null,
      durum: g.durum ?? "ETKIN",
      sinif: g.sinif ?? "URETIM",
      moduller: g.abonelik ? ["patron-bulut"] : [],
      patronBulutBitis: g.abonelik ? new Date(Date.now() + 86_400_000).toISOString() : null,
      devredildi: g.durum === "DEVREDILDI",
      aktif: g.aktif ?? true,
      saklamaAy: 13,
    },
  };
  satici.set(kurulumId, k);
  return k;
}

/** Satıcının hiç bilmediği kurulum (anahtar gerçek, kayıt yok). */
export const yabanciKurulum = (): SahteKurulum => ({ kurulumId: randomUUID(), tesisId: randomUUID(), privateKey: generateKeyPairSync("ed25519").privateKey, gorunum: {} });

export const SENTINEL = `GIZLI-METIN-${randomUUID()}`;
/** Üretilen her ham belirteç: §9 günlük/DB taraması bunları da arar. */
export const uretilenBelirtecler: string[] = [];
export const belirtec = (): string => {
  const t = `ExponentPushToken[${randomUUID().replace(/-/g, "").slice(0, 22)}]`;
  uretilenBelirtecler.push(t);
  return t;
};

export type IstekSecenek = { amac?: "bildir" | "esitle"; baslik?: string; ham?: Buffer; gzip?: boolean; imzaYolu?: string | null; imzaSaati?: number };

export async function istek(o: Ortam, k: Pick<SahteKurulum, "kurulumId" | "privateKey">, yol: string, govde: unknown, g: IstekSecenek = {}): Promise<Yanit & { baslik: string }> {
  const ham = g.ham ?? Buffer.from(JSON.stringify(govde), "utf8");
  const tel = g.gzip ? gzipSync(ham) : ham;
  // `imzaYolu: null` = yolsuz (eski biçim) imza; verilmezse ucun kendi yolu.
  const imzaYolu = g.imzaYolu === null ? {} : { path: g.imzaYolu ?? yol };
  const baslik = g.baslik ?? signRequest({ installationId: k.kurulumId, purpose: g.amac ?? "bildir", body: tel, key: { privateKey: k.privateKey, nowMs: g.imzaSaati ?? o.saat.simdi() }, ...imzaYolu });
  const res = await fetch(`${o.adres}${yol}`, {
    method: "POST",
    headers: { [REQUEST_HEADER]: baslik, "Content-Type": "application/json", ...(g.gzip ? { "Content-Encoding": "gzip" } : {}) },
    body: new Uint8Array(tel),
  });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as Yanit["json"]) : { success: false }, headers: res.headers, baslik };
}

export const kaydet = (o: Ortam, k: SahteKurulum, ozetler: string[]) => istek(o, k, PUSH_BRIDGE_PATHS.REGISTER, { v: 1, ozetler });
export const birak = (o: Ortam, k: SahteKurulum, ozetler: string[]) => istek(o, k, PUSH_BRIDGE_PATHS.RELEASE, { v: 1, ozetler });
export const durtGovdesi = (belirtecler: string[], g: { baslik?: string; govde?: string; bildirimId?: string; rota?: string | null } = {}) => ({
  v: 1,
  belirtecler,
  baslik: g.baslik ?? `${SENTINEL} başlık`,
  govde: g.govde ?? `${SENTINEL} gövde`,
  data: { bildirimId: g.bildirimId ?? randomUUID(), rota: g.rota === undefined ? "/bildirimler" : g.rota },
});
export const durt = (o: Ortam, k: SahteKurulum, belirtecler: string[], g: Parameters<typeof durtGovdesi>[1] = {}) => istek(o, k, PUSH_BRIDGE_PATHS.NUDGE, durtGovdesi(belirtecler, g));

export type DurtVeri = { gonderim: string; sonuclar: { ozet: string; sonuc: string; kod?: string }[]; gecersiz: string[] };
export const veri = (r: Yanit): DurtVeri => r.json as unknown as DurtVeri;
export const kod = (r: Yanit): string | undefined => r.json.details?.code;
export const SATICI_ORTAMI = { KURULUM_KAYNAGI: "satici", SATICI_IC_API_URL: SATICI, SATICI_IC_API_BELIRTECI: SATICI_BELIRTECI, KURULUM_ONBELLEK_DK: "5" };
