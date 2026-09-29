import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { safeFormat } from "@/lib/format";

/** Lisans ekranının kart iskeleti — başlık + iki kolonlu bilgi satırları. */
export function LicenseCard({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        {action}
      </CardHeader>
      <CardContent className="space-y-1.5 text-sm">{children}</CardContent>
    </Card>
  );
}

export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right">{children ?? "—"}</span>
    </div>
  );
}

export const when = (iso: string | null | undefined): string => safeFormat(iso ?? null, "dd.MM.yyyy HH:mm");
export const day = (iso: string | null | undefined): string => safeFormat(iso ?? null, "dd.MM.yyyy");
