import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Bölüm rengi — form başlığı ile sağ önizleme aynı kavramda aynı tonu kullanır. */
export type SectionTone =
  | "primary"
  | "slate"
  | "blue"
  | "indigo"
  | "emerald"
  | "violet"
  | "amber";

export const SECTION_TONE: Record<
  SectionTone,
  { icon: string; badge: string; border: string }
> = {
  primary: { icon: "text-primary", badge: "bg-primary", border: "border-l-primary" },
  slate: { icon: "text-slate-500", badge: "bg-slate-500", border: "border-l-slate-400" },
  blue: { icon: "text-blue-500", badge: "bg-blue-500", border: "border-l-blue-500" },
  indigo: { icon: "text-indigo-500", badge: "bg-indigo-500", border: "border-l-indigo-500" },
  emerald: { icon: "text-emerald-500", badge: "bg-emerald-500", border: "border-l-emerald-500" },
  violet: { icon: "text-violet-500", badge: "bg-violet-500", border: "border-l-violet-500" },
  amber: { icon: "text-amber-600", badge: "bg-amber-500", border: "border-l-amber-500" },
};

/**
 * Numaralı, başlıklı form bölümü kartı. Uzun formlarda bölümleri görsel olarak
 * ayırır; numara "önce şunu doldur" sırasını, "Zorunlu/Opsiyonel" rozeti hangi
 * bölümün şart olduğunu belli eder. İkon + ton (renkli sol şerit + numara rozeti)
 * bölümün ne olduğunu hızlıca okutur. İçeride düz `FormField`'lar ya da kendi
 * kabuğu olan bloklar (rota editörü, kapsama paneli) yer alabilir.
 */
interface Props {
  /** Sıra rozeti (1, 2, 3…). Atlanırsa numara gösterilmez. */
  step?: number;
  title: string;
  description?: string;
  /** Başlık ikonu — bölümün ne olduğunu simgeler. */
  icon?: LucideIcon;
  /** Renk tonu — ikon/numara/sol şerit. Önizleme ile aynı kavramda aynı ton. */
  tone?: SectionTone;
  /** "Zorunlu" rozeti — bölümde doldurulması şart input var. */
  required?: boolean;
  /** "Opsiyonel" rozeti — bölüm atlanabilir. */
  optional?: boolean;
  /** Sağ üst köşe — aksiyon butonu / ek rozet. */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Gövde padding'ini kaldır (içerik kendi boşluğunu yönetiyorsa). */
  flush?: boolean;
}

export function FormSection({
  step,
  title,
  description,
  icon: Icon,
  tone = "primary",
  required,
  optional,
  aside,
  children,
  className,
  flush,
}: Props) {
  const t = SECTION_TONE[tone];
  return (
    <section
      className={cn(
        "overflow-hidden rounded-lg border border-l-4 bg-card shadow-sm",
        t.border,
        className,
      )}
    >
      <header className="flex items-center gap-3 border-b bg-muted/30 px-4 py-2.5">
        {step != null && (
          <span
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white shadow-sm",
              t.badge,
            )}
          >
            {step}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold leading-tight">
              {Icon && <Icon className={cn("h-4 w-4 shrink-0", t.icon)} />}
              {title}
            </h3>
            {required && (
              <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none tracking-wide text-destructive">
                Zorunlu
              </span>
            )}
            {optional && (
              <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none tracking-wide text-blue-600 dark:text-blue-400">
                Opsiyonel
              </span>
            )}
          </div>
          {description && (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {aside && <div className="shrink-0">{aside}</div>}
      </header>
      <div className={cn(!flush && "space-y-3 p-4")}>{children}</div>
    </section>
  );
}
