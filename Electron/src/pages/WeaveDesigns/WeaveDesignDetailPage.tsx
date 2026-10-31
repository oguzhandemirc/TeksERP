// DESEN KARTI sayfası (SY-A3, tasarım §2.8): beş sekme — Yapı · Atkı sırası · Armür · Varyantlar · Maliyet.
// Atkı/varyant/çözgü katmanı KUMAŞ başına tutulur (desen N kumaşı besler) → üstte kumaş seçimi.
// Maliyet sekmesi `cost:read` + `maliyetEnabled` yoksa çizilmez (koşulsuz 403 verecek sorgu atılmaz).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { PageBody, PageShell } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useOperationsVisibilityContext } from "@/pages/Operations/useOperationsVisibility";
import { FabricChooser } from "./FabricChooser";
import { listDesignFabrics, weaveDesignApi } from "./service";
import { CostTab } from "./tabs/CostTab";
import { LiftPlanTab } from "./tabs/LiftPlanTab";
import { StructureTab } from "./tabs/StructureTab";
import { VariantsTab } from "./tabs/VariantsTab";
import { WeftTab } from "./tabs/WeftTab";
import { WEAVE_KIND_LABEL } from "./types";

export function WeaveDesignDetailPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const { hasPermission } = useRoleAccess();
  const { maliyetEnabled } = useOperationsVisibilityContext();
  const canWrite = hasPermission("warpspec:write");
  const showCost = maliyetEnabled && hasPermission("cost:read");
  const [tab, setTab] = useState("structure");
  const [chosen, setChosen] = useState<string | null>(null);
  const design = useQuery({ queryKey: ["weave-designs", "detail", id], queryFn: () => weaveDesignApi.get(id), enabled: !!id });
  const fabrics = useQuery({ queryKey: ["weave-designs", "fabrics", id], queryFn: () => listDesignFabrics(id), enabled: !!id });
  const fabricList = fabrics.data ?? [];
  const fabric = fabricList.find((f) => f.id === chosen) ?? fabricList[0] ?? null;
  const toggleActive = useMutation({
    mutationFn: () => (design.data?.isActive ? weaveDesignApi.deactivate(id) : weaveDesignApi.activate(id)),
    onSuccess: (r) => {
      toast.success(r.message ?? "Desen kartı güncellendi.");
      void qc.invalidateQueries({ queryKey: ["weave-designs"] });
    },
  });
  const d = design.data;
  return (
    <PageShell>
      <PageHeader
        title={d ? `${d.code} — Desen kartı` : "Desen kartı"}
        description={d ? `${d.name} · ${WEAVE_KIND_LABEL[d.kind] ?? d.kind}` : undefined}
        actions={d && (
          <div className="flex items-center gap-2">
            {d.isActive ? <Badge variant="default">Aktif</Badge> : <Badge variant="muted">Pasif</Badge>}
            {canWrite && (
              <Button size="sm" variant="outline" disabled={toggleActive.isPending} onClick={() => toggleActive.mutate()}>
                {d.isActive ? "Pasife al" : "Aktif et"}
              </Button>
            )}
          </div>
        )}
      />
      <PageBody className="min-h-0 space-y-4 p-4 sm:p-6">
        {design.isLoading ? (
          <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        ) : !d ? (
          <p className="text-sm text-muted-foreground">Desen kartı bulunamadı.</p>
        ) : (
          <>
            <FabricChooser fabrics={fabricList} loading={fabrics.isLoading} selectedId={fabric?.id ?? null} onSelect={setChosen} />
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="max-w-full justify-start overflow-x-auto">
                <TabsTrigger value="structure">Yapı</TabsTrigger>
                <TabsTrigger value="weft">Atkı sırası</TabsTrigger>
                <TabsTrigger value="lift">Armür</TabsTrigger>
                <TabsTrigger value="variants">Varyantlar</TabsTrigger>
                {showCost && <TabsTrigger value="cost">Maliyet</TabsTrigger>}
              </TabsList>
              <TabsContent value="structure" className="mt-4">
                <StructureTab key={d.id + (d.repeatCm ?? "") + d.name} design={d} fabric={fabric} canWrite={canWrite} />
              </TabsContent>
              <TabsContent value="weft" className="mt-4"><WeftTab fabric={fabric} canWrite={canWrite} /></TabsContent>
              <TabsContent value="lift" className="mt-4">
                <LiftPlanTab key={d.id + JSON.stringify(d.liftPlan ?? null)} design={d} canWrite={canWrite} />
              </TabsContent>
              <TabsContent value="variants" className="mt-4"><VariantsTab fabric={fabric} /></TabsContent>
              {showCost && <TabsContent value="cost" className="mt-4"><CostTab fabrics={fabricList} /></TabsContent>}
            </Tabs>
          </>
        )}
      </PageBody>
    </PageShell>
  );
}
