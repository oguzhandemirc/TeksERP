// =============================================================================
// SİPARİŞ SATIRI PLAN ALANLARI (SY-K2; tasarım §12.5) — varyant · top boyu · hedef değer (kuşak)
// =============================================================================
// Düğme DOĞRUDAN modal açar (combobox yok). Varyant seçilince renk ve en, satırda boşsa varyanttan
// ön dolar. Varyant listesi `station:read`, hedef özellik listesi `property:read` ister — izin yoksa
// o bölümün sorgusu atılmaz. Doğrulama sunucuda (RECIPE_ITEM_MISMATCH · TARGET_VALUE_INVALID).
// =============================================================================
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { loadAllForPicker } from "@/lib/picker-loader";
import { cn } from "@/lib/utils";
import { productRecipeService } from "@/pages/ProductRecipes/service";
import type { ProductRecipe } from "@/pages/ProductRecipes/types";
import { fabricPropertyService } from "@/pages/FabricProperties/service";
import type { OrderLineFormValues } from "./schema";

type Recipe = ProductRecipe & { variantCode?: string | null };
type Target = { propertyId: string; valueId: string };
type PlanPatch = Pick<OrderLineFormValues, "recipeId" | "pieceLengthM" | "targetValues" | "colorId" | "width">;

export function recipeLabel(r: { code: string; name: string; variantCode?: string | null }): string {
  return r.variantCode ? `${r.variantCode} · ${r.name}` : `${r.code} · ${r.name}`;
}

interface Props {
  line: OrderLineFormValues;
  onPatch: (patch: Partial<OrderLineFormValues>) => void;
  onMissingItem: () => void;
}

/** Satır alt çubuğundaki düğme + özet; tıklanınca modal. */
export function OrderLinePlanButton({ line, onPatch, onMissingItem }: Props) {
  const [open, setOpen] = useState(false);
  const count = (line.recipeId ? 1 : 0) + (line.pieceLengthM ? 1 : 0) + (line.targetValues?.length ?? 0);
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 gap-1 text-xs"
        onClick={() => (line.itemId ? setOpen(true) : onMissingItem())}
        data-testid="order-line-plan-button"
      >
        <Layers className="h-3.5 w-3.5" /> Varyant · kuşak · top boyu{count > 0 ? ` (${count})` : ""}
      </Button>
      {open && <OrderLinePlanDialog line={line} onClose={() => setOpen(false)} onApply={(p) => { onPatch(p); setOpen(false); }} />}
    </>
  );
}

function OrderLinePlanDialog({ line, onClose, onApply }: { line: OrderLineFormValues; onClose: () => void; onApply: (p: PlanPatch) => void }) {
  const { hasPermission } = useRoleAccess();
  const canRecipes = hasPermission("station:read");
  const canProps = hasPermission("property:read");
  const [recipeId, setRecipeId] = useState<string | null>(line.recipeId ?? null);
  const [pieceText, setPieceText] = useState(line.pieceLengthM ? String(line.pieceLengthM) : "");
  const [targets, setTargets] = useState<Target[]>(line.targetValues ?? []);

  const recipes = useQuery({
    queryKey: ["order-line-recipes", line.itemId],
    queryFn: () => loadAllForPicker(productRecipeService, { filters: { itemId: line.itemId, isActive: "true" }, sortBy: "code" }).then((r) => r.data as Recipe[]),
    enabled: canRecipes && Boolean(line.itemId),
  });
  const props = useQuery({
    queryKey: ["order-line-target-properties"],
    queryFn: () => loadAllForPicker(fabricPropertyService, { filters: { isActive: "true", valueType: "CHOICE" }, sortBy: "sortOrder" })
      .then((r) => r.data.filter((p) => p.variantOfPropertyId)),
    enabled: canProps,
  });

  const piece = pieceText.trim() === "" ? null : Number(pieceText.replace(",", "."));
  const pieceInvalid = piece !== null && !(Number.isFinite(piece) && piece > 0);
  const setTarget = (propertyId: string, valueId: string | null) =>
    setTargets((cur) => [...cur.filter((t) => t.propertyId !== propertyId), ...(valueId ? [{ propertyId, valueId }] : [])]);

  const apply = () => {
    const r = recipes.data?.find((x) => x.id === recipeId);
    onApply({
      recipeId,
      pieceLengthM: piece,
      targetValues: targets,
      // Varyanttan ön dolum: satırda boşsa renk ve en varyanttan gelir; dolu alan ezilmez.
      colorId: line.colorId ?? r?.colorId ?? null,
      width: line.width ?? (r?.width != null ? Number(r.width) : null),
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg" data-testid="order-line-plan-dialog">
        <DialogHeader>
          <DialogTitle>Varyant · kuşak · top boyu</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          {canRecipes && (
            <section className="space-y-1.5">
              <h4 className="font-medium">Varyant</h4>
              <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                <Choice active={recipeId === null} onClick={() => setRecipeId(null)}>Desen geneli (varyantsız)</Choice>
                {(recipes.data ?? []).map((r) => (
                  <Choice key={r.id} active={recipeId === r.id} onClick={() => setRecipeId(r.id)}>{recipeLabel(r)}</Choice>
                ))}
                {recipes.isSuccess && recipes.data.length === 0 && <p className="text-xs text-muted-foreground">Bu desenin aktif varyantı yok.</p>}
              </div>
            </section>
          )}
          <section className="space-y-1.5">
            <h4 className="font-medium">Top boyu (m)</h4>
            <Input type="number" step="0.1" min={0} placeholder="Boş = belirtilmedi" aria-label="Top boyu (m)" value={pieceText} onChange={(e) => setPieceText(e.target.value)} />
            {pieceInvalid && <p className="text-xs text-destructive">Top boyu 0'dan büyük olmalı.</p>}
          </section>
          {canProps && (props.data ?? []).map((p) => {
            const current = targets.find((t) => t.propertyId === p.id)?.valueId ?? null;
            return (
              <section key={p.id} className="space-y-1.5">
                <h4 className="font-medium">{p.name}</h4>
                <div className="flex flex-wrap gap-1">
                  <Choice active={current === null} onClick={() => setTarget(p.id, null)}>Yok</Choice>
                  {(p.values ?? []).filter((v) => v.isActive).map((v) => (
                    <Choice key={v.id} active={current === v.id} onClick={() => setTarget(p.id, v.id)}>{v.name}</Choice>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button type="button" onClick={apply} disabled={pieceInvalid}>Uygula</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Choice({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button type="button" size="sm" variant={active ? "default" : "outline"} className={cn("h-8 justify-start text-xs")} aria-pressed={active} onClick={onClick}>
      {children}
    </Button>
  );
}
