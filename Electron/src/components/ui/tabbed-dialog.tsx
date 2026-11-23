// SEKMELİ MODAL İSKELETİ (kural 2026-11-24): sekme değişince modalın boyutu DEĞİŞMEZ. Yükseklik görünüm alanına bağlı
// sabit; başlık + sekme şeridi + alt düğme çubuğu sabit, yalnız etkin sekmenin gövdesi kayar; alt düğmeler hep görünür.
// Sekmeli her modal bu parçalarla kurulur (bekçi: tabbed-dialog.test.tsx).
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type HTMLAttributes, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/** Sabit çerçeve: içerik boş da olsa aynı yükseklik (dar ekranda dialog.tsx tam ekrana çevirir). */
export const TABBED_DIALOG_FRAME = "flex h-[min(88vh,60rem)] flex-col gap-0 overflow-hidden p-0";

export const TabbedDialogContent = forwardRef<ElementRef<typeof DialogContent>, ComponentPropsWithoutRef<typeof DialogContent>>(
  ({ className, ...props }, ref) => <DialogContent ref={ref} data-tabbed-dialog="" className={cn(TABBED_DIALOG_FRAME, className)} {...props} />,
);
TabbedDialogContent.displayName = "TabbedDialogContent";

export function TabbedDialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <DialogHeader className={cn("shrink-0 px-6 pb-3 pt-5 pr-16", className)} {...props} />;
}

/** Sekme kökü gövdeyi doldurur; şerit sabit, panel kayar. */
export function TabbedDialogTabs({ className, ...props }: ComponentPropsWithoutRef<typeof Tabs>) {
  return <Tabs className={cn("flex min-h-0 flex-1 flex-col", className)} {...props} />;
}

export function TabbedDialogTabList({ className, ...props }: ComponentPropsWithoutRef<typeof TabsList>) {
  return <TabsList className={cn("mx-6 flex shrink-0", className)} {...props} />;
}

/** Tek kaydırıcı gövde. `forceMount`lı panelde (form durumu korunur) gizlilik `data-state`ten gelir. */
export function TabbedDialogPanel({ className, ...props }: ComponentPropsWithoutRef<typeof TabsContent>) {
  return <TabsContent className={cn("mt-0 min-h-0 flex-1 overflow-y-auto px-6 py-4 data-[state=inactive]:hidden", className)} {...props} />;
}

/** Sekmesiz gövde (aynı çerçevede tek sayfa form): tek kaydırıcı. */
export function TabbedDialogBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto px-6 py-4", className)} {...props} />;
}

export function TabbedDialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <DialogFooter className={cn("shrink-0 items-center border-t border-border/70 bg-card px-6 py-3", className)} {...props} />;
}

/** Boş sekme: panelin ortasında ikon + tek cümle + (varsa) eylem. */
export function TabbedDialogEmpty({ icon: Icon, text, action }: { icon?: LucideIcon; text: string; action?: ReactNode }) {
  return (
    <div className="flex h-full min-h-[12rem] flex-col items-center justify-center gap-2 text-center" data-testid="tabbed-dialog-empty">
      {Icon ? <Icon className="h-8 w-8 text-muted-foreground/60" aria-hidden /> : null}
      <p className="text-sm text-muted-foreground">{text}</p>
      {action}
    </div>
  );
}
