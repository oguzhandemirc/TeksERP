// =============================================================================
// KK1 MUAYENE KONAĞI — bağdaştırıcı (K4P-TABLET, plan §4.1 konak a; saf, React'sız)
// =============================================================================
// Konak üç şey söyler: ne zaman gösterilir (TEK yüklem), taslak hangi yazma yoluna girer
// (`initial-entry` gövdesinin `inspection` alanı — top ile aynı tx), kayıt sonrası ne olur.
// `canInspect` SUNUCUDAN gelir (`stationCanInspect`); istemci istasyon türü okumaz.
// =============================================================================
import type { BirthInspectionRequest } from '../../../services/roll.service';
import { isDraftEmpty, type InspectionDraft } from '../../../components/inspection/inspectionDraft';
import { draftToWireDefects } from '../../../components/inspection/inspectionWire';
import { inspectionDraftKey } from '../../../components/inspection/inspectionDraftStore';

export const KK1_INSPECTION_HOST = 'kk1-birth';

export interface Kk1InspectionGateInput {
  moduleEnabled: boolean;
  hasPermission: (code: string) => boolean;
  /** Oturum istasyonu; eski sunucu `canInspect` göndermez → kapalı. */
  station: { canInspect?: unknown } | null | undefined;
}

/** Gösterim kapısı — TEK yüklem: modül ∧ `inspection:write` ∧ sunucunun `canInspect`i. */
export function kk1InspectionVisible({ moduleEnabled, hasPermission, station }: Kk1InspectionGateInput): boolean {
  return moduleEnabled && hasPermission('inspection:write') && station?.canInspect === true;
}

/** KK1'de top doğmadı: ref = istasyonun doğuş anahtarı (istasyon değişince taslak karışmaz). */
export function kk1InspectionDraftKey(stationId: string | null | undefined): string {
  return inspectionDraftKey(KK1_INSPECTION_HOST, `station:${stationId ?? 'none'}`);
}

/** Gövde parçası: kapı kapalı ya da taslak boşsa BOŞ (bugünkü payload bayt bayt). */
export function kk1BirthInspectionPayload(draft: InspectionDraft, visible: boolean): { inspection?: BirthInspectionRequest } {
  if (!visible || isDraftEmpty(draft)) return {};
  const note = draft.note.trim();
  return {
    inspection: {
      defects: draftToWireDefects(draft),
      ...(draft.inspectedLengthM != null ? { inspectedLengthM: draft.inspectedLengthM } : {}),
      ...(note ? { note } : {}),
    },
  };
}

export interface InspectionNotSavedWire {
  code?: string;
  reason?: string;
  message?: string;
}

const REASON_TEXT: Record<string, string> = {
  MODULE_DISABLED: 'Kalite Güvence modülü kapalı',
  PERMISSION_DENIED: 'muayene yetkiniz yok',
  STATION_NO_QUALITY: 'bu istasyonda muayene kapalı',
};

/** `INSPECTION_NOT_SAVED` → turuncu toast; top doğdu, muayene yazılmadı. */
export function inspectionNotSavedToast(notSaved: InspectionNotSavedWire | null | undefined, barcode?: string | null): { text1: string; text2: string } | null {
  if (!notSaved || notSaved.code !== 'INSPECTION_NOT_SAVED') return null;
  const why = (notSaved.reason && REASON_TEXT[notSaved.reason]) || 'sunucu reddetti';
  return { text1: `Muayene kaydedilmedi: ${why}`, text2: barcode ? `${barcode} — top kaydedildi, muayeneyi panelden girin` : 'Top kaydedildi, muayeneyi panelden girin' };
}

/** Genel uyarı kanalından muayene metnini düş — turuncu toast ayrıca söyler (çift mesaj olmasın). */
export function withoutInspectionWarning(warnings: readonly string[] | undefined, notSaved: InspectionNotSavedWire | null | undefined): string[] | undefined {
  if (!warnings || !notSaved?.message) return warnings ? [...warnings] : undefined;
  return warnings.filter((w) => w !== notSaved.message);
}
