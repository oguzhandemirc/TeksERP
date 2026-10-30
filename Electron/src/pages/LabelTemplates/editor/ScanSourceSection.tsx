// =============================================================================
// Etiket Stüdyosu — barkod/QR kaynağı (D4-F3): Top barkodu | Müşteri barkodu
// =============================================================================
// ROLL seçilince `source` anahtarı elemandan KALDIRILIR (undefined → JSON'a yazılmaz):
// kaynağa hiç dokunulmamış şablonla bayt-aynı kalır.
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { LabelElement, ScanSource } from "@/types/label-canvas";

export const SCAN_SOURCE_OPTIONS: { value: ScanSource; label: string }[] = [
  { value: "ROLL", label: "Top barkodu" },
  { value: "CUSTOMER_CODE", label: "Müşteri barkodu" },
];

export function scanSourcePatch(value: ScanSource): Partial<LabelElement> {
  return { source: value === "ROLL" ? undefined : value } as Partial<LabelElement>;
}

export function ScanSourceSection({ element: el, onChange }: {
  element: LabelElement;
  onChange: (patch: Partial<LabelElement>) => void;
}) {
  if (el.type !== "qr" && el.type !== "code128") return null;
  const current: ScanSource = el.source ?? "ROLL";
  return (
    <div className="space-y-1">
      <Label className="text-xs">Kaynak</Label>
      <div className="flex gap-1" role="radiogroup" aria-label="Barkod kaynağı">
        {SCAN_SOURCE_OPTIONS.map((o) => (
          <Button
            key={o.value}
            type="button"
            size="sm"
            role="radio"
            aria-checked={current === o.value}
            variant={current === o.value ? "default" : "outline"}
            onClick={() => onChange(scanSourcePatch(o.value))}
          >
            {o.label}
          </Button>
        ))}
      </div>
      {current === "CUSTOMER_CODE" && (
        <p className="text-[11px] text-muted-foreground">
          Topa bağlanmış müşteri barkodu basılır. Kodu olmayan topta ne olacağı Genel Ayarlar → Etiket Baskısı →
          “Müşteri barkodu yoksa” ayarındadır (varsayılan: basılmaz).
        </p>
      )}
    </div>
  );
}
