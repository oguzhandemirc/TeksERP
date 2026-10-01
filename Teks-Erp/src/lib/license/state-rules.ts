// Lisans durumunun KURALLARI — her biri bulgu listesine satır ekleyen saf bir değerlendirici.
// Birleştirme (geçerlilik, kademe, etki) `state.ts`te. Kural gerekçeleri: docs/design/LISANS-PROTOKOLU.md, "Lisans durumu".
import {
  DAY_MS,
  POLL_DEFAULT_MINUTES,
  isoToMs,
  checkLeaseBinding,
  type VerifiedEntitlement,
  type VerifiedLease,
  type StateTier,
  type MatchResult,
  type Validity,
  type LeaseDoc,
  type LicenseMode,
  type FingerprintRuleApplied,
} from "./protocol";
import type { CoreErrorCode } from "./license-core";
import { evaluateClock, type ClockResult, type EntitlementPin, type RememberedAnchor, type SanctionSnapshot } from "./saat";
import type { TraceInput } from "./state-rules-trace";

export const REASON_CODES = [
  "HAK_YOK",
  "HAK_GECERSIZ",
  "HAK_KURULUM_UYUSMAZ",
  "KIRA_YOK",
  "KIRA_GECERSIZ",
  "KIRA_BAG_UYUSMAZ",
  /** Diskteki kira/HAK durum kaydının bildiği son kabulden ESKİ ya da pini ters: geri alınmış sayılır. */
  "KIRA_GERI_ALINDI",
  /** Lisans deposunda bir dosya var ama okunamadı (izin, G/Ç) — yok sayılmaz, ölçülemedi sayılır. */
  "DEPO_OKUNAMADI",
  "PARMAK_IZI_UYUSMAZ",
  "PARMAK_IZI_OLCULEMEDI",
  "BUTUNLUK_GECERSIZ",
  "BUTUNLUK_OLCULEMEDI",
  "SAAT_ILERI",
  "SAAT_GERI",
  /** Satıcı `ISTEK_ZAMAN` ile duvar saatinin kaydığını söyledi; istek bir kez düzeltilmiş zamanla yeniden imzalanır. */
  "SAAT_KAYIK",
  "DURUM_DOSYASI",
  "ILK_ACILIS_BILINMIYOR",
  "KIRA_SURESI_DOLDU",
  "VADE_DOLDU",
  /** v2: ödenmiş tarih (P) geçti — ek süre P'den sayılır. */
  "ODENMIS_TARIH_DOLDU",
  /** v2 bilgi bandı (K1): P'ye ≤ 30 gün; yalnız internetsizken ya da P sözleşme sonuyken. Kademe değiştirmez. */
  "ODEME_YAKLASIYOR",
  "KIRASIZ_EK_SURE",
  "ETKINLESTIRME_EK_SURESI",
  "EK_SURE_BITTI",
  "YAPTIRIM",
  "MODUL_DONDURULDU",
  "GUNCELLEME_DONDURULDU",
  "DEVREDILDI",
  "BAKIM_BITIYOR",
  "BAKIM_BITTI",
  "BAKIM_IHLALI",
  "DERLEME_TARIHI_YOK",
  /** G12: kira · durum kaydı · DB izinden biri ya da birkaçı kayıp (ayrıntı: hangileri); son kiradan beri kalıcı. */
  "LISANS_IZI_KAYIP",
  /** G12: ayakta kalan iki iz farklı süre çapası taşıyor — erken olan geçerli. */
  "LISANS_IZI_CELISKI",
  /** G12: süren ölçülemedi birikimi (çalışma süresi) — 14 gün UYARI → 30 gün EK_SURE → KISITLI. */
  "BELIRSIZLIK_SURUYOR",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

/** Nedenin geçerliliğe etkisi; `null` = geçerliliği değiştirmez (kademe ya da bilgi). */
export const REASON_VALIDITY: Readonly<Record<ReasonCode, Validity | null>> = {
  HAK_YOK: "GECERSIZ",
  HAK_GECERSIZ: "GECERSIZ",
  HAK_KURULUM_UYUSMAZ: "GECERSIZ",
  KIRA_YOK: "GECERSIZ",
  KIRA_GECERSIZ: "GECERSIZ",
  KIRA_BAG_UYUSMAZ: "GECERSIZ",
  // Geri alınmış kira ne geçerli ne sahte kanıtıdır: sunucu kararları durum kaydından sürer.
  KIRA_GERI_ALINDI: "OLCULEMEDI",
  DEPO_OKUNAMADI: "OLCULEMEDI",
  PARMAK_IZI_UYUSMAZ: "GECERSIZ",
  BUTUNLUK_GECERSIZ: "GECERSIZ",
  PARMAK_IZI_OLCULEMEDI: "OLCULEMEDI",
  BUTUNLUK_OLCULEMEDI: "OLCULEMEDI",
  SAAT_ILERI: "OLCULEMEDI",
  SAAT_GERI: "OLCULEMEDI",
  // Bilgi: imzasız satıcı saati güvenilir saate girmez, kademe saat kaymasından düşmez.
  SAAT_KAYIK: null,
  DURUM_DOSYASI: "OLCULEMEDI",
  ILK_ACILIS_BILINMIYOR: "OLCULEMEDI",
  KIRA_SURESI_DOLDU: null,
  VADE_DOLDU: null,
  ODENMIS_TARIH_DOLDU: null,
  ODEME_YAKLASIYOR: null,
  KIRASIZ_EK_SURE: null,
  ETKINLESTIRME_EK_SURESI: null,
  EK_SURE_BITTI: null,
  YAPTIRIM: null,
  MODUL_DONDURULDU: null,
  GUNCELLEME_DONDURULDU: null,
  DEVREDILDI: null,
  BAKIM_BITIYOR: null,
  BAKIM_BITTI: null,
  BAKIM_IHLALI: null,
  DERLEME_TARIHI_YOK: null,
  // İz kaybı ve çelişki program kalan süreyi bilemediği hâllerdir: ölçülemedi, merdivene girer.
  LISANS_IZI_KAYIP: "OLCULEMEDI",
  LISANS_IZI_CELISKI: "OLCULEMEDI",
  // Merdivenin kendisi kademe taşır; geçerliliği onu doğuran bulgular belirler.
  BELIRSIZLIK_SURUYOR: null,
};

export interface Banner {
  readonly metin: string;
  readonly ton: "bilgi" | "uyari" | "tehlike";
}

export interface Finding {
  readonly code: ReasonCode;
  readonly detail?: string;
  readonly tier?: StateTier;
  readonly banner?: Banner;
  /** EK_SURE ya da K3 geri sayımında kalan tam gün. */
  readonly daysLeft?: number;
}

export type DocResult<T> =
  | { readonly status: "YOK" }
  /** Dosya var ama okunamadı: YOK değildir (silmekle eşit sayılmaz), ölçülemedi bulgusu `depoOkunamadi`dan gelir. */
  | { readonly status: "OKUNAMADI" }
  | { readonly status: "GECERSIZ"; readonly code: CoreErrorCode }
  | { readonly status: "GECERLI"; readonly value: T };

export type IntegrityStatus = "GECERLI" | "GECERSIZ" | "OLCULEMEDI" | "KAPSAM_DISI";

export interface LicenseStateInput {
  readonly kurulumId: string | null;
  /** Yerel kurulum anahtarının kimliği (`kur-…`); anahtar yoksa null. */
  readonly kurulumAnahtarKimligi: string | null;
  readonly hak: DocResult<VerifiedEntitlement>;
  readonly kira: DocResult<VerifiedLease>;
  readonly saat: {
    readonly duvarMs: number;
    readonly yuksekSuMs: number;
    /** İmzalı durum kaydındaki birikim ve ait olduğu kira; yoksa null. */
    readonly monotonik: { readonly kiraId: string; readonly gecenMs: number } | null;
    readonly durumDosyasiGecerli: boolean;
    /** Duvar saatiyle gözlenmiş kapalı kalma süresi (üst eşik kredisi; `evaluateClock`). */
    readonly kapaliKrediMs?: number;
  };
  readonly parmakIziEslesme: MatchResult;
  readonly butunluk: IntegrityStatus;
  /** Uyuşmazlığın İLK görüldüğü an (imzalı durum kaydı ya da bu süreç); ek süre buradan sayılır. */
  readonly butunlukIlkUyusmazlikMs?: number | null;
  readonly derlemeTarihiMs: number | null;
  /** DB'den türeyen (dosya silmekle yenilenemeyen) ilk açılış anı; bilinmiyorsa null. */
  readonly ilkAcilisMs: number | null;
  readonly varsayilanKip: LicenseMode;
  readonly sonKiraZorlamasi: boolean | null;
  /** Son kullanılabilir kiranın sunucu kararları (`durum.json`); kira kullanılabilirken yok sayılır. */
  readonly sonYaptirim: SanctionSnapshot | null;
  /**
   * Durum kaydının bildiği son kabul edilen kira: geri alma tespiti ve — kira silinmiş/okunamıyorsa —
   * son başarılı alışverişin zamanı (iki anahtarın ikincisi); yoksa ikisi de kiradan.
   */
  readonly sonKira?: { readonly kiraId: string; readonly verilisMs: number } | null;
  /** Durum kaydının bildiği son HAK pini (sürüm · sınıf · kök türü). */
  readonly sonHak?: EntitlementPin | null;
  /** Satıcının `ISTEK_ZAMAN` ile ölçtürdüğü sapma (duvar − satıcı, ms); null = ölçülmedi. BİLGİdir. */
  readonly saticiSapmaMs?: number | null;
  /** Var olan ama okunamayan depo dosyaları (ad listesi); boşsa sorun yok. */
  readonly depoOkunamadi?: readonly string[];
  // ── Lisans v2 G12 (L2-6). Hepsi isteğe bağlı: verilmezse bugünkü davranış. ──
  /** Lisans izlerinin hâli (kira · durum kaydı · DB izi); yoksa iz kuralı işlemez. */
  readonly izler?: TraceInput;
  /** Süren ölçülemedi birikimi (çalışma süresi, ms): durum kaydı ile DB izinin BÜYÜĞÜ + bu süreçteki. */
  readonly belirsizlikMs?: number;
  /** Parmak izi uyuşmazlık merdiveninin birikimi (çalışma süresi, ms). */
  readonly parmakIziUyusmazMs?: number;
  /** Kararın uygulandığı parmak izi kuralı (kiradaki alan; yoksa `v1`); ölçülmediyse verilmez. */
  readonly parmakIziKurali?: FingerprintRuleApplied;
  /** Ayakta kalan izlerin (durum kaydı dosyası · DB izi) hatırladığı süre çapaları. */
  readonly sonCapalar?: readonly RememberedAnchor[];
  /** HAK doğrulanamazsa uygulanacak son bilinen modül tavanı (durum kaydı pini → DB izi); bilinmiyorsa null. */
  readonly sonBilinenTavan?: readonly string[] | null;
  /** Kurulum anahtarı okunamıyor: imza (yoklama, kayıt yazımı) durdu — İnternet YOK sayılır (Z9). */
  readonly imzaYok?: boolean;
  /** Üç iz birden yok bulunduğu an (K7, kayıttan): süre çapası budur, HAK verilişi / ilk açılış çapası uygulanmaz. */
  readonly ekSureCapasiMs?: number | null;
}

/** Kiradan sunucu kararlarının anlık görüntüsü — `durum.json` bunu saklar, durum onu okur. */
export function sanctionSnapshotOf(lease: LeaseDoc): SanctionSnapshot {
  const y = lease.yaptirim;
  return {
    kademe: y.kademe,
    mesaj: y.mesaj,
    kisitlamaTarihi: y.kisitlamaTarihi,
    donmusModuller: [...y.donmusModuller],
    guncellemeDonuk: y.guncellemeDonuk,
    devredildi: lease.devredildi,
  };
}

export const DEFAULT_GRACE_DAYS = 30;

export function remainingDays(targetMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((targetMs - nowMs) / DAY_MS));
}

export const warnBanner = (text: string): Banner => ({ metin: text, ton: "uyari" });
export const dangerBanner = (text: string): Banner => ({ metin: text, ton: "tehlike" });
export const UNVERIFIED_BANNER = warnBanner("Lisans doğrulanamadı; sistem yöneticinize ya da destek hattına başvurun.");
export const UNMEASURED_BANNER = warnBanner("Lisans durumu şu an ölçülemiyor; üretim etkilenmez, bağlantı kurulunca düzelir.");

export function evaluateEntitlement(g: LicenseStateInput, out: Finding[]): VerifiedEntitlement | null {
  const h = g.hak;
  if (h.status === "OKUNAMADI") return null;
  if (h.status === "YOK") {
    out.push({ code: "HAK_YOK" });
    return null;
  }
  if (h.status === "GECERSIZ") {
    out.push({ code: "HAK_GECERSIZ", detail: h.code, tier: "UYARI", banner: UNVERIFIED_BANNER });
    return null;
  }
  if (h.value.document.kurulumId !== g.kurulumId) {
    out.push({ code: "HAK_KURULUM_UYUSMAZ", tier: "UYARI", banner: UNVERIFIED_BANNER });
    return null;
  }
  return h.value;
}

/** Kira HAK bozuk olsa da kuruluma bağlıysa kullanılır (imzalı zaman çapası ve sunucu kararı taşır). */
export function evaluateLease(g: LicenseStateInput, entitlement: VerifiedEntitlement | null, out: Finding[]): VerifiedLease | null {
  const k = g.kira;
  if (k.status === "OKUNAMADI") return null;
  if (k.status === "YOK") {
    if (g.hak.status !== "YOK") out.push({ code: "KIRA_YOK" });
    return null;
  }
  if (k.status === "GECERSIZ") {
    out.push({ code: "KIRA_GECERSIZ", detail: k.code, tier: "UYARI", banner: UNVERIFIED_BANNER });
    return null;
  }
  const lease = k.value;
  if (lease.document.kurulumId !== g.kurulumId || lease.document.kurulumAnahtarKimligi !== g.kurulumAnahtarKimligi) {
    out.push({ code: "KIRA_BAG_UYUSMAZ", detail: "KURULUM", tier: "UYARI", banner: UNVERIFIED_BANNER });
    return null;
  }
  const binding = entitlement ? checkLeaseBinding(lease, entitlement) : null;
  if (binding && !binding.ok) {
    out.push({ code: "KIRA_BAG_UYUSMAZ", detail: binding.code, tier: "UYARI", banner: UNVERIFIED_BANNER });
    return null;
  }
  return lease;
}

export function computeClock(g: LicenseStateInput, lease: LeaseDoc | null, out: Finding[]): ClockResult {
  const m = g.saat.monotonik;
  const elapsed = lease && g.saat.durumDosyasiGecerli && m && m.kiraId === lease.kiraId ? m.gecenMs : null;
  if (lease && elapsed === null) out.push({ code: "DURUM_DOSYASI", tier: "UYARI", banner: UNMEASURED_BANNER });
  const s = evaluateClock({
    wallMs: g.saat.duvarMs,
    highWaterMs: g.saat.yuksekSuMs,
    leaseServerTimeMs: lease ? isoToMs(lease.sunucuSaati) : null,
    monotonicElapsedMs: elapsed,
    pollIntervalMs: (lease?.yoklamaAraligiDk ?? POLL_DEFAULT_MINUTES) * 60_000,
    downtimeCreditMs: g.saat.kapaliKrediMs ?? 0,
  });
  if (s.finding) out.push({ code: s.finding, detail: s.findingSource ?? undefined, tier: "UYARI", banner: UNMEASURED_BANNER });
  return s;
}

/** Zamanın getirdiği KISITLI'nın ikinci anahtarı (`state-rules-time.ts` `evaluateExchange` doldurur). */
export interface SecondKey {
  /** Son 24 saatte başarılı kira alışverişi VAR — varken süre dolsa da kademe EK_SURE (0 gün) kalır. */
  readonly internetVar: boolean;
}

/**
 * Sunucunun imzalı kararı tek anahtarlıdır: K3 tarihi, K4, K5 ve DEVREDİLDİ ikinci anahtar
 * beklemez. Kaynak kullanılabilir kira ya da (kira silinmiş/bozuksa) son kiranın anlık görüntüsü.
 */
export function evaluateSanction(y: SanctionSnapshot, nowMs: number, out: Finding[]): number | null {
  if (y.donmusModuller.length > 0) out.push({ code: "MODUL_DONDURULDU", detail: y.donmusModuller.join(",") });
  if (y.guncellemeDonuk || y.kademe === "K1") out.push({ code: "GUNCELLEME_DONDURULDU" });
  if (y.devredildi) {
    out.push({ code: "DEVREDILDI", tier: "KISITLI", banner: dangerBanner("Üretim DR sunucusunda sürüyor; bu sunucu kısıtlı kipte (veri erişimi açık).") });
  }
  const message = y.mesaj ?? "";
  switch (y.kademe) {
    case "K0":
      out.push({ code: "YAPTIRIM", detail: "K0", banner: { metin: message || "Lisans sağlayıcınızdan bir bildirim var.", ton: "bilgi" } });
      return null;
    case "K3": {
      const date = y.kisitlamaTarihi === null ? nowMs : isoToMs(y.kisitlamaTarihi);
      if (nowMs >= date) {
        out.push({ code: "YAPTIRIM", detail: "K3", tier: "KISITLI", banner: dangerBanner(message || "Lisans kısıtlandı: program kısıtlı kipte.") });
        return null;
      }
      const left = remainingDays(date, nowMs);
      out.push({ code: "YAPTIRIM", detail: "K3", tier: "UYARI", daysLeft: left, banner: warnBanner(`${message ? `${message} — ` : ""}${left} gün sonra kısıtlı kip.`) });
      return left;
    }
    case "K4":
      out.push({ code: "YAPTIRIM", detail: "K4", tier: "KISITLI", banner: dangerBanner(message || "Lisans kısıtlandı: program kısıtlı kipte.") });
      return null;
    case "K5":
      out.push({ code: "YAPTIRIM", detail: "K5", tier: "DURDURULMUS", banner: dangerBanner(message || "Lisans durduruldu: yalnız lisans ekranı ve verilerimi al açık.") });
      return null;
    default:
      return null;
  }
}
