import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  open: boolean;
  nextNo: number;
  pending: boolean;
  /** Kayıt bitti ama uyarı var: pencere uyarıyı göstermek için açık kalır. */
  done: boolean;
  error: string | null;
  /** Kayıt dönüş uyarıları (ör. Excel varsayılan kolonlarla — TX). */
  warnings: string[];
  onSave: (note: string) => void;
  onClose: () => void;
}

/** "Taslağı kaydet": isteğe bağlı notla yeni değişmez sürüm (plan §3.5). */
export function SaveVersionDialog({ open, nextNo, pending, done, error, warnings, onSave, onClose }: Props) {
  const [note, setNote] = useState("");
  useEffect(() => {
    if (open) setNote("");
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Taslağı kaydet (v{nextNo})</DialogTitle>
          <DialogDescription>Kayıt yeni ve değişmez bir sürüm açar; yayındaki sürüm değişmez.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="surum-notu">Sürüm notu (isteğe bağlı)</Label>
          <Input id="surum-notu" value={note} maxLength={300} placeholder="Ör. logo büyütüldü" onChange={(e) => setNote(e.target.value)} />
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          {warnings.length > 0 && (
            <Callout tone="warning" title="Kayıt uyarıları">
              <ul className="list-disc pl-4 text-xs">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </Callout>
          )}
        </div>
        <DialogFooter>
          {done ? (
            <Button onClick={onClose}>Tamam</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>Vazgeç</Button>
              <Button disabled={pending} onClick={() => onSave(note)}>
                {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Kaydet
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
