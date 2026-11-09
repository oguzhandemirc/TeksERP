// Top kartı bölüm iskeleti — başlık + iki sütunlu satırlar. Değeri olmayan satır HİÇ çizilmez (boş "—" gürültüdür).
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function CardSection({ title, icon: Icon, testId, children }: { title: string; icon: LucideIcon; testId: string; children: ReactNode }) {
  return (
    <Card data-testid={testId}>
      <CardContent className="p-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Icon className="h-3.5 w-3.5" /> {title}
        </div>
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-sm">{children}</div>
      </CardContent>
    </Card>
  );
}

export function CardRow({ label, testId, children }: { label: string; testId?: string; children: ReactNode }) {
  if (children === null || children === undefined || children === false || children === "") return null;
  return (
    <>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="min-w-0 text-xs" data-testid={testId}>{children}</div>
    </>
  );
}

/** Bölümde gösterilecek en az bir satır var mı — hepsi boşsa bölüm çizilmez. */
export const hasAny = (...values: unknown[]): boolean => values.some((v) => v !== null && v !== undefined && v !== "" && v !== false);

/** Kart içinden kayda git (İE / gelen belge) — sekme deposu tıklamada yüklenir (RollTraceLink emsali). */
export function CardLink({ to, testId, children }: { to: string; testId?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      data-testid={testId}
      className="font-mono text-xs text-primary underline-offset-2 hover:underline"
      onClick={(e) => {
        e.stopPropagation();
        void import("@/components/layout/tabs/use-tab-target").then(({ openTargetNow }) => openTargetNow("topLevel", to));
      }}
    >
      {children}
    </button>
  );
}
