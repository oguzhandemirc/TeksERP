// Cari kartı renk adı ekleme satırı: Kumaş (isteğe bağlı) → Renk → Ad. Kumaş seçilirse ad YALNIZ o kumaşta geçerli.
// Seçiciler modal (combobox yok); kumaş seçilince renk modalı kumaşın izinli renkleriyle sınırlanır.
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ItemSelect } from "@/components/forms/ItemSelect";
import { ColorPickerModal } from "@/components/forms/color-picker/ColorPickerModal";
import { useItemDetail } from "@/pages/Items/useItemDetail";

export interface ColorAliasDraft {
  itemId: string | null;
  colorId: string;
  alias: string;
}

interface Props {
  customerId: string;
  pending?: boolean;
  /** Başarılıysa çözülür → form boşalır; hata apiClient'ta gösterilir. */
  onAdd: (draft: ColorAliasDraft) => Promise<unknown>;
}

export function ColorAliasAddForm({ customerId, pending, onAdd }: Props) {
  const [itemId, setItemId] = useState<string | null>(null);
  const [colorId, setColorId] = useState<string | null>(null);
  const [alias, setAlias] = useState("");
  const itemQ = useItemDetail(itemId ?? "");
  const allowedColorIds = itemId ? (itemQ.data?.data?.allowedColors ?? []).map((c) => c.colorId) : null;
  const canAdd = Boolean(colorId && alias.trim()) && !pending;

  const submit = () => {
    if (!colorId || !alias.trim()) return;
    onAdd({ itemId, colorId, alias: alias.trim() })
      .then(() => {
        setColorId(null);
        setAlias("");
      })
      .catch(() => undefined);
  };

  return (
    <div className="space-y-1.5 rounded-md border bg-muted/30 p-2">
      <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <ItemSelect
            className="min-w-0 flex-1"
            value={itemId}
            onChange={(id) => {
              setItemId(id);
              setColorId(null);
            }}
            allowedTypes={["FABRIC"]}
            lifecycle="ACTIVE"
            placeholder="Bütün kumaşlar"
            aria-label="Kumaş seç (isteğe bağlı)"
          />
          {itemId && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0"
              aria-label="Kumaş seçimini kaldır"
              title="Kumaş seçimini kaldır — ad bütün kumaşlarda geçerli olur"
              onClick={() => {
                setItemId(null);
                setColorId(null);
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
        <ColorPickerModal
          value={colorId}
          onChange={setColorId}
          customerId={customerId}
          allowedColorIds={allowedColorIds}
          allowNone={false}
          triggerClassName="h-9"
        />
        <Input
          aria-label="Müşterideki ad"
          placeholder="Müşterideki ad (örn. ABC)"
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && canAdd && submit()}
        />
        <Button type="button" size="sm" onClick={submit} disabled={!canAdd} className="gap-1">
          <Plus className="h-3.5 w-3.5" /> Ekle
        </Button>
      </div>
      <p className="px-1 text-xs text-muted-foreground">
        {itemId
          ? "Bu ad yalnız seçilen kumaşta geçerli; o kumaşta genel adın önüne geçer."
          : "Kumaş seçmezseniz ad bu müşterinin bütün kumaşlarında geçerli olur."}
      </p>
    </div>
  );
}
