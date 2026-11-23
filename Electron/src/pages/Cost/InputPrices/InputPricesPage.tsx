import { useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PageTabsList, PageTabsTrigger } from "@/components/layout/PageTabs";
import { YarnPricesPage } from "../YarnPrices/YarnPricesPage";
import { FinishingRatesPage } from "../FinishingRates/FinishingRatesPage";
import { FormulasPage } from "../Formulas/FormulasPage";
import { ConsumableNormsPage } from "../ConsumableNorms/ConsumableNormsPage";
import { COST_INPUT_DESCRIPTIONS, COST_INPUT_TABS, resolveCostInputTab, type CostInputTabKey } from "./tabs-config";

/**
 * Maliyet › Girdi Fiyatları — iplik fiyatı, fason tarifesi, ek formül ve sarf normu tek
 * başlık altında sekmeli (M6; Etiketler kalıbı). Sekme URL'de (?tab=) — eski dört yol buraya yönlenir.
 * Alt listelerin eylemleri başlığa, arama/araçları sekme şeridinin sağına portal'lanır.
 */
export function InputPricesPage() {
  const [sp, setSp] = useSearchParams();
  const [actionsEl, setActionsEl] = useState<HTMLDivElement | null>(null);
  const [toolsEl, setToolsEl] = useState<HTMLDivElement | null>(null);
  const tab = resolveCostInputTab(sp.get("tab"));
  const setTab = (v: string) => {
    const n = new URLSearchParams(sp);
    n.set("tab", v);
    setSp(n, { replace: true });
  };
  const slots = { actions: actionsEl, tools: toolsEl };
  // Yalnız etkin sekme bağlanır: dört liste aynı portala aynı anda yazmasın.
  const body: Record<CostInputTabKey, ReactNode> = {
    yarn: <YarnPricesPage embedded={slots} />,
    finishing: <FinishingRatesPage embedded={slots} />,
    formulas: <FormulasPage embedded={slots} />,
    norms: <ConsumableNormsPage embedded={slots} />,
  };

  return (
    <PageShell>
      <PageHeader
        title="Girdi Fiyatları"
        description={COST_INPUT_DESCRIPTIONS[tab]}
        actions={<div ref={setActionsEl} className="flex items-center gap-2" />}
      />
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <PageTabsList trailing={<div ref={setToolsEl} className="flex items-center gap-1.5 pr-4" />}>
          {COST_INPUT_TABS.map((t) => (
            <PageTabsTrigger key={t.key} value={t.key}>{t.label}</PageTabsTrigger>
          ))}
        </PageTabsList>
        {COST_INPUT_TABS.map((t) => (
          <TabsContent key={t.key} value={t.key} className="mt-0 min-h-0 flex-1 overflow-hidden">
            {t.key === tab ? body[t.key] : null}
          </TabsContent>
        ))}
      </Tabs>
    </PageShell>
  );
}
