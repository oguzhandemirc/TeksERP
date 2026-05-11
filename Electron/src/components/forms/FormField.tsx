import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * RHF'in array/nested error tipleri farklı union'lar üretir; biz sadece `message`'a
 * bakıyoruz. Esnek tip tut ki cast gerekmesin.
 */
interface FieldErrorLike {
  message?: string;
}

interface Props {
  label: string;
  htmlFor?: string;
  error?: FieldErrorLike;
  hint?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function FormField({ label, htmlFor, error, hint, required, children, className }: Props) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
      {error?.message && <p className="text-xs text-destructive">{error.message}</p>}
      {!error && hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
