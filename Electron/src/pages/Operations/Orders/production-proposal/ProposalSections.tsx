// Üretim önerisi diyaloğunun bölümleri (SY-M3, §14.8): dokuma işleri · terbiye iş emirleri · leventler · dışarıda kalanlar.
// Her kayıt ayrı seçilir; izinsiz tür "izniniz yok" ile seçilemez; levent önerisi bilgi amaçlıdır (yaratılmaz).
import type { ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { TERIM } from "@/lib/terim";
import { excludedKindLabel, excludedReason, parsePlannedM, type ProposalSelection } from "./selection";
import type { BeamNeed, ProductionProposal, WeavingProposal, WorkOrderProposal } from "./types";

const fmt = (n: number | null | undefined, unit = "m") => (n == null ? "—" : `${n.toLocaleString("tr-TR", { maximumFractionDigits: 1 })} ${unit}`);

export type LineLabel = (orderLineId: string) => string;

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h4 className="text-sm font-medium">{title}</h4>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {children}
    </section>
  );
}

interface WeavingProps {
  rows: WeavingProposal[];
  sel: ProposalSelection;
  canCreate: boolean;
  lineLabel: LineLabel;
  onToggle: (key: string) => void;
  onPlannedM: (key: string, text: string) => void;
}

export function WeavingSection({ rows, sel, canCreate, lineLabel, onToggle, onPlannedM }: WeavingProps) {
  if (rows.length === 0) return null;
  return (
    <Section title={`${TERIM.dokumaIsEmri.cogul} (${rows.length})`} hint={canCreate ? "Plan metresi = açık metre ÷ (1 − çekme); düzeltebilirsiniz." : "Dokuma iş emri oluşturma izniniz yok."}>
      <ul className="divide-y rounded-md border">
        {rows.map((w) => {
          const text = sel.plannedM.get(w.key) ?? (w.plannedM == null ? "" : String(w.plannedM));
          const invalid = Number.isNaN(parsePlannedM(text));
          return (
            <li key={w.key} className="flex items-start gap-2 p-2 text-sm">
              <Checkbox checked={sel.weaving.has(w.key)} disabled={!canCreate} onCheckedChange={() => onToggle(w.key)} aria-label={`${w.itemName} ${TERIM.dokumaIsEmri.cekim.belirtme} seç`} />
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="font-medium">{w.itemName}</div>
                <div className="text-xs text-muted-foreground">
                  {w.orderLines.map((l) => lineLabel(l.orderLineId)).join(" · ")}
                  {w.shrinkPct != null && ` · çekme %${w.shrinkPct}`}
                </div>
              </div>
              <label className="flex items-center gap-1 text-xs">
                Plan m
                <Input value={text} onChange={(e) => onPlannedM(w.key, e.target.value)} disabled={!canCreate} inputMode="decimal" aria-invalid={invalid} className="h-7 w-24" />
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
    <Section title={`Terbiye iş emirleri (${rows.length})`} hint={canCreate ? "Grup: kumaş + renk + en (toplu eylemle aynı kural)." : "Terbiye iş emri oluşturma izniniz yok."}>
      <ul className="divide-y rounded-md border">
        {rows.map((w) => (
          <li key={w.key} className="flex items-start gap-2 p-2 text-sm">
            <Checkbox checked={sel.workOrders.has(w.key)} disabled={!canCreate || w.blockedCode != null} onCheckedChange={() => onToggle(w.key)} aria-label={`${w.itemName} terbiye iş emrini seç`} />
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="font-medium">
                {w.itemName} {w.width != null && <span className="text-muted-foreground">· {w.width} cm</span>}
              </div>
              <div className="text-xs text-muted-foreground">{w.orderLines.map((l) => lineLabel(l.orderLineId)).join(" · ")}</div>
              {w.blockedCode && <div className="text-xs text-destructive">{excludedReason(w.blockedCode)}</div>}
            </div>
            <span className="text-xs tabular-nums">{fmt(w.targetQuantity)}</span>
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
      <ul className="divide-y rounded-md border">
        {needs.map(({ w, b }) => (
          <li key={`${w.key}:${b.role}:${b.warpSpecId}`} className="flex flex-wrap items-center gap-2 p-2 text-xs">
            <span className="font-medium">{w.itemName}</span>
            <span className="font-mono">{b.warpSpecCode}</span>
            <span className="text-muted-foreground">gerekli {fmt(b.requiredM)}</span>
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
    <Section title={`Öneri dışında kalanlar (${rows.length})`}>
      <ul className="space-y-0.5 text-xs text-muted-foreground">
        {rows.map((x) => (
          <li key={`${x.kind}:${x.orderLineId}:${x.code}`}>
            {excludedKindLabel(x.kind)} · {lineLabel(x.orderLineId)} — {excludedReason(x.code)}
          </li>
        ))}
      </ul>
    </Section>
  );
}
