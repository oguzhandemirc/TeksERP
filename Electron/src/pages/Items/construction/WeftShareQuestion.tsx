// Paylaşılan atkı kartı kaydı (B19, kullanıcı 2026-11-25): ortak kart ürün penceresinden DEĞİŞTİRİLMEZ ("hepsinde değişsin" yok).
// "Yalnız bu kumaş için kopya" seçildiyse (Atkı sekmesindeki düğme) sormadan kopyaya çevrilir; değilse (ör. kullanım sayısı sonradan
// değişti) sorar: kopya ya da Atkı Kartları ekranında aç. Kopya cevabı pencere açık kaldıkça hatırlanır — kopyadan sonra ürün kaydı
// düşerse tekrar Kaydet aynı kopyayı (doğal anahtar replay) bulur.
import { useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { suggestForkCode } from "@/pages/WeaveDesigns/tabs/weft-fork-defaults";
import { openWeftSpecsTab } from "@/pages/WeftSpecs/open-weft-specs";
import { toForkPlan, type WeftSavePlan } from "./useItemWeftDraft";

export type ShareChoice = "fork" | "open";

interface Pending { others: number | null; forkCode: string; resolve: (c: ShareChoice | null) => void }

export function useWeftShareQuestion(open: boolean) {
  const [pending, setPending] = useState<Pending | null>(null);
  const forkChosen = useRef(false);
  useEffect(() => {
    if (open) forkChosen.current = false;
  }, [open]);

  /** Planı son haline getirir: paylaşılan kart değişikliği kopyaya döner ya da kayıt durur (null). */
  async function resolvePlan(
    plan: WeftSavePlan,
    weft: { forking: boolean; others: number | null; card: { code: string; name: string } | null },
    itemCode: string,
  ): Promise<WeftSavePlan | null> {
    if (plan.kind !== "shared-card") return plan;
    if (!weft.card) return null; // kart bilgisi yokken kopya kodu önerilemez — kayıt durur, ortak kart değişmez
    const card = weft.card;
    if (!weft.forking && !forkChosen.current) {
      const choice = await new Promise<ShareChoice | null>((resolve) => setPending({ others: weft.others, forkCode: suggestForkCode(card.code, itemCode), resolve }));
      if (choice === "open") openWeftSpecsTab(card.code);
      if (choice !== "fork") return null;
    }
    forkChosen.current = true;
    return toForkPlan(plan, card, itemCode);
  }

  const answer = (c: ShareChoice | null) => {
    pending?.resolve(c);
    setPending(null);
  };
  const element = <WeftShareQuestionDialog pending={pending} onAnswer={answer} />;
  return { resolvePlan, element };
}

function WeftShareQuestionDialog({ pending, onAnswer }: { pending: Pending | null; onAnswer: (c: ShareChoice | null) => void }) {
  const title = pending?.others ? `Bu atkı kartı ${pending.others} kumaşta daha kullanılıyor` : "Bu atkı kartı başka kumaşlarda da kullanılıyor olabilir";
  return (
    <Dialog open={!!pending} onOpenChange={(o) => !o && onAnswer(null)}>
      <DialogContent className="max-w-lg" data-testid="weft-share-question">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Ortak atkı kartı burada değiştirilmez. Değişikliği yalnız bu kumaşa mı uygulayalım, yoksa kartı Atkı Kartları ekranında mı açalım?</DialogDescription>
        </DialogHeader>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li>
            <strong className="text-foreground">Yalnız bu kumaş için kopya:</strong> bu kumaşa <span className="font-mono text-xs">{pending?.forkCode}</span> kodlu
            yeni kart açılır, değişiklik ona yazılır; öteki kumaşlar eski kartta kalır.
          </li>
          <li><strong className="text-foreground">Atkı Kartları ekranında aç:</strong> kartı kullanan bütün kumaşlar için orada düzeltin; bu kayıt yapılmaz.</li>
        </ul>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="ghost" onClick={() => onAnswer(null)}>Vazgeç</Button>
          <Button type="button" variant="outline" onClick={() => onAnswer("open")}>
            <ExternalLink className="mr-1.5 h-4 w-4" />Atkı Kartları ekranında aç
          </Button>
          <Button type="button" onClick={() => onAnswer("fork")}>Yalnız bu kumaş için kopya</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
