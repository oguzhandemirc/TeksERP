import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Factory, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { subcontractorService } from "@/pages/Subcontractors/service";
import type { Subcontractor } from "@/pages/Subcontractors/types";
import {
  FASON_FIRMA_KEY,
  FASON_GUN_KEY,
  NEREDE_FILTER_KEY,
  activeNeredeTab,
  neredeTabs,
  normalizeFasonGun,
} from "./order-nerede";

type Patch = Record<string, string | null>;
type Apply = (patch: Patch) => void;

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
 * Siparişler "Nerede?" süzgeç şeridi: hızlı sekmeler + fason firma + "Fasonda X
 * günden uzun". Süzme SUNUCUDA (NEREDE-SOZLESME §2); şerit yalnız URL yazar,
 * liste + cursor + özet şeridi aynı where'den okur.
 */
export function OrdersNeredeBar({ productionEnabled }: { productionEnabled: boolean }) {
  const [sp, apply] = useApply();
  const active = activeNeredeTab(sp.get(NEREDE_FILTER_KEY));
  return (
    <div data-testid="orders-nerede-bar" className="flex shrink-0 flex-wrap items-center gap-1.5 px-3 pt-2">
      <div role="tablist" aria-label="Sipariş nerede" className="flex flex-wrap items-center gap-1">
        {neredeTabs(productionEnabled).map((t) => (
          <Button
            key={t.label}
            type="button"
            role="tab"
            aria-selected={active === t.value}
            size="sm"
            variant={active === t.value ? "default" : "outline"}
            className="h-7 px-2.5 text-xs"
            onClick={() => apply({ [NEREDE_FILTER_KEY]: t.value })}
          >
            {t.label}
          </Button>
        ))}
      </div>
      {productionEnabled && (
        <>
          <FasonFirmaFilter value={sp.get(FASON_FIRMA_KEY)} apply={apply} />
          <FasonGunFilter urlValue={sp.get(FASON_GUN_KEY) ?? ""} apply={apply} />
        </>
      )}
    </div>
  );
}

/** Fason firma — tıklayınca doğrudan modal açılır (combobox yok); tek firma seçilir. */
function FasonFirmaFilter({ value, apply }: { value: string | null; apply: Apply }) {
  // Sunucu CSV kabul eder; elle yazılmış çoklu URL'de modal ilk firmayı gösterir.
  const first = value?.split(",").find(Boolean) ?? null;
  return (
    <div className="w-[220px]">
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
        placeholder="Fason firma"
        title="Fason firma seç"
        countLabel="firma"
        triggerClassName={cn("h-7 py-0 text-xs", first && "border-primary/50")}
      />
    </div>
  );
}

/** "Fasonda X günden uzun" — yazma durunca (500 ms) URL'e işlenir; geçersiz girdi süzgeci kaldırır. */
function FasonGunFilter({ urlValue, apply }: { urlValue: string; apply: Apply }) {
  const [local, setLocal] = useState(urlValue);
  useEffect(() => setLocal(urlValue), [urlValue]);
  useEffect(() => {
    const next = normalizeFasonGun(local);
    if ((next ?? "") === urlValue) return;
    const t = setTimeout(() => apply({ [FASON_GUN_KEY]: next }), 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local]);
  return (
    <div
      className={cn(
        "flex h-7 items-center gap-1 rounded-md border bg-background px-1.5 text-xs",
        urlValue ? "border-primary/50" : "border-input",
      )}
    >
      <span className="text-muted-foreground">Fasonda</span>
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        max={3650}
        step={1}
        aria-label="Fasonda kaç günden uzun"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        className="h-6 w-[56px] border-0 px-1 text-xs shadow-none focus-visible:ring-0"
        placeholder="X"
      />
      <span className="text-muted-foreground">günden uzun</span>
      {urlValue && (
        <Button type="button" size="icon" variant="ghost" className="h-5 w-5" title="Temizle" onClick={() => { setLocal(""); apply({ [FASON_GUN_KEY]: null }); }}>
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
