// Kayıt kalıbı — küçük yapı taşları: pastel rozet, özet satırı, boş durum, avatar.
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { IconTile, type IconTileTone } from "@/components/ui/icon-tile";
import { cn } from "@/lib/utils";
import { upperTr } from "@/lib/tr-case";

/** Pastel hap (hedef görsel) — ton `tile-<ton>` belirteçlerinden; tema/koyu kip izler. */
export function ToneChip({ tone, children, className, title }: { tone: IconTileTone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("tone-chip inline-flex max-w-full items-center truncate rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4", `tile-${tone}`, className)}>
      {children}
    </span>
  );
}

/** Ad baş harfleri (avatar karesi) — Türkçe büyük harf, en çok iki harf. */
export function initialsOf(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((p) => p[0] ?? "");
  return upperTr(letters.join("")) || "?";
}

/** Baş harfli renkli kare — kayıt kimliğinin görsel çapası. */
export function RecordAvatar({ name, tone, size = "md" }: { name: string; tone: IconTileTone; size?: "md" | "lg" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "icon-tile inline-flex shrink-0 items-center justify-center font-bold tracking-tight",
        `tile-${tone}`,
        size === "lg" ? "h-14 w-14 rounded-2xl text-lg" : "h-10 w-10 rounded-xl text-sm",
      )}
    >
      {initialsOf(name)}
    </span>
  );
}

export interface RecordFact {
  key: string;
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
}

/** Özet satırları — değeri boş (null/"") olan satır HİÇ çizilmez; hepsi boşsa bileşen de yok. */
export function RecordFacts({ facts, className }: { facts: RecordFact[]; className?: string }) {
  const shown = facts.filter((f) => f.value !== null && f.value !== undefined && f.value !== "");
  if (shown.length === 0) return null;
  return (
    <dl className={cn("grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm", className)}>
      {shown.map((f) => (
        <div key={f.key} className="contents">
          <dt className="flex items-center gap-2 text-muted-foreground">
            {f.icon && <f.icon className="h-3.5 w-3.5 shrink-0" aria-hidden />}
            {f.label}
          </dt>
          <dd className="min-w-0 break-words font-medium">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Boş durum — simge karesi + tek cümle (+ isteğe bağlı eylem). */
export function RecordEmpty({ icon, text, action, tone = "violet" }: { icon: LucideIcon; text: ReactNode; action?: ReactNode; tone?: IconTileTone }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-sm text-muted-foreground">
      <IconTile icon={icon} tone={tone} size="md" />
      <p>{text}</p>
      {action}
    </div>
  );
}

/** Mini başlık (panel bölümleri). */
export function RecordSectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{children}</h3>
      {action}
    </div>
  );
}
