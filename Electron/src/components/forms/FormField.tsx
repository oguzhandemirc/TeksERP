import type { ReactNode } from "react";
import { Info, AlertTriangle } from "lucide-react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * RHF'in array/nested error tipleri farklı union'lar üretir; biz sadece `message`'a
 * bakıyoruz. Esnek tip tut ki cast gerekmesin.
 */
interface FieldErrorLike {
  message?: string;
}

/** İpucu tonu: nötr açıklama (muted), dikkat çeken bilgi (info), uyarı (warning). */
type HintTone = "muted" | "info" | "warning";

interface Props {
  label: string;
  htmlFor?: string;
  error?: FieldErrorLike;
  hint?: ReactNode;
  hintTone?: HintTone;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function FormField({
  label,
  htmlFor,
  error,
  hint,
  hintTone = "muted",
  required,
  children,
  className,
}: Props) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="ml-0.5 font-bold text-destructive">*</span>}
      </Label>
      {children}
      {error?.message && (
        <p className="flex items-start gap-1 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error.message}</span>
        </p>
      )}
      {!error && hint && <FieldHint tone={hintTone}>{hint}</FieldHint>}
    </div>
  );
}

/** İpucu satırı — tona göre renk + ikon. Uyarı/bilgi görsel olarak ayrışır. */
function FieldHint({ tone, children }: { tone: HintTone; children: ReactNode }) {
  if (tone === "muted") {
    return <p className="text-xs text-muted-foreground">{children}</p>;
  }
  const Icon = tone === "warning" ? AlertTriangle : Info;
  return (
    <p
      className={cn(
        "flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-xs",
        tone === "warning"
          ? "border-warning/30 bg-warning/10 text-warning"
          : "border-info/30 bg-info/10 text-info",
      )}
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span className="text-foreground/80 [&_strong]:font-semibold [&_strong]:text-foreground">
        {children}
      </span>
    </p>
  );
}
