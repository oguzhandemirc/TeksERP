// =============================================================================
// LEVENT GÖVDELERİ — liste · sahibine iade · iade belgeleri (devere ek B4) · `definitions/beam-bodies`
// =============================================================================
// ⚠️ İKİ KAPI: modül (devere, route `ROUTE_MODULE`) + ayar (`devere.beamBodyMode≠OFF`, `BeamBodyModeGate`);
// backend kapıları `requireDevereEnabled` + `requireBeamBodyTracking` (OFF → 403 BEAM_BODY_MODE_OFF).
// Okuma `beam-body:read`, yazma `beam-body:write`, etiket `label:print`. Sekme URL'de (`?tab=`).
// =============================================================================
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import { PermissionGate } from "@/components/PermissionGate";
import { RefreshButton } from "@/components/RefreshButton";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDevereBeamBodyMode } from "@/hooks/usePricingEnabled";
import { BeamBodiesList } from "./BeamBodiesList";
import { BeamBodyFormDialog } from "./BeamBodyFormDialog";
import { BeamBodyModeGate } from "./BeamBodyModeGate";
import { OwnerReturnTab } from "./returns/OwnerReturnTab";
import { ReturnDocsTab } from "./returns/ReturnDocsTab";
import { BEAM_BODIES_QUERY_KEY, BEAM_BODY_RETURNS_QUERY_KEY, beamBodyPath } from "./service";

const TABS = [
  { value: "bodies", label: "Gövdeler" },
  { value: "owner-return", label: "Sahibine iade" },
  { value: "returns", label: "İade belgeleri" },
] as const;
type TabKey = (typeof TABS)[number]["value"];

export function BeamBodiesPage() {
  const [sp, setSp] = useSearchParams();
  const openTarget = useOpenTarget();
  const [creating, setCreating] = useState(false);
  const on = useDevereBeamBodyMode() !== "OFF";
  const raw = sp.get("tab");
  const tab: TabKey = TABS.some((t) => t.value === raw) ? (raw as TabKey) : "bodies";
  const setTab = (v: string) => {
    const next = new URLSearchParams(sp);
    if (v === "bodies") next.delete("tab");
    else next.set("tab", v);
    setSp(next, { replace: true });
  };
  return (
    <PageShell>
      <PageHeader
        title="Levent Gövdeleri"
        description="Boş levent gövdeleri demirbaştır: numara ve QR etiketle izlenir — kimin, nerede, dolu mu boş mu. Bizim olmayan gövde boşalınca sahibine iade edilir."
        actions={
          on && (
          <div className="flex items-center gap-2">
            <PermissionGate permission="beam-body:write">
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="mr-1 h-4 w-4" /> Yeni Gövde
              </Button>
            </PermissionGate>
            <RefreshButton queryKey={tab === "returns" ? BEAM_BODY_RETURNS_QUERY_KEY : BEAM_BODIES_QUERY_KEY} />
          </div>
          )
        }
      />
      <BeamBodyModeGate>
        <Tabs value={tab} onValueChange={setTab} className="shrink-0 px-4 pt-2 sm:px-6">
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {tab === "bodies" && <BeamBodiesList />}
        {tab === "owner-return" && <OwnerReturnTab onCreated={() => setTab("returns")} />}
        {tab === "returns" && <ReturnDocsTab />}
        {creating && <BeamBodyFormDialog initial={null} onClose={() => setCreating(false)} onSaved={(b) => openTarget(beamBodyPath(b.id))} />}
      </BeamBodyModeGate>
    </PageShell>
  );
}
