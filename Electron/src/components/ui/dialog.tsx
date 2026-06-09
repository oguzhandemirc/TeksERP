import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTabPortalContainer } from "@/components/layout/tabs/tab-portal";
import { useIsTabActive } from "@/components/layout/tabs/tab-active";

/**
 * Sekme içinde açıldığında modal o sekmeye gömülür: `modal={false}` olur (sekme
 * barı/sidebar tıklanabilir kalır, kullanıcı başka sekmeye bakıp dönebilir).
 * Sekme dışında (login, komut paleti) klasik bloklayan tam-ekran modal sürer.
 * Çağıran açıkça `modal` verirse o kazanır.
 */
function Dialog({ modal, ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  const scoped = useTabPortalContainer() != null;
  return <DialogPrimitive.Root modal={modal ?? !scoped} {...props} />;
}

const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    data-ui-overlay=""
    className={cn("fixed inset-0 z-50 bg-black/70", className)}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, onInteractOutside, onEscapeKeyDown, ...props }, ref) => {
  const tabContainer = useTabPortalContainer();
  const isTabActive = useIsTabActive();
  const scoped = tabContainer != null;
  return (
    <DialogPortal container={scoped ? tabContainer : undefined}>
      {scoped ? (
        // Non-modal'da Radix `Overlay` null döner; karartmayı kendimiz çiziyoruz.
        // `absolute inset-0` → yalnız bu sekmeyi kaplar (bar/sidebar açıkta kalır).
        // `data-ui-overlay` → onInteractOutside'da "karartmaya tıklandı → kapat".
        <div data-ui-overlay="" aria-hidden className="absolute inset-0 z-50 bg-black/70" />
      ) : (
        <DialogOverlay />
      )}
      <DialogPrimitive.Content
        ref={ref}
        data-ui-dialog=""
        onEscapeKeyDown={(e) => {
          // Arka plandaki (gizli) sekmenin modalı Esc'i yutmasın.
          if (scoped && !isTabActive) e.preventDefault();
          onEscapeKeyDown?.(e);
        }}
        onInteractOutside={(e) => {
          onInteractOutside?.(e);
          if (e.defaultPrevented) return;
          if (scoped) {
            // Sadece kendi karartma katmanına tıklayınca kapan; sekme barı /
            // sidebar / başka sekme tıklaması modalı KAPATMAZ (referansa bakılır).
            const target = (e as unknown as { detail?: { originalEvent?: Event } }).detail
              ?.originalEvent?.target as HTMLElement | null;
            if (!target?.closest("[data-ui-overlay]")) e.preventDefault();
          }
        }}
        className={cn(
          // max-h + overflow varsayılanı: içerik uzasa bile modal ekranı aşmaz,
          // gövde kayar. Kendi yüksekliğini yöneten dialog'lar (flex + h-[..vh] +
          // overflow-hidden) bunu tailwind-merge ile override eder.
          "left-1/2 top-1/2 z-50 grid max-h-[90vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto border bg-background p-6 shadow-lg sm:rounded-lg",
          // Sekmeye gömülü: `fixed` yerine `absolute` (portal hedefi sekme kutusu)
          // ve yükseklik sekme paneline göre sınırlanır (bar/sidebar'a taşmaz).
          scoped ? "absolute max-h-[calc(100%-1.5rem)]" : "fixed",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none">
          <X className="h-4 w-4" />
          <span className="sr-only">Kapat</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-left", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn("text-lg font-semibold leading-none tracking-tight", className)} {...props} />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
