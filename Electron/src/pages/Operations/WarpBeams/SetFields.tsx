// =============================================================================
// RAŞEL TAKIMI (#23) — "Adet" + gövde no öneki; iplik satırları TOPLAM girilir, levent başına pay ipucu
// =============================================================================
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatKg } from "./types";

interface Props {
  count: string;
  setCount: (v: string) => void;
  prefix: string;
  setPrefix: (v: string) => void;
  /** Girilen iplik çıkışı toplamı (kg) — levent başına pay ipucu için. */
  issueTotalKg: number;
  nominalKg: number | null;
}

/** Adet 1 = bugünkü tek levent (alan gönderilmez); N>1 → N−1 kardeş aynı işlemde doğar, iplik ÷ N. */
export function SetFields({ count, setCount, prefix, setPrefix, issueTotalKg, nominalKg }: Props) {
  const n = Number(count);
  const many = Number.isInteger(n) && n > 1;
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1">
        <Label htmlFor="wb-set-count">Adet (raşel takımı)</Label>
        <Input id="wb-set-count" type="number" min={1} max={24} step={1} value={count} onChange={(e) => setCount(e.target.value)} />
        <p className="text-muted-foreground text-xs">
          {many
            ? `${n} levent birlikte doğar; iplik satırları TOPLAMDIR — levent başına ≈ ${formatKg(issueTotalKg / n)}${nominalKg != null ? ` (nominal ${formatKg(nominalKg)}/levent)` : ""}.`
            : "1 = tek levent (bugünkü). Raşel takımında N yazın: N ayrı levent doğar, iplik payı N'e bölünür."}
        </p>
      </div>
      {many && (
        <div className="space-y-1">
          <Label htmlFor="wb-set-prefix">Gövde no öneki (isteğe bağlı)</Label>
          <Input id="wb-set-prefix" maxLength={28} value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="ör. R7 → R7-1 … R7-N" />
        </div>
      )}
    </div>
  );
}
