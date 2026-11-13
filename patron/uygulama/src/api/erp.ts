// ERP kipi uçları: fabrikanın TeksERP sunucusu (`/api/auth/*`, `/api/patron/v1/*`). Okuma uçlarının yanıt biçimi
// bulutun `/oturum`, `/veri`, `/anlik` uçlarıyla AYNI (V3a) → ekranlar aynı `Api` tipini kullanır. Bu tablo bulut uç
// tablosundan (`endpoints.ts`, ayna bekçisi) AYRIDIR. Parola ve kod yalnız istek gövdesinde gider; hiçbir yere yazılmaz.
import { ApiError, type ApiClient } from "./client";
import { createApi, type Api, type ListParams } from "./endpoints";
import { kipteYok } from "./baglanti";
import { kumeSunuluyor, type Yetenek } from "./yetenek";
import type { FacilityStatus, Page, ProjectionRecord, Snapshot } from "./wire";

export const ERP_ENDPOINTS = {
  login: ["post", "/auth/login"],
  me: ["get", "/auth/me"],
  logout: ["post", "/auth/logout"],
  session: ["get", "/patron/v1/oturum"],
  list: ["get", "/patron/v1/veri/:projeksiyon"],
  record: ["get", "/patron/v1/veri/:projeksiyon/:id"],
  snapshot: ["get", "/patron/v1/anlik/:projeksiyon"],
} as const;

const seg = (v: string) => encodeURIComponent(v);

/** `GET /api/auth/me` — yalnız uygulamanın okuduğu alanlar. */
export interface ErpMe {
  readonly userId: string;
  readonly username: string;
  readonly fullName?: string | null;
  readonly permissions: readonly string[];
  readonly backendVersion?: string;
  readonly patronApiVersion?: number | string;
  readonly patronReadSets?: readonly string[];
}

export interface ErpLoginResult {
  readonly token: string;
  readonly mustChangePassword?: boolean;
}

/** Giriş hata kodu → kısa Türkçe ileti (kod `details.code`). */
const GIRIS_ILETISI: Readonly<Record<string, string>> = {
  PATRON_ACCESS_DENIED: "Bu hesabın telefon uygulamasına izni yok",
  TOTP_REQUIRED: "Doğrulama kodu gerekli",
  TOTP_INVALID: "Doğrulama kodu yanlış",
  TOTP_ENROLLMENT_REQUIRED: "Bu hesapta önce iki adımlı doğrulama kurulmalı",
  PASSWORD_CHANGE_REQUIRED: "Parolanızı önce yönetim panelinden değiştirin",
  PATRON_PASSWORD_ONLY: "Yalnız kullanıcı adı ve parolayla girilir",
  RATE_LIMITED: "Çok fazla deneme; biraz sonra tekrar deneyin",
};

export const TOTP_REQUIRED = "TOTP_REQUIRED";

/** Giriş hatasını kısa Türkçe iletiyle yeniden kurar (kod ve durum korunur). */
export function girisHatasi(err: unknown): unknown {
  if (!(err instanceof ApiError)) return err;
  const known = GIRIS_ILETISI[err.code];
  if (known) return new ApiError(err.status, err.code, known, err.details);
  if (err.status === 401) return new ApiError(401, err.code, "Kullanıcı adı veya parola yanlış", err.details);
  if (err.status === 429) return new ApiError(429, err.code, GIRIS_ILETISI.RATE_LIMITED!, err.details);
  if (err.kind === "AG") return new ApiError(0, err.code, "Sunucuya ulaşılamıyor", err.details);
  return err;
}

/** `POST /api/auth/login` (patron türü). Kod boşsa gönderilmez; sunucu isterse 409 `TOTP_REQUIRED`. */
export async function erpGiris(c: ApiClient, b: { kullanici: string; parola: string; kod?: string }): Promise<ErpLoginResult> {
  const kod = b.kod?.trim();
  try {
    const r = await c.post<ErpLoginResult>(ERP_ENDPOINTS.login[1], {
      username: b.kullanici,
      password: b.parola,
      clientType: "patron",
      ...(kod ? { totpCode: kod } : {}),
    });
    if (typeof r?.token !== "string" || r.token === "") throw new ApiError(502, "SUNUCU_HATASI", "Sunucudan beklenmeyen yanıt");
    // Zorunlu parola değişimindeki kısıtlı belirteç patron uçlarına geçmez: girişi açmayız.
    if (r.mustChangePassword === true) throw new ApiError(403, "PASSWORD_CHANGE_REQUIRED", GIRIS_ILETISI.PASSWORD_CHANGE_REQUIRED!);
    return r;
  } catch (err) {
    throw girisHatasi(err);
  }
}

export function erpBen(c: ApiClient): Promise<ErpMe> {
  return c.get<ErpMe>(ERP_ENDPOINTS.me[1]);
}

/**
 * Bulutla AYNI `Api` nesnesi: okuma ERP uçlarına gider; bu kipte karşılığı olmayan her yöntem ve sunulmayan küme
 * AĞA GİTMEDEN 404 döner (ekran gizlidir; gizlenmemiş bir alt parça boş durum çizer, kırılmaz).
 */
export function createErpApi(c: ApiClient, y: () => Yetenek): Api {
  const yok = () => Promise.reject(kipteYok("KIP_DESTEKLEMIYOR"));
  const base = createApi(c);
  const unsupported = Object.fromEntries(Object.keys(base).map((k) => [k, yok])) as unknown as Api;
  const guard = <T,>(ad: string, run: () => Promise<T>): Promise<T> => (kumeSunuluyor(ad, y()) ? run() : Promise.reject(kipteYok("KUME_SUNULMUYOR")));
  const q = (p: ListParams) => ({ imlec: p.imlec, limit: p.limit, durum: p.durum, cariKartId: p.cariKartId, cariHesapId: p.cariHesapId, siparisId: p.siparisId, teklifId: p.teklifId, ara: p.ara, suzgec: p.suzgec, kategoriAnahtari: p.kategoriAnahtari });
  return {
    ...unsupported,
    session: () => c.get<FacilityStatus>(ERP_ENDPOINTS.session[1]),
    logout: () => c.post<null>(ERP_ENDPOINTS.logout[1], {}),
    facilities: () => Promise.resolve([]),
    list: (p: string, lp: ListParams = {}) => guard(p, () => c.get<Page<ProjectionRecord>>(`/patron/v1/veri/${seg(p)}`, q(lp))),
    record: (p: string, id: string) => guard(p, () => c.get<ProjectionRecord>(`/patron/v1/veri/${seg(p)}/${seg(id)}`)),
    snapshot: (p: string) => guard(p, () => c.get<Snapshot>(`/patron/v1/anlik/${seg(p)}`)),
  };
}
