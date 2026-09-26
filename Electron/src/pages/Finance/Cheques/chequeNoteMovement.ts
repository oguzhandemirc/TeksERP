// =============================================================================
// TESLİM BORDROSU HAREKET FİŞİ (K3) — saf katman: teslim türü, kapılar, 409 çözümleri
// =============================================================================
// Bayrak `financeChequeNoteMovementEnabled` AÇIKKEN bordro çeki hareket ettirir: banka hedefi →
// bankaya verme, cari hedefi → ciro. Kuralın sahibi backend'dir (`cheque-note-movement.service`);
// ekran yalnız teslim türünü sorar ve backend'in planını/ret listesini GÖSTERİR — kendi planını
// üretmez (ikinci yorum, bir gün "geçer" deyip sunucunun reddettiği bir seçim demekti).
// Bayrak KAPALIYKEN bu dosyanın hiçbir çıktısı gövdeye girmez: bordro bugünkü gibi belge-only.
// =============================================================================
import type { ChequeKind, ChequeStatus } from "./service";

/** Teslim türü — hareket yalnız ilk ikisinde; "yalnız belge" sistemde durumu olmayan teslimler için. */
export type DeliveryTargetKind = "BANK" | "CARI" | "TEXT";

export const TARGET_KIND_LABEL: Record<DeliveryTargetKind, string> = {
  BANK: "Bankaya (tahsile / teminata)",
  CARI: "Cariye ciro",
  TEXT: "Diğer — yalnız belge",
};

export type NoteMovementType = "DEPOSIT" | "ENDORSE";

export const MOVEMENT_LABEL: Record<NoteMovementType, string> = {
  DEPOSIT: "bankaya verilecek",
  ENDORSE: "ciro edilecek",
};

/** Kayıtlı hareketin geçmiş kipi — iptal önizlemesinde "ne geri alınacak". */
export const MOVED_LABEL: Record<NoteMovementType, string> = {
  DEPOSIT: "bankaya verilmişti",
  ENDORSE: "ciro edilmişti",
};

export const TARGET_KIND_REQUIRED = "Teslim türünü seçin — bankaya mı, cariye ciro mu, yalnız belge mi.";
export const BANK_REQUIRED = "Teslim edilen banka hesabını seçin.";
export const CARI_REQUIRED = "Ciro edilen cariyi seçin (cari hesabı olan bir kart).";

/**
 * Hareket fişi bu seçimde uygulanır mı: bayrak açık VE aldığımız çekler. Verdiğimiz çekin teslimi
 * hareket değildir (verme doğuşta yazıldı; bankaya "teslim" backend'de 400) — ekran onu sormaz.
 */
export function movementApplies(movementOn: boolean, kind: ChequeKind | null): boolean {
  return movementOn && kind === "RECEIVED";
}

export interface DeliveryTarget {
  targetKind: DeliveryTargetKind | null;
  bankAccountId: string | null;
  cariId: string | null;
}

/** Teslim türünün kendi kapısı; sebep döner (kapalı düğme tek başına "bozuk" okunur). */
export function targetBlockReason(t: DeliveryTarget): string | null {
  if (!t.targetKind) return TARGET_KIND_REQUIRED;
  if (t.targetKind === "BANK" && !t.bankAccountId) return BANK_REQUIRED;
  if (t.targetKind === "CARI" && !t.cariId) return CARI_REQUIRED;
  return null;
}

/**
 * Gövdeye giden hedef alanları — YALNIZ seçilen türün kimliği gider (backend çift hedefi 400'ler);
 * "yalnız belge"de hiçbiri gitmez, serbest metin kendi alanında kalır.
 */
export function targetBodyFields(t: DeliveryTarget): { bankAccountId?: string; cariId?: string } {
  if (t.targetKind === "BANK" && t.bankAccountId) return { bankAccountId: t.bankAccountId };
  if (t.targetKind === "CARI" && t.cariId) return { cariId: t.cariId };
  return {};
}

/** Taslağın "kaydedince ne olacak" satırı (backend `planMovementTx` aynası — yalnız TİP). */
export interface MovementPlanRow {
  chequeId: string;
  docNo: string;
  action: NoteMovementType;
  fromStatus: ChequeStatus;
  toStatus: ChequeStatus;
  blockedReason: string | null;
}

export interface MovementPlan {
  type: NoteMovementType | null;
  rows: MovementPlanRow[];
}

/** Planın özeti — engelli satır varsa Kaydet kapanır ve sebep yazılır (kayıt zaten 409 verirdi). */
export function planBlockReason(plan: MovementPlan | undefined): string | null {
  const blocked = plan?.rows.filter((r) => r.blockedReason) ?? [];
  if (blocked.length === 0) return null;
  return `${blocked.length} kıymet bu bordroyla hareket edemez — seçimden çıkarın ya da teslim türünü değiştirin.`;
}

type ErrorBody = { message?: unknown; details?: Record<string, unknown> };

function errorBody(error: unknown): ErrorBody | undefined {
  return (error as { response?: { data?: unknown } } | null | undefined)?.response?.data as ErrorBody | undefined;
}

export interface RowIssue {
  chequeId: string;
  docNo: string;
  reason: string;
}

function issuesOf(v: unknown): RowIssue[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x) => {
    const r = x as { chequeId?: unknown; docNo?: unknown; reason?: unknown };
    return typeof r.chequeId === "string"
      ? [{ chequeId: r.chequeId, docNo: typeof r.docNo === "string" ? r.docNo : "", reason: typeof r.reason === "string" ? r.reason : "" }]
      : [];
  });
}

/**
 * Hareketin satır reddi (`DELIVERY_ROWS_BLOCKED` kaydı · `DELIVERY_ITEMS_ADVANCED` iptali) mi?
 * Gövde YAPISAL okunur, `code` ile eşleşilir (mesaj metniyle değil); başka hata `null`.
 */
export function rowIssuesError(error: unknown): { code: string; message: string; rows: RowIssue[] } | null {
  const body = errorBody(error);
  const code = body?.details?.code;
  if (code !== "DELIVERY_ROWS_BLOCKED" && code !== "DELIVERY_ITEMS_ADVANCED") return null;
  return {
    code,
    message: typeof body?.message === "string" ? body.message : "Seçimdeki bazı kıymetler işlenemedi.",
    rows: issuesOf(code === "DELIVERY_ROWS_BLOCKED" ? body?.details?.rows : body?.details?.items),
  };
}

/** İptal önizlemesinin kalemi (backend `CancelPreviewItem` aynası — yalnız TİP). */
export interface CancelPreviewItem {
  chequeId: string;
  docNo: string;
  amount: string;
  currency: string;
  status: ChequeStatus;
  action: NoteMovementType | null;
  reversed: boolean;
  reversible: boolean;
  reason: string | null;
}

export interface CancelPreview {
  id: string;
  docNo: string;
  status: "ACTIVE" | "CANCELLED";
  hasMovements: boolean;
  items: CancelPreviewItem[];
}

/** Seçilebilen kalemler: bordronun hareketi canlı VE geri alınabilir. */
export function reversibleIds(items: readonly CancelPreviewItem[]): string[] {
  return items.filter((i) => i.action && !i.reversed && i.reversible).map((i) => i.chequeId);
}

export const CANCEL_REASON_REQUIRED = "Sebep zorunlu — iptal çeklerin hareketini ters kayıtla geri alır.";
export const CANCEL_SELECTION_REQUIRED = "Geri alınacak en az bir kıymet seçin.";

/** Hareketli iptalin kapısı — seçim ve sebep (backend ikisini de zorunlu tutar). */
export function cancelSelectionBlockReason(selected: ReadonlySet<string>, reason: string): string | null {
  if (selected.size === 0) return CANCEL_SELECTION_REQUIRED;
  if (!reason.trim()) return CANCEL_REASON_REQUIRED;
  return null;
}

/** Seçim bütün canlı kalemleri kapsıyorsa bordro da iptal olur — onay metni bunu SÖYLER. */
export function cancelWillCloseNote(items: readonly CancelPreviewItem[], selected: ReadonlySet<string>): boolean {
  const live = items.filter((i) => i.action && !i.reversed).map((i) => i.chequeId);
  return live.length > 0 && live.every((id) => selected.has(id));
}
