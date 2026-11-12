import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

interface Props {
  title: string;
  /** Bölümde dolu değer varsa açık gelir — kapalı bölümde kayıtlı veri gözden kaçmasın. */
  defaultOpen?: boolean;
  /** Doğrulama hatası bölümün içindeyse zorla açık — kapalı bölümde hata görünmezdi. */
  forceOpen?: boolean;
  children: ReactNode;
  testId?: string;
}

/** Az kullanılan form alanları için kapalı gelen bölüm; görünüm `NoteHeaderForm` "Diğer bilgiler" ile aynı. */
export function CollapsibleFormSection({ title, defaultOpen = false, forceOpen = false, children, testId }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      open={open || forceOpen}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="group border-t pt-3"
      data-testid={testId}
    >
      <summary className="flex cursor-pointer select-none list-none items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" aria-hidden />
        {title}
      </summary>
      <div className="mt-3 space-y-3">{children}</div>
    </details>
  );
}
