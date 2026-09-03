import type { StationKind } from "@/types/enums";

/** GET /api/station-capabilities — özet liste (flat alanlar) */
export interface StationCapabilitySummary {
  stationId: string;
  stationCode: string;
  stationName: string;
  stationKind: StationKind;
  /** İstasyona varsayılan kategori atanmış mı? */
  hasDefaultCategory: boolean;
  /** İstasyon renk uygulayabilir mi? Kategori varsa appliesColor; yoksa true. */
  canApplyColor: boolean;
  /** İstasyon özellik uygulayabilir mi? Kategori varsa appliesProperty; yoksa true. */
  canApplyProperty: boolean;
  /**
   * İstasyon KALİTE KONTROL (Kurşun + KK2) yürütür mü?
   * ⚠️ Backend `deriveCapabilityFlags` ÇÖZER — panel kendi `kind` kontrolünü
   * YAZMAZ (kural tek kaynakta: `helpers/quality-station.helper`).
   */
  canApplyQuality: boolean;
  colorCount: number;
  propertyCount: number;
}

/** GET /api/station-capabilities/:stationId — detay */
export interface StationCapabilityDetail {
  stationId: string;
  stationCode: string;
  stationName: string;
  stationKind: StationKind;
  hasDefaultCategory: boolean;
  canApplyColor: boolean;
  canApplyProperty: boolean;
  canApplyQuality: boolean;
  colors: { id: string; code: string; name: string; hex: string | null }[];
  properties: StationCapabilityProperty[];
}

/** İstasyonun bir özelliği NASIL teyit ettiği — SAP rota "control key" karşılığı. */
export type StationPropertyMode = "AUTO" | "OPTIONAL" | "REQUIRED";

export interface StationCapabilityProperty {
  id: string;
  code: string;
  name: string;
  category: string | null;
  color?: string | null;
  valueType: "FLAG" | "CHOICE";
  mode: StationPropertyMode;
  values: { code: string; name: string; isActive: boolean }[];
}

/**
 * Bu adım/istasyon RENK uygulayabilir mi? — `Teks-Erp/src/services/helpers/
 * step-capability.helper.stepCanApplyColor`'ın AYNASI.
 *
 * ⚠️ 2026-08-10 öncesinde bu, `hasDefaultCategory && canApplyColor` bileşiğiydi
 * ve DÖRT dosyada elle tekrarlanıyordu — çünkü kategorisiz istasyonda
 * `canApplyColor` "bilinmiyor → serbest" anlamında `true` doğuyordu. Yetenek
 * `Station`'ın kendi alanına taşınınca bayrak dürüst oldu; bileşik kalktı.
 * Bileşiği GERİ EKLEME: artık `canApplyColor=true` gerçekten "renk uygular"
 * demek ve kategorisi olmayan bir İÇ boyahaneyi yanlışlıkla eler.
 *
 * Electron backend'i import edemez — bu, kuralın ikinci nüshasıdır; backend
 * yüklemi değişirse burası da değişmeli.
 */
export function capCanApplyColor(
  cap: { canApplyColor?: boolean } | null | undefined,
): boolean {
  return Boolean(cap?.canApplyColor);
}

/**
 * HEDEF-ÖZELLİK seçicilerinde gösterilebilir mi?
 *
 * SEÇİM tipli özellik (KAT) hedef listesine SIZMAMALI: planlamacı "Kat"ı
 * işaretlerdi (hangi kat?) ve backend'in "bu özelliği verebilen adım var mı"
 * guard'ı iş emrini reddederdi. Kat kendi alanında seçilir.
 *
 * ⚠️ TEK KURAL, TEK YER: rota adımı chip'leri (RouteStepTargets ·
 * RouteStepDetail), iş emri hedef özellikleri ve ürün izinli-özellik listesi
 * bunu kullanır. Kopyalanırsa biri güncellenmeyip KAT'ı göstermeye devam eder.
 */
export function isTargetableProperty(p: { valueType?: "FLAG" | "CHOICE" }): boolean {
  return p.valueType !== "CHOICE";
}

/** Mod etiketleri — panel ve tablet AYNI kelimeleri kullanmalı. */
export const STATION_PROPERTY_MODE_LABELS: Record<StationPropertyMode, string> = {
  AUTO: "Otomatik",
  OPTIONAL: "Opsiyonel",
  REQUIRED: "Zorunlu",
};

export const STATION_PROPERTY_MODE_HINTS: Record<StationPropertyMode, string> = {
  AUTO: "Operatöre sorulmaz — adım kapanınca her topa yazılır.",
  OPTIONAL: "Tabletde tuş çıkar; yalnız operatör işaretlerse yazılır.",
  REQUIRED: "Tabletde tuş çıkar; işaretlenmeden adım kapanmaz.",
};
