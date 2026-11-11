import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SectionCardProps {
  title: ReactNode;
  /** Başlık altında küçük açıklama. */
  description?: ReactNode;
  /** Başlık yanında (aynı satır) küçük ek — ör. ⓘ ya da sayı rozeti. */
  titleExtra?: ReactNode;
  /** Sağ üstte eylem/seçici ("Bu ay ▾", "Tümünü gör"). */
  action?: ReactNode;
  children?: ReactNode;
  /** İçerik dolgusuz (tablo/grafik kenardan kenara) — başlık dolgusu kalır. */
  flush?: boolean;
  className?: string;
  contentClassName?: string;
}

/** Bölüm kartı (hedef görsel): başlık + sağda eylem + içerik; pano ve detay ekranlarının ortak kabuğu. */
export function SectionCard({ title, description, titleExtra, action, children, flush, className, contentClassName }: SectionCardProps) {
  return (
    <section
      data-slot="card"
      className={cn("flex min-w-0 flex-col rounded-xl border border-card-border bg-card text-card-foreground shadow-card", className)}
    >
      <header className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h2 className="truncate text-sm font-bold tracking-tight">{title}</h2>
            {titleExtra}
          </div>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </header>
      <div className={cn("min-h-0 flex-1", flush ? "pb-2" : "px-5 pb-5", contentClassName)}>{children}</div>
    </section>
  );
}
