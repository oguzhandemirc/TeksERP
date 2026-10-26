// Kilit önizlemesi (yıkıcı işlem kuralı): kilit, aşağıdaki kişilerin KENDİ kapattığı türü yeniden açar.
// Her kişi tek tek seçilir; seçilmeyen kişi profilden çıkarılır (tercihi korunur).
import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { LockPreviewAffected } from "@/services/bildirimProfilService";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  affected: readonly LockPreviewAffected[];
  /** Salt bakış (Kaydet'ten gelmeyen önizleme) — seçim ve onay yok. */
  readOnly?: boolean;
  pending?: boolean;
  onConfirm: (kept: Set<string>) => void;
}

export function LockPreviewDialog({ open, onOpenChange, affected, readOnly, pending, onConfirm }: Props) {
  const [kept, setKept] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (open) setKept(new Set(affected.map((a) => a.userId)));
  }, [open, affected]);
  const dropped = affected.length - kept.size;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Lock className="h-4 w-4" /> Kilit önizlemesi</DialogTitle>
          <DialogDescription>
            {affected.length === 0
              ? "Bu kilit hiçbir üyenin tercihini ezmiyor."
              : `Kilit, ${affected.length} üyenin kendi kapattığı bildirimi yeniden açar. Seçili kişiler profilde kalır; seçimi kaldırılan kişi profilden çıkarılır ve kendi tercihi korunur.`}
          </DialogDescription>
        </DialogHeader>
        {affected.length > 0 && (
          <ul className="max-h-80 divide-y overflow-y-auto rounded-md border" aria-label="Tercihi ezilecek kişiler">
            {affected.map((a) => (
              <li key={a.userId}>
                <label className="flex cursor-pointer items-start gap-3 px-3 py-2 text-sm">
                  {!readOnly && (
                    <Checkbox
                      className="mt-0.5"
                      checked={kept.has(a.userId)}
                      aria-label={a.ad}
                      onCheckedChange={(v) =>
                        setKept((s) => {
                          const n = new Set(s);
                          if (v === true) n.add(a.userId);
                          else n.delete(a.userId);
                          return n;
                        })
                      }
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{a.ad}</span>
                    <span className="block text-xs text-muted-foreground">Kapattığı: {a.turler.map((t) => t.ad).join(", ")}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{readOnly ? "Kapat" : "Vazgeç"}</Button>
          {!readOnly && (
            <Button disabled={pending} onClick={() => onConfirm(kept)}>
              {dropped > 0 ? `Kaydet · ${dropped} kişi profilden çıkar` : "Kaydet"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
