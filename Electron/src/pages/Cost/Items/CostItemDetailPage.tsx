// =============================================================================
// MALİYET › MALİYET KARTI (MAL-3, plan §5) — sekmeler Yapı · Döküm · Sürümler. Döküm canlı önizlemedir
// (`POST /api/cost/preview`, ~400 ms durulma, YAZMAZ); Sürümler kayıtlı (donmuş) sayıları okur.
// =============================================================================
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Currency } from "@/pages/Finance/service";
import { CostQueryError } from "../shared/CostQueryState";
import { fxBody } from "../shared/FxRateInputs";
import { STRUCTURE_STATUS_LABEL } from "../shared/labels";
import { missingFields } from "../shared/missing-targets";
import { useCostPreview } from "../shared/useCostPreview";
import { BreakdownTab } from "./BreakdownTab";
import { SaveVersionDialog } from "./SaveVersionDialog";
import { StructureTab } from "./StructureTab";
import { VersionsTab } from "./VersionsTab";
import { costItemService } from "./service";
import { useCostVariants } from "./variant-scope";

export function CostItemDetailPage() {
  const { itemId = "" } = useParams();
  const [tab, setTab] = useState("breakdown");
  const [fx, setFx] = useState<Partial<Record<Currency, string>>>({});
  const [saveOpen, setSaveOpen] = useState(false);
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const detail = useQuery({ queryKey: ["cost-items", "detail", itemId], queryFn: () => costItemService.detail(itemId), enabled: !!itemId });
  const fxRates = fxBody(fx);
  const variants = useCostVariants(itemId);
  const preview = useCostPreview(itemId ? { itemId, fxRates } : null);
  const d = detail.data;
  return (
    <PageShell>
      <PageHeader
        title={d ? `${d.urun.kod} — Maliyet kartı` : "Maliyet kartı"}
        description={d ? d.urun.ad : undefined}
        actions={d && (
          <div className="flex gap-1">
            <Badge variant="muted">{STRUCTURE_STATUS_LABEL[d.yapiDurumu] ?? d.yapiDurumu}</Badge>
            {d.girdiDegisti && <Badge variant="muted" className="bg-amber-500/15 text-amber-700 dark:text-amber-300">Girdi değişti</Badge>}
          </div>
        )}
      />
      <PageBody className="p-4 sm:p-6">
        {detail.isLoading ? (
          <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        ) : detail.isError || !d ? (
          <CostQueryError error={detail.error} what="Maliyet kartı" onRetry={() => void detail.refetch()} />
        ) : (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="structure">Yapı</TabsTrigger>
              <TabsTrigger value="breakdown">Döküm</TabsTrigger>
              <TabsTrigger value="versions">Sürümler</TabsTrigger>
            </TabsList>
            <TabsContent value="structure" className="mt-4">
              <StructureTab key={d.yapi ? JSON.stringify(d.yapi) : "bos"} detail={d} measured={preview.data?.oneriler.warpWaste ?? null} flagged={flagged} />
            </TabsContent>
            <TabsContent value="breakdown" className="mt-4">
              <BreakdownTab preview={preview.data} loading={preview.isFetching} fx={fx} onFx={(c, v) => setFx((x) => ({ ...x, [c]: v }))}
                fxFlagged={flagged.has("fx")} onSave={() => setSaveOpen(true)} />
              {preview.isError && <CostQueryError error={preview.error} what="Önizleme" onRetry={() => void preview.refetch()} />}
            </TabsContent>
            <TabsContent value="versions" className="mt-4"><VersionsTab itemId={itemId} active={d.aktifSurum} variants={variants} /></TabsContent>
          </Tabs>
        )}
      </PageBody>
      {saveOpen && <SaveVersionDialog itemId={itemId} fxRates={fxRates} variants={variants} onClose={() => setSaveOpen(false)} onMissing={(m) => setFlagged(missingFields(m))} />}
    </PageShell>
  );
}
