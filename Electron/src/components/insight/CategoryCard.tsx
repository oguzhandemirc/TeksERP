import type { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { IconTile, type IconTileTone } from "@/components/ui/icon-tile";
import { cn } from "@/lib/utils";

export interface CategoryCardProps {
  icon: LucideIcon;
  tone: IconTileTone;
  title: string;
  /** Tek satır açıklama (iki satırda kırpılır). */
  description: string;
  /** Alt satır sayaç ("12 rapor"). */
  countText?: string;
  /** Süzgeç kartı: seçiliyse vurgulu, `aria-pressed`. */
  active?: boolean;
  /** Ya tıklama (süzgeç) ya bağlantı (`to`) — ikisi birden verilirse `to` kazanır. */
  onClick?: () => void;
  to?: string;
}

const BODY = "group flex h-full min-w-0 flex-col items-center gap-2 rounded-xl border bg-card px-3 py-4 text-center transition-colors hover:border-primary/50 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Kategori kartı (hedef görsel üst şerit): renkli simge karesi + ad + açıklama + sayaç. */
export function CategoryCard({ icon, tone, title, description, countText, active, onClick, to }: CategoryCardProps) {
  const inner = (
    <>
      <IconTile icon={icon} tone={tone} size="lg" />
      <span className="block text-sm font-semibold leading-tight">{title}</span>
      <span className="line-clamp-2 block text-xs text-muted-foreground">{description}</span>
      {countText && <span className="mt-auto block pt-1 text-xs font-semibold tabular-nums">{countText}</span>}
    </>
  );
  const cls = cn(BODY, active ? "border-primary bg-primary-soft/40 ring-1 ring-primary/40" : "border-card-border");
  if (to) return <Link to={to} className={cls}>{inner}</Link>;
  return (
    <button type="button" onClick={onClick} aria-pressed={active ?? false} className={cls}>
      {inner}
    </button>
  );
}

/** Kategori kartı ızgarası — kart en az 9.5rem; dar ekranda kendiliğinden satır kırar. */
export function CategoryCardGrid({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div role="group" aria-label={label} className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3">
      {children}
    </div>
  );
}
