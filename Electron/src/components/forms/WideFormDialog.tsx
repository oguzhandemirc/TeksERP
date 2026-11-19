// GENİŞ FORM İSKELETİ (kullanıcı kararı 2026-11-19): formlar dar modalda alt alta değil, ekranın büyük kısmını kaplayan
// geniş diyalogda açılır — sabit başlık, kendi kaydırıcılı ferah gövde, sabit alt çubuk; kısa alanlar ızgarada yan yana
// (`FieldGrid`), gruplar başlıklı kartta (`FormCard`), uzun açıklama `FormField info` balonunda. Kaydırma gerekirse olur.
import type { FormEventHandler, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { MaybeSections, ModalSection, type SectionDecl } from "./modal-sections/ModalSections";

interface WideFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Alt çubuk düğmeleri (Vazgeç · Kaydet). */
  footer: ReactNode;
  /** Verilirse gövde + alt çubuk bir `<form>` içine alınır (submit düğmesi çalışır). */
  onSubmit?: FormEventHandler<HTMLFormElement>;
  /** Kirli-sekme algısı formu kendisi yönetiyorsa (react-hook-form) `data-dirty-managed`. */
  dirtyManaged?: boolean;
  /** Bölüm görünürlüğü tercih anahtarı (ör. `warp-spec.form`); verilirse `sectionId`li kartlar × yanındaki menüde listelenir. */
  sectionsKey?: string;
  children: ReactNode;
}

export function WideFormDialog({ open, onOpenChange, title, description, footer, onSubmit, dirtyManaged, sectionsKey, children }: WideFormDialogProps) {
  const body = (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto bg-muted/40 px-6 py-5">{children}</div>
      <DialogFooter className="shrink-0 border-t border-border/70 bg-card px-6 py-3">{footer}</DialogFooter>
    </>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[92vh] w-[calc(100%-2rem)] max-w-[88rem] flex-col gap-0 overflow-hidden p-0" data-form-size="wide">
        <MaybeSections sectionsKey={sectionsKey}>
          <DialogHeader className={cn("shrink-0 border-b border-border/70 px-6 pb-3 pt-4", sectionsKey && "pr-20")}>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          {onSubmit ? (
            <form {...(dirtyManaged ? { "data-dirty-managed": "" } : {})} onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
              {body}
            </form>
          ) : (
            body
          )}
        </MaybeSections>
      </DialogContent>
    </Dialog>
  );
}

/** Başlıklı form kartı: başlık şeridi (ikon · başlık · kısa not · sağda eylem) + ferah gövde; `sectionId` → modal bölümü. */
export function FormCard({ sectionId, sectionRequired, errorFields, sectionError, ...rest }: CardProps & SectionDecl) {
  if (!sectionId) return <CardBody {...rest} />;
  return (
    <ModalSection id={sectionId} title={rest.title} required={sectionRequired} fields={errorFields} hasError={sectionError}>
      <CardBody {...rest} />
    </ModalSection>
  );
}

type CardProps = { title: string; icon?: LucideIcon; note?: string; aside?: ReactNode; children: ReactNode; className?: string };

function CardBody({ title, icon: Icon, note, aside, children, className }: CardProps) {
  return (
    <section className={cn("rounded-xl border border-card-border bg-card shadow-card", className)} aria-label={title}>
      <header className="flex min-h-11 flex-wrap items-center gap-2 border-b px-5 py-2">
        {Icon ? <Icon className="h-4 w-4 text-primary" /> : null}
        <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{title}</h3>
        {note ? <span className="hidden text-xs text-muted-foreground sm:inline">· {note}</span> : null}
        {aside ? <div className="ml-auto">{aside}</div> : null}
      </header>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

const GRID_COLS = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 md:grid-cols-3", 4: "sm:grid-cols-2 md:grid-cols-4" } as const;

/** Kısa alanlar yan yana: dar ekranda 1, sonra 2, genişte `cols` sütun. */
export function FieldGrid({ cols, children, className }: { cols: keyof typeof GRID_COLS; children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-1 gap-4", GRID_COLS[cols], className)}>{children}</div>;
}

/** İki sütunlu geniş form gövdesi: solda alanlar, sağda yapışkan yan panel (hesap/önizleme; tablo varsa "wide"); `xl` altında tek sütun. */
export function WideFormColumns({
  main,
  side,
  after,
  sideWidth = "minmax(22rem,26rem)",
}: {
  main: ReactNode;
  side: ReactNode;
  /** İki sütunun altında tam genişlik (sıra hâlinde çok kısa alanlı kartlar: ücret · termin · fire). */
  after?: ReactNode;
  sideWidth?: "minmax(22rem,26rem)" | "half" | "wide";
}) {
  const cols = sideWidth === "half" ? "xl:grid-cols-2" : sideWidth === "wide" ? "xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]" : "xl:grid-cols-[minmax(0,1fr)_minmax(22rem,26rem)]";
  return (
    <div className="space-y-5" data-testid="wide-form-columns">
      <div className={cn("grid gap-5", cols, "xl:[&:has(>[data-side]:empty)]:grid-cols-1")}>
        <div className="min-w-0 space-y-5">{main}</div>
        <div data-side="" className="min-w-0 space-y-5 empty:hidden xl:sticky xl:top-0 xl:self-start">{side}</div>
      </div>
      {after}
    </div>
  );
}
