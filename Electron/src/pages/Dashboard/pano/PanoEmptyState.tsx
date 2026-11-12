import type { LucideIcon } from "lucide-react";

/** Kutu içi boş durum: soluk simge + kısa metin (+ ek satır) — kocaman boş kart yerine. */
export function PanoEmptyState({ icon: Icon, metin, ek }: { icon: LucideIcon; metin: string; ek?: string }) {
  return (
    <div className="flex min-h-32 flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
      <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground" aria-hidden>
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </span>
      <p className="text-sm font-medium text-muted-foreground">{metin}</p>
      {ek && <p className="max-w-[16rem] text-xs text-muted-foreground/80">{ek}</p>}
    </div>
  );
}
