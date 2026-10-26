import { cn } from "@/lib/utils";

/** Sunucunun çizdiği belge HTML'i: `sandbox=""` (betik yok, köken yok) — önizleme iframe'lerinin tek kuralı. */
export function SandboxFrame({ title, html, className }: { title: string; html: string; className?: string }) {
  return <iframe title={title} sandbox="" srcDoc={html} className={cn("h-full w-full rounded border bg-white", className)} />;
}
