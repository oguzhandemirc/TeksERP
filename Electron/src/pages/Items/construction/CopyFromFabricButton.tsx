// "Başka kumaştan kopyala" (B19, yeni üründe): seçilen kumaşın çözgü ve desen kartı BAĞLANIR (aynı kart), atkısı yeni atkı
// taslağı olarak gelir — kaydedince bu kumaşa ait ayrı atkı kartı açılır (kaynağın kartı değişmez).
import { useState } from "react";
import { toast } from "sonner";
import type { UseFormReturn } from "react-hook-form";
import { Copy } from "lucide-react";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { weftSpecApi } from "@/pages/WeaveDesigns/service";
import { weftContentFromSpec } from "@/pages/WeaveDesigns/tabs/WeftSpecEditor";
import { itemService } from "../service";
import type { Item } from "../types";
import type { ItemFormValues } from "../schema";
import type { ItemWeftDraft } from "./useItemWeftDraft";

interface Props {
  form: UseFormReturn<ItemFormValues>;
  weft: Pick<ItemWeftDraft, "startNew">;
  warpVisible: boolean;
}

export function CopyFromFabricButton({ form, weft, warpVisible }: Props) {
  const [busy, setBusy] = useState(false);
  const copy = async (id: string | null) => {
    if (!id) return;
    setBusy(true);
    try {
      const src = (await itemService.getById(id)).data;
      const taken: string[] = [];
      if (warpVisible && src.warpSpecId) {
        form.setValue("warpSpecId", src.warpSpecId, { shouldDirty: true });
        taken.push("çözgü");
      }
      if (src.weaveDesignId) {
        form.setValue("weaveDesignId", src.weaveDesignId, { shouldDirty: true });
        taken.push("desen");
      }
      if (src.weftSpecId) {
        weft.startNew(weftContentFromSpec(await weftSpecApi.get(src.weftSpecId)));
        taken.push("atkı (yeni kart olarak)");
      }
      if (taken.length) toast.success(`${src.code} kumaşından alındı: ${taken.join(", ")}.`);
      else toast.info(`${src.code} kumaşında çözgü, desen ya da atkı kartı yok.`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="w-60">
      <EntityPickerModal<Item>
        value={null}
        onChange={(id) => void copy(id)}
        service={itemService}
        queryKey="items-copy-fabric"
        filters={{ itemType: "FABRIC", lifecycleStatus: "ACTIVE" }}
        getLabel={(it) => it.name}
        getSubLabel={(it) => it.code}
        icon={Copy}
        title="Hangi kumaştan kopyalansın?"
        description="Çözgü ve desen kartı aynen bağlanır; atkı bu kumaş için yeni kart olarak kopyalanır."
        placeholder={busy ? "Kopyalanıyor…" : "Başka kumaştan kopyala"}
        disabled={busy}
        hideChevron
      />
    </div>
  );
}
