// Kesin birim fiyat hücresi: 2 hane doğrulaması istemcide (biçim), değer sunucuya PATCH; tutar yanıttan gelir.
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { decToInput } from "../shared/format";
import { checkUnitPrice, samePriceText } from "./price-input";

interface Props { value: string; disabled?: boolean; onCommit: (text: string) => void; label: string }

export function PriceCell({ value, disabled, onCommit, label }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? decToInput(value);
  const check = draft === null ? null : checkUnitPrice(draft);
  const commit = () => {
    if (!check) return;
    if (!check.ok) return;
    setDraft(null);
    if (!samePriceText(check.text, value)) onCommit(check.text);
  };
  return (
    <div className="space-y-0.5">
      <Input
        aria-label={label}
        inputMode="decimal"
        disabled={disabled}
        className={cn("h-8 w-24 text-right tabular-nums", check && !check.ok && "ring-2 ring-destructive")}
        value={shown}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setDraft(null);
        }}
      />
      {check && !check.ok && <p role="alert" className="text-xs text-destructive">{check.error}</p>}
    </div>
  );
}
