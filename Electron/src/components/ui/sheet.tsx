import * as React from "react";
import * as SheetPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTabPortalContainer } from "@/components/layout/tabs/tab-portal";
import { useIsTabActive } from "@/components/layout/tabs/tab-active";
import { EscapeRegistrar, EscCloseContext } from "@/components/ui/escape-stack";

/** Sekme içinde slide-over'ı o sekmeye gömer (bkz. Dialog). Dışarıda klasik. */
function Sheet({ modal, onOpenChange, ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  const scoped = useTabPortalContainer() != null;
  // O5: Esc yığını controlled sheet'i kapatabilsin (bkz. dialog.tsx).
  const requestClose = React.useMemo(
    () => (onOpenChange ? () => onOpenChange(false) : null),
    [onOpenChange],
  );
  return (
    <EscCloseContext.Provider value={requestClose}>
      <SheetPrimitive.Root modal={modal ?? !scoped} onOpenChange={onOpenChange} {...props} />
    </EscCloseContext.Provider>
  );
}

const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;
const SheetPortal = SheetPrimitive.Portal;

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay data-ui-overlay="" className={cn("fixed inset-0 z-50 bg-black/70", className)} {...props} ref={ref} />
));
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

const sheetVariants = cva(
  "fixed z-50 gap-4 bg-background p-6 shadow-lg",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 border-b",
        bottom: "inset-x-0 bottom-0 border-t",
        left: "inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm",
        right: "inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-xl",
      },
    },
    defaultVariants: { side: "right" },
  },
);

interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {}

const SheetContent = React.forwardRef<React.ElementRef<typeof SheetPrimitive.Content>, SheetContentProps>(
  ({ side = "right", className, children, onInteractOutside, onEscapeKeyDown, ...props }, ref) => {
    const tabContainer = useTabPortalContainer();
    const isTabActive = useIsTabActive();
    const scoped = tabContainer != null;
    // Y5 fix: karartma sahipliği — dialog.tsx ile aynı; "herhangi bir overlay"
    // kontrolü başka sekmedeki/kardeş modalın karartmasıyla bu sheet'i kapatıyordu.
    const ownOverlayRef = React.useRef<HTMLDivElement>(null);
    // O5 fix: Esc yönetimi escape-stack'te (bkz. dialog.tsx). Kayıt CONTENT'İN
    // İÇİNDE yapılır — burada olursa sheet KAPALIYKEN de yığına girer.
    const requestClose = React.useContext(EscCloseContext);
    const isTabActiveRef = React.useRef(isTabActive);
    isTabActiveRef.current = isTabActive;
    const registerEsc = scoped && requestClose != null;
    return (
      <SheetPortal container={scoped ? tabContainer : undefined}>
        {scoped ? (
          <div
            ref={ownOverlayRef}
            data-ui-overlay=""
            aria-hidden
            className="absolute inset-0 z-50 bg-black/70"
          />
        ) : (
          <SheetOverlay />
        )}
        <SheetPrimitive.Content
          ref={ref}
          data-ui-sheet=""
          data-side={side}
          {...(!scoped ? { "data-global-modal": "" } : {})}
          onEscapeKeyDown={(e) => {
            if (scoped) e.preventDefault();
            onEscapeKeyDown?.(e);
          }}
          onInteractOutside={(e) => {
            onInteractOutside?.(e);
            if (e.defaultPrevented) return;
            if (scoped) {
              // Pasif sekmedeki sheet dış tıklamayla kapanmaz (Esc simetriği).
              if (!isTabActive) {
                e.preventDefault();
                return;
              }
              const target = (e as unknown as { detail?: { originalEvent?: Event } }).detail
                ?.originalEvent?.target as HTMLElement | null;
              if (!target || target !== ownOverlayRef.current) e.preventDefault();
            }
          }}
          className={cn(sheetVariants({ side }), scoped && "absolute", className)}
          {...props}
        >
          {registerEsc && (
            <EscapeRegistrar close={requestClose} isActive={() => isTabActiveRef.current} />
          )}
          {children}
          <SheetPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100 focus:outline-none">
            <X className="h-4 w-4" />
            <span className="sr-only">Kapat</span>
          </SheetPrimitive.Close>
        </SheetPrimitive.Content>
      </SheetPortal>
    );
  },
);
SheetContent.displayName = SheetPrimitive.Content.displayName;

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-2", className)} {...props} />
);
SheetHeader.displayName = "SheetHeader";

const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />
);
SheetFooter.displayName = "SheetFooter";

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title ref={ref} className={cn("text-lg font-semibold text-foreground", className)} {...props} />
));
SheetTitle.displayName = SheetPrimitive.Title.displayName;

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
SheetDescription.displayName = SheetPrimitive.Description.displayName;

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription };
