import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 px-0.5">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Tek seçimli düğme grubu (radyo anlamı; ekran okuyucuya `radiogroup`). */
export function ChoiceGroup(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { key: string; label: string; hint?: string; disabled?: boolean }[];
  /** true → alt alta (uzun etiket), değilse yan yana bölümlü düğme. */
  column?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={props.label} className={cn(props.column ? "flex flex-col gap-1" : "inline-flex rounded-md border bg-card p-0.5")}>
      {props.options.map((o) => {
        const on = o.key === props.value;
        return (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={o.disabled}
            title={o.hint}
            onClick={() => props.onChange(o.key)}
            className={cn(
              "text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              props.column
                ? "flex items-center gap-2 rounded-md border px-3 py-1.5 text-left"
                : "rounded px-3 py-1",
              on
                ? "border-primary bg-primary text-primary-foreground"
                : props.column
                  ? "bg-card hover:bg-accent"
                  : "hover:bg-accent",
            )}
          >
            {props.column && (
              <span
                aria-hidden
                className={cn("h-3 w-3 shrink-0 rounded-full border", on ? "border-primary-foreground bg-primary-foreground/90" : "border-muted-foreground")}
              />
            )}
            <span className="min-w-0 flex-1">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
