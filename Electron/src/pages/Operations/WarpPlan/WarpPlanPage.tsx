// =============================================================================
// OPERASYON › ÇÖZGÜ HESABI (fason devere D3, plan E2) — `warpspec:read`, devere modülü.
// Üç sekme: "Leventten" (levent adedi × boy → iplik başına kg) · "Eldeki iplikten" (en çok metre) · "İhtiyaçtan" (D8: kumaş/iş/sipariş → devere önerisi).
// KAYIT YAZMAZ (`POST /api/warp-plan/calculate` · `GET /api/warp-plan/need`); her sayı sunucudan.
// =============================================================================
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { apiErrorMessage } from "@/services/apiClient";
import { useWarpPlan } from "./service";
import { buildWarpPlanBody, emptyWarpPlanState, type WarpPlanState } from "./warp-plan-model";
import { WarpPlanInputs } from "./WarpPlanInputs";
import { ForwardTable } from "./ForwardTable";
import { ReverseResult } from "./ReverseResult";
import type { WarpPlanMode } from "./types";
import { OpenOrderLink } from "./OpenOrderLink";
import { NeedTab } from "./need/NeedTab";
import { linkedNeedQuery } from "./need/need-model";

const NEED_PARAMS = ["tab", "source", "weavingOrderId", "orderId"];

export function WarpPlanPage() {
  const [sp, setSp] = useSearchParams();
  // İhtiyaç sekmesi URL'de (`?tab=NEED&source=…`) — dokuma işi / üretim önerisi bağı doğrudan açar; hesap yönü
  // (`s.mode`) ayrı durumdur, sekme değişince iki yönün girdileri korunur.
  const needTab = sp.get("tab") === "NEED";
  const [s, setS] = useState<WarpPlanState>(emptyWarpPlanState);
  const up = (patch: Partial<WarpPlanState>) => setS((x) => ({ ...x, ...patch }));
  const setTab = (v: string) => {
    const next = new URLSearchParams(sp);
    for (const k of NEED_PARAMS) next.delete(k);
    if (v === "NEED") next.set("tab", "NEED");
    else up({ mode: v as WarpPlanMode });
    setSp(next, { replace: true });
  };
  const clearLinked = () => setSp(new URLSearchParams({ tab: "NEED" }), { replace: true });
  const body = needTab ? null : buildWarpPlanBody(s);
  const q = useWarpPlan(body);
  const res = q.data?.data;
  const fresh = res && res.mode === s.mode && res.warpSpec?.id === s.warpSpecId;
  return (
    <PageShell>
      <PageHeader
        title="Çözgü Hesabı"
        description="Çözgü kartındaki tel ve iplik denyesiyle: kaç levent için kaç kg iplik gerekir, eldeki iplik kaç metre çözgüye yeter, ya da dokunacak kumaş için ne kadar çözgü devere verilmeli. Hiçbir şey kaydedilmez."
      />
      <PageBody className="space-y-4 p-4 sm:p-6">
        <Tabs value={needTab ? "NEED" : s.mode} onValueChange={setTab}>
          <TabsList aria-label="Hesap yönü">
            <TabsTrigger value="FROM_BEAMS">Leventten → iplik</TabsTrigger>
            <TabsTrigger value="FROM_STOCK">Eldeki iplikten → metre</TabsTrigger>
            <TabsTrigger value="NEED">İhtiyaçtan → devere önerisi</TabsTrigger>
          </TabsList>
        </Tabs>
        {needTab ? (
          <NeedTab linked={linkedNeedQuery(sp)} onClearLinked={clearLinked} />
        ) : (
          <>
            <Card className="p-4">
              <WarpPlanInputs s={s} up={up} defaultFixedWasteM={res?.fixedWasteM ?? null} />
            </Card>
            <ResultArea s={s} hasBody={body !== null} q={q} fresh={Boolean(fresh)} />
          </>
        )}
      </PageBody>
    </PageShell>
  );
}

function ResultArea({ s, hasBody, q, fresh }: { s: WarpPlanState; hasBody: boolean; q: ReturnType<typeof useWarpPlan>; fresh: boolean }) {
  if (!s.warpSpecId) return <Empty text="Hesap için bir çözgü kartı seçin." />;
  if (!hasBody) {
    return <Empty text={s.mode === "FROM_BEAMS" ? "Levent adedi (tam sayı) ve levent boyu (m) sıfırdan büyük olmalı." : "Levent boyu boş bırakılabilir; yazılırsa sıfırdan büyük olmalı."} />;
  }
  if (q.isError) {
    return (
      <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
        {apiErrorMessage(q.error)}
      </p>
    );
  }
  const res = q.data?.data;
  if (!res || !fresh) return <Empty text="Hesaplanıyor…" />;
  const warnings = q.data?.warnings ?? [];
  return (
    <div className="space-y-3" aria-busy={q.isFetching}>
      {warnings.map((w) => (
        <Callout key={w} tone="warning" className="text-sm">{w}</Callout>
      ))}
      {res.forward && <ForwardTable res={res} forward={res.forward} />}
      {res.forward && s.mode === "FROM_BEAMS" && <OpenOrderLink s={s} />}
      {res.reverse && <ReverseResult res={res} reverse={res.reverse} />}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">{text}</p>;
}
