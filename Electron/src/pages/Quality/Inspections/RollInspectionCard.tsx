// Top detayındaki salt-okunur "Muayene" kartı: aktif muayene özeti + Muayeneler ekranına bağlantı.
// Modül kapalıysa ya da izin yoksa HİÇ çizilmez (istek de atılmaz) — bayrak kapalı kurulum bugünküyle aynı.
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Gauge } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useOperationsVisibilityContext } from "@/pages/Operations/useOperationsVisibility";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import { inspectionService } from "./service";
import { PHASE_LABEL, numText } from "./inspectionRules";

export function inspectionsHref(p: { rollId?: string; rollLabel?: string | null; batchId?: string; batchLabel?: string | null; focus?: string }): string {
  const sp = new URLSearchParams();
  if (p.rollId) { sp.set("rollId", p.rollId); if (p.rollLabel) sp.set("rollLabel", p.rollLabel); }
  if (p.batchId) { sp.set("batchId", p.batchId); if (p.batchLabel) sp.set("batchLabel", p.batchLabel); }
  if (p.focus) sp.set("focus", p.focus);
  return `/quality/inspections?${sp.toString()}`;
}

/** Modül + izin kapısı — kart ve bağlantı aynı yüklemi kullanır. */
export function useInspectionsVisible(): boolean {
  const { kaliteGuvenceEnabled } = useOperationsVisibilityContext();
  const { hasPermission } = useRoleAccess();
  return kaliteGuvenceEnabled && hasPermission("inspection:read");
}

export function RollInspectionCard({ rollId, barcode }: { rollId: string; barcode: string | null }) {
  const enabled = useInspectionsVisible();
  const q = useQuery({ queryKey: ["quality-inspections", "card", rollId], queryFn: () => inspectionService.list({ rollId, limit: 5 }), enabled });
  if (!enabled) return null;
  const rows = q.data?.items ?? [];
  return (
    <section className="rounded-md border p-3 text-sm" aria-label="Muayene">
      <div className="mb-2 flex items-center gap-2">
        <Gauge className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-medium">Muayene</h3>
        <Link className="ml-auto text-xs text-primary underline-offset-2 hover:underline" to={inspectionsHref({ rollId, rollLabel: barcode })}>Muayeneler</Link>
      </div>
      {q.isLoading ? <p className="text-xs text-muted-foreground">Yükleniyor…</p>
        : q.isError ? <p className="text-xs text-destructive">Muayene okunamadı.</p>
        : rows.length === 0 ? <p className="text-xs text-muted-foreground">Bu topun aktif muayenesi yok.</p>
        : (
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.id}>
                <Link to={inspectionsHref({ rollId, rollLabel: barcode, focus: r.id })} className="flex flex-wrap items-center gap-2 py-1.5 hover:bg-muted/40">
                  <span>{PHASE_LABEL[r.phase]}</span>
                  <span className="tabular-nums">{r.totalPoints} puan · {numText(r.pointsPer100M2)} /100 m²</span>
                  <span className="text-xs text-muted-foreground">{fmtFactoryDateTime(r.inspectedAt)}</span>
                  <span className="ml-auto flex gap-1">
                    {r.gradeMismatch && <Badge variant="destructive">Uyumsuz</Badge>}
                    <Badge variant="outline">{r.suggestedGradeCode ?? "—"}</Badge>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}

/** Parti satırındaki "Muayeneler" bağlantısı (parti seçici modal yok — parti kartından açılır, KARARLAR 04:30). */
export function BatchInspectionsLink({ batchId, batchLabel }: { batchId: string; batchLabel: string }) {
  if (!useInspectionsVisible()) return null;
  return (
    <Link className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline" to={inspectionsHref({ batchId, batchLabel })}>
      <Gauge className="h-3.5 w-3.5" />Muayeneler
    </Link>
  );
}
