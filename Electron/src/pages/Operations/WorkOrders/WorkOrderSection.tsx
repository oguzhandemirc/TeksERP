import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * İş emri detay yüzeylerinde (slide-over + tam sayfa) ortak "bölge" başlığı:
 * tonlu bant + kalın sol şerit + ikon çipi + bold renkli başlık + sağda
 * opsiyonel aksiyon. Her üretim bölgesi (künye / rota / üretilen / sipariş)
 * kendi tonuyla güçlü biçimde ayrışsın diye tek kaynak — renkler index.css
 * token'larıyla eşleşir.
 */
export type SectionTone = "neutral" | "primary" | "info" | "success" | "warning" | "process";

/** Başlık bandı — yumuşak tonlu zemin + ince çerçeve + kalın sol şerit. */
const BAND: Record<SectionTone, string> = {
  neutral: "border-border border-l-foreground/40 bg-muted/60",
  primary: "border-primary/25 border-l-primary bg-primary/10",
  info: "border-info/25 border-l-info bg-info/10",
  success: "border-success/25 border-l-success bg-success/10",
  warning: "border-warning/25 border-l-warning bg-warning/10",
  process: "border-station-process/25 border-l-station-process bg-station-process/10",
};

/** İkon çipi — dolu tonlu kare. */
const CHIP: Record<SectionTone, string> = {
  neutral: "bg-foreground/10 text-foreground/70",
  primary: "bg-primary/15 text-primary",
  info: "bg-info/15 text-info",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  process: "bg-station-process/15 text-station-process",
};

/** Başlık metni — tonun tam gücünde, bold. */
const TEXT: Record<SectionTone, string> = {
  neutral: "text-foreground/80",
  primary: "text-primary",
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  process: "text-station-process",
};

export function SectionBlock({
  id,
  title,
  tone = "primary",
  icon: Icon,
  trailing,
  children,
  className,
}: {
  /** Tam sayfada scroll-spy anchor'ı (slide-over'da verilmez). */
  id?: string;
  title: React.ReactNode;
  tone?: SectionTone;
  icon?: LucideIcon;
  /** Başlığın sağında aksiyon (ör. "Tümünü göster" toggle). */
  trailing?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cn(id && "scroll-mt-16", "space-y-3", className)}>
      <div
        className={cn(
          "flex items-center gap-2.5 rounded-lg border border-l-4 px-3 py-2 shadow-sm",
          BAND[tone],
        )}
      >
        {Icon && (
          <span
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
              CHIP[tone],
            )}
          >
            <Icon className="h-4 w-4" />
          </span>
        )}
        <h2 className={cn("min-w-0 flex-1 truncate text-sm font-bold uppercase tracking-wide", TEXT[tone])}>
          {title}
        </h2>
        {trailing}
      </div>
      {children}
    </section>
  );
}
