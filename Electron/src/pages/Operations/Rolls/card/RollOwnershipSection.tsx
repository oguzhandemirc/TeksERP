// SAHİPLİK — "bu mal kimin?" (kullanıcı 2026-11-10: kartta okunmuyordu). Sahip `ownerCustomer`dır; etiket müşterisi
// (`labelCustomer`) ve alıcı (`labelConsignee`, müşterimizin müşterisi) yalnız etikete basılan addır, sahiplik DEĞİL.
import { Building2, UserRound } from "lucide-react";
import type { Roll } from "../types";

interface Props {
  roll: Pick<Roll, "ownerCustomer" | "labelCustomer" | "labelConsignee">;
  /** Emanet kapalı kurulumda "Bizim mal" satırı çizilmez (bugünkü görünüm); sahipli top her zaman gösterilir. */
  emanetEnabled: boolean;
}

export function RollOwnershipSection({ roll, emanetEnabled }: Props) {
  const owner = roll.ownerCustomer ?? null;
  const label = roll.labelCustomer ?? null;
  const consignee = roll.labelConsignee ?? null;
  if (!owner && !emanetEnabled && !label && !consignee) return null;
  return (
    <div className="space-y-1.5" data-testid="roll-card-ownership">
      {owner ? (
        <div data-testid="roll-owner-consigned" className="flex items-center gap-2 rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <Building2 className="h-4 w-4 shrink-0" /> Müşteri malı (emanet) — {owner.name}
        </div>
      ) : emanetEnabled ? (
        <div data-testid="roll-owner-own" className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium">
          <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" /> Bizim mal
        </div>
      ) : null}
      {label && (
        <div data-testid="roll-label-customer" className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
          <UserRound className="h-3.5 w-3.5" /> Etiketteki müşteri: <span className="font-medium text-foreground">{label.name}</span>
        </div>
      )}
      {consignee && (
        <div data-testid="roll-label-consignee" className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
          <UserRound className="h-3.5 w-3.5" /> Etiketteki alıcı: <span className="font-medium text-foreground">{consignee.name}</span>
        </div>
      )}
    </div>
  );
}
