// Sayfa içi alt sekmeler ("Siparişler / Üretim planı") — başlık bandının altında tam genişlik bant, alt çizgili düz
// sekme: kabuk sekmeleri (üst şerit, kutucuk) ile karışmasın. Klavye Radix Tabs'tan (ok/Home/End, otomatik seçim).
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Bant: tam genişlik, sayfa oluğuyla hizalı (`--list-inset`, index.css "SAYFA BANTLARI"), ince alt çizgi. */
export const PAGE_TABS_BAR_CLASS = "flex shrink-0 items-end gap-1 overflow-x-auto";

/** Sekme: alt çizgili düz metin; seçili = ana renk alt çizgi + koyu metin. */
export function pageTabClass(active: boolean): string {
  return cn(
    "-mb-px inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50",
    active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
  );
}

/** `<Tabs>` içinde TabsList yerine — içerikli (TabsContent) sayfalar için. */
export const PageTabsList = forwardRef<ElementRef<typeof TabsPrimitive.List>, ComponentPropsWithoutRef<typeof TabsPrimitive.List> & { trailing?: ReactNode }>(
  ({ className, children, trailing, ...props }, ref) => (
    <div data-page-tabs="" className={PAGE_TABS_BAR_CLASS}>
      <TabsPrimitive.List ref={ref} className={cn("flex min-w-0 items-end gap-1", className)} {...props}>
        {children}
      </TabsPrimitive.List>
      {trailing && <div className="ml-auto flex shrink-0 items-center self-center py-1">{trailing}</div>}
    </div>
  ),
);
PageTabsList.displayName = "PageTabsList";

export const PageTabsTrigger = forwardRef<ElementRef<typeof TabsPrimitive.Trigger>, ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>>(
  ({ className, ...props }, ref) => (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(pageTabClass(false), "data-[state=active]:border-primary data-[state=active]:text-foreground", className)}
      {...props}
    />
  ),
);
PageTabsTrigger.displayName = "PageTabsTrigger";

export interface PageTab {
  key: string;
  label: ReactNode;
  icon?: LucideIcon;
  disabled?: boolean;
}

/**
 * İçeriksiz (durumu URL'de tutan) sekme bandı: seçim `onSelect`e gider, adres çubuğunu çağıran yazar.
 * `label` ekran okuyucu adı ("Siparişler görünümü").
 */
export function PageTabs({ tabs, active, onSelect, label, trailing }: { tabs: PageTab[]; active: string; onSelect: (key: string) => void; label: string; trailing?: ReactNode }) {
  return (
    <TabsPrimitive.Root value={active} onValueChange={onSelect} activationMode="automatic">
      <PageTabsList aria-label={label} trailing={trailing}>
        {tabs.map((t) => (
          <PageTabsTrigger key={t.key} value={t.key} disabled={t.disabled}>
            {t.icon && <t.icon className="h-3.5 w-3.5" aria-hidden />}
            {t.label}
          </PageTabsTrigger>
        ))}
      </PageTabsList>
    </TabsPrimitive.Root>
  );
}
