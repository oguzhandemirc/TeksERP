import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { FadeInUp } from "@/components/motion";

interface Props {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/** Dostça boş/hata durumu — ikon + başlık + opsiyonel açıklama/aksiyon, yumuşak giriş. */
export function EmptyState({ icon: Icon, title, description, action, className }: Props) {
  return (
    <FadeInUp
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-4 py-10 text-center",
        className,
      )}
    >
      {Icon && (
        <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="h-5 w-5" />
        </div>
      )}
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-xs text-xs text-muted-foreground">{description}</p>}
      {action}
    </FadeInUp>
  );
}
