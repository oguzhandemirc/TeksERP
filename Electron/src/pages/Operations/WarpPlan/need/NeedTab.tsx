// Çözgü Hesabı › "İhtiyaçtan → devere önerisi" (D8): kumaş + ham kumaş metresi ya da URL'den gelen dokuma işi /
// sipariş → kart başına çözgü ihtiyacı, eldeki/yoldaki arz ve devere önerisi. KAYIT YAZMAZ.
import { useState } from "react";
import { Package, X } from "lucide-react";
import { FormField } from "@/components/forms/FormField";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { apiErrorMessage } from "@/services/apiClient";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { TERIM } from "@/lib/terim";
import { itemLifecycleOf, pickableLifecycle } from "@/lib/item-lifecycle";
import { itemService } from "@/pages/Items/service";
import type { Item } from "@/pages/Items/types";
import { fabricNeedQuery } from "./need-model";
import { useWarpNeed } from "./need-service";
import { NeedTable } from "./NeedTable";
import type { WarpNeedQuery } from "./need-types";

interface Props {
  /** URL'den gelen dokuma işi / sipariş kaynağı; null → kumaş girişi. */
  linked: WarpNeedQuery | null;
  onClearLinked: () => void;
}

export function NeedTab({ linked, onClearLinked }: Props) {
  const flags = useFeatureFlags().data?.data;
  const [itemId, setItemId] = useState<string | null>(null);
  const [fabricM, setFabricM] = useState("");
  const settledM = useDebouncedValue(fabricM, 400);
  const query = linked ?? fabricNeedQuery(itemId, settledM);
  const q = useWarpNeed(query);
  return (
    <div className="space-y-4">
      {linked ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">Kaynak:</span>
          <span className="font-medium" data-testid="warp-need-source">{q.data?.sourceLabel ?? "…"}</span>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={onClearLinked}>
            <X className="mr-1 h-4 w-4" /> Kumaştan hesapla
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <FormField label="Kumaş" required>
            <EntityPickerModal<Item>
              value={itemId}
              onChange={(id) => setItemId(id)}
              service={itemService}
              queryKey="items-warp-need-fabric"
              filters={{ itemType: "FABRIC", lifecycleStatus: pickableLifecycle("plan", flags) }}
              getLabel={(i) => i.name}
              getSubLabel={(i) => (itemLifecycleOf(i) === "PHASE_OUT" ? `${i.code} · Tükenene kadar` : i.code)}
              icon={Package}
              title="Dokunacak kumaşı seç"
              placeholder="Kumaş seç"
            />
          </FormField>
          <FormField label="Ham kumaş (m)" htmlFor="wn-fabric-m" required hint="Dokunacak metre; çözgü metresi kumaşın çekme oranıyla bulunur.">
            <Input id="wn-fabric-m" inputMode="decimal" value={fabricM} onChange={(e) => setFabricM(e.target.value)} />
          </FormField>
        </div>
      )}
      <NeedResult hasQuery={query !== null} q={q} />
    </div>
  );
}

function NeedResult({ hasQuery, q }: { hasQuery: boolean; q: ReturnType<typeof useWarpNeed> }) {
  if (!hasQuery) return <Empty text="Kumaşı seçip dokunacak metreyi yazın; eldeki ve yoldaki çözgü düşülerek devere önerisi çıkar." />;
  if (q.isError) {
    return (
      <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
        {apiErrorMessage(q.error)}
      </p>
    );
  }
  const res = q.data;
  if (!res) return <Empty text="Hesaplanıyor…" />;
  return (
    <div className="space-y-3" aria-busy={q.isFetching}>
      {res.warnings.map((w) => (
        <Callout key={w.code + w.message} tone="warning" className="text-sm">{w.message}</Callout>
      ))}
      {res.rows.length === 0 && res.warnings.length === 0 && <Empty text="Bu kaynak için leventli çözgü ihtiyacı yok." />}
      <NeedTable res={res} />
      <p className="text-xs text-muted-foreground">
        Eldeki + yoldaki = hazır/takılı levent kalanı + planlanmış levent + açık devere siparişlerinin henüz dönmemiş metresi. Önce açık {TERIM.dokumaIsEmri.cogulKucuk} (plan başlangıcı sırasıyla) bu çözgüyü kullanır; öneri yalnız kalan eksiği kapatır.
      </p>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">{text}</p>;
}
