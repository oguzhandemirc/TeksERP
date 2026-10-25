import type { ReactNode } from "react";

/** Sağ panel bölümü — başlık + içerik. */
export function Section({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <section className="space-y-2 border-b px-3 py-3" data-testid={testId}>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      {children}
    </section>
  );
}
