// =============================================================================
// KALİTE GÜVENCE › MUAYENELER (K4P-PANEL)
// =============================================================================
// 4 puan muayenelerinin listesi/özeti/detayı; düzelt ve iptal durum geçişidir (satır silinmez).
// Modül kapalıyken route kapısı `route-modules.ts` eşlemesinden (kaliteGuvenceEnabled); backend 403 MODULE_DISABLED.
// URL: ?rollId=&rollLabel= / ?batchId=&batchLabel= (top/parti kartı), ?focus=<id> (derin bağlantı).
// =============================================================================
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ClipboardPlus } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { InspectionList } from "./InspectionList";
import { InspectionDetailSheet } from "./InspectionDetailSheet";
import { PaperInspectionDialog } from "./PaperInspectionDialog";
import { InspectionReportPicker } from "./InspectionReportPicker";
import { filtersFromSearch, type InspectionFilterState } from "./inspectionRules";
import { RefreshButton } from "@/components/RefreshButton";

export function InspectionsPage() {
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const [filters, setFilters] = useState<InspectionFilterState>(() => filtersFromSearch(sp));
  const [paperOpen, setPaperOpen] = useState(false);
  const openId = sp.get("focus");
  const setOpenId = (id: string | null) => setSp((prev) => { const n = new URLSearchParams(prev); if (id) n.set("focus", id); else n.delete("focus"); return n; }, { replace: true });
  return (
    <PageShell>
      <PageHeader
        className="flex-wrap"
        title="Muayeneler"
        description="4 puan muayeneleri — puan / 100 m², önerilen derece, uyumsuzluk. Düzeltme yeni revizyon yazar; iptal gerekçeyle saklanır."
        actions={
          <>
            <RefreshButton queryKey={["quality-inspections"]} />
            <InspectionReportPicker defaultOpen={sp.get("report") === "1"} />
            <PermissionGate permission="inspection:write">
              <Button onClick={() => setPaperOpen(true)}><ClipboardPlus className="mr-1 h-4 w-4" />Kâğıttan muayene</Button>
            </PermissionGate>
          </>
        }
      />
      <InspectionList f={filters} onFilters={setFilters} onOpen={setOpenId} />
      {paperOpen && (
        <PaperInspectionDialog onOpenChange={setPaperOpen} onCreated={(id) => { setPaperOpen(false); void qc.invalidateQueries({ queryKey: ["quality-inspections"] }); setOpenId(id); }} />
      )}
      {openId && <InspectionDetailSheet id={openId} onClose={() => setOpenId(null)} onOpen={setOpenId} />}
    </PageShell>
  );
}
