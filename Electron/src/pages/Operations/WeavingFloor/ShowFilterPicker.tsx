// "Göster: Tümü" — modal seçici (combobox değil): salonda hangi tezgahlar görünsün.
import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { escalationTierOf, isPastTarget } from "./metrics";
import type { LiveLoom } from "./types";

export type ShowFilter = "ALL" | "STOPPED" | "OVERDUE";

export const SHOW_FILTER_LABEL: Record<ShowFilter, string> = {
  ALL: "Tümü",
  STOPPED: "Duranlar",
  OVERDUE: "Hedefi aşanlar",
};

const SHOW_FILTER_HINT: Record<ShowFilter, string> = {
  ALL: "Bütün tezgahlar, holdeki sırasıyla",
  STOPPED: "Yalnız şu an duran tezgahlar",
  OVERDUE: "Hedef müdahale süresini geçen duruşlar",
};

export function showFilterPredicate(filter: ShowFilter, now: number): (t: LiveLoom) => boolean {
  if (filter === "STOPPED") return (t) => t.openStop !== null;
  if (filter === "OVERDUE") return (t) => t.openStop !== null && isPastTarget(escalationTierOf(t.openStop, now));
  return () => true;
}

export function ShowFilterPicker({ value, onChange }: { value: ShowFilter; onChange: (f: ShowFilter) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Göster: {SHOW_FILTER_LABEL[value]}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Göster</DialogTitle>
            <DialogDescription>Salonda hangi tezgahlar görünsün?</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {(Object.keys(SHOW_FILTER_LABEL) as ShowFilter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => {
                  onChange(f);
                  setOpen(false);
                }}
                className={cn(
                  "flex items-center gap-3 rounded-xl border px-4 py-3 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                  f === value && "border-primary bg-primary/5",
                )}
              >
                <div className="flex-1">
                  <div className="font-semibold">{SHOW_FILTER_LABEL[f]}</div>
                  <div className="text-sm text-muted-foreground">{SHOW_FILTER_HINT[f]}</div>
                </div>
                {f === value && <Check className="h-5 w-5 text-primary" />}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
