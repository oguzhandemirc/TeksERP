import { useMemo, type Ref } from "react";
import { ScanLine, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  classifyBarcode,
  type BarcodeKind,
} from "@/lib/scanner/barcode-kind";

/** Tür → kullanıcıya gösterilecek kısa Türkçe ad (uyumsuzluk uyarısında). */
const KIND_LABEL: Record<BarcodeKind, string> = {
  ROLL: "top barkodu",
  TRAVELER_CARD: "refakat kartı",
  SWATCH: "kartela",
  SACK: "çuval kodu",
  DISPATCH_DOC: "sevk/kabul belgesi",
  UNKNOWN: "kod",
};

interface ScanFieldProps {
  value: string;
  onChange: (v: string) => void;
  /** Enter / butona basınca (veya wedge burst'ü tamamlanınca) doğrulanmış kodla çağrılır. */
  onScan: (code: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  /**
   * Beklenen tür(ler). Tanımlıysa, okunan kod farklı bir BİLİNEN türe aitse
   * (örn. top alanına refakat kartı) submit engellenir ve uyarı gösterilir.
   * Bilinmeyen (serbest) kodlar her zaman geçer.
   */
  expectPrefix?: BarcodeKind | BarcodeKind[];
  /** Tanımlıysa, input yanında bir submit butonu çizilir. */
  submitLabel?: string;
  busy?: boolean;
  busyLabel?: string;
  /** Dış sarmalayıcı sınıfı (border/padding sayfada kalır). */
  className?: string;
  /** Input kutusunun genişlik sınırı. */
  widthClassName?: string;
  /** Input'un kendi sınıfına ek/override (örn. yanındaki filtrelerle yükseklik eşitleme). */
  inputClassName?: string;
  /** Dolu iken input'un İÇİNDE temizleme (X) düğmesi göster → tek tıkla siler. */
  clearable?: boolean;
  /**
   * Odak disiplini için input ref'i — dialog kapanışı/aksiyon sonrası sayfa
   * `inputRef.current?.focus()` ile odağı okutma kutusuna geri verir
   * (operatör fare aramadan okutmaya devam eder).
   */
  inputRef?: Ref<HTMLInputElement>;
}

/**
 * Barkod okutma/elle giriş alanı — RelabelStation/SackContentEdit'teki
 * Input+ScanLine+Enter desenini paylaşan tek implementasyon. Klavye-wedge
 * tabancalar (kod + Enter) ve elle yazım aynı yoldan geçer. `expectPrefix` ile
 * yanlış-tür guard'ı (mobil FasonSevk davranışı) sunar. Backend tek doğruluk
 * kaynağıdır — istemci yalnız yanlış-tür uyarısı verir.
 */
export function ScanField({
  value,
  onChange,
  onScan,
  placeholder,
  autoFocus,
  expectPrefix,
  submitLabel,
  busy,
  busyLabel,
  className,
  widthClassName = "max-w-sm",
  inputClassName,
  clearable = false,
  inputRef,
}: ScanFieldProps) {
  const trimmed = value.trim();

  const mismatch = useMemo(() => {
    if (!trimmed) return null as string | null;
    const { kind } = classifyBarcode(trimmed);
    if (expectPrefix) {
      const allowed = Array.isArray(expectPrefix) ? expectPrefix : [expectPrefix];
      if (kind !== "UNKNOWN" && !allowed.includes(kind)) {
        const want = allowed.map((k) => KIND_LABEL[k]).join(" / ");
        return `Bu bir ${KIND_LABEL[kind]} — buraya ${want} okut.`;
      }
    }
    return null;
  }, [trimmed, expectPrefix]);

  const blocked = Boolean(mismatch);

  const submit = () => {
    // `busy` guard'ı ŞART: Enter yolu (onKeyDown) da bu fonksiyona düşer — buton
    // disabled iken (busy) klavye ile ikinci okutma tetiklenip mutasyon uçlarında
    // (örn. çuvala top okut) çift POST atmasın.
    if (!trimmed || blocked || busy) return;
    onScan(trimmed);
  };

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-center gap-2">
        <div className={cn("relative flex-1", widthClassName)}>
          <ScanLine className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder={placeholder}
            className={cn("pl-8", clearable && value && "pr-8", inputClassName)}
            autoFocus={autoFocus}
          />
          {clearable && value ? (
            <button
              type="button"
              onClick={() => onChange("")}
              aria-label="Temizle"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        {submitLabel && (
          <Button size="sm" onClick={submit} disabled={!trimmed || blocked || busy}>
            {busy ? (busyLabel ?? "…") : submitLabel}
          </Button>
        )}
      </div>
      {mismatch ? (
        <p className="text-xs text-destructive">{mismatch}</p>
      ) : null}
    </div>
  );
}
