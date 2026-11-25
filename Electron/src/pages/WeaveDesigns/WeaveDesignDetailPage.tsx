// DESEN KARTI sayfası (SY-A3, tasarım §2.8): beş sekme — Yapı · Atkı sırası · Armür · Varyantlar · Maliyet.
// Atkı/varyant/çözgü katmanı KUMAŞ başına tutulur (desen N kumaşı besler) → üstte kumaş seçimi.
// Maliyet sekmesi `cost:read` + `maliyetEnabled` yoksa çizilmez (koşulsuz 403 verecek sorgu atılmaz).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router-dom";
import { PageBody, PageShell } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useOperationsVisibilityContext } from "@/pages/Operations/useOperationsVisibility";
import { FabricChooser } from "./FabricChooser";
import { TechSummaryStrip } from "./TechSummaryStrip";
import { WeaveDesignHeaderActions } from "./WeaveDesignHeaderActions";
import { listDesignFabrics, weaveDesignApi } from "./service";
import { CostTab } from "./tabs/CostTab";
import { LiftPlanTab } from "./tabs/LiftPlanTab";
import { StructureTab } from "./tabs/StructureTab";
import { VariantsTab } from "./tabs/VariantsTab";
import { WeftTab } from "./tabs/WeftTab";
import { useOpenItemCard, type ItemCardTab } from "@/pages/Items/useOpenItemCard";
import { SHED_MECHANISM_LABEL, resolveWeaveClass, weaveClassLabel } from "./weave-class";

const DETAIL_TABS = new Set(["structure", "weft", "lift", "variants"]);

export function WeaveDesignDetailPage() {
  const { id = "" } = useParams();
  const { hasPermission } = useRoleAccess();
  const { maliyetEnabled } = useOperationsVisibilityContext();
  const canWrite = hasPermission("warpspec:write");
  const showCost = maliyetEnabled && hasPermission("cost:read");
  // Dış bağlantı (dokuma iş emri "Yapı") `?tab=lift&fabric=<itemId>` ile doğrudan Armür sekmesini açar.
  const [params] = useSearchParams();
  const [tab, setTab] = useState(() => (DETAIL_TABS.has(params.get("tab") ?? "") ? params.get("tab")! : "structure"));
  const [chosen, setChosen] = useState<string | null>(() => params.get("fabric"));
  const design = useQuery({ queryKey: ["weave-designs", "detail", id], queryFn: () => weaveDesignApi.get(id), enabled: !!id });
  const fabrics = useQuery({ queryKey: ["weave-designs", "fabrics", id], queryFn: () => listDesignFabrics(id), enabled: !!id });
  const fabricList = fabrics.data ?? [];
  const fabric = fabricList.find((f) => f.id === chosen) ?? fabricList[0] ?? null;
  const d = design.data;
  // D3/K7: atkı, varyant ve ek çözgü kumaşa aittir → burada salt okunur; "Üründe aç" kumaşın ürün penceresini ilgili sekmede açar.
  const itemCard = useOpenItemCard();
  const openItem = (t: ItemCardTab) => (fabric ? () => itemCard.open(fabric, t) : undefined);
  return (
    <PageShell>
      <PageHeader
        title={d ? `${d.code} — Desen kartı` : "Desen kartı"}
        statusLine={d ? `${d.name} · ${weaveClassLabel(d)}` : undefined}
        actions={d && <WeaveDesignHeaderActions design={d} fabric={fabric} canWrite={canWrite} />}
      />
      <PageBody className="min-h-0 space-y-4 p-4 sm:p-6">
        {design.isLoading ? (
          <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        ) : !d ? (
          <p className="text-sm text-muted-foreground">Desen kartı bulunamadı.</p>
        ) : (
          <>
            <FabricChooser fabrics={fabricList} loading={fabrics.isLoading} selectedId={fabric?.id ?? null} onSelect={setChosen} />
            <TechSummaryStrip fabric={fabric} frameCount={resolveWeaveClass(d).shedMechanism === "DOBBY" ? d.frameCount : undefined} />
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="max-w-full justify-start overflow-x-auto">
                <TabsTrigger value="structure">Desen bilgileri</TabsTrigger>
                <TabsTrigger value="weft">Atkı raporu</TabsTrigger>
                <TabsTrigger value="lift">Armür</TabsTrigger>
                <TabsTrigger value="variants">Varyantlar</TabsTrigger>
                {showCost && <TabsTrigger value="cost">Maliyet</TabsTrigger>}
              </TabsList>
              <TabsContent value="structure" className="mt-4">
                <StructureTab key={d.id + (d.repeatCm ?? "") + d.name} design={d} fabric={fabric} canWrite={canWrite} onOpenItem={openItem("warp")} />
              </TabsContent>
              <TabsContent value="weft" forceMount className="mt-4 data-[state=inactive]:hidden"><WeftTab fabric={fabric} onOpenItem={openItem("weft")} /></TabsContent>
              {/* Armür editörü sekme değişince sökülmez: kaydedilmemiş taslak ve geri al yığını korunur. */}
              <TabsContent value="lift" forceMount className="mt-4 data-[state=inactive]:hidden">
                {/* Izgara yalnız Armür'de anlamlı; sunucu Armür dışı ızgara yazımını reddeder. */}
                {resolveWeaveClass(d).shedMechanism === "DOBBY" ? (
                  <LiftPlanTab key={d.id + JSON.stringify(d.liftPlan ?? null) + JSON.stringify(d.lenoFrames ?? []) + JSON.stringify(d.selvedgeFrames ?? [])} design={d} fabric={fabric} canWrite={canWrite} />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Bu desenin mekanizması {SHED_MECHANISM_LABEL[resolveWeaveClass(d).shedMechanism]}; armür ızgarası yalnız Armür mekanizmasında çizilir.
                    Mekanizmayı Yapı sekmesinden değiştirebilirsiniz.
                  </p>
                )}
              </TabsContent>
              <TabsContent value="variants" className="mt-4"><VariantsTab fabric={fabric} onOpenItem={openItem("variants")} /></TabsContent>
              {showCost && <TabsContent value="cost" className="mt-4"><CostTab fabrics={fabricList} /></TabsContent>}
            </Tabs>
            {itemCard.element}
          </>
        )}
      </PageBody>
    </PageShell>
  );
}
