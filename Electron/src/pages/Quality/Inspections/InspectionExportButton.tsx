// Dışa aktarım listenin AYNI parametreleriyle (aynı where) imleci sonuna kadar çeker; tavanda söyler.
import { useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { drainCursor } from "@/lib/export-drain";
import { exportRowsToXlsx, type ExportColumn } from "@/lib/list-export";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import { apiErrorText } from "@/lib/api-error";
import { inspectionService, type InspectionListParams, type InspectionListRow } from "./service";
import { PHASE_LABEL, STATE_LABEL, WIDTH_SOURCE_LABEL, inspectionState } from "./inspectionRules";

const num = (v: string | number | null) => (v == null ? null : Number(v));
export const INSPECTION_EXPORT_COLUMNS: ExportColumn<InspectionListRow>[] = [
  { label: "Top", value: (r) => r.roll.barcode ?? "" },
  { label: "Kumaş", value: (r) => r.roll.item?.name ?? "" },
  { label: "Aşama", value: (r) => PHASE_LABEL[r.phase] },
  { label: "Revizyon", value: (r) => r.revision },
  { label: "Uzunluk (m)", value: (r) => num(r.inspectedLengthM), summable: true },
  { label: "En (cm)", value: (r) => num(r.widthCm) },
  { label: "En kaynağı", value: (r) => WIDTH_SOURCE_LABEL[r.widthSource] },
  { label: "Hata sayısı", value: (r) => r.defectCount, summable: true },
  { label: "Puan", value: (r) => r.totalPoints, summable: true },
  { label: "Puan / 100 m²", value: (r) => num(r.pointsPer100M2) },
  { label: "Önerilen derece", value: (r) => r.suggestedGradeCode ?? "" },
  { label: "Top kalitesi", value: (r) => r.roll.qualityGrade ?? "" },
  { label: "Uyumsuz", value: (r) => (r.gradeMismatch ? "Evet" : "") },
  { label: "Muayene saati", value: (r) => fmtFactoryDateTime(r.inspectedAt) },
  { label: "Operatör", value: (r) => r.inspectedBy?.fullName ?? "" },
  { label: "İstasyon", value: (r) => r.station?.name ?? "" },
  { label: "Durum", value: (r) => STATE_LABEL[inspectionState(r)] },
];
const EXPORT_PAGE = 200; // backend liste tavanı

export function InspectionExportButton({ params, disabled }: { params: InspectionListParams; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const res = await drainCursor<InspectionListRow>(async (cursor) => {
        const page = await inspectionService.list({ ...params, cursor, limit: EXPORT_PAGE });
        return { data: page.items, pagination: { nextCursor: page.nextCursor, totalEstimate: page.summary.total } };
      });
      const notes = res.truncated ? ["Liste tavana ulaştı; tüm satırlar alınamadı — süzgeci daraltın."] : undefined;
      await exportRowsToXlsx(INSPECTION_EXPORT_COLUMNS, res.rows, "muayeneler", notes);
      if (res.truncated) toast.warning("Dosya eksik: liste tavanına ulaşıldı. Süzgeci daraltıp yeniden indirin.");
    } catch (e) {
      toast.error(apiErrorText(e, "Dışa aktarılamadı."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant="outline" size="sm" className="h-9" disabled={disabled || busy} onClick={() => void run()}>
      <Download className="mr-1 h-4 w-4" />{busy ? "Hazırlanıyor…" : "Excel'e aktar"}
    </Button>
  );
}
