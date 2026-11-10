import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { OptionSetPair } from "@/components/labels/option-set/OptionSetPair";
import { useOptionSets } from "@/components/labels/option-set/useOptionSets";
import { labelTemplateOptionService } from "@/services/labelTemplateOptionService";

export const GLOBAL_SETS_KEY = "label-global-options";

export function useGlobalLabelSets(alsoInvalidate: ReadonlyArray<readonly unknown[]>) {
  return useOptionSets({
    queryKey: [GLOBAL_SETS_KEY],
    load: labelTemplateOptionService.getGlobal,
    save: ({ kind, templateIds, defaultTemplateId }) =>
      labelTemplateOptionService.setGlobal({ kind, templateIds, defaultTemplateId }),
    alsoInvalidate,
  });
}

/** Etiketler → Atamalar: herkes için top etiketi seti (ham / bitmiş). Eski backend'de çizilmez. */
export function GlobalLabelSetsCard({ sets }: { sets: ReturnType<typeof useGlobalLabelSets> }) {
  if (sets.status === "missing") return null;
  return (
    <Card data-testid="global-label-sets">
      <CardHeader>
        <CardTitle>Herkes İçin Top Etiketi Seti</CardTitle>
        <CardDescription>
          Müşteriye özel atama yoksa yıldızlı (★) şablon basılır; tablette setteki diğer
          şablonlar da seçilebilir. Ham ve bitmiş top için ayrı settir.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sets.status === "loading" ? (
          <Skeleton className="h-40 w-full" />
        ) : sets.status === "error" ? (
          <p className="text-sm text-destructive">Etiket seti yüklenemedi. Yenile düğmesiyle tekrar deneyin.</p>
        ) : (
          <OptionSetPair
            drafts={sets.drafts}
            pending={sets.pending}
            onApply={(c) => void sets.apply(c).catch(() => {})}
            noDefaultHint={() => "Varsayılan yok — müşteriye özel atama yoksa bu bağlamda şablonsuz (katalog düzeni) basılır."}
            removeDefaultText="Varsayılan kalkar; müşteriye özel ataması olmayan etiketler şablonsuz (katalog düzeni) basılır. Yeni varsayılan için bir şablona yıldız verin."
          />
        )}
      </CardContent>
    </Card>
  );
}
