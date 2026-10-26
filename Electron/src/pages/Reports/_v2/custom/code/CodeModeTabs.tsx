import { Code2, LayoutDashboard, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CodeLock } from "./useCodeCheck";
import type { EditorMode } from "./useCodeMode";

interface Props {
  mode: EditorMode;
  lock: CodeLock | null;
  onVisual: () => void;
  onCode: () => void;
}

const tabClass = (on: boolean) =>
  cn("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60", on ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground");

/** Oluşturucunun [Görsel | Kod] sekmeleri; kod geçersizken görsele dönüş kilitli ve nedeni yazılı. */
export function CodeModeTabs({ mode, lock, onVisual, onCode }: Props) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3">
      <div role="tablist" aria-label="Düzenleme kipi" className="inline-flex rounded-lg bg-muted p-1">
        <button type="button" role="tab" aria-selected={mode === "visual"} disabled={mode === "code" && lock !== null} title={lock?.message} className={tabClass(mode === "visual")} onClick={onVisual}>
          {mode === "code" && lock ? <Lock className="h-3.5 w-3.5" aria-hidden /> : <LayoutDashboard className="h-3.5 w-3.5" aria-hidden />} Görsel
        </button>
        <button type="button" role="tab" aria-selected={mode === "code"} className={tabClass(mode === "code")} onClick={onCode}>
          <Code2 className="h-3.5 w-3.5" aria-hidden /> Kod
        </button>
      </div>
      {mode === "code" && lock ? (
        <p role="status" className={cn("text-sm", lock.kind === "pending" ? "text-muted-foreground" : "text-destructive dark:text-red-300")}>
          {lock.message}
        </p>
      ) : null}
    </div>
  );
}
