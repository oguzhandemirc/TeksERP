// K30-T A3: kayıttan önce "bu belge mevcut bir tipe benziyor" sorusu (tablet `SimilarDialog` aynası). Aynı inputa giden farklı
// ifadeler farklı belge tiplerinde → her tip ayrı şablon; benzerse ya o tip güncellenir ya bilerek yeni tip açılır.
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { SimilarTemplate } from "./types";

interface Props {
  similar: readonly SimilarTemplate[] | null;
  /** Güncellenen şablonun adı (güncelle kipi); null = yeni tip. */
  currentName: string | null;
  onSame: (kod: string) => void;
  onNew: () => void;
  onDismiss: () => void;
}

export function SimilarDialog({ similar, currentName, onSame, onNew, onDismiss }: Props) {
  const first = similar?.[0];
  return (
    <Dialog open={Boolean(similar && similar.length > 0)} onOpenChange={(o) => !o && onDismiss()}>
      <DialogContent className="max-w-lg" data-testid="teach-similar">
        <DialogHeader>
          <DialogTitle>{first ? `Bu belge “${first.ad}” tipine benziyor` : "Benzer belge tipi"}</DialogTitle>
          <DialogDescription>Aynı tipse o şablonu bu belgeyle güncelleyin; farklı bir belge tipiyse yeni tip olarak kaydedin.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {(similar ?? []).map((s) => (
            <Button key={s.kod} onClick={() => onSame(s.kod)} data-testid={`teach-similar-same-${s.kod}`}>Aynı tip — “{s.ad}” güncellensin</Button>
          ))}
          <Button variant="outline" onClick={onNew} data-testid="teach-similar-new">{currentName ? `Hayır — “${currentName}” güncellensin` : "Yeni tip olarak kaydet"}</Button>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onDismiss}>Vazgeç</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
