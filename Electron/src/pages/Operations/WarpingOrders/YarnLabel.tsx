// Devere yüzeylerinde iplik gösterimi TEK yerden: ADI birincil (normal yazı), stok kodu küçük ikincil (muted).
// Ad yoksa (eski sunucu yanıtı) kod birincil kalır; ad = kod ise kod tekrar yazılmaz.
import { cn } from "@/lib/utils";

export function yarnLabelParts(name?: string | null, code?: string | null): { primary: string; secondary: string | null } {
  const n = name?.trim() || "";
  const c = code?.trim() || "";
  return { primary: n || c || "iplik", secondary: n && c && c !== n ? c : null };
}

/** Düz metin bağlamı (başlık, aria, yazdırma, birleşik satır): "ad (kod)". */
export function yarnText(name?: string | null, code?: string | null): string {
  const p = yarnLabelParts(name, code);
  return p.secondary ? `${p.primary} (${p.secondary})` : p.primary;
}

interface Props {
  name?: string | null;
  code?: string | null;
  /** Adın önüne (ör. "A · "). */
  prefix?: string;
  /** Kodun yanına ikincil bilgi (sevk · lot …). */
  extra?: string;
  /** İki satır: ad üstte, kod (+ extra) altta. */
  stacked?: boolean;
  className?: string;
}

export function YarnLabel({ name, code, prefix, extra, stacked, className }: Props) {
  const p = yarnLabelParts(name, code);
  const second = [p.secondary, extra].filter(Boolean).join(" · ");
  if (stacked) {
    return (
      <span className={cn("block leading-tight", className)}>
        <span className="block">{prefix}{p.primary}</span>
        {second && <span className="block text-xs text-muted-foreground">{second}</span>}
      </span>
    );
  }
  return (
    <span className={className}>
      {prefix}{p.primary}
      {second && <>{" "}<span className="ml-0.5 text-xs text-muted-foreground">{second}</span></>}
    </span>
  );
}
