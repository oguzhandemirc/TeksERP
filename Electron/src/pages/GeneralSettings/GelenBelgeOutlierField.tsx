// Gelen belge → el yazısı şüpheli değer oranı K (backend `gelenBelge.handwritingOutlierFactor`, tek yazar `PUT /ayarlar`).
// Metre blok medyanının 1/K'sından küçük ya da K katından büyükse satır "Şüpheli değer" etiketi + uyarı alır; yalnız
// yeni okumaya uygulanır. Eski backend alanı göndermez → alan çizilmez (yazılamayan ayar gösterilmez).
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { FieldLabel } from "./SettingRow";
import type { IncomingDocumentSettings } from "@/pages/Operations/GelenBelgeler/types";

/** Oran taslağı: metin tutulur (yazarken "1" ara değeri reddedilmez); geçerlilik aralığı sunucudan. */
export function useOutlierDraft(server: IncomingDocumentSettings | undefined) {
  const serverValue = server?.handwritingOutlierFactor;
  const range = server?.handwritingOutlierFactorRange ?? { min: 2, max: 20 };
  const [text, setText] = useState(serverValue === undefined ? "" : String(serverValue));
  const n = Number(text.replace(",", "."));
  const valid = text.trim() !== "" && Number.isFinite(n) && n >= range.min && n <= range.max;
  const dirty = serverValue !== undefined && valid && n !== serverValue;
  const invalid = serverValue !== undefined && !valid;
  const reset = () => setText(serverValue === undefined ? "" : String(serverValue));
  return { serverValue, range, text, setText, dirty, invalid, body: dirty ? { handwritingOutlierFactor: n } : {}, reset };
}

export function OutlierFactorField({ draft, defaultValue }: { draft: ReturnType<typeof useOutlierDraft>; defaultValue: number | undefined }) {
  if (draft.serverValue === undefined) return null;
  const k = Number(draft.text.replace(",", ".")) || defaultValue || 4;
  return (
    <div data-testid="gb-outlier-factor">
      <FieldLabel
        htmlFor="gb-outlier-factor-input"
        label="El yazısı şüpheli değer oranı"
        desc={`El yazısı belgede bir satırın metresi, aynı bloktaki değerlerin ortancasının ${k} katından büyük ya da ${k}'te birinden küçükse satır "Şüpheli değer" olarak işaretlenir ve taslakta uyarı çıkar (ör. 137 yerine 1370 okunması). Yalnız uyarıdır, onayı engellemez; yeni okunan sayfalara uygulanır. Küçük oran daha çok satırı işaretler.`}
      />
      <Input
        id="gb-outlier-factor-input"
        type="number"
        inputMode="decimal"
        min={draft.range.min}
        max={draft.range.max}
        step={0.5}
        value={draft.text}
        onChange={(e) => draft.setText(e.target.value)}
        className="mt-2 w-28"
        aria-invalid={draft.invalid}
      />
      {draft.invalid && <p className="mt-1 text-xs text-destructive">Oran {draft.range.min} ile {draft.range.max} arasında olmalı.</p>}
      <p className="mt-1 text-xs text-muted-foreground">Varsayılan: {defaultValue ?? 4}</p>
    </div>
  );
}
