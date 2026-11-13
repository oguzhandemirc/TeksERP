// Rapor koşumunu dosya olarak paylaşma (ERP `GET /patron/v1/raporlar/:id/dosya`): Excel sunucudan .xlsx gelir; PDF için
// sunucu aynı spec'ten HTML verir, telefon PDF'e çevirir. Dosyalar önbellekteki `rapor-dosya/` dizininde doğar; paylaşımdan
// hemen sonra SİLİNMEZ (alıcı uygulama dosyayı geç okuyabilir) — her yeni dışa aktarmanın başında ve uygulama açılışında
// süpürülür. Platform modülleri port olarak gelir (`rapor-dosya-yerel.ts`) — akış saf kalır, testte sahtesi verilir.
import { ApiError, errorMessage } from "../api/client";
import type { Raporcu, RaporDosyaBicimi } from "../api/rapor";

export type RaporDosyaTuru = "pdf" | "excel";

export interface DosyaPortlari {
  /** Önbellek dizinindeki önceki dışa aktarma dosyalarını siler (başarısızlık akışı durdurmaz). */
  supur(): void;
  /** Baytı önbellek dizinine `ad` ile yazar; dosya adresi döner. */
  yaz(ad: string, veri: Uint8Array): string;
  /** Dosyayı UTF-8 metin okur (sunucunun HTML'i). */
  metinOku(uri: string): Promise<string>;
  /** HTML'den PDF üretir (çevrimdışı; dış kaynak yok), dosyayı `ad` ile önbellek dizinine koyar. */
  pdfYap(html: string, ad: string): Promise<string>;
  sil(uri: string): void;
  paylasimVar(): Promise<boolean>;
  paylas(uri: string, o: { mimeType: string; uti: string; baslik: string }): Promise<void>;
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const BICIM: Readonly<Record<RaporDosyaTuru, RaporDosyaBicimi>> = { pdf: "html", excel: "xlsx" };

/** Sunucunun verdiği adı dosya sistemine güvenli hâle getirir; uzantıyı istenen türe çevirir. */
export function dosyaAdi(sunucuAdi: string, tur: RaporDosyaTuru): string {
  const govde = sunucuAdi.replace(/\.[a-z0-9]+$/i, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "rapor";
  return `${govde}.${tur === "pdf" ? "pdf" : "xlsx"}`;
}

/** Kullanıcıya gösterilecek ileti (Türkçe, kısa). */
export function dosyaHataIletisi(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "DISA_AKTARILAMAZ") return "Bu rapor dosya olarak indirilemiyor.";
    if (err.kind === "BULUNAMADI") return "Rapor bulunamadı; silinmiş olabilir.";
    if (err.kind === "AG") return "Dosya indirilemedi; bağlantınızı kontrol edip tekrar deneyin.";
    return errorMessage(err);
  }
  if (err instanceof PaylasimYok) return err.message;
  return "Dosya hazırlanamadı; tekrar deneyin.";
}

class PaylasimYok extends Error {}

/** Önceki dışa aktarma dosyalarını siler; en iyi çaba (hata yutulur, bir sonraki turda yeniden denenir). */
export function oncekileriSupur(p: Pick<DosyaPortlari, "supur">): void {
  try {
    p.supur();
  } catch {
    // Süpürme en iyi çabadır.
  }
}

/** Önceki artıkları süpür → indir → (PDF ise çevir) → paylaşım sayfası. Paylaşılan dosya bir sonraki tura kadar durur. */
export async function raporDosyasiPaylas(raporcu: Raporcu, kosumId: string, tur: RaporDosyaTuru, p: DosyaPortlari, baslik: string): Promise<void> {
  if (!(await p.paylasimVar())) throw new PaylasimYok("Bu cihazda paylaşım kullanılamıyor.");
  oncekileriSupur(p);
  const file = await raporcu.dosya(kosumId, BICIM[tur]);
  const ad = dosyaAdi(file.fileName, tur);
  let uri: string;
  if (tur === "excel") {
    uri = p.yaz(ad, new Uint8Array(file.data));
  } else {
    const htmlUri = p.yaz(ad.replace(/\.pdf$/, ".html"), new Uint8Array(file.data));
    try {
      uri = await p.pdfYap(await p.metinOku(htmlUri), ad);
    } finally {
      // Ara HTML paylaşılmaz; hemen silinebilir (silinemezse bir sonraki turda süpürülür).
      try {
        p.sil(htmlUri);
      } catch {
        // en iyi çaba
      }
    }
  }
  await p.paylas(uri, tur === "excel" ? { mimeType: XLSX_MIME, uti: "org.openxmlformats.spreadsheetml.sheet", baslik } : { mimeType: "application/pdf", uti: "com.adobe.pdf", baslik });
}
