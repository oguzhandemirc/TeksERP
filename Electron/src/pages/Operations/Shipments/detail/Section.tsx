import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Sevkiyat tam-sayfa detayının bölüm başlığı — kısa dik ray + başlık + opsiyonel
 * sağ sayaç. WorkOrders detail-v3 `V3Section`'a görsel benzer ama o bileşen `.wo-v3`
 * CSS'ine sıkı bağlı olduğundan Shipments için bağımsız, kendi kendine yeten yerel
 * bir bileşen (harici CSS gerektirmez).
 */
export function Section({
  title,
  count,
  children,
  className,
}: {
  title: string;
  count?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("mt-6 first:mt-0", className)}>
      <div className="mb-2 flex items-center gap-2">
        <span className="h-4 w-1 rounded-full bg-primary/70" aria-hidden />
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>
        {count != null && (
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">{count}</span>
        )}
      </div>
      {children}
    </section>
  );
}
