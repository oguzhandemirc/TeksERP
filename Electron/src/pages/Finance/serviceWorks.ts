// Hizmet taslağının iş kırılımı (fason F4/F9 `serviceWorks?`) — backend `service-billing/types.ts`
// `ServiceDraftWorkRow` aynası. Hesap SUNUCUDA; panel yalnız gösterir. Eski backend alanı yollamaz ⇒ bölüm çizilmez.

export type ServiceWorkSource = "LEAD" | "FLAG" | "STEP" | "WINDING" | "WEAVING";

export interface ServiceDraftWorkRow {
  source: ServiceWorkSource;
  subjectKind: "ROLL" | "WARP_BEAM";
  subjectId: string;
  /** Top barkodu ya da levent no. */
  subjectCode: string;
  serviceItemId: string;
  processLabel: string;
  workOrderStepId: string | null;
  qty: string;
  unit: "METER" | "PIECE" | "STITCH";
  meterBasis: string;
  unitPrice: string;
  /** Dolu satır taslak toplamına GİRMEZ (yeniden işlem — bizim hatamız). */
  excludedReason: "REWORK_OUR_FAULT" | null;
}

export const SERVICE_WORK_SOURCE_LABEL: Record<ServiceWorkSource, string> = {
  LEAD: "Kurşun",
  FLAG: "Özellik işi",
  STEP: "Adım",
  WINDING: "Levent sarımı",
  WEAVING: "Dokuma",
};

const UNIT_LABEL: Record<ServiceDraftWorkRow["unit"], string> = { METER: "m", PIECE: "adet", STITCH: "vuruş" };

const BASIS_LABEL: Record<string, string> = {
  OUT: "çıkış metresi",
  IN: "giriş metresi",
  DECLARED: "bildirilen metre",
  CUT: "kesim metresi",
  RECEIVED: "kabul metresi",
  WOUND: "sarım metresi",
  WOVEN: "dokuma metresi",
};

/** Bilinmeyen değer ham kod olarak değil nötr metinle düşer (yeni backend değeri ekranı bozmasın). */
export const sourceLabel = (s: string): string => SERVICE_WORK_SOURCE_LABEL[s as ServiceWorkSource] ?? "Diğer";
export const unitLabel = (u: string): string => UNIT_LABEL[u as ServiceDraftWorkRow["unit"]] ?? "";
export const basisLabel = (b: string): string => BASIS_LABEL[b] ?? "—";
export const subjectKindLabel = (k: string): string => (k === "WARP_BEAM" ? "Levent" : "Top");

export interface ServiceWorksSummary {
  billed: number;
  excluded: number;
}

export function summarizeServiceWorks(rows: readonly ServiceDraftWorkRow[] | undefined): ServiceWorksSummary {
  const excluded = (rows ?? []).filter((r) => r.excludedReason !== null).length;
  return { billed: (rows ?? []).length - excluded, excluded };
}

/** Satır sırası: önce faturalanan, sonra hariç; kendi içinde kaynak → süreç → konu kodu (ekran ve dışa aktarım aynı). */
export function sortServiceWorks(rows: readonly ServiceDraftWorkRow[]): ServiceDraftWorkRow[] {
  const order: ServiceWorkSource[] = ["LEAD", "FLAG", "STEP", "WINDING", "WEAVING"];
  const rank = (s: string) => {
    const i = order.indexOf(s as ServiceWorkSource);
    return i < 0 ? order.length : i;
  };
  return [...rows].sort(
    (a, b) =>
      Number(a.excludedReason !== null) - Number(b.excludedReason !== null) ||
      rank(a.source) - rank(b.source) ||
      a.processLabel.localeCompare(b.processLabel, "tr") ||
      a.subjectCode.localeCompare(b.subjectCode, "tr"),
  );
}
