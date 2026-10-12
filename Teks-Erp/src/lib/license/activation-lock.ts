// ETKİNLEŞTİRME KİLİDİ (G2) — hiç etkinleşmemiş kurulum yalnız etkinleştirme ekranını açar. Kilit lisans DURUMUNUN
// dışında bir katmandır: `computeLicenseState` ve merdiven ona bakmaz, etkin kurulumun davranışı bayt-eşit kalır.
// Yalnız korumalı derlemede (esbuild `define`) işler; ortamdan, dosyadan ya da DB'den açılıp kapatılamaz.

/** Paketleme `build-korumali.mjs` `true` yapar; geliştirme ve bekçi sunucusunda tanımsızdır → kilit yok. */
declare const __TEKSERP_ETKINLESTIRME_KILIDI__: boolean | undefined;
export const BUILD_ACTIVATION_LOCK: boolean =
  typeof __TEKSERP_ETKINLESTIRME_KILIDI__ !== "undefined" && __TEKSERP_ETKINLESTIRME_KILIDI__ === true;

let testOverride: boolean | null = null;

/** Test-only: kilidi süreç içinde aç/kapat (`null` = derleme sabiti). */
export function configureActivationLockForTests(on: boolean | null): void {
  testOverride = on;
}

export function activationLockEnabled(): boolean {
  return testOverride ?? BUILD_ACTIVATION_LOCK;
}

/** YOK: kilit yok · ETKINLESMEDI: hiç lisans izi yok · KOPYA: iz başka kurulumun (veri dışarı alınabilir). */
export const ACTIVATION_LOCK_CLASSES = ["YOK", "ETKINLESMEDI", "KOPYA"] as const;
export type ActivationLockClass = (typeof ACTIVATION_LOCK_CLASSES)[number];

/** Kilidin nedeni — tanı ve test içindir; kapı yalnız sınıfa bakar. */
export type ActivationLockReason =
  | "KAPALI"
  | "HAZIR_DEGIL"
  | "ETKIN"
  | "MUAFIYET"
  | "IZ_BILINMIYOR"
  | "IZ_YOK"
  | "IZ_KAYIP"
  | "IZ_OLCULEMEDI"
  | "IZ_YABANCI";

/**
 * DB izinin bu kurulum açısından hâli: okunmadı · yok · bu kurulumun değil — aynı PG kümesi (KAYIP) · küme kimliği
 * okunamadı (BELIRSIZ) · farklı küme ya da satıcı kanıtsız iz (YABANCI).
 */
export type ForeignTrace = "BILINMIYOR" | "YOK" | "KAYIP" | "BELIRSIZ" | "YABANCI";

export interface ActivationLockInput {
  readonly enabled: boolean;
  /** Lisans durumu hesaplanabiliyor (`durumHazir`); değilse belirsizlik fabrikayı durdurmaz. */
  readonly ready: boolean;
  readonly activated: boolean;
  /** Geçerli (bu anahtara ve makineye bağlı, satıcı imzalı) muafiyet belgesi var. */
  readonly exempt: boolean;
  readonly trace: ForeignTrace;
}

export interface ActivationLockDecision {
  readonly sinif: ActivationLockClass;
  readonly neden: ActivationLockReason;
}

/**
 * Sıra önemlidir: etkin kurulum ve muafiyet her zaman kilitsizdir; ölçülemeyen durum kilit üretmez; yalnız "hiç iz
 * yok" ve KESİN "iz başka kurulumun" kilitlenir. KAYIP (aynı PG kümesi) ve BELIRSIZ (küme kimliği okunamadı) bugünkü
 * merdivenden gider: etkinleşmiş gerçek müşteriyi yanlışlıkla kilitlemek, bir kopyanın merdivene düşmesinden kötüdür.
 */
export function classifyActivationLock(i: ActivationLockInput): ActivationLockDecision {
  if (!i.enabled) return { sinif: "YOK", neden: "KAPALI" };
  if (i.activated) return { sinif: "YOK", neden: "ETKIN" };
  if (i.exempt) return { sinif: "YOK", neden: "MUAFIYET" };
  if (!i.ready) return { sinif: "YOK", neden: "HAZIR_DEGIL" };
  if (i.trace === "BILINMIYOR") return { sinif: "YOK", neden: "IZ_BILINMIYOR" };
  if (i.trace === "KAYIP") return { sinif: "YOK", neden: "IZ_KAYIP" };
  if (i.trace === "BELIRSIZ") return { sinif: "YOK", neden: "IZ_OLCULEMEDI" };
  if (i.trace === "YABANCI") return { sinif: "KOPYA", neden: "IZ_YABANCI" };
  return { sinif: "ETKINLESMEDI", neden: "IZ_YOK" };
}
