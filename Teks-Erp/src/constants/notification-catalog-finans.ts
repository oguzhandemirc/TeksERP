// =============================================================================
// BİLDİRİM KATALOĞU — Finans · Cari kart · Ana veri · Maliyet parça dosyası (S4, 2026-11-14)
// =============================================================================
// `NOTIFICATION_CATALOG`a yayılır (tek katalog; ayrı dosya yalnız boyut içindir). Kaynaklar (tek yayma noktaları):
// finans → `notification-sources/finans.ts` (+ `finans-kosul.ts`, `finans-ozet.ts`), kart/ürün → `anaveri.ts`,
// maliyet → `maliyet.ts` / `maliyet-kursun.ts`. Yük TUTAR taşımaz (ne belge tutarı ne fiyat): gelen kutusu finans
// ekranı değil — rakam için bildirim ilgili ekrana götürür. OLAY birleştirme anahtarı = tür + kayıt, pencere 10 dk (K3).
// =============================================================================
import { z } from "zod";
import {
  NOTIFICATION_DEFAULT_CHANNELS as KANAL_VARSAYILAN,
  NOTIFICATION_DEFAULT_RETENTION as SAKLAMA,
  NOTIFICATION_DESKTOP_CHANNELS as KANAL_MASAUSTU,
  type NotificationCatalogEntry,
} from "./notification-catalog.types";

const ORTAK = {
  sinif: "BILDIRIM", altTur: "OLAY", varsayilan: "HERKES", kilit: "YOK", pencereSn: 600,
  kanallar: KANAL_MASAUSTU, varsayilanKanallar: KANAL_VARSAYILAN, saklama: SAKLAMA,
} as const;

const FINANS = { ...ORTAK, grup: "Finans", izinler: [["finance:read"]], modul: "financeEnabled" } as const;
const ODEME = {
  ...FINANS, tekilKalibi: "{odemeId}", panelEkran: "finance/payments", panelYol: "/finance/payments",
  payloadAlanlari: ["odemeId", "belgeNo", "cariAd", "yontem", "kullanici"],
} as const;
const VADE = {
  ...FINANS, altTur: "KOSUL", pencereSn: 0, izinler: [["report:finance"]], tekilKalibi: "{cariId}:{paraBirimi}:{yon}",
  panelEkran: "reports/finance", panelYol: "/reports/finance/alacaklar",
  payloadAlanlari: ["cariId", "cariAd", "yon", "paraBirimi", "belgeSayisi", "gun"],
} as const;
const FATURA = { ...FINANS, tekilKalibi: "{faturaId}", panelEkran: "finance/invoices", panelYol: "/finance/invoices" } as const;
const CARI_KART = {
  ...ORTAK, grup: "Ana Veri", izinler: [["customer:read"]], modul: "cekirdek:ana-veri",
  tekilKalibi: "{cariId}", panelEkran: "definitions/cariler", panelYol: "/definitions/cariler?kayit=C:{cariId}",
} as const;
const URUN = {
  ...ORTAK, grup: "Ana Veri", izinler: [["item:read"]], modul: "cekirdek:ana-veri",
  tekilKalibi: "{urunId}", panelEkran: "definitions/items", panelYol: "/definitions/items",
} as const;
const MALIYET = { ...ORTAK, grup: "Finans", modul: "maliyetEnabled" } as const;

export const FINANS_NOTIFICATION_ENTRIES = {
  // ── Finans / Muhasebe ─────────────────────────────────────────────────────
  "finans.tahsilat": {
    ...ODEME, kod: "finans.tahsilat", ad: "Tahsilat yapıldı", onemli: true,
    baslik: "Tahsilat: {cariAd}",
    govde: "{belgeNo} · {cariAd} ödeme yaptı ({yontem}) · {kullanici}",
    tahminiHaftalik: 20,
  },
  "finans.odeme": {
    ...ODEME, kod: "finans.odeme", ad: "Ödeme yapıldı", onemli: true,
    baslik: "Ödeme: {cariAd}",
    govde: "{belgeNo} · {cariAd} firmasına ödeme yapıldı ({yontem}) · {kullanici}",
    tahminiHaftalik: 15,
  },
  "finans.fatura-kesildi": {
    ...FATURA, kod: "finans.fatura-kesildi", ad: "Fatura onaylandı",
    baslik: "{faturaTuru} faturası onaylandı: {faturaNo}",
    govde: "{faturaNo} · {cariAd} cari hesabına işlendi · {kullanici}",
    payloadAlanlari: ["faturaId", "faturaNo", "faturaTuru", "cariAd", "kullanici"],
    tahminiHaftalik: 25,
  },
  "finans.fatura-iptal": {
    ...FATURA, kod: "finans.fatura-iptal", ad: "Onaylı fatura iptal edildi", onemli: true,
    baslik: "Fatura iptal edildi: {faturaNo}",
    govde: "{kullanici} {faturaTuru} faturasını ({cariAd}) iptal etti, cari hesaptan ters kayıtla geri alındı: {sebep}",
    payloadAlanlari: ["faturaId", "faturaNo", "faturaTuru", "cariAd", "sebep", "kullanici"],
    tahminiHaftalik: 1,
  },
  "finans.cek-senet-vade": {
    ...FINANS, altTur: "KOSUL", pencereSn: 0, kod: "finans.cek-senet-vade", ad: "Çek/senet vadesi geldi", onemli: true,
    tekilKalibi: "{cekId}", panelEkran: "finance/cheques", panelYol: "/finance/cheques",
    baslik: "{belgeTuru} vadesi: {belgeNo}",
    govde: "{yon} {belgeTuru} {belgeNo} · {cariAd} · vade {vade}",
    cozuldu: "{belgeNo} artık vadesi bekleyen belge değil",
    paramSemasi: z.object({ gun: z.number().int().min(0).max(30).default(3) }).strict(),
    payloadAlanlari: ["cekId", "belgeNo", "belgeTuru", "yon", "cariAd", "vade"],
    tahminiHaftalik: 5,
  },
  // Vade (S5b): karar `helpers/invoice-due.helper.ts` + yaşlandırma çekirdeği (`collectAgingRows`, sanal FIFO sonrası).
  // Konu cari × para birimi × yön; yük belge sayısı + gün, TUTAR YOK. Yük açılışta donar (gün o anın ölçüsü).
  "finans.vade-yaklasti": {
    ...VADE, kod: "finans.vade-yaklasti", ad: "Vadesi yaklaşan belge",
    baslik: "Vade yaklaşıyor: {cariAd}",
    govde: "{cariAd} · {belgeSayisi} {yon} belgesinin vadesi en geç {gun} gün içinde ({paraBirimi})",
    cozuldu: "{cariAd}: vadesi yaklaşan {yon} belgesi kalmadı",
    paramSemasi: z.object({ gun: z.number().int().min(0).max(30).default(3) }).strict(),
    tahminiHaftalik: 10,
  },
  "finans.vade-gecti": {
    ...VADE, kod: "finans.vade-gecti", ad: "Vadesi geçen belge", onemli: true,
    baslik: "Vadesi geçti: {cariAd}",
    govde: "{cariAd} · {belgeSayisi} {yon} belgesinin vadesi geçti, en eskisi {gun} gün ({paraBirimi})",
    cozuldu: "{cariAd}: vadesi geçmiş {yon} belgesi kalmadı",
    // tolerans: vade geçtikten kaç gün sonra bildirilsin (0 = hemen) — "hemen" ve "birkaç gün bekle" ikisi de ayarla seçilir.
    paramSemasi: z.object({ tolerans: z.number().int().min(0).max(90).default(0) }).strict(),
    tahminiHaftalik: 10,
  },
  "finans.gunluk-ozet": {
    ...FINANS, tekilKalibi: "{gun}", pencereSn: 0, ozet: "GUN_SONU",
    kod: "finans.gunluk-ozet", ad: "Günlük finans özeti", panelEkran: "finance/payments", panelYol: "/finance/payments",
    baslik: "Günlük finans özeti · {gun}",
    govde: "{tahsilat} tahsilat · {odeme} ödeme · {fatura} fatura onaylandı · {iptal} iptal",
    payloadAlanlari: ["gun", "tahsilat", "odeme", "fatura", "iptal"],
    tahminiHaftalik: 7,
  },

  // ── Cari kart ─────────────────────────────────────────────────────────────
  "cari.olusturuldu": {
    ...CARI_KART, kod: "cari.olusturuldu", ad: "Yeni cari kart açıldı",
    baslik: "Yeni cari: {cariAd}",
    govde: "{kullanici} {cariAd} ({cariKodu}) kartını açtı",
    payloadAlanlari: ["cariId", "cariAd", "cariKodu", "kullanici"],
    tahminiHaftalik: 3,
  },
  // S5b: değişen alanların yalnız ADLARI (değer yok — iletişim/vergi bilgisi ve iç kolon metne girmez; liste opt-in).
  "cari.degisti": {
    ...CARI_KART, kod: "cari.degisti", ad: "Cari kart değişti",
    baslik: "Cari kart değişti: {cariAd}",
    govde: "{kullanici} {cariAd} ({cariKodu}) kartını düzenledi: {alanlar}",
    payloadAlanlari: ["cariId", "cariAd", "cariKodu", "alanlar", "kullanici"],
    tahminiHaftalik: 5,
  },
  "cari.pasife-alindi": {
    ...CARI_KART, kod: "cari.pasife-alindi", ad: "Cari kart pasife alındı",
    baslik: "Cari pasife alındı: {cariAd}",
    govde: "{kullanici} {cariAd} ({cariKodu}) kartını pasife aldı",
    payloadAlanlari: ["cariId", "cariAd", "cariKodu", "kullanici"],
    tahminiHaftalik: 0.5,
  },

  // ── Ana veri ──────────────────────────────────────────────────────────────
  "anaveri.urun-olusturuldu": {
    ...URUN, kod: "anaveri.urun-olusturuldu", ad: "Yeni ürün kartı açıldı",
    baslik: "Yeni ürün: {urunAd}",
    govde: "{kullanici} {urunAd} ({urunKodu}) kartını açtı",
    payloadAlanlari: ["urunId", "urunAd", "urunKodu", "kullanici"],
    tahminiHaftalik: 5,
  },
  "anaveri.urun-pasif": {
    ...URUN, kod: "anaveri.urun-pasif", ad: "Ürün kartı pasife alındı",
    baslik: "Ürün pasife alındı: {urunAd}",
    govde: "{kullanici} {urunAd} ({urunKodu}) kartını pasife aldı: {sebep}",
    payloadAlanlari: ["urunId", "urunAd", "urunKodu", "sebep", "kullanici"],
    tahminiHaftalik: 1,
  },

  // ── Maliyet / Fiyat ───────────────────────────────────────────────────────
  "maliyet.standart-degisti": {
    ...MALIYET, izinler: [["cost:read"]], tekilKalibi: "{urunId}", panelEkran: "cost/items", panelYol: "/cost/items",
    kod: "maliyet.standart-degisti", ad: "Standart maliyet yeni sürüm",
    baslik: "Maliyet sürümü: {urunAd}",
    govde: "{kullanici} {urunAd} için {surumNo}. maliyet sürümünü kaydetti: {gerekce}",
    payloadAlanlari: ["urunId", "urunAd", "surumNo", "gerekce", "kullanici"],
    tahminiHaftalik: 5,
  },
  "maliyet.fiyat-listesi-yayinlandi": {
    ...MALIYET, izinler: [["price-list:read"]], tekilKalibi: "{listeId}", panelEkran: "cost/price-lists", panelYol: "/cost/price-lists",
    kod: "maliyet.fiyat-listesi-yayinlandi", ad: "Fiyat listesi yayınlandı", onemli: true,
    baslik: "Fiyat listesi yayınlandı: {listeNo}",
    govde: "{kullanici} {listeAd} ({musteriAd}) listesini yayınladı; önceki liste arşive alındı",
    payloadAlanlari: ["listeId", "listeNo", "listeAd", "musteriAd", "kullanici"],
    tahminiHaftalik: 1,
  },
  "maliyet.kursun-fiyat-degisti": {
    ...ORTAK, grup: "Finans", izinler: [["station:read"]], modul: "cekirdek:ana-veri",
    tekilKalibi: "{sahipId}", panelEkran: "definitions/stations", panelYol: "/definitions/stations",
    kod: "maliyet.kursun-fiyat-degisti", ad: "Kurşun gram fiyatı değişti", onemli: true,
    baslik: "Kurşun gram fiyatı değişti: {sahipAd}",
    govde: "{kullanici}, {sahipAd} {sahipTuru} için kurşun gram fiyatını {islem}",
    payloadAlanlari: ["sahipId", "sahipTuru", "sahipAd", "islem", "kullanici"],
    tahminiHaftalik: 1,
  },
} as const satisfies Record<string, NotificationCatalogEntry>;
