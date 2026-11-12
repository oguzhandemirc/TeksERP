import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { IconTile, type IconTileTone } from "@/components/ui/icon-tile";

export interface ActivityItem {
  key: string;
  icon: LucideIcon;
  tone: IconTileTone;
  title: string;
  subtitle?: string;
  /** Sağdaki küçük bilgi (zaman, rozet). */
  meta?: ReactNode;
  /** Verilirse satır bağlantıdır. */
  to?: string;
}

export interface ActivityListProps {
  items: readonly ActivityItem[];
  /** Ekran okuyucu adı. */
  label: string;
  /** Liste boşken yazılan cümle. */
  emptyText: string;
}

/** Simgeli kısa liste (hedef görsel "son etkinlik"/"zamanlanmış"): simge karesi + başlık + alt satır + sağda bilgi. */
export function ActivityList({ items, label, emptyText }: ActivityListProps) {
  if (items.length === 0) return <p className="py-6 text-center text-xs text-muted-foreground">{emptyText}</p>;
  return (
    <ul aria-label={label} className="flex flex-col gap-0.5">
      {items.map((it) => {
        const body = (
          <>
            <IconTile icon={it.icon} tone={it.tone} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold">{it.title}</span>
              {it.subtitle && <span className="block truncate text-[11px] text-muted-foreground">{it.subtitle}</span>}
            </span>
            {it.meta != null && <span className="shrink-0 text-[11px] text-muted-foreground">{it.meta}</span>}
          </>
        );
        const cls = "flex items-center gap-2.5 rounded-lg px-1.5 py-1.5";
        return (
          <li key={it.key}>
            {it.to ? (
              <Link to={it.to} className={`${cls} transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}>
                {body}
              </Link>
            ) : (
              <div className={cls}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
