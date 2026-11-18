// D8: üretim önerisi "Levent ihtiyacı" → Çözgü Hesabı ihtiyaç sekmesi (kaynak bu sipariş). Devere kapalıyken ya da
// `warpspec:read` yoksa çizilmez — hedef ekran da aynı kapıyla korunur.
import { Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import { useDevereEnabled } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { needTabHref } from "@/pages/Operations/WarpPlan/need/need-model";

export function DevereNeedLink({ orderId, onNavigate }: { orderId: string; onNavigate: () => void }) {
  const devere = useDevereEnabled();
  const { hasPermission } = useRoleAccess();
  const openTarget = useOpenTarget();
  if (!devere || !hasPermission("warpspec:read")) return null;
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={(e) => {
        onNavigate();
        openTarget(needTabHref({ orderId }), e);
      }}
    >
      <Truck className="mr-1 h-4 w-4" /> Fason devere önerisi
    </Button>
  );
}
