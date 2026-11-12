import { createContext, useContext, type ReactNode } from "react";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { SectionCard, type SectionCardProps } from "@/components/ui/section-card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { PreviewKind } from "./box-meta";

/** Kutunun başlık köşesine çerçeveden gelen ek (⋯ menüsü) — kutu bileşenleri `PanoCard` ile alır. */
const BoxChromeContext = createContext<ReactNode>(null);

export function BoxChrome({ menu, children }: { menu: ReactNode; children: ReactNode }) {
  return <BoxChromeContext.Provider value={menu}>{children}</BoxChromeContext.Provider>;
}

/** Pano kutusu kabuğu: `SectionCard` + sağ üstte kutunun kendi eylemi ve çerçevenin ⋯ menüsü. */
/** İçerik sütunu esnek: aynı satırdaki kutular eşit boyda, boş durum (`flex-1`) kalan alanın ortasında durur. */
export function PanoCard({ action, className, contentClassName, ...rest }: SectionCardProps) {
  const menu = useContext(BoxChromeContext);
  return <SectionCard {...rest} className={cn("h-full", className)} contentClassName={cn("flex flex-col", contentClassName)} action={action || menu ? <>{action}{menu}</> : undefined} />;
}

/** Kip dışında kutu başlığındaki ⋯ — "Kaldır". */
export function BoxMenu({ title, onRemove, className }: { title: string; onRemove: () => void; className?: string }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`${title} kutusu seçenekleri`}
          className={cn("-mr-1.5 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}>
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onRemove} className="gap-2 text-destructive focus:text-destructive">
          <Trash2 className="h-4 w-4" aria-hidden />Panodan kaldır
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const BAR_HEIGHTS = [40, 65, 50, 80, 55, 90, 70, 45, 75, 60];

/** Kutunun küçük önizleme iskeleti (çekmece ve düzenleme kipi) — veri istemeden kutunun biçimini anlatır. */
export function PreviewSkeleton({ kind, large }: { kind: PreviewKind; large?: boolean }) {
  const shade = "bg-muted-foreground/15";
  if (kind === "kpi") {
    return <div className="space-y-1.5"><div className={cn("h-4 w-2/3 rounded", shade)} /><div className={cn("h-2 w-1/2 rounded", shade)} /></div>;
  }
  if (kind === "area" || kind === "bars") {
    return (
      <div className={cn("flex items-end gap-1", large ? "h-36" : "h-9")}>
        {BAR_HEIGHTS.map((h, i) => <span key={i} className={cn("flex-1 rounded-t-sm", kind === "area" ? "bg-primary/20" : shade)} style={{ height: `${h}%` }} />)}
      </div>
    );
  }
  if (kind === "hbars") {
    return <div className="space-y-1.5">{[90, 70, 50, 30].map((w) => <div key={w} className={cn("h-2 rounded-full", shade)} style={{ width: `${w}%` }} />)}</div>;
  }
  if (kind === "donut") {
    return (
      <div className="flex items-center gap-3">
        <span className={cn("shrink-0 rounded-full border-primary/25", large ? "h-28 w-28 border-[14px]" : "h-9 w-9 border-[5px]")} />
        <div className="flex-1 space-y-1.5">{[80, 60, 40].map((w) => <div key={w} className={cn("h-2 rounded", shade)} style={{ width: `${w}%` }} />)}</div>
      </div>
    );
  }
  if (kind === "calendar") {
    return <div className="grid grid-cols-7 gap-1">{Array.from({ length: large ? 35 : 14 }, (_, i) => <span key={i} className={cn("rounded-sm", large ? "h-5" : "h-2", i % 5 === 2 ? "bg-primary/30" : shade)} />)}</div>;
  }
  if (kind === "tiles") {
    return <div className="grid grid-cols-4 gap-1.5">{Array.from({ length: large ? 8 : 4 }, (_, i) => <span key={i} className={cn("rounded-md", large ? "h-16" : "h-3", shade)} />)}</div>;
  }
  return <div className="space-y-1.5">{Array.from({ length: large ? 5 : 3 }, (_, i) => <div key={i} className={cn("rounded", shade, large ? "h-6" : "h-2")} style={{ width: `${95 - i * 12}%` }} />)}</div>;
}

/** Kutu verisi yüklenirken: gerçek başlık + biçime uygun iskelet (titreme yok). */
export function BoxLoading({ title, kind }: { title: string; kind: PreviewKind }) {
  return (
    <PanoCard title={title}>
      <div className="skeleton-shimmer" data-testid="pano-kutu-iskelet"><PreviewSkeleton kind={kind} large /></div>
    </PanoCard>
  );
}

export function BoxFailed({ title, onRetry }: { title: string; onRetry: () => void }): ReactNode {
  return (
    <PanoCard title={title}>
      <div className="py-6 text-center text-sm">
        <p className="font-medium text-destructive">Veri alınamadı.</p>
        <button type="button" onClick={onRetry} className="mt-2 text-xs font-medium text-primary underline-offset-2 hover:underline">Tekrar dene</button>
      </div>
    </PanoCard>
  );
}
