import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Printer,
  X,
  Truck,
  User,
  Calendar,
  ClipboardList,
  FileText,
  Lock,
  Eye,
  Loader2,
} from "lucide-react";
import { shipmentStatusLabels } from "@/types/enums";
import type { ShipmentStatus } from "@/types/enums";
import {
  shippingService,
  type ShipmentPrintSnapshot,
} from "@/services/shippingService";

interface ShipmentPrintDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shipmentId: string | null;
}

const statusColor: Record<string, string> = {
  PREPARING: "bg-yellow-100 text-yellow-900 border-yellow-300",
  SHIPPED: "bg-green-100 text-green-900 border-green-300",
  CANCELLED: "bg-red-100 text-red-900 border-red-300",
};

export default function ShipmentPrintDialog({
  open,
  onOpenChange,
  shipmentId,
}: ShipmentPrintDialogProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["shipment-print", shipmentId],
    queryFn: () => shippingService.getPrintSnapshot(shipmentId!),
    enabled: !!shipmentId && open,
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

  const buildPrintHtml = (s: ShipmentPrintSnapshot): string => {
    const shippedAt = s.shipment.shippedAt
      ? new Date(s.shipment.shippedAt).toLocaleString("tr-TR")
      : null;
    const createdAt = new Date(s.shipment.createdAt).toLocaleString("tr-TR");

    const rowsHtml = s.items
      .map((it) => {
        const custHtml = it.customerLabel
          ? `<div><strong>${it.customerLabel}</strong></div>${
              it.customerCode
                ? `<div class="muted">Kod: ${it.customerCode}</div>`
                : ""
            }`
          : `<span class="muted">—</span>`;
        const orderWoHtml = [
          it.orderNumber ? `<div>Sipariş: ${it.orderNumber}</div>` : "",
          it.workOrderBatchNumber
            ? `<div class="muted">İş Emri: ${it.workOrderBatchNumber}</div>`
            : "",
        ].join("");
        return `<tr>
          <td class="num">${it.sequence}</td>
          <td class="mono">${it.rollBarcode}</td>
          <td>
            <div><strong>${it.itemCode}</strong></div>
            <div class="muted">${it.itemName}${
              it.variantCode ? ` · ${it.variantCode}` : ""
            }</div>
          </td>
          <td>${custHtml}</td>
          <td>${orderWoHtml || '<span class="muted">—</span>'}</td>
          <td class="num">${it.shippedQty.toFixed(2)}</td>
          <td class="num">${
            it.shippedWeight != null ? it.shippedWeight.toFixed(2) : "—"
          }</td>
        </tr>`;
      })
      .join("");

    return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="utf-8" />
  <title>İrsaliye ${s.shipment.shipmentNumber}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 28px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      color: #111;
      background: #fff;
      font-size: 12px;
      line-height: 1.4;
    }
    .doc-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 3px double #222;
      padding-bottom: 14px;
      margin-bottom: 22px;
    }
    .doc-header h1 { margin: 0; font-size: 24px; letter-spacing: 1px; }
    .doc-header .number { font-size: 14px; color: #444; margin-top: 4px; font-family: ui-monospace, Menlo, monospace; }
    .doc-header .right { text-align: right; font-size: 11px; }
    .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 18px; }
    .party { border: 1px solid #ccc; border-radius: 6px; padding: 12px 14px; background: #fafafa; }
    .party-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #666; margin-bottom: 6px; font-weight: 600; }
    .party-name { font-size: 14px; font-weight: 700; margin-bottom: 2px; }
    .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 18px; font-size: 11px; }
    .meta-item { border: 1px solid #e5e5e5; border-radius: 4px; padding: 8px 10px; }
    .meta-label { color: #777; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; }
    .meta-value { font-weight: 600; font-size: 12px; }
    .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 18px; }
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
    .signatures { display: grid; grid-template-columns: repeat(3, 1fr); gap: 36px; margin-top: 44px; }
    .sig { border-top: 1px solid #000; padding-top: 8px; font-size: 11px; text-align: center; font-weight: 600; }
    .doc-footer { margin-top: 28px; border-top: 1px dashed #bbb; padding-top: 10px; font-size: 9px; color: #999; text-align: center; }
    @media print { body { padding: 14px; } }
  </style>
</head>
<body>
  <div class="doc-header">
    <div>
      <h1>SEVK İRSALİYESİ</h1>
      <div class="number">${s.shipment.shipmentNumber}</div>
    </div>
    <div class="right">
      <div><strong>Durum:</strong> ${
        shipmentStatusLabels[s.shipment.status as ShipmentStatus] ??
        s.shipment.status
      }</div>
      <div>Oluşturulma: ${createdAt}</div>
      ${shippedAt ? `<div>Sevk: <strong>${shippedAt}</strong></div>` : ""}
      ${
        s.frozen
          ? `<div style="margin-top:6px; color:#066;">🔒 Dondurulmuş belge</div>`
          : ""
      }
    </div>
  </div>

  <div class="parties">
    <div class="party">
      <div class="party-label">Gönderen</div>
      <div class="party-name">TeksERP Tekstil Fabrikası</div>
      <div class="muted">(Fabrika bilgileri ayarlardan düzenlenir)</div>
    </div>
    <div class="party">
      <div class="party-label">Alıcı</div>
      <div class="party-name">${s.customer.name}</div>
      ${
        s.customer.code
          ? `<div class="muted">Müşteri Kodu: ${s.customer.code}</div>`
          : ""
      }
    </div>
  </div>

  <div class="meta">
    <div class="meta-item">
      <div class="meta-label">Şoför</div>
      <div class="meta-value">${s.shipment.driverName ?? "—"}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Plaka</div>
      <div class="meta-value">${
        s.shipment.plateNumber ? s.shipment.plateNumber.toUpperCase() : "—"
      }</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Taşıyıcı</div>
      <div class="meta-value">${s.shipment.carrier ?? "—"}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Sevk Tarihi</div>
      <div class="meta-value">${shippedAt ?? "—"}</div>
    </div>
  </div>

  <div class="summary">
    <div class="sum-box">
      <div class="sum-num">${s.totals.itemCount}</div>
      <div class="sum-label">Top Sayısı</div>
    </div>
    <div class="sum-box">
      <div class="sum-num">${s.totals.totalQty.toFixed(2)}</div>
      <div class="sum-label">Toplam Metre</div>
    </div>
    <div class="sum-box">
      <div class="sum-num">${s.totals.totalWeight.toFixed(2)}</div>
      <div class="sum-label">Toplam Kg</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:32px">#</th>
        <th>Barkod</th>
        <th>Ürün (Fabrika)</th>
        <th>Müşteri Adı</th>
        <th>Sipariş / İş Emri</th>
        <th class="num">Metraj</th>
        <th class="num">Ağırlık</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
    <tfoot>
      <tr>
        <td colspan="5">TOPLAM</td>
        <td class="num">${s.totals.totalQty.toFixed(2)} mt</td>
        <td class="num">${s.totals.totalWeight.toFixed(2)} kg</td>
      </tr>
    </tfoot>
  </table>

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
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 250);
  };

  const shippedAt = snap?.shipment.shippedAt
    ? new Date(snap.shipment.shippedAt).toLocaleString("tr-TR")
    : null;
  const createdAt = snap
    ? new Date(snap.shipment.createdAt).toLocaleString("tr-TR")
    : "";

  return createPortal(
    <div
      className="fixed inset-0 z-150 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >

      <div className="relative z-10 w-full max-w-5xl max-h-[92vh] flex flex-col rounded-xl border bg-background shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-muted/30">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
              <Printer className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold tracking-tight truncate">
                  İrsaliye
                </h2>
                {snap?.frozen ? (
                  <Badge
                    variant="outline"
                    className="bg-emerald-50 text-emerald-900 border-emerald-300 gap-1"
                  >
                    <Lock className="h-3 w-3" />
                    Dondurulmuş Belge
                  </Badge>
                ) : snap ? (
                  <Badge
                    variant="outline"
                    className="bg-orange-50 text-orange-900 border-orange-300 gap-1"
                  >
                    <Eye className="h-3 w-3" />
                    Önizleme
                  </Badge>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground font-mono truncate">
                {snap?.shipment.shipmentNumber ?? "—"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" onClick={handlePrint} disabled={!snap}>
              <Printer className="h-4 w-4 mr-1" />
              Yazdır
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
              <span className="text-sm">İrsaliye hazırlanıyor...</span>
            </div>
          ) : (
            <div className="mx-auto max-w-[900px] bg-white text-slate-900 rounded-lg shadow-lg p-10">
              {/* Document Header */}
              <div className="flex items-start justify-between border-b-[3px] border-double border-slate-800 pb-4 mb-6">
                <div>
                  <h1 className="text-2xl font-bold tracking-wider">
                    SEVK İRSALİYESİ
                  </h1>
                  <p className="text-sm font-mono text-slate-600 mt-1">
                    {snap.shipment.shipmentNumber}
                  </p>
                </div>
                <div className="text-right text-xs space-y-0.5">
                  <div>
                    <Badge
                      className={`${
                        statusColor[snap.shipment.status] ?? ""
                      } border font-semibold`}
                    >
                      {shipmentStatusLabels[
                        snap.shipment.status as ShipmentStatus
                      ] ?? snap.shipment.status}
                    </Badge>
                  </div>
                  <div className="text-slate-600 pt-1">
                    Oluşturulma: {createdAt}
                  </div>
                  {shippedAt && (
                    <div className="text-slate-700 font-semibold">
                      Sevk: {shippedAt}
                    </div>
                  )}
                  {snap.frozen && (
                    <div className="text-emerald-800 text-[11px] font-semibold pt-1 flex items-center justify-end gap-1">
                      <Lock className="h-3 w-3" /> Dondurulmuş
                    </div>
                  )}
                </div>
              </div>

              {/* Parties */}
              <div className="grid grid-cols-2 gap-4 mb-5">
                <div className="border border-slate-200 rounded-md bg-slate-50 p-3">
                  <div className="text-[10px] uppercase tracking-widest font-semibold text-slate-500 mb-1">
                    Gönderen
                  </div>
                  <div className="font-bold text-sm">
                    TeksERP Tekstil Fabrikası
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    (Fabrika bilgileri ayarlardan düzenlenir)
                  </div>
                </div>
                <div className="border border-slate-200 rounded-md bg-slate-50 p-3">
                  <div className="text-[10px] uppercase tracking-widest font-semibold text-slate-500 mb-1">
                    Alıcı
                  </div>
                  <div className="font-bold text-sm">{snap.customer.name}</div>
                  {snap.customer.code && (
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      Müşteri Kodu: {snap.customer.code}
                    </div>
                  )}
                </div>
              </div>

              {/* Meta */}
              <div className="grid grid-cols-4 gap-2 mb-5">
                <MetaItem
                  label="Şoför"
                  value={snap.shipment.driverName ?? "—"}
                  icon={<User className="h-3 w-3" />}
                />
                <MetaItem
                  label="Plaka"
                  value={
                    snap.shipment.plateNumber
                      ? snap.shipment.plateNumber.toUpperCase()
                      : "—"
                  }
                  icon={<Truck className="h-3 w-3" />}
                />
                <MetaItem
                  label="Taşıyıcı"
                  value={snap.shipment.carrier ?? "—"}
                  icon={<ClipboardList className="h-3 w-3" />}
                />
                <MetaItem
                  label="Sevk Tarihi"
                  value={shippedAt ?? "—"}
                  icon={<Calendar className="h-3 w-3" />}
                />
              </div>

              {/* Summary */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                <SummaryBox
                  num={String(snap.totals.itemCount)}
                  label="Top Sayısı"
                />
                <SummaryBox
                  num={snap.totals.totalQty.toFixed(2)}
                  label="Toplam Metre"
                />
                <SummaryBox
                  num={snap.totals.totalWeight.toFixed(2)}
                  label="Toplam Kg"
                />
              </div>

              {/* Table */}
              <div className="border border-slate-200 rounded-md overflow-hidden mb-6">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-800 text-white">
                      <th className="p-2 text-left w-8">#</th>
                      <th className="p-2 text-left">Barkod</th>
                      <th className="p-2 text-left">Ürün (Fabrika)</th>
                      <th className="p-2 text-left">Müşteri Adı</th>
                      <th className="p-2 text-left">Sipariş / İş Emri</th>
                      <th className="p-2 text-right">Metraj</th>
                      <th className="p-2 text-right">Ağırlık</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snap.items.map((it, idx) => (
                      <tr
                        key={it.id}
                        className={idx % 2 === 0 ? "bg-white" : "bg-slate-50"}
                      >
                        <td className="p-2 text-slate-500">{it.sequence}</td>
                        <td className="p-2 font-mono text-[11px]">
                          {it.rollBarcode}
                        </td>
                        <td className="p-2">
                          <div className="font-semibold">{it.itemCode}</div>
                          <div className="text-[10px] text-slate-500">
                            {it.itemName}
                            {it.variantCode && <> · {it.variantCode}</>}
                          </div>
                        </td>
                        <td className="p-2">
                          {it.customerLabel ? (
                            <>
                              <div className="font-semibold text-blue-900">
                                {it.customerLabel}
                              </div>
                              {it.customerCode && (
                                <div className="text-[10px] text-slate-500">
                                  Kod: {it.customerCode}
                                </div>
                              )}
                            </>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="p-2 text-[11px]">
                          {it.orderNumber && (
                            <div>Sipariş: {it.orderNumber}</div>
                          )}
                          {it.workOrderBatchNumber && (
                            <div className="text-slate-500 text-[10px]">
                              İş Emri: {it.workOrderBatchNumber}
                            </div>
                          )}
                          {!it.orderNumber && !it.workOrderBatchNumber && (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="p-2 text-right font-variant-numeric tabular-nums">
                          {it.shippedQty.toFixed(2)}
                        </td>
                        <td className="p-2 text-right font-variant-numeric tabular-nums">
                          {it.shippedWeight != null
                            ? it.shippedWeight.toFixed(2)
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-100 font-bold border-t-2 border-slate-800">
                      <td colSpan={5} className="p-2.5">
                        TOPLAM
                      </td>
                      <td className="p-2.5 text-right tabular-nums">
                        {snap.totals.totalQty.toFixed(2)} mt
                      </td>
                      <td className="p-2.5 text-right tabular-nums">
                        {snap.totals.totalWeight.toFixed(2)} kg
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Signatures */}
              <div className="grid grid-cols-3 gap-10 mt-10 mb-4">
                {["Teslim Eden", "Taşıyıcı", "Teslim Alan"].map((role) => (
                  <div
                    key={role}
                    className="border-t border-slate-800 pt-2 text-center text-xs font-semibold"
                  >
                    {role}
                  </div>
                ))}
              </div>

              {/* Footer */}
              <div className="mt-6 pt-3 border-t border-dashed border-slate-300 text-center text-[10px] text-slate-400">
                <FileText className="inline h-3 w-3 mr-1" />
                TeksERP — Snapshot: {new Date(snap.snapshotAt).toLocaleString("tr-TR")}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function MetaItem({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="border border-slate-200 rounded p-2 bg-white">
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-slate-500 mb-0.5">
        {icon}
        {label}
      </div>
      <div className="font-semibold text-xs">{value}</div>
    </div>
  );
}

function SummaryBox({ num, label }: { num: string; label: string }) {
  return (
    <div className="rounded-lg border border-slate-300 bg-linear-to-br from-slate-50 to-slate-100 p-3 text-center">
      <div className="text-2xl font-bold text-slate-800 tabular-nums">
        {num}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-slate-600 mt-0.5">
        {label}
      </div>
    </div>
  );
}
