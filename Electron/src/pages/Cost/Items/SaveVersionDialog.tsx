// "Standart olarak kaydet" — 400 COST_INPUT_MISSING'de modal KAPANMAZ: eksikler listelenir ve ilgili alan
// (kur, devir, atkı boyu, tarife) işaretlenir; kur yoksa kayıt reddedilir, 1 varsayılmaz.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { FxRates } from "../shared/cost-types";
import { costMissingFromError } from "../shared/errors";
import { missingText } from "../shared/labels";
import { missingTarget } from "../shared/missing-targets";
import { STRUCTURE_MAX } from "./schema";
import { costItemService } from "./service";
import { type CostVariant, VariantScopeChoice } from "./variant-scope";

/** `variants` boşsa (varyantsız ürün / station:read yok) seçici çizilmez, gövde bugünkü gibi recipeId taşımaz. */
interface Props { itemId: string; fxRates: FxRates; variants?: CostVariant[]; onClose: () => void; onMissing: (codes: string[]) => void }

export function SaveVersionDialog({ itemId, fxRates, variants = [], onClose, onMissing }: Props) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [missing, setMissing] = useState<string[]>([]);
  const [recipeId, setRecipeId] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => costItemService.saveVersion(itemId, { reason: reason.trim() || undefined, fxRates, recipeId }),
    onSuccess: (r) => {
      toast.success(r.message ?? "Standart maliyet kaydedildi.");
      void qc.invalidateQueries({ queryKey: ["cost-items"] });
      onClose();
    },
    onError: (e) => {
      const m = costMissingFromError(e);
      // Varyant kaydının eksiği varyant girdisindedir; desen geneli alanlarını işaretlemek yanlış yere yollar.
      if (m) { setMissing(m); if (!recipeId) onMissing(m); }
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Standart olarak kaydet</DialogTitle>
          <DialogDescription>Yeni sürüm yazılır; önceki sürüm geçersiz olur ama değişmez. Kayıtlı teklifler etkilenmez.</DialogDescription>
        </DialogHeader>
        <VariantScopeChoice variants={variants} value={recipeId} onChange={setRecipeId} activeOnly label="Kapsam" />
        {recipeId && <p className="text-xs text-muted-foreground">Varyant sürümü varyantın iplik ve tarifesiyle hesaplanır; desen geneli aktif sürüm değişmez.</p>}
        <label className="text-sm"><span className="text-muted-foreground">Gerekçe (opsiyonel)</span>
          <Input className="mt-1" maxLength={STRUCTURE_MAX.reason} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        {missing.length > 0 && (
          <ul role="alert" className="space-y-1 text-sm text-destructive">
            {recipeId && <li className="text-xs">Varyant girdisi eksik (varyantın iş emri şablonu / iplik ve tarifesi):</li>}
            {missing.map((c) => {
              const t = missingTarget(c);
              return (
                <li key={c} data-code={c}>
                  ✕ {missingText(c)}{" "}
                  {t?.kind === "link" && <Link className="underline" to={t.to}>{t.label}</Link>}
                  {t?.kind === "field" && !recipeId && <span className="text-xs">(işaretli alan)</span>}
                </li>
              );
            })}
          </ul>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>Kaydet</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
