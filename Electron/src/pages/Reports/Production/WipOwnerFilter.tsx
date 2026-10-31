// D4-KUC3a: WIP karnesi emanet sahibi süzgeci — süzme SUNUCUDA (`ownerCustomerId`, D4-KUC2 h). Seçici müşteri listesini
// okuyabilen ve emanet modülü açık kurulumda görünür (izinsiz liste sorgusu atılmaz).
import { useState, type ReactNode } from "react";
import { CustomerPickerField } from "@/components/forms/CustomerPickerField";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";

export function useWipOwnerFilter(): { owner: string | null; filter: ReactNode } {
  const { hasPermission } = useRoleAccess();
  const emanetOn = useFeatureFlags().data?.data?.emanetEnabled === true;
  const canFilter = emanetOn && hasPermission("customer:read");
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const owner = canFilter ? ownerId : null;
  const filter = canFilter ? (
    <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="wip-owner-filter">
      <span className="text-muted-foreground">Emanet sahibi</span>
      <div className="w-72">
        <CustomerPickerField value={ownerId} onChange={setOwnerId} placeholder="Sahip (tümü)" clearable />
      </div>
      {owner && <span className="text-xs text-muted-foreground">Hiç başlamamış iş emirleri bu süzgeçten etkilenmez.</span>}
    </div>
  ) : null;
  return { owner, filter };
}
