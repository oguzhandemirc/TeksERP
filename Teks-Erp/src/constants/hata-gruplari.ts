// =============================================================================
// HATA GRUBU KÜMESİ — rapor v2 "hata grubu" boyutunun TEK kaynağı (R1-BOYUT).
// `DefectType.defectGroup` kolonunda DB CHECK YOK: küme burada yaşar, yeni grup migration istemez.
// Panel aynası `Electron/src/lib/hata-gruplari.ts` BAYT-EŞİT (bekçi `test_hata_gruplari`);
// değişiklik ÖNCE burada, sonra `cp -p`. Dosya import'suzdur ki ayna derlenebilsin.
// =============================================================================

/** Grup kodları VERİ değeridir (DB'ye yazılır, rapor anahtarıdır) — asla yeniden adlandırılmaz. */
export const DEFECT_GROUPS = ["COZGU", "ATKI", "BOYA", "LEKE", "MEKANIK", "DIGER"] as const;

export type DefectGroup = (typeof DEFECT_GROUPS)[number];

/** Çözgü grubu — "vardiyaya göre çözgü hatası" şablonu süzgeci (literal tek kaynakta kalsın). */
export const WARP_DEFECT_GROUP: DefectGroup = "COZGU";

export const DEFECT_GROUP_LABELS: Readonly<Record<DefectGroup, string>> = {
  COZGU: "Çözgü",
  ATKI: "Atkı",
  BOYA: "Boya",
  LEKE: "Leke",
  MEKANIK: "Mekanik",
  DIGER: "Diğer",
};

/** `defectGroup = null` kaydın rapor/ekran adı. */
export const UNGROUPED_LABEL = "Gruplanmamış";

/**
 * Duruş sebebi (`MACHINE_STOP_REASONS` kodu) → hata grubu. HER duruş kodu burada beyanlıdır:
 * `null` = bilinçli olarak hata grubu değil (planlı/ayar/dış etken). Yeni duruş kodu eklenince
 * `test_hata_gruplari` kırmızı olur — eşleme kararı o anda verilir.
 */
export const STOP_REASON_DEFECT_GROUP: Readonly<Record<string, DefectGroup | null>> = {
  COZGU_KOPUSU: "COZGU",
  ATKI_KOPUSU: "ATKI",
  // Kenar ipliği çözgü sistemindendir (kenar çözgüsü).
  KENAR_KOPUSU: "COZGU",
  IPLIK_BITTI: null,
  MEKANIK_ARIZA: "MEKANIK",
  JAKAR_ARIZA: "MEKANIK",
  // Elektrik/hava tesis kaynaklıdır; kumaş hatası üretmez.
  ELEKTRIK_ARIZA: null,
  ELEKTRIK_KESINTISI: null,
  HAVA_BASINCI: null,
  OPERATOR_YOK: null,
  KUMAS_TAMIR: "DIGER",
  TESPIT_EDILEMEDI: null,
  LEVENT_BAGLAMA: null,
  TAHAR: null,
  TARAK_DEGISIMI: null,
  DESEN_DEGISIMI: null,
  TOP_ALMA: null,
  PLANLI_BAKIM: null,
  TEMIZLIK: null,
  MOLA: null,
  VARDIYA_DEVRI: null,
  SIPARIS_YOK: null,
  TEZGAH_KAPALI: null,
};

export function isDefectGroup(value: unknown): value is DefectGroup {
  return typeof value === "string" && (DEFECT_GROUPS as readonly string[]).includes(value);
}

/** Eşlenmemiş ya da bilinmeyen duruş kodu → `null` (gruplanmamış); uydurma grup yok. */
export function stopReasonToDefectGroup(reasonCode: string | null | undefined): DefectGroup | null {
  if (!reasonCode) return null;
  return STOP_REASON_DEFECT_GROUP[reasonCode] ?? null;
}

export function defectGroupLabel(group: string | null | undefined): string {
  return isDefectGroup(group) ? DEFECT_GROUP_LABELS[group] : UNGROUPED_LABEL;
}
