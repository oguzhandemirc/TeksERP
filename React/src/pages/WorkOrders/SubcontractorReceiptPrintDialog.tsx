import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Printer,
  X,
  PackageCheck,
  User,
  Calendar,
  Factory,
  FileText,
  Loader2,
} from "lucide-react";
import {
  subcontractorService,
  type SubcontractorReceiptPrintSnapshot,
} from "@/services/subcontractorService";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  receiptId: string | null;
}

export default function SubcontractorReceiptPrintDialog({
  open,
  onOpenChange,
  receiptId,
}: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["receipt-print", receiptId],
    queryFn: () => subcontractorService.getReceiptPrint(receiptId!),
    enabled: !!receiptId && open,
  });

  useEffect(() => {
    if (!open) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", handleEsc);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleEsc);
      document.body.style.overflow = prev;
    };
  }, [open, onOpenChange]);

  if (!open) return null;

  const snap = data?.data;

  const buildPrintHtml = (s: SubcontractorReceiptPrintSnapshot): string => {
    const receivedAt = new Date(s.receivedAt).toLocaleString("tr-TR");

    const rowsHtml = s.rolls
      .map(
        (r) => `<tr>
        <td class="num">${r.sequence}</td>
        <td class="mono">${r.barcode}</td>
        <td>
          <div><strong>${r.itemCode}</strong></div>
          <div class="muted">${r.itemName}</div>
        </td>
        <td>${r.variantCode ? `<strong>${r.variantCode}</strong>${r.variantName ? `<div class="muted">${r.variantName}</div>` : ""}` : '<span class="muted">—</span>'}</td>
        <td>${r.qualityGrade}</td>
        <td>${r.notes ? `<span class="muted">${r.notes}</span>` : '<span class="muted">—</span>'}</td>
      </tr>`,
      )
      .join("");

    return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="utf-8" />
  <title>Fason Kabul ${s.receiptNo}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 28px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; color: #111; background: #fff; font-size: 12px; line-height: 1.4; }
    .doc-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px double #222; padding-bottom: 14px; margin-bottom: 22px; }
    .doc-header h1 { margin: 0; font-size: 22px; letter-spacing: 1px; }
    .doc-header .number { font-size: 14px; color: #444; margin-top: 4px; font-family: ui-monospace, Menlo, monospace; }
    .doc-header .right { text-align: right; font-size: 11px; color: #444; }
    .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 16px; }
    .party { border: 1px solid #ccc; border-radius: 6px; padding: 12px 14px; background: #fafafa; }
    .party-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #666; margin-bottom: 6px; font-weight: 600; }
    .party-name { font-size: 14px; font-weight: 700; margin-bottom: 2px; }
    .wo-box { border: 1px solid #b8d4f0; border-radius: 6px; padding: 12px 14px; background: #f0f6ff; margin-bottom: 16px; }
    .wo-box-title { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #2255aa; margin-bottom: 8px; font-weight: 700; }
    .wo-grid { display: grid; grid-template-columns: auto 1fr; gap: 4px 16px; font-size: 11px; }
    .wo-grid .lbl { color: #555; }
    .wo-grid .val { font-weight: 600; }
    .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; font-size: 11px; }
    .meta-item { border: 1px solid #e5e5e5; border-radius: 4px; padding: 8px 10px; }
    .meta-label { color: #777; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; }
    .meta-value { font-weight: 600; font-size: 12px; }
    .summary { display: grid; grid-template-columns: repeat(1, 1fr); gap: 12px; margin-bottom: 16px; max-width: 200px; }
    .sum-box { background: #f0f4f8; border: 1px solid #d3dce5; border-radius: 6px; padding: 12px; text-align: center; }
    .sum-num { font-size: 22px; font-weight: 700; color: #0f2d4a; }
    .sum-label { font-size: 10px; color: #456; margin-top: 2px; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 11px; }
    thead th { background: #1a2b3a; color: #fff; padding: 8px 10px; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
    tbody td { border-bottom: 1px solid #e1e4e8; padding: 8px 10px; vertical-align: top; }
    tbody tr:nth-child(even) { background: #f8f9fa; }
    tfoot td { background: #eef1f4; font-weight: 700; border-top: 2px solid #1a2b3a; padding: 10px; }
    .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .mono { font-family: ui-monospace, Menlo, monospace; }
    .muted { color: #777; font-size: 10px; margin-top: 2px; }
    .notes-box { border: 1px solid #e5e5e5; border-radius: 4px; padding: 10px 12px; background: #fffdf0; font-size: 11px; margin-bottom: 20px; }
    .signatures { display: grid; grid-template-columns: repeat(3, 1fr); gap: 36px; margin-top: 44px; }
    .sig { border-top: 1px solid #000; padding-top: 8px; font-size: 11px; text-align: center; font-weight: 600; }
    .doc-footer { margin-top: 28px; border-top: 1px dashed #bbb; padding-top: 10px; font-size: 9px; color: #999; text-align: center; }
    @media print { body { padding: 14px; } }
  </style>
</head>
<body>
  <div class="doc-header">
    <div>
      <h1>FASON MAL KABUL FORMU</h1>
      <div class="number">${s.receiptNo}</div>
    </div>
    <div class="right">
      <div>Kabul Tarihi: <strong>${receivedAt}</strong></div>
      <div style="margin-top:4px">Firma İrsaliye No: <strong>${s.manifestNo}</strong></div>
      <div style="margin-top:4px">İstasyon: ${s.step.station.code} — ${s.step.station.name}</div>
    </div>
  </div>

  <div class="parties">
    <div class="party">
      <div class="party-label">Gönderen (Boyahane / Fason Firma)</div>
      <div class="party-name">${s.company.name}</div>
      ${s.company.code ? `<div class="muted">Kod: ${s.company.code}</div>` : ""}
    </div>
    <div class="party">
      <div class="party-label">Alıcı</div>
      <div class="party-name">TeksERP Tekstil Fabrikası</div>
      <div class="muted">(Fabrika bilgileri ayarlardan düzenlenir)</div>
    </div>
  </div>

  <div class="wo-box">
    <div class="wo-box-title">İş Emri Bilgileri</div>
    <div class="wo-grid">
      <span class="lbl">Parti No:</span>
      <span class="val" style="font-family: monospace">${s.workOrder.batchNumber}</span>
      ${s.workOrder.recipeNo ? `<span class="lbl">Reçete No:</span><span class="val">${s.workOrder.recipeNo}</span>` : ""}
    </div>
  </div>

  <div class="meta">
    <div class="meta-item">
      <div class="meta-label">Firma İrsaliye No</div>
      <div class="meta-value" style="font-family:monospace">${s.manifestNo}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Kabul Tarihi</div>
      <div class="meta-value">${receivedAt}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Kabul Eden</div>
      <div class="meta-value">${s.receivedBy ?? "—"}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Top Sayısı</div>
      <div class="meta-value">${s.totals.rollCount}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:28px">#</th>
        <th>Barkod</th>
        <th>Ürün</th>
        <th>Varyant</th>
        <th>Kalite</th>
        <th>Not</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
    <tfoot>
      <tr>
        <td colspan="5">TOPLAM</td>
        <td>${s.totals.rollCount} top</td>
      </tr>
    </tfoot>
  </table>

  ${s.notes ? `<div class="notes-box"><strong>Notlar:</strong> ${s.notes}</div>` : ""}

  <div class="signatures">
    <div class="sig">Teslim Eden</div>
    <div class="sig">Taşıyıcı</div>
    <div class="sig">Teslim Alan</div>
  </div>

  <div class="doc-footer">
    TeksERP — ${new Date().toLocaleString("tr-TR")}
  </div>
</body>
</html>`;
  };

  const handlePrint = () => {
    if (!snap) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    printWindow.document.write(buildPrintHtml(snap));
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 250);
  };

  const receivedAt = snap ? new Date(snap.receivedAt).toLocaleString("tr-TR") : "";

  return createPortal(
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />

      <div className="relative z-10 w-full max-w-5xl max-h-[92vh] flex flex-col rounded-xl border bg-background shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-muted/30">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
              <PackageCheck className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold tracking-tight">
                Fason Mal Kabul Formu
              </h2>
              <p className="text-xs text-muted-foreground font-mono truncate">
                {snap?.receiptNo ?? "—"}
                {snap?.manifestNo && (
                  <span className="ml-2 opacity-60">· Firma: {snap.manifestNo}</span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" onClick={handlePrint} disabled={!snap}>
              <Printer className="h-4 w-4 mr-1" />
              Yazdır / PDF
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onOpenChange(false)}
              className="h-9 w-9"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Preview Body */}
        <div className="flex-1 overflow-y-auto bg-slate-100 dark:bg-slate-900 p-6">
          {isLoading || !snap ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mb-3" />
              <span className="text-sm">Belge hazırlanıyor...</span>
            </div>
          ) : (
            <div className="mx-auto max-w-[900px] bg-white text-slate-900 rounded-lg shadow-lg p-10">
              {/* Document Header */}
              <div className="flex items-start justify-between border-b-[3px] border-double border-slate-800 pb-4 mb-6">
                <div>
                  <h1 className="text-2xl font-bold tracking-wider">
                    FASON MAL KABUL FORMU
                  </h1>
                  <p className="text-sm font-mono text-slate-600 mt-1">
                    {snap.receiptNo}
                  </p>
                </div>
                <div className="text-right text-xs text-slate-600 space-y-1">
                  <div className="font-semibold text-slate-800">{receivedAt}</div>
                  <div>Firma İrsaliye: <span className="font-mono font-bold">{snap.manifestNo}</span></div>
                  <div>İstasyon: {snap.step.station.code} — {snap.step.station.name}</div>
                </div>
              </div>

              {/* Parties */}
              <div className="grid grid-cols-2 gap-4 mb-5">
                <div className="border border-slate-200 rounded-md bg-slate-50 p-3">
                  <div className="text-[10px] uppercase tracking-widest font-semibold text-slate-500 mb-1">
                    Gönderen — Boyahane / Fason Firma
                  </div>
                  <div className="font-bold text-sm">{snap.company.name}</div>
                  {snap.company.code && (
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      Kod: {snap.company.code}
                    </div>
                  )}
                </div>
                <div className="border border-slate-200 rounded-md bg-slate-50 p-3">
                  <div className="text-[10px] uppercase tracking-widest font-semibold text-slate-500 mb-1">
                    Alıcı
                  </div>
                  <div className="font-bold text-sm">TeksERP Tekstil Fabrikası</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    (Fabrika bilgileri ayarlardan düzenlenir)
                  </div>
                </div>
              </div>

              {/* Work Order Info */}
              <div className="border border-blue-200 rounded-md bg-blue-50 p-3 mb-5">
                <div className="text-[10px] uppercase tracking-widest font-semibold text-blue-700 mb-2">
                  İş Emri Bilgileri
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                  <div className="flex gap-2">
                    <span className="text-slate-500 min-w-[60px]">Parti No:</span>
                    <span className="font-bold font-mono">{snap.workOrder.batchNumber}</span>
                  </div>
                  {snap.workOrder.recipeNo && (
                    <div className="flex gap-2">
                      <span className="text-slate-500 min-w-[60px]">Reçete No:</span>
                      <span className="font-semibold">{snap.workOrder.recipeNo}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Meta */}
              <div className="grid grid-cols-4 gap-2 mb-5">
                <MetaItem
                  label="Firma İrsaliye No"
                  value={snap.manifestNo}
                  icon={<FileText className="h-3 w-3" />}
                />
                <MetaItem
                  label="Kabul Tarihi"
                  value={receivedAt}
                  icon={<Calendar className="h-3 w-3" />}
                />
                <MetaItem
                  label="Kabul Eden"
                  value={snap.receivedBy ?? "—"}
                  icon={<User className="h-3 w-3" />}
                />
                <MetaItem
                  label="İstasyon"
                  value={snap.step.station.code}
                  icon={<Factory className="h-3 w-3" />}
                />
              </div>

              {/* Summary */}
              <div className="mb-5">
                <SummaryBox num={String(snap.totals.rollCount)} label="Kabul Edilen Top Sayısı" />
              </div>

              {/* Table */}
              <div className="border border-slate-200 rounded-md overflow-hidden mb-5">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-800 text-white">
                      <th className="p-2 text-left w-8">#</th>
                      <th className="p-2 text-left">Barkod</th>
                      <th className="p-2 text-left">Ürün</th>
                      <th className="p-2 text-left">Varyant</th>
                      <th className="p-2 text-left">Kalite</th>
                      <th className="p-2 text-left">Not</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snap.rolls.map((r, idx) => (
                      <tr key={r.id} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                        <td className="p-2 text-slate-500">{r.sequence}</td>
                        <td className="p-2 font-mono text-[11px]">{r.barcode}</td>
                        <td className="p-2">
                          <div className="font-semibold">{r.itemCode}</div>
                          <div className="text-[10px] text-slate-500">{r.itemName}</div>
                        </td>
                        <td className="p-2">
                          {r.variantCode ? (
                            <>
                              <div className="font-semibold">{r.variantCode}</div>
                              {r.variantName && (
                                <div className="text-[10px] text-slate-500">{r.variantName}</div>
                              )}
                            </>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="p-2">{r.qualityGrade}</td>
                        <td className="p-2 text-[11px] text-slate-500">{r.notes ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-100 font-bold border-t-2 border-slate-800">
                      <td colSpan={5} className="p-2.5">TOPLAM</td>
                      <td className="p-2.5">{snap.totals.rollCount} top</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {snap.notes && (
                <div className="border border-amber-200 rounded-md bg-amber-50 p-3 mb-5 text-xs">
                  <span className="font-semibold text-amber-800">Notlar: </span>
                  <span className="text-slate-700">{snap.notes}</span>
                </div>
              )}

              {/* Signatures */}
              <div className="grid grid-cols-3 gap-10 mt-10 mb-4">
                {["Teslim Eden", "Taşıyıcı", "Teslim Alan"].map((role) => (
                  <div key={role} className="border-t border-slate-800 pt-2 text-center text-xs font-semibold">
                    {role}
                  </div>
                ))}
              </div>

              <div className="mt-6 pt-3 border-t border-dashed border-slate-300 text-center text-[10px] text-slate-400">
                <FileText className="inline h-3 w-3 mr-1" />
                TeksERP — {new Date().toLocaleString("tr-TR")}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function MetaItem({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="border border-slate-200 rounded p-2 bg-white">
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-slate-500 mb-0.5">
        {icon}{label}
      </div>
      <div className="font-semibold text-xs">{value}</div>
    </div>
  );
}

function SummaryBox({ num, label }: { num: string; label: string }) {
  return (
    <div className="rounded-lg border border-slate-300 bg-gradient-to-br from-slate-50 to-slate-100 p-3 text-center max-w-[200px]">
      <div className="text-2xl font-bold text-slate-800 tabular-nums">{num}</div>
      <div className="text-[10px] uppercase tracking-wider text-slate-600 mt-0.5">{label}</div>
    </div>
  );
}
