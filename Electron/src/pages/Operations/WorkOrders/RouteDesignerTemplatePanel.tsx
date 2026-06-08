import { AnimatePresence, motion } from "framer-motion";
import { BookmarkPlus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { springSnappy } from "@/lib/motion";

interface Props {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  name: string;
  onNameChange: (v: string) => void;
  customerId: string | null;
  forCustomer: boolean;
  onForCustomerChange: (v: boolean) => void;
}

export function RouteDesignerTemplatePanel({
  enabled,
  onEnabledChange,
  name,
  onNameChange,
  customerId,
  forCustomer,
  onForCustomerChange,
}: Props) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border transition-colors",
        enabled
          ? "border-primary/50 bg-primary/5 shadow-sm"
          : "border-dashed border-border bg-muted/20 hover:border-primary/40 hover:bg-primary/5",
      )}
    >
      <button
        type="button"
        onClick={() => onEnabledChange(!enabled)}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
        aria-pressed={enabled}
      >
        <span
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors",
            enabled ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
          )}
        >
          <BookmarkPlus className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Bu rotayı şablon olarak kaydet</span>
          <span className="block text-[11px] text-muted-foreground">
            Sonraki iş emirlerinde "Şablondan başla" ile tek tıkla gelir
          </span>
        </span>
        {/* Switch göstergesi */}
        <span
          className={cn(
            "relative h-5 w-9 shrink-0 rounded-full transition-colors",
            enabled ? "bg-primary" : "bg-muted-foreground/30",
          )}
        >
          <motion.span
            className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow"
            animate={{ x: enabled ? 16 : 0 }}
            transition={springSnappy}
          />
        </span>
      </button>

      <AnimatePresence initial={false}>
        {enabled && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="space-y-2 border-t border-primary/20 px-3 py-2.5">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Şablon Adı *</label>
                <Input
                  value={name}
                  onChange={(e) => onNameChange(e.target.value)}
                  placeholder="Örn: Boyahane + Kurşun + Tambur"
                  className="mt-1"
                  autoFocus
                />
                <p className="mt-1 text-[11px] text-muted-foreground">Kod otomatik atanır.</p>
              </div>
              {customerId && (
                <label className="flex cursor-pointer items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={forCustomer}
                    onChange={(e) => onForCustomerChange(e.target.checked)}
                    className="h-4 w-4 cursor-pointer accent-primary"
                  />
                  Bu müşteriye özel varsayılan rota olarak kaydet
                </label>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
