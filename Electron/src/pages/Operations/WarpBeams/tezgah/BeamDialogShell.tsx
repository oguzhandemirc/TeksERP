// =============================================================================
// LEVENT TEZGAH BAĞI diyalogları — ortak kabuk + küçük alanlar (devere Faz 3 E2)
// =============================================================================
// Her diyalog aynı iskelete oturur: başlık · açıklama · gövde · Vazgeç/Onay. Sayı alanları METİN
// taşır ("" → null), uç sayı bekler — dönüşüm `num()`; `onError` toast'u yok (apiClient basar).
// =============================================================================
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { WARP_LENGTH_SOURCE_LABEL, type WarpLengthSource } from "../types";

interface ShellProps {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  ok: boolean;
  isPending: boolean;
  onClose: () => void;
  onConfirm: () => void;
  children: ReactNode;
  wide?: boolean;
}

export function BeamDialogShell(p: ShellProps) {
  return (
    <Dialog open onOpenChange={(o) => !o && p.onClose()}>
      <DialogContent className={p.wide ? "max-w-2xl" : "max-w-lg"}>
        <DialogHeader>
          <DialogTitle>{p.title}</DialogTitle>
          <DialogDescription>{p.description}</DialogDescription>
        </DialogHeader>
        {p.children}
        <DialogFooter>
          <Button variant="outline" onClick={p.onClose} disabled={p.isPending}>
            Vazgeç
          </Button>
          <Button variant={p.destructive ? "destructive" : "default"} disabled={!p.ok || p.isPending} onClick={p.onConfirm}>
            {p.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "" · geçersiz → null; uç `qty` (sayı ya da metin) kabul eder, panel sayı yollar. */
export function num(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function NumField({ id, label, value, onChange, min = 0, step = "0.001", hint }: { id: string; label: string; value: string; onChange: (v: string) => void; min?: number; step?: string; hint?: string }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" min={min} step={step} value={value} onChange={(e) => onChange(e.target.value)} />
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}

export function SourceSelect({ value, onChange, label = "Ölçüm kaynağı" }: { value: WarpLengthSource; onChange: (v: WarpLengthSource) => void; label?: string }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Select value={value} onValueChange={(v) => onChange(v as WarpLengthSource)}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(WARP_LENGTH_SOURCE_LABEL) as WarpLengthSource[]).map((k) => (
            <SelectItem key={k} value={k}>
              {WARP_LENGTH_SOURCE_LABEL[k]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function ReasonField({ id, value, onChange, label = "Açıklama (isteğe bağlı)", required = false }: { id: string; value: string; onChange: (v: string) => void; label?: string; required?: boolean }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Textarea id={id} rows={2} maxLength={300} value={value} onChange={(e) => onChange(e.target.value)} autoFocus={required} />
    </div>
  );
}

/** Sebep kataloğu seçici — kod listesi çağıran tarafından süzülür (kind + aktif). */
export function ReasonCodeSelect({ label, value, onChange, presets, placeholder = "Sebep seç" }: { label: string; value: string; onChange: (v: string) => void; presets: Array<{ code: string; label: string }>; placeholder?: string }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder={presets.length ? placeholder : "Katalogda aktif sebep yok"} />
        </SelectTrigger>
        <SelectContent>
          {presets.map((r) => (
            <SelectItem key={r.code} value={r.code}>
              {r.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
