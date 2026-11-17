// Çözgü Hesabı → "Fason devere siparişi aç" (plan E2): sipariş listesi yeni sipariş formunu kart, devereci ve
// levent adedi × boy dolu açar. Yalnız `warping-order:write` varken çizilir.
import { Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import type { WarpPlanState } from "./warp-plan-model";

export function openOrderHref(s: Pick<WarpPlanState, "warpSpecId" | "subcontractorId" | "beamCount" | "beamLengthM">): string {
  const sp = new URLSearchParams({ new: "1" });
  if (s.warpSpecId) sp.set("warpSpecId", s.warpSpecId);
  if (s.subcontractorId) sp.set("subcontractorId", s.subcontractorId);
  if (s.beamCount.trim()) sp.set("beamCount", s.beamCount.trim());
  if (s.beamLengthM.trim()) sp.set("beamLengthM", s.beamLengthM.trim());
  return `/operations/fason-devere?${sp.toString()}`;
}

export function OpenOrderLink({ s }: { s: WarpPlanState }) {
  const openTarget = useOpenTarget();
  return (
    <PermissionGate permission="warping-order:write">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={() => openTarget(openOrderHref(s))}>
          <Truck className="mr-1 h-4 w-4" /> Bu hesapla fason devere siparişi aç
        </Button>
      </div>
    </PermissionGate>
  );
}
