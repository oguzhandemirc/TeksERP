// Rapor katmanı (V5b): istek üzerine EŞZAMANLI oluşturulan, saklanan ve geçmişi tutulan rapor (ERP
// `/api/patron/v1/raporlar`, V5a). Ekranlar kip bilmez; `yetenek().raporAnlik` açıksa `Raporcu` ile çalışır. Bulutun
// istek → yoklama akışı `Api` (`reportCreate`/`reportGet`…) üzerinde BAYT AYNI kalır; bulut `Raporcu`su ağa gitmez.
import { kipteYok } from "./baglanti";
import type { ApiClient, DownloadedFile } from "./client";
import type { Page, ReportRequest, ReportRequestDetail } from "./wire";

export const ERP_RAPOR_ENDPOINTS = {
  katalog: ["get", "/patron/v1/raporlar/katalog"],
  olustur: ["post", "/patron/v1/raporlar"],
  gecmis: ["get", "/patron/v1/raporlar"],
  kosum: ["get", "/patron/v1/raporlar/:id"],
  sil: ["delete", "/patron/v1/raporlar/:id"],
  dosya: ["get", "/patron/v1/raporlar/:id/dosya"],
} as const;

/** Koşum dosyası biçimi: `xlsx` (Excel) · `html` (telefon PDF'e çevirir). İkisi sunucuda aynı spec'ten. */
export type RaporDosyaBicimi = "xlsx" | "html";

/** Sunucu hesabı 60 sn'de keser (`ZAMAN_ASIMI` olarak saklar); istemci yanıtı biraz daha bekler. */
export const RAPOR_OLUSTUR_TIMEOUT_MS = 75_000;

/** Koşum satırı: bulut `ReportRequest` + ERP ekleri (eski sunucuda yoksa ekran yedekle çizer). */
export interface RaporKosumu extends ReportRequest {
  readonly baslik?: string;
  readonly parametreOzeti?: string;
  readonly sureMs?: number | null;
  readonly olusturan?: { readonly id: string; readonly kullaniciAdi: string };
}

export interface RaporKosumuDetay extends RaporKosumu {
  readonly sonuc: ReportRequestDetail["sonuc"];
  /** İndirilebilir biçimler (ERP eki); zarfsız/HATA'lı koşumda boş, eski sunucuda yok → düğme gizli. */
  readonly dosyaBicimleri?: readonly string[];
}

export interface RaporKatalogSatiri {
  readonly anahtar: string;
  readonly baslik: string;
  readonly soru?: string;
  readonly aile: string;
  /** Parametre ADLARI (bulut `rapor-katalogu` biçimi). */
  readonly parametreler: unknown;
  readonly sonKosum: RaporKosumu | null;
}

export interface RaporKatalogu {
  readonly raporlar: readonly RaporKatalogSatiri[];
}

export interface Raporcu {
  katalog(): Promise<RaporKatalogu>;
  /** Aynı `clientToken` tek koşum (sunucu tekrarı tanır); sonuç yanıtın içinde. */
  olustur(clientToken: string, raporAnahtari: string, parametreler: Record<string, unknown>): Promise<RaporKosumuDetay>;
  gecmis(raporAnahtari: string, p?: { imlec?: string; limit?: number }): Promise<Page<RaporKosumu>>;
  kosum(id: string): Promise<RaporKosumuDetay>;
  sil(id: string): Promise<{ id: string; silindi: true }>;
  /** Koşumun dosyası (saklı sonuçtan); oturum belirteci başlıkta gider, adreste sır yok. */
  dosya(id: string, bicim: RaporDosyaBicimi): Promise<DownloadedFile>;
}

const seg = (v: string) => encodeURIComponent(v);

export function createErpRaporcu(c: ApiClient): Raporcu {
  return {
    katalog: () => c.get<RaporKatalogu>(ERP_RAPOR_ENDPOINTS.katalog[1]),
    olustur: (clientToken, raporAnahtari, parametreler) =>
      c.post<RaporKosumuDetay>(ERP_RAPOR_ENDPOINTS.olustur[1], { clientToken, raporAnahtari, parametreler }, { timeoutMs: RAPOR_OLUSTUR_TIMEOUT_MS }),
    gecmis: (raporAnahtari, p = {}) => c.get<Page<RaporKosumu>>(ERP_RAPOR_ENDPOINTS.gecmis[1], { raporAnahtari, imlec: p.imlec, limit: p.limit }),
    kosum: (id) => c.get<RaporKosumuDetay>(`/patron/v1/raporlar/${seg(id)}`),
    sil: (id) => c.del<{ id: string; silindi: true }>(`/patron/v1/raporlar/${seg(id)}`),
    dosya: (id, bicim) => c.download(`/patron/v1/raporlar/${seg(id)}/dosya`, { bicim }),
  };
}

/** Bulut: bu akış yok (istek → yoklama `Api` üzerinde); her yöntem AĞA GİTMEDEN 404. */
export function createBulutRaporcu(): Raporcu {
  const yok = () => Promise.reject(kipteYok("KIP_DESTEKLEMIYOR"));
  return { katalog: yok, olustur: yok, gecmis: yok, kosum: yok, sil: yok, dosya: yok };
}
