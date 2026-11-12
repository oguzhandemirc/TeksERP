// Üretim önerisi diyaloğunun bölümleri (SY-M3, §14.8): dokuma işleri · terbiye iş emirleri · leventler · dışarıda kalanlar.
// Her kayıt ayrı seçilir; izinsiz tür "izniniz yok" ile seçilemez; levent önerisi bilgi amaçlıdır (yaratılmaz).
import type { ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Callout } from "@/components/ui/callout";
import { SectionCard } from "@/components/ui/section-card";
import { TERIM } from "@/lib/terim";
import { ProposalInsights } from "./ProposalInsights";
import { shrinkSourceText, wasteNote } from "./insight-text";
import { excludedKindLabel, excludedReason, parsePlannedM, type ProposalSelection } from "./selection";
import type { BeamNeed, ProductionProposal, WeavingProposal, WorkOrderProposal } from "./types";
import { formatMeasure, formatPercent } from "@/lib/format";

const fmt = (n: number | null | undefined, unit = "m") => formatMeasure(n, unit);

export type LineLabel = (orderLineId: string) => string;

// Diyalog bölümü: ortak bölüm kartı, liste kenardan kenara (satır ayırıcıları kartın içinde).
function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <SectionCard title={title} description={hint} flush>
      {children}
    </SectionCard>
  );
}

const ROW = "flex items-start gap-3 border-t border-card-border px-5 py-2.5 text-sm";

interface WeavingProps {
  rows: WeavingProposal[];
  sel: ProposalSelection;
  canCreate: boolean;
  lineLabel: LineLabel;
  onToggle: (key: string) => void;
  onPlannedM: (key: string, text: string) => void;
  /** Uygulanan dokuma firesi % (üst düzey; eski backend göndermez). */
  wastePct?: number | null;
}

export function WeavingSection({ rows, sel, canCreate, lineLabel, onToggle, onPlannedM, wastePct }: WeavingProps) {
  if (rows.length === 0) return null;
  const waste = wasteNote(wastePct ?? rows[0]?.weavingWastePct);
  const hint = canCreate ? `Plan metresi = açık metre ÷ (1 − çekme)${waste ? `; ${waste}` : ""}; düzeltebilirsiniz.` : "Dokuma iş emri oluşturma izniniz yok.";
  return (
    <Section title={`${TERIM.dokumaIsEmri.cogul} (${rows.length})`} hint={hint}>
      <ul>
        {rows.map((w) => {
          const text = sel.plannedM.get(w.key) ?? (w.plannedM == null ? "" : String(w.plannedM));
          const invalid = Number.isNaN(parsePlannedM(text));
          return (
            <li key={w.key} className={ROW}>
              <Checkbox className="mt-0.5" checked={sel.weaving.has(w.key)} disabled={!canCreate} onCheckedChange={() => onToggle(w.key)} aria-label={`${w.itemName} ${TERIM.dokumaIsEmri.cekim.belirtme} seç`} />
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="font-medium">{w.itemName}</div>
                <div className="text-xs text-muted-foreground">
                  {w.orderLines.map((l) => lineLabel(l.orderLineId)).join(" · ")}
                  {w.shrinkPct != null && ` · çekme ${formatPercent(w.shrinkPct, 2)}${shrinkSourceText(w.shrinkSource) ? ` (${shrinkSourceText(w.shrinkSource)})` : ""}`}
                </div>
                <ProposalInsights w={w} />
              </div>
              <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                Plan m
                <Input value={text} onChange={(e) => onPlannedM(w.key, e.target.value)} disabled={!canCreate} inputMode="decimal" aria-invalid={invalid} className="h-8 w-24 text-right tabular-nums" />
              </label>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

interface WorkOrderProps {
  rows: WorkOrderProposal[];
  sel: ProposalSelection;
  canCreate: boolean;
  lineLabel: LineLabel;
  onToggle: (key: string) => void;
}

export function WorkOrderSection({ rows, sel, canCreate, lineLabel, onToggle }: WorkOrderProps) {
  if (rows.length === 0) return null;
  return (
    <Section title={`${TERIM.terbiyeIsEmri.cumleBasiCogul.yalin} (${rows.length})`} hint={canCreate ? "Grup: kumaş + renk + en (toplu eylemle aynı kural)." : `${TERIM.terbiyeIsEmri.cumleBasi.yalin} oluşturma izniniz yok.`}>
      <ul>
        {rows.map((w) => (
          <li key={w.key} className={ROW}>
            <Checkbox className="mt-0.5" checked={sel.workOrders.has(w.key)} disabled={!canCreate || w.blockedCode != null} onCheckedChange={() => onToggle(w.key)} aria-label={`${w.itemName} ${TERIM.terbiyeIsEmri.cekimKucuk.belirtme} seç`} />
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="font-medium">
                {w.itemName} {w.width != null && <span className="font-normal text-muted-foreground">· {fmt(w.width, "cm")}</span>}
              </div>
              <div className="text-xs text-muted-foreground">{w.orderLines.map((l) => lineLabel(l.orderLineId)).join(" · ")}</div>
              {w.blockedCode && <Callout tone="warning" className="mt-1 p-2">{excludedReason(w.blockedCode)}</Callout>}
            </div>
            <span className="shrink-0 text-sm font-medium tabular-nums">{fmt(w.targetQuantity)}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function beamText(b: BeamNeed): string {
  if (b.beamMode === "CREEL") return "cağlık — levent yok";
  if (!b.ownBeam) return "zemin leventinde";
  if (b.proposedBeams) return `eksik ${fmt(b.shortfallM)} → ${b.proposedBeams.count} × ${fmt(b.proposedBeams.lengthM)} levent planlanmalı`;
  return `hazır/takılı ${fmt(b.availableM)} yeter`;
}

export function BeamSection({ rows }: { rows: WeavingProposal[] }) {
  const needs = rows.flatMap((w) => (w.beamNeeds ?? []).map((b) => ({ w, b })));
  if (needs.length === 0) return null;
  return (
    <Section title="Levent ihtiyacı" hint="Bilgi amaçlı — levent planı buradan oluşturulmaz.">
      <ul>
        {needs.map(({ w, b }) => (
          <li key={`${w.key}:${b.role}:${b.warpSpecId}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-card-border px-5 py-2 text-xs">
            <span className="font-medium">{w.itemName}</span>
            <span className="font-mono">{b.warpSpecCode}</span>
            <span className="tabular-nums text-muted-foreground">gerekli {fmt(b.requiredM)}</span>
            <span className={b.proposedBeams ? "text-warning" : "text-muted-foreground"}>{beamText(b)}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function ExcludedSection({ rows, lineLabel }: { rows: ProductionProposal["excluded"]; lineLabel: LineLabel }) {
  if (rows.length === 0) return null;
  return (
    <Callout tone="muted" title={`Öneri dışında kalanlar (${rows.length})`}>
      <ul className="space-y-0.5">
        {rows.map((x) => (
          <li key={`${x.kind}:${x.orderLineId}:${x.code}`}>
            {excludedKindLabel(x.kind)} · {lineLabel(x.orderLineId)} — {excludedReason(x.code)}
          </li>
        ))}
      </ul>
    </Callout>
  );
}
