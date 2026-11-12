import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ROW_MARK_NOTE_MAX, type RowMark, type RowMarkInput } from "@/services/rowMarkService";

interface Props {
  /** Düzenlenen kaydın KENDİ işareti (yoksa null); kapalıyken `open=false`. */
  open: boolean;
  mark: RowMark | null;
  onClose: () => void;
  onSave: (patch: Pick<RowMarkInput, "note" | "shared">) => void;
}

/** Küçük not penceresi: metin (≤500) + "Herkese açık"; Sil notu boşaltır (renk kalır, ikisi boşsa işaret gider). */
export function RowMarkNoteDialog({ open, mark, onClose, onSave }: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      {/* key: her açılışta form işaretin güncel değerinden doğar. */}
      {open ? <NoteForm key={mark?.updatedAt ?? "new"} mark={mark} onClose={onClose} onSave={onSave} /> : null}
    </Dialog>
  );
}

function NoteForm({ mark, onClose, onSave }: Omit<Props, "open">) {
  const [text, setText] = useState(mark?.note ?? "");
  const [shared, setShared] = useState(mark?.shared ?? false);
  const save = (note: string | null) => {
    onSave({ note: note?.trim() ? note.trim() : null, shared });
    onClose();
  };
  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Satır notu</DialogTitle>
        <DialogDescription>Not yalnız size görünür; "Herkese açık" seçilirse adınızla herkes görür.</DialogDescription>
      </DialogHeader>
      <Textarea
        aria-label="Not"
        value={text}
        maxLength={ROW_MARK_NOTE_MAX}
        rows={4}
        autoFocus
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <label className="flex items-center gap-2">
          <Switch checked={shared} onCheckedChange={setShared} aria-label="Herkese açık" />
          Herkese açık
        </label>
        <span className="tabular-nums">
          {text.length}/{ROW_MARK_NOTE_MAX}
        </span>
      </div>
      <DialogFooter>
        {mark?.note ? (
          <Button type="button" variant="outline" className="mr-auto" onClick={() => save(null)}>
            Notu sil
          </Button>
        ) : null}
        <Button type="button" variant="ghost" onClick={onClose}>
          Vazgeç
        </Button>
        <Button type="button" onClick={() => save(text)}>
          Kaydet
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
