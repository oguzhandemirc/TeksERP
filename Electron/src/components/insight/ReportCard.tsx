import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Star, type LucideIcon } from "lucide-react";
import { IconTile, type IconTileTone } from "@/components/ui/icon-tile";
import { cn } from "@/lib/utils";

export interface ReportCardProps {
  to: string;
  title: string;
  description?: string;
  icon: LucideIcon;
  tone: IconTileTone;
  /** Alt satır sol bilgi ("Satış ve sevkiyat · 4 kez açıldı"). */
  meta?: ReactNode;
  /** Verilirse sağ altta favori yıldızı düğmesi. */
  favorite?: { active: boolean; onToggle: () => void };
  /** `compact`: simge küçük, açıklama tek satır (uzun listeler için). */
  compact?: boolean;
}

/**
 * Kayıt kartı (hedef görsel "popüler raporlar"): simge karesi + başlık + açıklama + bilgi + favori yıldızı.
 * Bütün kart tıklanır (bağlantı kartı örter); yıldız ayrı düğmedir — iç içe etkileşim yok.
 */
export function ReportCard({ to, title, description, icon, tone, meta, favorite, compact }: ReportCardProps) {
  return (
    <div className="group relative flex min-w-0 items-start gap-3 rounded-xl border border-card-border bg-card p-3 transition-colors hover:border-primary/50 hover:bg-muted/40">
      <IconTile icon={icon} tone={tone} size={compact ? "md" : "lg"} />
      <div className="min-w-0 flex-1">
        <Link
          to={to}
          className="block truncate text-sm font-semibold after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
        >
          {title}
        </Link>
        {description && <p className={cn("mt-0.5 text-xs text-muted-foreground", compact ? "truncate" : "line-clamp-2")}>{description}</p>}
        {(meta || favorite) && (
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-[11px] font-medium text-muted-foreground">{meta}</span>
            {favorite && (
              <button
                type="button"
                onClick={favorite.onToggle}
                aria-pressed={favorite.active}
                aria-label={favorite.active ? `${title} favorilerden çıkar` : `${title} favorilere ekle`}
                className="relative z-10 -m-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Star className={cn("h-4 w-4", favorite.active && "fill-warning text-warning")} aria-hidden />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
