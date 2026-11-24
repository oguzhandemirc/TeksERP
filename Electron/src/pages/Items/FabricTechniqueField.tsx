// Kumaşın üretim tekniği (2026-11-25): bugün yalnız Dokuma; kumaş sunucuda Dokuma olarak doğar, Örme 400.
// Alan bu yüzden gövdeye girmez — yalnız gösterir; Örme pasif "yakında" olarak durur (açılınca seçilebilir olur).
import { FormField } from "@/components/forms/FormField";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "WOVEN", label: "Dokuma", enabled: true },
  { value: "KNITTED", label: "Örme", enabled: false },
] as const;

export function FabricTechniqueField() {
  return (
    <FormField label="Üretim tekniği" info="Kumaşın dokuma tezgâhında mı örme makinesinde mi üretildiği. Şimdilik yalnız Dokuma; Örme yakında eklenecek.">
      <div role="radiogroup" aria-label="Üretim tekniği" className="inline-flex h-9 w-full overflow-hidden rounded-md border">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === "WOVEN"}
            disabled={!o.enabled}
            title={o.enabled ? undefined : "Yakında"}
            className={cn(
              "flex-1 px-3 text-sm",
              o.value === "WOVEN" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground",
              !o.enabled && "cursor-not-allowed opacity-60",
            )}
          >
            {o.label}
            {!o.enabled && <span className="ml-1 text-xs">(yakında)</span>}
          </button>
        ))}
      </div>
    </FormField>
  );
}
