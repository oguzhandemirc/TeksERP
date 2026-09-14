// =============================================================================
// KARNE DİYALOGLARI — terim düzeltme (M3) · mühür aç (M5, gerekçe ≥ 3)
// =============================================================================
// Düzeltme yalnız OPEN karnede; kaynak SUPERVISOR olur ve kapanış job'u artık
// bu satırı EZMEZ (elle düzeltilmiş terim korunur). Mühür açma geçmiş rakamı
// yeniden hesaba açar — 1e şartı ③: bu cümle kullanıcıya GÖRÜNÜR.
// =============================================================================
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ShiftStatRow, ShiftTermsCorrection } from "./service";

const TERM_FIELDS: Array<{ key: keyof ShiftTermsCorrection; label: string; unit: "sn" | "atkı" | "m" | "atkı/dk" }> = [
  { key: "nonScheduledSec", label: "Çalışma dışı", unit: "sn" },
  { key: "plannedBreakSec", label: "Planlı mola", unit: "sn" },
  { key: "setupSec", label: "Kurulum", unit: "sn" },
  { key: "plannedDownSec", label: "Planlı duruş", unit: "sn" },
  { key: "unplannedDownSec", label: "Plansız duruş", unit: "sn" },
  { key: "minorStopSec", label: "Mikro duruş", unit: "sn" },
  { key: "unitsActual", label: "Atkı", unit: "atkı" },
  { key: "producedM", label: "Metre", unit: "m" },
  { key: "targetUnitsPerMin", label: "Hedef devir", unit: "atkı/dk" },
];

interface TermsProps { target: ShiftStatRow; isPending: boolean; onClose: () => void; onConfirm: (body: ShiftTermsCorrection) => void }

export function TermsDialog({ target, isPending, onClose, onConfirm }: TermsProps) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const body: ShiftTermsCorrection = {};
  for (const [k, v] of Object.entries(draft)) {
    if (v.trim() === "") continue;
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) (body as Record<string, number>)[k] = k === "producedM" ? n : Math.round(n);
  }
  const ok = Object.keys(body).length > 0;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Karne terimlerini düzelt — {target.machine.name} · {target.shiftInstance.shiftDefinition.name}</DialogTitle>
          <DialogDescription>
            Yalnız doldurduğunuz alanlar değişir. Kaynak "elle (amir)" olur; kapanış işi bu karneyi bir daha yeniden hesaplamaz. Planlı ve çalışma süresi buradan yeniden türetilir; hedef devir verilirse kapasite tek hedeften hesaplanır (koşum kesişimi yeniden kurulmaz).
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {TERM_FIELDS.map((f) => (
            <div key={f.key} className="space-y-1">
              <Label htmlFor={`karne-${f.key}`}>{f.label} ({f.unit})</Label>
              <Input id={`karne-${f.key}`} type="number" min={0} step={f.key === "producedM" ? "0.001" : "1"} placeholder={String((target.terms as Record<string, unknown>)[f.key] ?? "")} value={draft[f.key] ?? ""} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Vazgeç</Button>
          <Button disabled={!ok || isPending} onClick={() => onConfirm(body)}>Düzelt</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface UnsealProps { target: ShiftStatRow; isPending: boolean; onClose: () => void; onConfirm: (reason: string) => void }

export function UnsealDialog({ target, isPending, onClose, onConfirm }: UnsealProps) {
  const [reason, setReason] = useState("");
  const ok = reason.trim().length >= 3;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Mühür açılsın mı? — {target.machine.name} · {target.shiftInstance.shiftDefinition.name}</DialogTitle>
          <DialogDescription>
            Mühürlü karne RESMİ rakamdır. Açınca kuşak {target.sealGeneration} defterde kalır, karne yeniden hesaplanabilir hâle gelir (kapanış işi elle düzeltilmiş satıra dokunmaz) ve yeniden mühürlenmelidir. Gerekçe zorunlu (en az 3 karakter) ve deftere yazılır.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="karne-unseal-reason">Gerekçe</Label>
          <Textarea id="karne-unseal-reason" rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Vazgeç</Button>
          <Button variant="destructive" disabled={!ok || isPending} onClick={() => onConfirm(reason.trim())}>Mührü Aç</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
