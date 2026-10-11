// Nöbet değişikliği formu — tek bir vardiya penceresinde (gün × vardiya) holün kademe sorumlusunun YERİNE geçer.
// Yalnız bitmemiş, iptal edilmemiş pencereler seçilebilir (backend de reddeder).
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtFactoryTime } from "@/lib/factory-time";
import { shiftWindowLabel, type PersonOption } from "./duty-model";
import { OptionPickerField } from "./OptionPickerModal";
import { TierToggle } from "./TierToggle";
import type { DutyRef, DutyShiftInstance, DutyTier, OverrideBody } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  halls: readonly DutyRef[];
  windows: readonly DutyShiftInstance[];
  people: readonly PersonOption[];
  busy: boolean;
  onSubmit: (body: OverrideBody) => Promise<boolean>;
}

export function OverrideFormDialog({ open, onOpenChange, halls, windows, people, busy, onSubmit }: Props) {
  const [shiftInstanceId, setWindow] = useState<string | null>(null);
  const [stationId, setHall] = useState<string | null>(null);
  const [tier, setTier] = useState<DutyTier>(1);
  const [userId, setUser] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const writable = windows.filter((w) => !w.ended && !w.isCancelled);
  const ready = Boolean(shiftInstanceId && stationId && userId);
  const submit = async () => {
    if (!shiftInstanceId || !stationId || !userId) return;
    const ok = await onSubmit({ shiftInstanceId, stationId, tier, userId, note: note.trim() || null });
    if (ok) onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nöbet değişikliği</DialogTitle>
          <DialogDescription>Seçilen vardiyada holün sorumlusunun yerine bu kişiye bildirilir.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Vardiya</Label>
            <OptionPickerField value={shiftInstanceId} onChange={setWindow} title="Vardiya seç" placeholder="Vardiya seç"
              options={writable.map((w) => ({ id: w.id, label: shiftWindowLabel(w), subLabel: `${fmtFactoryTime(w.startsAt)} – ${fmtFactoryTime(w.endsAt)}` }))} />
          </div>
          <div className="space-y-1">
            <Label>Hol</Label>
            <OptionPickerField value={stationId} onChange={setHall} title="Hol seç" placeholder="Hol seç" options={halls.map((h) => ({ id: h.id, label: h.name }))} />
          </div>
          <div className="space-y-1">
            <Label>Kademe</Label>
            <TierToggle value={tier} onChange={setTier} />
          </div>
          <div className="space-y-1">
            <Label>Kişi</Label>
            <OptionPickerField value={userId} onChange={setUser} title="Nöbetçi seç" placeholder="Kişi seç" options={people} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="duty-note">Not (isteğe bağlı)</Label>
            <Input id="duty-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Vazgeç</Button>
          <Button type="button" disabled={!ready || busy} onClick={() => void submit()}>Kaydet</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
