import { useEffect, useState } from "react";
import { StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Tek seferlik baskı notu alanı — kalıcı şablona YAZILMAZ; yalnız o baskının
 * HTML'ine girer (?printNote=). Belge görüntüleyicilerin versiyon çubuğu altına konur.
 *
 * Yazarken ANINDA render tetiklemez (eskiden her harf yeniden render ediyordu):
 * metin yerel tutulur, yalnız "Ekle" tuşu (veya Enter) ile uygulanır → onChange.
 */
export function PrintNoteField({
  value,
  onChange,
  disabled,
}: {
  /** Uygulanan (render'a giren) not. */
  value: string;
  /** Yalnız "Ekle"/Enter ile çağrılır — uygulanan notu iletir. */
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  // Yerel taslak metin — value dışarıdan değişirse (modal reset) senkronla.
  const [text, setText] = useState(value);
  useEffect(() => {
    setText(value);
  }, [value]);

  const dirty = text !== value;
  const apply = () => {
    if (!disabled && dirty) onChange(text);
  };

  return (
    <div className="flex items-center gap-2">
      <StickyNote className="h-4 w-4 shrink-0 text-muted-foreground" />
      <input
        value={text}
        maxLength={300}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            apply();
          }
        }}
        placeholder="Bu baskıya özel not (kaydedilmez — yalnız çıktıya basılır)…"
        className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <Button
        type="button"
        size="sm"
        variant={dirty ? "default" : "outline"}
        disabled={disabled || !dirty}
        onClick={apply}
        className="h-8 shrink-0"
        title="Notu çıktıya uygula (yazarken önizleme yenilenmez)"
      >
        Ekle
      </Button>
    </div>
  );
}
