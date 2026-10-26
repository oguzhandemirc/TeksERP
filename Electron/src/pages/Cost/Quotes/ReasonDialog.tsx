// Ret / iptal sebebi (sunucuda ret için zorunlu, iptal için isteğe bağlı; en çok 300 karakter).
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: string;
  required: boolean;
  busy: boolean;
  onConfirm: (reason: string) => void;
}

export function ReasonDialog({ open, onOpenChange, title, description, required, busy, onConfirm }: Props) {
  const [reason, setReason] = useState("");
  const ok = !required || reason.trim().length > 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <label className="block text-sm">
          <span className="text-muted-foreground">Sebep{required ? " *" : " (isteğe bağlı)"}</span>
          <Textarea className="mt-1" rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Sebep" />
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Vazgeç</Button>
          <Button variant="destructive" disabled={!ok || busy} onClick={() => onConfirm(reason.trim())}>{busy ? "İşleniyor…" : title}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
