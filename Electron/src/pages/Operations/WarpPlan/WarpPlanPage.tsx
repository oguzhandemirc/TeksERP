// =============================================================================
// OPERASYON › ÇÖZGÜ HESABI (fason devere D3, plan E2) — `warpspec:read`, devere modülü.
// İki yön: "Leventten" (levent adedi × boy → iplik başına kg) · "Eldeki iplikten" (depo + deverecide → en çok metre).
// KAYIT YAZMAZ (yalnız `POST /api/warp-plan/calculate`); her sayı sunucudan.
// =============================================================================
import { useState } from "react";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Callout } from "@/components/ui/callout";
import { apiErrorMessage } from "@/services/apiClient";
import { useWarpPlan } from "./service";
import { buildWarpPlanBody, emptyWarpPlanState, type WarpPlanState } from "./warp-plan-model";
import { WarpPlanInputs } from "./WarpPlanInputs";
import { ForwardTable } from "./ForwardTable";
import { ReverseResult } from "./ReverseResult";
import type { WarpPlanMode } from "./types";
import { OpenOrderLink } from "./OpenOrderLink";

export function WarpPlanPage() {
  const [s, setS] = useState<WarpPlanState>(emptyWarpPlanState);
  const up = (patch: Partial<WarpPlanState>) => setS((x) => ({ ...x, ...patch }));
  const body = buildWarpPlanBody(s);
  const q = useWarpPlan(body);
  const res = q.data?.data;
  const fresh = res && res.mode === s.mode && res.warpSpec?.id === s.warpSpecId;
  return (
    <PageShell>
      <PageHeader
        title="Çözgü Hesabı"
        description="Çözgü kartındaki tel ve iplik denyesiyle: kaç levent için kaç kg iplik gerekir, ya da eldeki iplik kaç metre çözgüye yeter. Hiçbir şey kaydedilmez."
      />
      <PageBody className="space-y-4 p-4 sm:p-6">
        <Tabs value={s.mode} onValueChange={(v) => up({ mode: v as WarpPlanMode })}>
          <TabsList aria-label="Hesap yönü">
            <TabsTrigger value="FROM_BEAMS">Leventten → iplik</TabsTrigger>
            <TabsTrigger value="FROM_STOCK">Eldeki iplikten → metre</TabsTrigger>
          </TabsList>
        </Tabs>
        <WarpPlanInputs s={s} up={up} defaultFixedWasteM={res?.fixedWasteM ?? null} />
        <ResultArea s={s} hasBody={body !== null} q={q} fresh={Boolean(fresh)} />
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
