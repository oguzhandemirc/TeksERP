import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, Lock } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { factoryLocaleString } from "@/lib/factory-time";
import { cn } from "@/lib/utils";
import { apiErrorMessage } from "@/services/apiClient";
import { documentTemplateService, type SampleSourceRow } from "@/services/documentTemplateService";
import type { ContractView } from "../binding/contract";
import type { PreviewSample } from "./usePreview";

export const NO_READ_PERMISSION_REASON = "Bu belge türünü okuma izniniz yok — gerçek kayıttan örnek seçilemez.";

function isForbidden(e: unknown): boolean {
  return (e as { response?: { status?: number } } | null)?.response?.status === 403;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contract: ContractView | null;
  current: PreviewSample | null;
  onPick: (s: PreviewSample, recordNo?: string | null) => void;
}

/** Örnek veri seçici (plan §4): senaryolar + "Gerçek kayıttan…" araması; doğrudan modal. */
export function SamplePickerModal({ open, onOpenChange, contract, current, onPick }: Props) {
  const [q, setQ] = useState("");
  const docType = contract?.docType ?? "";
  const sources = useQuery({
    queryKey: ["document-templates", "sample-sources", docType, q],
    queryFn: () => documentTemplateService.sampleSources(docType, q.trim()),
    enabled: open && !!docType,
    retry: false,
  });
  const pick = (s: PreviewSample, no?: string | null) => {
    onPick(s, no);
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Örnek veri seç</DialogTitle>
          <DialogDescription>Önizleme bu veriyle çizilir; şablon kaydedilmez.</DialogDescription>
        </DialogHeader>
        <section className="space-y-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Örnek senaryolar</h4>
          {(contract?.senaryolar ?? []).map((s) => {
            const active = current?.kind === "senaryo" && current.key === s.ad;
            return (
              <button key={s.ad} type="button" onClick={() => pick({ kind: "senaryo", key: s.ad })}
                className={cn("flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-muted", active && "border-primary bg-primary/5")}>
                <Check className={cn("mt-0.5 h-4 w-4 shrink-0", active ? "text-primary" : "invisible")} />
                <span><span className="font-medium">{s.aciklama || s.ad}</span><span className="ml-2 font-mono text-[11px] text-muted-foreground">{s.ad}</span></span>
              </button>
            );
          })}
        </section>
        <section className="space-y-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Gerçek kayıttan…</h4>
          <RecordSources forbidden={isForbidden(sources.error)} q={q} onQ={setQ} loading={sources.isLoading}
            error={sources.error && !isForbidden(sources.error) ? apiErrorMessage(sources.error, "Kayıtlar alınamadı") : null}
            rows={sources.data?.data ?? []} current={current} onPick={(r) => pick({ kind: "kayit", sourceId: r.sourceId }, r.documentNo)} />
        </section>
      </DialogContent>
    </Dialog>
  );
}

interface RecordProps {
  forbidden: boolean;
  q: string;
  onQ: (q: string) => void;
  loading: boolean;
  error: string | null;
  rows: SampleSourceRow[];
  current: PreviewSample | null;
  onPick: (r: SampleSourceRow) => void;
}

/** İzin yoksa seçenek GİZLENMEZ: pasif gösterilir, gerekçesi yazılır. */
function RecordSources({ forbidden, q, onQ, loading, error, rows, current, onPick }: RecordProps) {
  if (forbidden) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground" aria-disabled="true" data-testid="gercek-kayit-pasif">
        <Lock className="h-4 w-4 shrink-0" /> {NO_READ_PERMISSION_REASON}
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <Input value={q} onChange={(e) => onQ(e.target.value)} placeholder="Belge no ile ara" aria-label="Belge no ile ara" className="h-8 text-sm" />
      {loading && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Aranıyor…</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {!loading && !error && rows.length === 0 && <p className="text-xs text-muted-foreground">Basılmış etkin belge bulunamadı.</p>}
      {rows.map((r) => {
        const active = current?.kind === "kayit" && current.sourceId === r.sourceId;
        return (
          <button key={r.id} type="button" onClick={() => onPick(r)}
            className={cn("flex w-full items-center justify-between rounded-md border px-3 py-1.5 text-left text-sm hover:bg-muted", active && "border-primary bg-primary/5")}>
            <span className="font-medium">{r.documentNo ?? "Numarasız"} <span className="text-xs text-muted-foreground">· sürüm {r.version}</span></span>
            <span className="text-xs text-muted-foreground">{factoryLocaleString(r.createdAt)}</span>
          </button>
        );
      })}
    </div>
  );
}
