import { Star } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { PermissionGate } from "@/components/PermissionGate";
import { OptionSetPair } from "@/components/labels/option-set/OptionSetPair";
import { useOptionSets } from "@/components/labels/option-set/useOptionSets";
import { previewNames } from "@/components/labels/option-set/labelOptionSet";
import {
  labelTemplateOptionService,
  type CustomerLabelOptionSetResponse,
  type OptionSetKind,
} from "@/services/labelTemplateOptionService";

export function useCustomerLabelSets(customerId: string, alsoInvalidate: ReadonlyArray<readonly unknown[]>) {
  return useOptionSets<CustomerLabelOptionSetResponse>({
    queryKey: ["customer-label-options", customerId],
    load: (kind) => labelTemplateOptionService.getCustomer(customerId, kind),
    save: (body) => labelTemplateOptionService.setCustomer(customerId, body),
    alsoInvalidate,
  });
}

type Sets = ReturnType<typeof useCustomerLabelSets>;

/** Müşteri → Etiket Şablonları: ham/bitmiş top seti + "Herkes için seti de göster" (K7, varsayılan açık). */
export function CustomerLabelSetsSection({ sets }: { sets: Sets }) {
  if (sets.status === "missing") return null;
  if (sets.status === "loading") return <Skeleton className="h-40 w-full" />;
  if (sets.status === "error") {
    return <p className="text-sm text-destructive">Etiket seti yüklenemedi; pencereyi kapatıp yeniden açın.</p>;
  }

  // Anahtar müşteri düzeyindedir; iki yanıt da aynı değeri taşır.
  const showGlobal = sets.responses.ROLL_RAW?.showGlobalTemplates ?? true;
  const globalDefault = (kind: OptionSetKind) =>
    sets.responses[kind]?.globalItems.find((i) => i.isDefault && i.active)?.name ?? null;

  return (
    <div className="space-y-3 rounded-md border p-3" data-testid="customer-label-sets">
      <p className="text-xs text-muted-foreground">
        Bu müşterinin top etiketlerinde yıldızlı (★) şablon basılır; tablette setteki diğerleri
        de seçilebilir. Top etiketinde Ham ya da Bitmiş seti topun aşamasına göre kullanılır.
      </p>
      <PermissionGate
        permission="label-template:write"
        fallback={<p className="text-xs text-muted-foreground">Herkes için set {showGlobal ? "gösterilir" : "gösterilmez"}.</p>}
      >
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={showGlobal}
            disabled={sets.pending}
            aria-label="Herkes için seti de göster"
            onCheckedChange={(v) =>
              void sets.apply([{ kind: "ROLL_RAW", draft: sets.drafts.ROLL_RAW, showGlobalTemplates: v }]).catch(() => {})
            }
          />
          Herkes için seti de göster
        </label>
      </PermissionGate>
      <OptionSetPair
        drafts={sets.drafts}
        pending={sets.pending}
        onApply={(c) => void sets.apply(c).catch(() => {})}
        noDefaultHint={(kind) => {
          const name = globalDefault(kind);
          return name ? `Varsayılan: herkes için ★ (${name}).` : "Müşteri varsayılanı yok — genel varsayılan kullanılır.";
        }}
        removeDefaultText="Bu müşteri için varsayılan kalkar; etiketler herkes için varsayılan şablonla basılır."
        footer={(kind) => (showGlobal ? <GlobalPreview items={sets.responses[kind]?.globalItems ?? []} /> : null)}
      />
    </div>
  );
}

function GlobalPreview({ items }: { items: CustomerLabelOptionSetResponse["globalItems"] }) {
  const names = previewNames(items);
  return (
    <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground opacity-80" data-testid="global-preview">
      <span>Herkes için:</span>
      {names.length === 0 ? (
        <span>set boş</span>
      ) : (
        names.map((n, i) => (
          <span key={`${n.name}-${i}`} className="inline-flex items-center gap-0.5">
            {i > 0 && <span aria-hidden>·</span>}
            {n.name}
            {n.isDefault && <Star className="h-3 w-3 fill-amber-400 text-amber-500" aria-label="varsayılan" />}
          </span>
        ))
      )}
    </p>
  );
}
