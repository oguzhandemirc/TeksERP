import { useMemo, type Ref } from "react";
import { ScanLine } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  classifyBarcode,
  BARCODE_FORMATS,
  type BarcodeKind,
} from "@/lib/scanner/barcode-kind";
import { verifyBarcode, verifyPrefixedBarcode } from "@/lib/scanner/barcode";

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
  /** RK-/SW- gibi checksum'lı kodlarda checksum'ı kontrol et (uyarı, ENGELLEMEZ). */
  validateChecksum?: boolean;
  /** Tanımlıysa, input yanında bir submit butonu çizilir. */
  submitLabel?: string;
  busy?: boolean;
  busyLabel?: string;
  /** Dış sarmalayıcı sınıfı (border/padding sayfada kalır). */
  className?: string;
  /** Input kutusunun genişlik sınırı. */
  widthClassName?: string;
  /**
   * Odak disiplini için input ref'i — dialog kapanışı/aksiyon sonrası sayfa
   * `inputRef.current?.focus()` ile odağı okutma kutusuna geri verir
   * (operatör fare aramadan okutmaya devam eder).
   */
  inputRef?: Ref<HTMLInputElement>;
}

/**
 * Barkod okutma/elle giriş alanı — RelabelStation/SackSearch'teki
 * Input+ScanLine+Enter desenini paylaşan tek implementasyon. Klavye-wedge
 * tabancalar (kod + Enter) ve elle yazım aynı yoldan geçer. `expectPrefix` ile
 * yanlış-tür guard'ı (mobil FasonSevk davranışı), `validateChecksum` ile
 * checksum ipucu sunar. Backend tek doğruluk kaynağıdır — checksum submit'i
 * engellemez, yalnız uyarır.
 */
export function ScanField({
  value,
  onChange,
  onScan,
  placeholder,
  autoFocus,
  expectPrefix,
  validateChecksum,
  submitLabel,
  busy,
  busyLabel,
  className,
  widthClassName = "max-w-sm",
  inputRef,
}: ScanFieldProps) {
  const trimmed = value.trim();

  const { mismatch, checksumWarn } = useMemo(() => {
    if (!trimmed) return { mismatch: null as string | null, checksumWarn: false };
    const { kind, code } = classifyBarcode(trimmed);

    let mismatchMsg: string | null = null;
    if (expectPrefix) {
      const allowed = Array.isArray(expectPrefix) ? expectPrefix : [expectPrefix];
      if (kind !== "UNKNOWN" && !allowed.includes(kind)) {
        const want = allowed.map((k) => KIND_LABEL[k]).join(" / ");
        mismatchMsg = `Bu bir ${KIND_LABEL[kind]} — buraya ${want} okut.`;
      }
    }

    // Checksum ipucu (yalnız tam-formatlı RK-/SW- kodlarda, engellemez).
    let warn = false;
    if (validateChecksum && !mismatchMsg) {
      if (BARCODE_FORMATS.TRAVELER_CARD.test(code)) warn = !verifyBarcode(code);
      else if (BARCODE_FORMATS.SWATCH.test(code)) warn = !verifyPrefixedBarcode("SW", code);
    }
    return { mismatch: mismatchMsg, checksumWarn: warn };
  }, [trimmed, expectPrefix, validateChecksum]);

  const blocked = Boolean(mismatch);

  const submit = () => {
    if (!trimmed || blocked) return;
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
            className="pl-8"
            autoFocus={autoFocus}
          />
        </div>
        {submitLabel && (
          <Button size="sm" onClick={submit} disabled={!trimmed || blocked || busy}>
            {busy ? (busyLabel ?? "…") : submitLabel}
          </Button>
        )}
      </div>
      {mismatch ? (
        <p className="text-xs text-destructive">{mismatch}</p>
      ) : checksumWarn ? (
        <p className="text-xs text-amber-600 dark:text-amber-500">
          Checksum tutmuyor — kod yanlış okunmuş olabilir, yine de deneyebilirsin.
        </p>
      ) : null}
    </div>
  );
}
