import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { PermissionGate } from "@/components/PermissionGate";
import { labelTemplateService } from "@/services/labelTemplateService";
import { customerStandaloneLabelService } from "@/services/customerStandaloneLabelService";

interface Props {
  customerId: string;
}

/**
 * Müşteri ↔ serbest etiket bağı (CustomerStandaloneLabel — kolaylık M:N bağı).
 * KIND-bazlı CustomerTemplateRoute'tan AYRIDIR: rulo/kartela baskı çözümüne
 * KATILMAZ. İşaretlenmeyen serbest etiket "genel" kalır ve her müşteride
 * görünür; işaretli etiket yalnız bu müşteride + genel etiketlerle listelenir.
 */
export function CustomerStandaloneLabelsPanel({ customerId }: Props) {
  const qc = useQueryClient();
  const linkedKey = ["customer-standalone-labels", customerId];

  // Seçilebilir havuz — tüm AKTİF serbest etiketler.
  const poolQuery = useQuery({
    queryKey: ["label-templates", "standalone", "link-picker"],
    queryFn: () => labelTemplateService.list({ standalone: true }).then((r) => r.data),
  });
  // Şu an bu müşteriye bağlı etiketler (id + ad).
  const linkedQuery = useQuery({
    queryKey: linkedKey,
    queryFn: () => customerStandaloneLabelService.list(customerId),
  });

  // Yerel seçim — sunucu durumundan yalnız İLK yüklemede/müşteri değişince
  // tohumlanır; yerel düzenleme varken arka plan refetch'i seçimi ezmez.
  const [checked, setChecked] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (checked === null && linkedQuery.data) {
      setChecked(new Set(linkedQuery.data.map((r) => r.id)));
    }
  }, [linkedQuery.data, checked]);
  useEffect(() => setChecked(null), [customerId]);

  const setMut = useMutation({
    mutationFn: (ids: string[]) => customerStandaloneLabelService.set(customerId, ids),
    onSuccess: () => {
      toast.success("Müşterinin serbest etiketleri güncellendi.");
      qc.invalidateQueries({ queryKey: linkedKey });
    },
  });

  if (poolQuery.isLoading || linkedQuery.isLoading || checked === null) {
    return <Skeleton className="h-40 w-full" />;
  }

  const activeTemplates = (poolQuery.data ?? []).filter((t) => t.isActive);
  const linkedRows = linkedQuery.data ?? [];

  if (activeTemplates.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        Henüz serbest etiket yok — Etiketler → Düzenler'den "Serbest etiket" oluşturun.
      </div>
    );
  }

  const linkedIds = new Set(linkedRows.map((r) => r.id));
  const dirty =
    checked.size !== linkedIds.size || [...checked].some((id) => !linkedIds.has(id));

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        İşaretlenmeyen serbest etiket <b>genel</b> kalır (tüm müşterilerde görünür).
        İşaretli etiketler Serbest Baskı ekranında bu müşteri seçilince — genel
        etiketlerle birlikte — listelenir.
      </p>

      <PermissionGate
        permission="label-template:write"
        fallback={<ReadOnlyLinked names={linkedRows.map((r) => r.name)} />}
      >
        <ul className="divide-y rounded-md border">
          {activeTemplates.map((t) => (
            <li key={t.id} className="flex items-center gap-2 p-3 text-sm">
              <Checkbox
                id={`std-lbl-${t.id}`}
                checked={checked.has(t.id)}
                onCheckedChange={() => toggle(t.id)}
                disabled={setMut.isPending}
              />
              <label htmlFor={`std-lbl-${t.id}`} className="flex-1 cursor-pointer font-medium">
                {t.name}
              </label>
            </li>
          ))}
        </ul>

        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            disabled={!dirty || setMut.isPending}
            onClick={() => setMut.mutate([...checked])}
          >
            {setMut.isPending ? "Kaydediliyor..." : "Kaydet"}
          </Button>
        </div>
      </PermissionGate>
    </div>
  );
}

/** Yazma yetkisi olmayan kullanıcıya salt-okunur bağlı etiket listesi. */
function ReadOnlyLinked({ names }: { names: string[] }) {
  if (names.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Bu müşteriye özel serbest etiket atanmamış — yalnız genel etiketler görünür.
      </p>
    );
  }
  return (
    <ul className="divide-y rounded-md border">
      {names.map((n) => (
        <li key={n} className="p-3 text-sm font-medium">
          {n}
        </li>
      ))}
    </ul>
  );
}
