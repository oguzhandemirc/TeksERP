import { Input } from "@/components/ui/input";

export const MAX_LABEL_COPIES = 100;

/** 1–100 aralığına kırpılmış kopya adedi (geçersiz giriş → 1). */
export function clampCopies(raw: number): number {
  if (!Number.isFinite(raw)) return 1;
  return Math.min(MAX_LABEL_COPIES, Math.max(1, Math.trunc(raw)));
}

/**
 * Kopya adedi girişi (1–100) — test baskısı + bağımsız şablon baskısı ortak.
 * Değer her değişimde kırpılır; boş giriş 1'e düşer.
 */
export function CopiesInput({
  value,
  onChange,
  id = "label-copies",
  disabled,
}: {
  value: number;
  onChange: (n: number) => void;
  id?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-muted-foreground" htmlFor={id}>
        Kopya
      </label>
      <Input
        id={id}
        type="number"
        min={1}
        max={MAX_LABEL_COPIES}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(clampCopies(Number(e.target.value)))}
        className="h-8 w-20"
      />
    </div>
  );
}
