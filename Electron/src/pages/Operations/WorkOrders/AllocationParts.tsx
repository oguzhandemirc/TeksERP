import { TERIM } from "@/lib/terim";
import { AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { fmtM, parseAllocationInput, type AllocationPreview } from "./order-allocation";

/**
 * "Paylaştır" diyaloğunun parçaları: satır metre
 * kutusu ve canlı özet şeridi. Özet YAZARKEN ÖNİZLEMEDİR; tavan sunucudan gelir.
 */

/** Satırdaki metre kutusu — boş = paylaştırma yok; geçersiz biçim kırmızı çerçeve. */
export function AllocationInput({
  value,
  onChange,
  disabled,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  label: string;
}) {
  const invalid = parseAllocationInput(value) === null;
  return (
    <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
      <Input
        type="text"
        inputMode="decimal"
        aria-label={label}
        aria-invalid={invalid || undefined}
        title={invalid ? "Geçersiz metre — binlik ayracı kullanmayın, virgül ondalıktır (ör. 800 ya da 250,5)" : undefined}
        className={cn("h-8 w-24 text-right tabular-nums", invalid && "border-destructive focus-visible:ring-destructive")}
        placeholder="—"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="text-xs text-muted-foreground">m</span>
    </div>
  );
}

/** "Giren 1000 m · Paylaştırılan 800 m · Kalan 200 m" — aşımda kırmızı; tavan yoksa yalnız toplam. */
export function AllocationSummaryBar({ preview }: { preview: AllocationPreview }) {
  const { basisLabel, basis, allocated, remaining, over } = preview;
  return (
    <div
      data-testid="allocation-summary"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-sm tabular-nums",
        over ? "border-destructive/40 bg-destructive/10" : "bg-muted/40",
      )}
    >
      {basisLabel && basis != null && (
        <span>
          {basisLabel} <strong>{fmtM(basis)} m</strong>
        </span>
      )}
      {basisLabel && <span className="text-muted-foreground">·</span>}
      <span>
        Paylaştırılan <strong>{fmtM(allocated)} m</strong>
      </span>
      {remaining != null && (
        <>
          <span className="text-muted-foreground">·</span>
          {over ? (
            <span className="flex items-center gap-1 font-medium text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" /> {fmtM(-remaining)} m fazla
            </span>
          ) : (
            <span>
              Kalan <strong>{fmtM(remaining)} m</strong>
            </span>
          )}
        </>
      )}
      {remaining == null && (
        <span className="text-xs text-muted-foreground">
          (tavan yok — {TERIM.terbiyeIsEmri.cekimKucuk.yonelme} top girmedi, hedef metre de yok)
        </span>
      )}
    </div>
  );
}
