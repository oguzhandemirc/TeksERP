// Sevk detayı "Muayene" bölümü (K4P-RAPOR): her sevk topunun KENDİ aktif muayenesi, müşteri kuralına
// göre etiket + GEÇTİ/KALDI. Etiket, sonuç ve toplamlar sunucudan gelir; burada hesap yok.
// Modül kapalıysa ya da izin yoksa HİÇ çizilmez (istek de atılmaz). Sevk yazma yolu değişmez.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Gauge } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatNumber } from "@/lib/format";
import { InspectionReportDialog } from "./InspectionReportDialog";
import { PHASE_LABEL } from "./inspectionRules";
import { useInspectionsVisible } from "./RollInspectionCard";
import { inspectionService, type InspectionResult, type ShipmentInspectionSummary } from "./service";

export const RESULT_LABEL: Record<InspectionResult, string> = { PASS: "GEÇTİ", FAIL: "KALDI", NONE: "Muayene yok", NO_SCORE: "Hesaplanamadı" };
const RESULT_VARIANT: Record<InspectionResult, "default" | "destructive" | "secondary" | "outline"> = {
  PASS: "default", FAIL: "destructive", NONE: "outline", NO_SCORE: "secondary",
};
const dash = (v: number | null | undefined, dec = 0) => (v == null ? "—" : formatNumber(v, dec));

export function ShipmentInspectionTable({ data }: { data: ShipmentInspectionSummary }) {
  const t = data.totals;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Muayene özeti">
        <span>Muayene edilen <b>{t.inspectedCount} / {t.rollCount}</b></span>
        <span>Geçti <b>{t.passCount}</b></span>
        <span className={t.failCount > 0 ? "text-destructive" : undefined}>Kaldı <b>{t.failCount}</b></span>
        <span>Muayene yok <b>{t.uninspectedCount}</b></span>
        <span>Ort. puan / 100 m² <b>{dash(t.avgPointsPer100M2, 2)}</b></span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr className="border-b text-left">
              <th className="py-1 pr-2">Barkod</th>
              <th className="py-1 pr-2">Kumaş / renk</th>
              <th className="py-1 pr-2 text-right">Metre</th>
              <th className="py-1 pr-2">Aşama</th>
              <th className="py-1 pr-2 text-right">Hata</th>
              <th className="py-1 pr-2 text-right">Puan</th>
              <th className="py-1 pr-2 text-right">Puan/100</th>
              <th className="py-1 pr-2">Etiket</th>
              <th className="py-1 pr-2">Sonuç</th>
              <th className="py-1">Fabrika derecesi</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.rollId} className="border-b last:border-0">
                <td className="py-1 pr-2 font-mono">{r.barcode ?? "—"}</td>
                <td className="py-1 pr-2">{r.colorName ? `${r.itemName} · ${r.colorName}` : r.itemName}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{formatNumber(r.meters, 2)}</td>
                <td className="py-1 pr-2">{r.phase ? PHASE_LABEL[r.phase] : "—"}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{dash(r.defectCount)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{dash(r.totalPoints)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{dash(r.score, 2)}{r.scoreUnit === "YD2" ? " yd²" : ""}</td>
                <td className="py-1 pr-2">{r.label ?? "—"}</td>
                <td className="py-1 pr-2"><Badge variant={RESULT_VARIANT[r.result]}>{RESULT_LABEL[r.result]}</Badge></td>
                <td className="py-1">{r.factoryGrade ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ShipmentInspectionSection({ shipmentId, shipmentNo }: { shipmentId: string; shipmentNo: string }) {
  const enabled = useInspectionsVisible();
  const [reportOpen, setReportOpen] = useState(false);
  const q = useQuery({ queryKey: ["quality-inspections", "shipment", shipmentId], queryFn: () => inspectionService.shipmentSummary(shipmentId), enabled });
  if (!enabled) return null;
  return (
    <Card>
      <CardContent className="space-y-2 p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Gauge className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-medium">Muayene</h3>
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => setReportOpen(true)} disabled={!q.data || q.data.rows.length === 0}>
            <FileText className="mr-1 h-4 w-4" />Muayene raporu (Yazdır / PDF)
          </Button>
        </div>
        {q.isLoading ? (
          <p className="text-xs text-muted-foreground">Yükleniyor…</p>
        ) : q.isError ? (
          <p className="text-xs text-destructive">Muayene özeti okunamadı.</p>
        ) : q.data && q.data.rows.length > 0 ? (
          <ShipmentInspectionTable data={q.data} />
        ) : (
          <p className="text-xs text-muted-foreground">Bu sevkiyatta top yok.</p>
        )}
      </CardContent>
      {reportOpen && <InspectionReportDialog shipmentId={shipmentId} shipmentNo={shipmentNo} onClose={() => setReportOpen(false)} />}
    </Card>
  );
}
