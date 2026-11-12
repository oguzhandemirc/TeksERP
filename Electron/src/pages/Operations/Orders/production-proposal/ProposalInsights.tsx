// Dokuma grubunun altındaki en çok üç kısa karar satırı (tezgâh · iplik · süre) + aynı diyalogda açılıp kapanan ayrıntı.
// Null özet satır çizmez; üçü de yoksa bileşen hiç çizilmez (eski backend dahil).
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { WidthWarningBadge } from "@/pages/Operations/WeavingOrders/loom-suggestion/LoomSuggestionParts";
import { durationInputsText, durationLine, formatKg, loomCountsText, loomLine, yarnLine } from "./insight-text";
import type { WeavingProposal } from "./types";
import { TERIM } from "@/lib/terim";

export function ProposalInsights({ w }: { w: WeavingProposal }) {
  const [open, setOpen] = useState(false);
  const loom = loomLine(w.loomSummary);
  const counts = loomCountsText(w.loomSummary);
  const yarn = yarnLine(w.yarnSummary);
  const duration = durationLine(w.durationEstimate);
  if (!loom && !yarn && !duration) return null;
  const yarns = w.yarnSummary?.yarns ?? [];
  const d = w.durationEstimate ?? null;
  const hasDetail = yarns.length > 0 || d != null;
  // SY-3 I1: ayırma ayarı açıkken sunucu `reservedKg`/`freeKg` ekler; kapalıyken (ya da eski backend) sütun yok.
  const reserved = yarns.some((y) => y.reservedKg !== undefined);
  const shortTone = (w.yarnSummary?.totalShortKg ?? 0) > 0;
  const machineCode = d && w.loomSummary?.best.machineId === d.machineId ? w.loomSummary.best.code : null;
  return (
    <div className="mt-1.5 space-y-1 text-xs" data-testid="proposal-insights">
      {loom && (
        <InsightRow label="Tezgâh:">
          <span className={w.loomSummary?.best.tier === "READY" ? "" : "text-warning"}>{loom}</span>
          {w.loomSummary?.best.widthWarning && <WidthWarningBadge />}
          {counts && <span className="text-muted-foreground">({counts})</span>}
        </InsightRow>
      )}
      {yarn && (
        <InsightRow label="İplik:">
          <span className={shortTone ? "text-warning" : ""}>{yarn}</span>
        </InsightRow>
      )}
      {duration && (
        <InsightRow label="Süre:">
          <span className={d?.weavingOnlyFitsDeadline === false ? "text-warning" : ""}>{duration}</span>
        </InsightRow>
      )}
      {hasDetail && (
        <Button type="button" variant="link" className="h-auto p-0 text-xs" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "ayrıntıyı gizle" : "ayrıntı"}
        </Button>
      )}
      {open && (
        <div className="space-y-1.5 rounded-lg border border-card-border bg-muted/30 p-2.5" data-testid="proposal-insights-detail">
          {yarns.length > 0 && (
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="text-left font-normal">İplik</th>
                  <th className="text-right font-normal">Gereken</th>
                  {reserved && <th className="text-right font-normal" title={`Açık ${TERIM.dokumaIsEmri.cogulCekimKucuk.ilgi} kalan metresi için ayrılan (tesis geneli)`}>Ayrılan</th>}
                  {reserved && <th className="text-right font-normal" title="Serbest stok − ayrılan">Serbest</th>}
                  <th className="text-right font-normal">Eksik</th>
                </tr>
              </thead>
              <tbody>
                {yarns.map((y) => (
                  <tr key={y.yarnItemId}>
                    <td>
                      <span className="font-mono">{y.code}</span> {y.name}
                      {y.wasteSource === "IPLIK" && <span className="ml-1 text-muted-foreground" title="Bu iplik kartına girilen fire yüzdesiyle hesaplandı">(iplik firesi)</span>}
                    </td>
                    <td className="text-right tabular-nums">{formatKg(y.needKg)}</td>
                    {reserved && <td className="text-right tabular-nums">{y.reservedKg ? formatKg(y.reservedKg) : "—"}</td>}
                    {reserved && <td className={y.freeKg != null && y.freeKg < 0 ? "text-right tabular-nums text-warning" : "text-right tabular-nums"}>{y.freeKg == null ? "bilinmiyor" : formatKg(y.freeKg)}</td>}
                    <td className="text-right tabular-nums">{y.shortKg == null ? "bilinmiyor" : y.shortKg > 0 ? formatKg(y.shortKg) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {w.yarnSummary && !w.yarnSummary.sources.stock && <p className="text-muted-foreground">Stok bilinmiyor (iplik modülü kapalı); eksik hesaplanmadı.</p>}
          {d && <p className="text-muted-foreground">Süre hesabı: {durationInputsText(d, machineCode)}</p>}
        </div>
      )}
    </div>
  );
}

// Etiket sütunu sabit genişlikte: üç karar satırı alt alta hizalı okunur.
function InsightRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-12 shrink-0 text-muted-foreground">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}
