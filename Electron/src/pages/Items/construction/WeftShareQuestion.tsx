// Paylaşılan atkı kartı sorusu (B19): kayıtlı kart başka kumaşlarda da kullanılıyorken değiştirilip kaydedilince
// "hepsinde mi değişsin, yalnız bu kumaş için kopya mı?" diye sorar. Cevap pencere açık kaldıkça hatırlanır: kopya alındıktan
// sonra ürün kaydı düşerse tekrar Kaydet aynı kopyayı (doğal anahtar replay) bulur, ortak kartı değiştirmez.
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { suggestForkCode } from "@/pages/WeaveDesigns/tabs/weft-fork-defaults";
import { needsShareQuestion, toForkPlan, type WeftSavePlan } from "./useItemWeftDraft";

export type ShareChoice = "all" | "fork";

interface Pending { others: number; forkCode: string; resolve: (c: ShareChoice | null) => void }

export function useWeftShareQuestion(open: boolean) {
  const [pending, setPending] = useState<Pending | null>(null);
  const chosen = useRef<ShareChoice | null>(null);
  useEffect(() => {
    if (open) chosen.current = null;
  }, [open]);

  /** Planı paylaşım cevabına göre son haline getirir; vazgeçilirse null. */
  async function resolvePlan(plan: WeftSavePlan, others: number, card: { code: string; name: string } | null, itemCode: string): Promise<WeftSavePlan | null> {
    if (plan.kind !== "patch-card" || !card) return plan;
    let choice = chosen.current;
    if (!choice) {
      if (!needsShareQuestion(plan, others)) return plan;
      choice = await new Promise<ShareChoice | null>((resolve) => setPending({ others, forkCode: suggestForkCode(card.code, itemCode), resolve }));
      if (!choice) return null;
      chosen.current = choice;
    }
    return choice === "fork" ? toForkPlan(plan, card, itemCode) : plan;
  }

  const answer = (c: ShareChoice | null) => {
    pending?.resolve(c);
    setPending(null);
  };
  const element = <WeftShareQuestionDialog pending={pending} onAnswer={answer} />;
  return { resolvePlan, element };
}

function WeftShareQuestionDialog({ pending, onAnswer }: { pending: Pending | null; onAnswer: (c: ShareChoice | null) => void }) {
  return (
    <Dialog open={!!pending} onOpenChange={(o) => !o && onAnswer(null)}>
      <DialogContent className="max-w-lg" data-testid="weft-share-question">
        <DialogHeader>
          <DialogTitle>Bu atkı kartı {pending?.others ?? 0} kumaşta daha kullanılıyor</DialogTitle>
          <DialogDescription>Yaptığınız değişiklik hepsinde mi geçerli olsun, yoksa yalnız bu kumaş için kartın kopyası mı açılsın?</DialogDescription>
        </DialogHeader>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li><strong className="text-foreground">Hepsinde değişsin:</strong> kartı kullanan bütün kumaşlar yeni atkıyla devam eder.</li>
          <li>
            <strong className="text-foreground">Yalnız bu kumaş için kopya:</strong> bu kumaşa <span className="font-mono text-xs">{pending?.forkCode}</span> kodlu
            yeni kart açılır, değişiklik ona yazılır; öteki kumaşlar eski kartta kalır.
          </li>
        </ul>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="ghost" onClick={() => onAnswer(null)}>Vazgeç</Button>
          <Button type="button" variant="outline" onClick={() => onAnswer("all")}>Hepsinde değişsin</Button>
          <Button type="button" onClick={() => onAnswer("fork")}>Yalnız bu kumaş için kopya</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
