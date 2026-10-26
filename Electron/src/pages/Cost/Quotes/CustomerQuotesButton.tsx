// Cari kartı › "Teklifler": müşteri rolündeki carinin tekliflerine süzülü liste. Maliyet modülü kapalıysa ya da
// `quote:read` yoksa çizilmez (çıkışsız kapı üretmez).
import { FileText } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useMaliyetEnabled } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";

export function CustomerQuotesButton({ customerId, isCustomerRole }: { customerId: string; isCustomerRole: boolean }) {
  const nav = useNavigate();
  const enabled = useMaliyetEnabled();
  const { hasPermission } = useRoleAccess();
  if (!enabled || !isCustomerRole || !hasPermission("quote:read")) return null;
  return (
    <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void nav(`/cost/quotes?customerId=${customerId}`)}>
      <FileText className="mr-1 h-3.5 w-3.5" />Teklifler
    </Button>
  );
}
