// Varyantın atkı ipliği değişimleri: kartın her harfi için "kart ipliği" ya da yerine geçen iplik.
// Pay/sıklık kartta kalır; etkin satırlar sunucunun `resolveEffectiveConstruction` yanıtından okunur.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Package } from "lucide-react";
import { toast } from "sonner";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { Button } from "@/components/ui/button";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { itemService } from "@/pages/Items/service";
import type { Item } from "@/pages/Items/types";
import { constructionApi } from "../service";
import { ConstructionWarnings } from "./ConstructionWarnings";

export function VariantWeftOverrides({ fabricId, recipeId }: { fabricId: string; recipeId: string }) {
  const qc = useQueryClient();
  const { hasAllPermissions } = useRoleAccess();
  const canWrite = hasAllPermissions(["station:write", "warpspec:write"]);
  const c = useQuery({ queryKey: ["item-construction", fabricId, recipeId], queryFn: () => constructionApi.get(fabricId, recipeId) });
  const [draft, setDraft] = useState<Record<number, string | null> | null>(null);
  const yarns = c.data?.weft?.yarns ?? [];
  const current = Object.fromEntries(yarns.map((y) => [y.sortOrder, y.cardYarnItem ? y.yarnItem.id : null]));
  const values = draft ?? current;
  const save = useMutation({
    mutationFn: () => constructionApi.putWeftOverrides(recipeId, Object.entries(values)
      .filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== "")
      .map(([k, yarnItemId]) => ({ weftSortOrder: Number(k), yarnItemId }))),
    onSuccess: () => {
      toast.success("Varyant atkı değişimleri güncellendi.");
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ["item-construction", fabricId] });
    },
  });
  if (c.isLoading) return <p className="mt-2 text-sm text-muted-foreground">Yükleniyor…</p>;
  if (!c.data?.weft) return <p className="mt-2 text-sm text-muted-foreground">Kumaşa atkı kartı bağlı değil — değişim tanımlanamaz.</p>;
  return (
    <div className="mt-2 space-y-2">
      {yarns.map((y) => {
        const card = y.cardYarnItem ?? y.yarnItem;
        return (
          <div key={y.sortOrder} className="grid items-center gap-2 text-sm sm:grid-cols-[2rem_1fr_1fr]">
            <span className="font-mono font-semibold">{y.letter}</span>
            <span className="text-muted-foreground">Kart: {card.name} · {y.picksInRepeat} atkı</span>
            <EntityPickerModal<Item>
              value={values[y.sortOrder] ?? null}
              onChange={(id) => setDraft({ ...values, [y.sortOrder]: id })}
              service={itemService}
              queryKey="items-weft-yarn"
              filters={{ itemType: "YARN", lifecycleStatus: "ACTIVE" }}
              getLabel={(it) => it.name}
              getSubLabel={(it) => it.code}
              icon={Package}
              nullable
              noneLabel="Kart ipliği (değişim yok)"
              title={`Atkı ${y.letter} — varyant ipliği`}
              placeholder="Kart ipliği (değişim yok)"
              disabled={!canWrite}
            />
          </div>
        );
      })}
      {canWrite && draft && <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>Değişimleri kaydet</Button>}
      <ConstructionWarnings warnings={c.data.warnings} />
    </div>
  );
}
