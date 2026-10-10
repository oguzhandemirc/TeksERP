// =============================================================================
// ARŞİVLE / GERİ AL — önce takvim etkisi (her pencere listelenir), sonra onay
// =============================================================================
// Arşiv bir DURUM GEÇİŞİDİR (silme yok): başlamamış pencereler takvim sebebiyle iptal
// edilir, geçmiş/başlamış/mühürlü değişmez. Pencere seçimi YOK: takvim tanımdan türer,
// tanımı arşivlenmiş bir pencereyi tutmak kuralla çelişirdi (job yeniden iptal ederdi).
// =============================================================================
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { shiftDefinitionService } from "./service";
import { ShiftPreviewList } from "./ShiftPreviewList";
import type { ShiftDefinition } from "./types";

interface Props {
  target: ShiftDefinition;
  isPending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function ShiftActiveDialog({ target, isPending, onClose, onConfirm }: Props) {
  const archive = target.isActive;
  const preview = useQuery({
    queryKey: ["shift-definitions-preview-active", target.id, archive],
    queryFn: () => shiftDefinitionService.preview({ id: target.id, active: !archive }),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {archive ? "Arşivlensin mi?" : "Geri alınsın mı?"} — {target.code} · {target.name}
          </DialogTitle>
          <DialogDescription>
            {archive
              ? "Tanım silinmez, arşive alınır. Önümüzdeki BAŞLAMAMIŞ vardiya pencereleri iptal edilir; geçmiş vardiyalar ve mühürlü karneler değişmez."
              : "Tanım yeniden etkin olur; takvimin iptal ettiği gelecek pencereler geri gelir, eksikler doğar."}
          </DialogDescription>
        </DialogHeader>
        {preview.isLoading && <p className="text-muted-foreground text-sm">Takvim etkisi hesaplanıyor…</p>}
        {preview.isError && <p className="text-destructive text-sm">Takvim etkisi okunamadı — işlem yine de yapılabilir, sonuç bildirimde yazar.</p>}
        {preview.data && <ShiftPreviewList preview={preview.data.data} />}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Vazgeç
          </Button>
          <Button variant={archive ? "destructive" : "default"} disabled={isPending || preview.isLoading} onClick={onConfirm}>
            {archive ? "Arşivle" : "Geri Al"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
