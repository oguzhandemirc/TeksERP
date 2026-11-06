import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Factory } from "lucide-react";
import { Input } from "@/components/ui/input";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { ViewSelect } from "@/components/data-table/filter-row/ViewSelect";
import { subcontractorService } from "@/pages/Subcontractors/service";
import type { Subcontractor } from "@/pages/Subcontractors/types";
import { FASON_FIRMA_KEY, FASON_GUN_KEY, NEREDE_FILTER_KEY, activeNeredeTab, normalizeFasonGun, neredeTabs } from "./order-nerede";
import { useOrderViewCounts } from "./useOrderViewCounts";

type Apply = (patch: Record<string, string | null>) => void;

/** URL yazıcı — `null` anahtarı siler; yeni süzgeçle eski sayfa anlamsız (cursor/page sıfırlanır). */
function useApply(): [URLSearchParams, Apply] {
  const [sp, setSp] = useSearchParams();
  const apply: Apply = (patch) =>
    setSp((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      next.delete("cursor");
      next.delete("page");
      return next;
    });
  return [sp, apply];
}

/**
 * "Görünüm" — "Nerede?" hızlı sekmeleri TEK açılırda (Tümü · Bekleyenler · Fasonda · Sevke hazır ·
 * Kısmen gidenler · Gecikenler) + sayılar. Süzme SUNUCUDA (`filter[nerede]`); üretim kapalıyken
 * fason/hazır seçenekleri düşer (sunucu da 403 verir).
 */
export function OrdersViewSelect({ productionEnabled, forceFilters, autoOpen }: { productionEnabled: boolean; forceFilters: Record<string, string>; autoOpen?: boolean }) {
  const [sp, apply] = useApply();
  const [open, setOpen] = useState(Boolean(autoOpen));
  const tabs = neredeTabs(productionEnabled);
  const counts = useOrderViewCounts(tabs, forceFilters, open);
  return (
    <ViewSelect
      label="Görünüm"
      options={tabs}
      value={activeNeredeTab(sp.get(NEREDE_FILTER_KEY))}
      onChange={(v) => apply({ [NEREDE_FILTER_KEY]: v })}
      counts={counts}
      onOpenChange={setOpen}
      autoOpen={autoOpen}
    />
  );
}

/** Fason firma — tıklayınca doğrudan modal açılır (combobox yok); tek firma seçilir. */
export function FasonFirmaFilter({ autoOpen }: { autoOpen?: boolean }) {
  const [sp, apply] = useApply();
  // Sunucu CSV kabul eder; elle yazılmış çoklu URL'de seçici ilk firmayı gösterir.
  const first = sp.get(FASON_FIRMA_KEY)?.split(",").find(Boolean) ?? null;
  return (
    <div className="flex min-w-0 items-center pl-2">
      <span className="shrink-0 text-xs">Fason firma:</span>
      <div className="w-[160px] min-w-0">
        <EntityPickerModal<Subcontractor>
          value={first}
          onChange={(id) => apply({ [FASON_FIRMA_KEY]: id })}
          service={subcontractorService}
          queryKey="subcontractors"
          getLabel={(s) => s.name}
          getSubLabel={(s) => s.code}
          nullable
          noneLabel="Tüm fason firmaları"
          icon={Factory}
          placeholder="Tümü"
          title="Fason firma seç"
          countLabel="firma"
          defaultOpen={autoOpen}
          triggerClassName="h-7 border-0 bg-transparent py-0 text-xs shadow-none"
        />
      </div>
    </div>
  );
}

/** "Fasonda X günden uzun" — yazma durunca (500 ms) URL'e işlenir; geçersiz girdi süzgeci kaldırır. */
export function FasonGunFilter({ autoOpen }: { autoOpen?: boolean }) {
  const [sp, apply] = useApply();
  const urlValue = sp.get(FASON_GUN_KEY) ?? "";
  const [local, setLocal] = useState(urlValue);
  useEffect(() => setLocal(urlValue), [urlValue]);
  useEffect(() => {
    const next = normalizeFasonGun(local);
    if ((next ?? "") === urlValue) return;
    const t = setTimeout(() => apply({ [FASON_GUN_KEY]: next }), 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- yalnız girdi değişiminde zamanlanır
  }, [local]);
  return (
    <div className="flex items-center gap-1 px-2 text-xs">
      <span>Fasonda</span>
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        max={3650}
        step={1}
        autoFocus={autoOpen}
        aria-label="Fasonda kaç günden uzun"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        className="h-6 w-[52px] border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0"
        placeholder="X"
      />
      <span>günden uzun</span>
    </div>
  );
}
