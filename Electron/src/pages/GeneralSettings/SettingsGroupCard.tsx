import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Vurgu } from "./SettingHint";

/**
 * Katlanabilir ayar grubu kartı (2026-09-22: "bayraklar çok fazla, gruplandır").
 * Başlık + satır sayısı; tıklayınca açılır/kapanır. Açılış durumu grup adına göre
 * `localStorage`da (cihaz-yerel tercih); arama varken `forceOpen` ile hep açık.
 */
export function SettingsGroupCard({ name, count, forceOpen, highlight, children }: { name: string; count: number; forceOpen?: boolean; highlight?: string; children: ReactNode }) {
  const storageKey = `settings.group.${name}`;
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(storageKey);
      return v == null ? true : v === "1";
    } catch {
      return true;
    }
  });
  const isOpen = forceOpen || open;
  const toggle = () => {
    const next = !isOpen;
    setOpen(next);
    try {
      localStorage.setItem(storageKey, next ? "1" : "0");
    } catch {
      /* özel pencere / kapalı depolama — tercih tutulmaz, işlev bozulmaz */
    }
  };
  return (
    <section className="rounded-lg border">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-3 rounded-t-lg bg-muted/30 px-4 py-2.5 text-left hover:bg-muted/50"
      >
        <span className="text-sm font-semibold"><Vurgu text={name} query={highlight} /></span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {count} ayar
          <ChevronDown className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")} />
        </span>
      </button>
      {isOpen && <div className="divide-y divide-border px-4 py-3">{children}</div>}
    </section>
  );
}
