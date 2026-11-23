import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { InfoPopover } from "@/components/ui/info-popover";
import { cn } from "@/lib/utils";

interface Props {
  title: string;
  description?: string;
  actions?: ReactNode;
  /** İçerik yüksekliği — chart için sabit yüksekliğe ihtiyaç var. */
  height?: number;
  isEmpty?: boolean;
  emptyLabel?: string;
  isLoading?: boolean;
  className?: string;
  children: ReactNode;
}

/** Chart wrapper: başlık + sabit yüksekli içerik + empty/loading state. */
export function ChartCard({
  title,
  description,
  actions,
  height = 280,
  isEmpty,
  emptyLabel = "Bu aralıkta veri yok",
  isLoading,
  className,
  children,
}: Props) {
  return (
    <Card className={cn("flex flex-col p-4", className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
          {description ? <InfoPopover desc={description} label={`${title} — açıklama`} /> : null}
        </div>
        {actions ? <div className="flex items-center gap-1">{actions}</div> : null}
      </div>
      <div style={{ height }} className="mt-3 w-full">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground/60">
            Yükleniyor...
          </div>
        ) : isEmpty ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground/60">
            {emptyLabel}
          </div>
        ) : (
          children
        )}
      </div>
    </Card>
  );
}
