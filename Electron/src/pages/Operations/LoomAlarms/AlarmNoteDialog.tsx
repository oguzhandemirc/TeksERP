// Alarma not ekleme — not silinmez, değişmez; yanlışsa yazan geri çeker (ayrı satır).
// Diyalog KOŞULLU mount edilir: her açılış yeni metin; token denemesi eylem hook'unda.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

const NOTE_MAX = 500;

interface Props {
  onClose: () => void;
  /** Başarıda sonuç, hatada `undefined` döner (hata cümlesini eylem hook'u basar). */
  onSubmit: (text: string) => Promise<unknown>;
  pending: boolean;
}

export function AlarmNoteDialog({ onClose, onSubmit, pending }: Props) {
  const [text, setText] = useState("");
  const trimmed = text.trim();
  const submit = async () => {
    const res = await onSubmit(trimmed);
    if (res !== undefined) onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Alarma not ekle</DialogTitle>
          <DialogDescription>Not alarmın zaman çizgisine yazılır; silinmez, yalnız yazan geri çekebilir.</DialogDescription>
        </DialogHeader>
        <Textarea
          autoFocus
          value={text}
          maxLength={NOTE_MAX}
          rows={4}
          placeholder="Örn. çözgü ipi değiştirildi, tezgah 5 dk içinde çalışır"
          onChange={(e) => setText(e.target.value)}
        />
        <p className="text-right text-xs text-muted-foreground">
          {text.length}/{NOTE_MAX}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Vazgeç
          </Button>
          <Button onClick={() => void submit()} disabled={pending || trimmed.length === 0}>
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
