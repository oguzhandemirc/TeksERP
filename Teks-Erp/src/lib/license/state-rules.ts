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
  type EntitlementDoc,
  type LeaseDoc,
  type LicenseMode,
  type ProtocolErrorCode,
} from "./protocol";
import { evaluateClock, type ClockResult, type SanctionSnapshot } from "./saat";

export const REASON_CODES = [
  "HAK_YOK",
  "HAK_GECERSIZ",
  "HAK_KURULUM_UYUSMAZ",
  "KIRA_YOK",
  "KIRA_GECERSIZ",
  "KIRA_BAG_UYUSMAZ",
  "PARMAK_IZI_UYUSMAZ",
  "PARMAK_IZI_OLCULEMEDI",
  "BUTUNLUK_GECERSIZ",
  "BUTUNLUK_OLCULEMEDI",
  "SAAT_ILERI",
  "SAAT_GERI",
  "DURUM_DOSYASI",
  "ILK_ACILIS_BILINMIYOR",
  "KIRA_SURESI_DOLDU",
  "VADE_DOLDU",
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
  PARMAK_IZI_UYUSMAZ: "GECERSIZ",
  BUTUNLUK_GECERSIZ: "GECERSIZ",
  PARMAK_IZI_OLCULEMEDI: "OLCULEMEDI",
  BUTUNLUK_OLCULEMEDI: "OLCULEMEDI",
  SAAT_ILERI: "OLCULEMEDI",
  SAAT_GERI: "OLCULEMEDI",
  DURUM_DOSYASI: "OLCULEMEDI",
  ILK_ACILIS_BILINMIYOR: "OLCULEMEDI",
  KIRA_SURESI_DOLDU: null,
  VADE_DOLDU: null,
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
  | { readonly status: "GECERSIZ"; readonly code: ProtocolErrorCode }
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
  };
  readonly parmakIziEslesme: MatchResult;
  readonly butunluk: IntegrityStatus;
  readonly derlemeTarihiMs: number | null;
  /** DB'den türeyen (dosya silmekle yenilenemeyen) ilk açılış anı; bilinmiyorsa null. */
  readonly ilkAcilisMs: number | null;
  /** Son 24 saatte geçerli yeni kira ALINAMAYAN en az bir gerçek yoklama denemesi oldu mu? */
  readonly sonYoklamaBasarisizMi: boolean;
  readonly varsayilanKip: LicenseMode;
  readonly sonKiraZorlamasi: boolean | null;
  /** Son kullanılabilir kiranın sunucu kararları (`durum.json`); kira kullanılabilirken yok sayılır. */
  readonly sonYaptirim: SanctionSnapshot | null;
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
const MAINTENANCE_WARNING_DAYS = 30;

export function remainingDays(targetMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((targetMs - nowMs) / DAY_MS));
}

const warnBanner = (text: string): Banner => ({ metin: text, ton: "uyari" });
const dangerBanner = (text: string): Banner => ({ metin: text, ton: "tehlike" });
const UNVERIFIED_BANNER = warnBanner("Lisans doğrulanamadı; sistem yöneticinize ya da destek hattına başvurun.");
const UNMEASURED_BANNER = warnBanner("Lisans durumu şu an ölçülemiyor; üretim etkilenmez, bağlantı kurulunca düzelir.");

export function evaluateEntitlement(g: LicenseStateInput, out: Finding[]): VerifiedEntitlement | null {
  const h = g.hak;
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
  });
  if (s.finding) out.push({ code: s.finding, detail: s.findingSource ?? undefined, tier: "UYARI", banner: UNMEASURED_BANNER });
  return s;
}

export function evaluateMeasurements(g: LicenseStateInput, lease: LeaseDoc | null, out: Finding[]): void {
  // Kabul edilmiş küme kirada; kira yoksa karşılaştıracak bir şey de yok.
  if (lease && g.parmakIziEslesme === "ESLESMEDI") out.push({ code: "PARMAK_IZI_UYUSMAZ", tier: "UYARI", banner: UNVERIFIED_BANNER });
  if (lease && g.parmakIziEslesme === "OLCULEMEDI") out.push({ code: "PARMAK_IZI_OLCULEMEDI", tier: "UYARI", banner: UNMEASURED_BANNER });
  if (g.butunluk === "GECERSIZ") out.push({ code: "BUTUNLUK_GECERSIZ", tier: "UYARI", banner: UNVERIFIED_BANNER });
  if (g.butunluk === "OLCULEMEDI") out.push({ code: "BUTUNLUK_OLCULEMEDI", tier: "UYARI", banner: UNMEASURED_BANNER });
}

interface TimeAnchor {
  readonly anchorMs: number;
  readonly graceDays: number;
  readonly code: ReasonCode;
  readonly text: string;
}

/** Ek süre İMZALI tarihten türer: kira → HAK veriliş → (hiç etkinleşmemişse) DB'deki ilk açılış. */
function timeAnchor(g: LicenseStateInput, entitlement: VerifiedEntitlement | null, lease: LeaseDoc | null): TimeAnchor | null {
  if (lease) {
    const end = isoToMs(lease.bitis);
    const due = lease.gecerlilikBitis === null ? Number.POSITIVE_INFINITY : isoToMs(lease.gecerlilikBitis);
    return due < end
      ? { anchorMs: due, graceDays: lease.ekSureGun, code: "VADE_DOLDU", text: "Lisans vadesi doldu" }
      : { anchorMs: end, graceDays: lease.ekSureGun, code: "KIRA_SURESI_DOLDU", text: "Lisans süresi doldu" };
  }
  if (entitlement) {
    return { anchorMs: isoToMs(entitlement.document.verilis), graceDays: DEFAULT_GRACE_DAYS, code: "KIRASIZ_EK_SURE", text: "Lisans kirası bulunamadı" };
  }
  if (g.ilkAcilisMs === null) return null;
  return { anchorMs: g.ilkAcilisMs, graceDays: DEFAULT_GRACE_DAYS, code: "ETKINLESTIRME_EK_SURESI", text: "Lisans etkinleştirilmedi" };
}

/** Zamanın getirdiği KISITLI iki anahtarlıdır: süre geçmiş VE son 24 saatte yoklama gerçekten başarısız. */
export function evaluateGrace(
  g: LicenseStateInput,
  docs: { readonly entitlement: VerifiedEntitlement | null; readonly lease: LeaseDoc | null },
  nowMs: number,
  out: Finding[],
): void {
  const anchor = timeAnchor(g, docs.entitlement, docs.lease);
  if (!anchor) {
    out.push({ code: "ILK_ACILIS_BILINMIYOR", tier: "UYARI", banner: UNMEASURED_BANNER });
    return;
  }
  if (nowMs < anchor.anchorMs) return;
  const end = anchor.anchorMs + anchor.graceDays * DAY_MS;
  if (nowMs < end) {
    const left = remainingDays(end, nowMs);
    const banner = warnBanner(`${anchor.text} — ${left} gün içinde yenilenmezse program kısıtlı kipe geçecek.`);
    out.push({ code: anchor.code, tier: "EK_SURE", banner, daysLeft: left });
    return;
  }
  out.push({ code: anchor.code });
  if (g.sonYoklamaBasarisizMi) {
    out.push({ code: "EK_SURE_BITTI", tier: "KISITLI", banner: dangerBanner(`${anchor.text} ve ek süre bitti: program kısıtlı kipte (okuma, rapor, yedek açık).`) });
  } else {
    out.push({ code: "EK_SURE_BITTI", tier: "EK_SURE", daysLeft: 0, banner: warnBanner(`${anchor.text}; lisans sunucusuyla bağlantı sürdükçe kısıtlama uygulanmaz.`) });
  }
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

/** Bakım sonu: bakım içinde çıkmış sürüm durmaz (yalnız güncelleme kesilir); bakım SONRASI çıkmış sürüm ek süreye düşer. */
export function evaluateMaintenance(g: LicenseStateInput, entitlement: EntitlementDoc, nowMs: number, out: Finding[]): void {
  const maintenanceEnd = isoToMs(entitlement.bakimBitis);
  if (g.derlemeTarihiMs === null) out.push({ code: "DERLEME_TARIHI_YOK" });
  else if (g.derlemeTarihiMs > maintenanceEnd) {
    const end = g.derlemeTarihiMs + DEFAULT_GRACE_DAYS * DAY_MS;
    const text = "Bu sürüm bakım süreniz bittikten sonra çıktı";
    if (nowMs < end) {
      const left = remainingDays(end, nowMs);
      out.push({ code: "BAKIM_IHLALI", tier: "EK_SURE", daysLeft: left, banner: warnBanner(`${text}; ${left} gün içinde bakımı yenileyin ya da hak ettiğiniz sürüme dönün.`) });
    } else if (g.sonYoklamaBasarisizMi) {
      out.push({ code: "BAKIM_IHLALI", tier: "KISITLI", banner: dangerBanner(`${text}: program kısıtlı kipte.`) });
    } else {
      out.push({ code: "BAKIM_IHLALI", tier: "EK_SURE", daysLeft: 0, banner: warnBanner(`${text}; bakımı yenileyin.`) });
    }
  }
  if (nowMs > maintenanceEnd) out.push({ code: "BAKIM_BITTI" });
  else if (maintenanceEnd - nowMs <= MAINTENANCE_WARNING_DAYS * DAY_MS) out.push({ code: "BAKIM_BITIYOR", detail: String(remainingDays(maintenanceEnd, nowMs)) });
}
