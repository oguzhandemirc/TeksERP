// =============================================================================
// KAPAT (bitiş anı) · GERİ AL (damga, sebep zorunlu)
// =============================================================================
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime, localInputToIso, nowLocalInput, type MachineStop } from "./types";

interface CloseProps {
  target: MachineStop;
  isPending: boolean;
  onClose: () => void;
  onConfirm: (endedAt: string | null) => void;
}

export function StopCloseDialog({ target, isPending, onClose, onConfirm }: CloseProps) {
  const [endedAt, setEndedAt] = useState(nowLocalInput());
  const iso = localInputToIso(endedAt);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Duruşu kapat — {target.machine.name}</DialogTitle>
          <DialogDescription>
            Başlangıç {formatDateTime(target.startedAt)}. Süre başlangıçtan hesaplanır; bitiş başlangıçtan önce olamaz (400). Bitiş en fazla 36 saat geriye / 5 dakika ileriye yazılabilir; dışı sunucu saatine kırpılır ve uyarıyla söylenir.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="stop-ended">Bitiş</Label>
          <Input id="stop-ended" type="datetime-local" value={endedAt} onChange={(e) => setEndedAt(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Vazgeç
          </Button>
          <Button disabled={iso === null || isPending} onClick={() => onConfirm(iso)}>
            Kapat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface RevokeProps {
  target: MachineStop;
  isPending: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}

export function StopRevokeDialog({ target, isPending, onClose, onConfirm }: RevokeProps) {
  const [reason, setReason] = useState("");
  const ok = reason.trim().length >= 3;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Duruş geri alınsın mı? — {target.machine.name}</DialogTitle>
          <DialogDescription>Damga: satır silinmez, `revokedAt` yazılır ve randımandan düşer. Gerekçe zorunlu (en az 3 karakter).</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="stop-revoke-reason">Gerekçe</Label>
          <Textarea id="stop-revoke-reason" rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Vazgeç
          </Button>
          <Button variant="destructive" disabled={!ok || isPending} onClick={() => onConfirm(reason.trim())}>
            Geri Al
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
