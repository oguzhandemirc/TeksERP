// =============================================================================
// MALİYET › HIZLI HESAPLAYICI (MAL-3, M0) — `cost:read`. Ürün seç ya da elle yapı + ezmeler + kur → canlı döküm.
// KAYIT YAZMAZ (yalnız `POST /api/cost/preview`); sayı sunucudandır. Teklif fiyatı MAL-4/5'te ("Teklife ekle" yok).
// =============================================================================
import { useState } from "react";
import { PackageSearch } from "lucide-react";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { ItemPickerModal } from "@/components/forms/ItemPickerModal";
import { apiErrorMessage } from "@/services/apiClient";
import { CostBreakdown } from "../shared/CostBreakdown";
import { CostModuleClosed } from "../shared/CostQueryState";
import { isModuleDisabled } from "../shared/errors";
import { FxRateInputs, foreignCurrencies } from "../shared/FxRateInputs";
import { missingFields } from "../shared/missing-targets";
import { useCostPreview } from "../shared/useCostPreview";
import { AdHocFields } from "./AdHocFields";
import { OverrideFields } from "./OverrideFields";
import { buildCalculatorBody, emptyCalculator, type CalculatorState } from "./calculator-body";

export function CalculatorPage() {
  const [s, setS] = useState<CalculatorState>(emptyCalculator);
  const [item, setItem] = useState<{ code: string; name: string } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const preview = useCostPreview(buildCalculatorBody(s));
  const p = preview.data;
  const flagged = missingFields(p?.eksikler ?? []);
  const up = (patch: Partial<CalculatorState>) => setS((x) => ({ ...x, ...patch }));
  return (
    <PageShell>
      <PageHeader
        title="Hızlı Hesaplayıcı"
        description="Bir kumaşın ya da elle kurduğunuz yapının metre maliyetini deneyin. Hiçbir şey kaydedilmez; her sayı sunucuda hesaplanır."
      />
      <PageBody className="grid gap-6 p-4 sm:p-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
        <div className="min-w-0 space-y-4">
          <SourceBar
            mode={s.mode}
            itemLabel={item ? `${item.code} — ${item.name}` : null}
            onMode={(mode) => up({ mode })}
            onPick={() => setPickerOpen(true)}
          />
          {s.mode === "adHoc" && <AdHocFields value={s.adHoc} onChange={(adHoc) => up({ adHoc })} />}
          <section className="space-y-2">
            <h3 className="text-sm font-medium">
              Ezmeler{" "}
              <span className="font-normal text-muted-foreground">
                — boş alan yapı/parametre varsayılanıdır
              </span>
            </h3>
            <OverrideFields
              value={s.overrides}
              onChange={(k, v) => up({ overrides: { ...s.overrides, [k]: v } })}
              rateCode={s.finishingRateCode}
              onRateCode={(finishingRateCode) => up({ finishingRateCode })}
              noRateLabel={s.mode === "item" ? "Ürün yapısındaki tarife" : "Ham satış (terbiye yok)"}
              flagged={flagged}
            />
          </section>
          <FxRateInputs
            currencies={foreignCurrencies(p?.girdi)}
            value={s.fx}
            onChange={(c, v) => up({ fx: { ...s.fx, [c]: v } })}
            suggestions={p?.oneriler.fx}
            highlight={flagged.has("fx")}
          />
        </div>
        {/* Geniş ekranda sonuç yanda ve yapışkan: girdi değişirken döküm görünür kalır. */}
        <aside className="min-w-0 xl:sticky xl:top-4 xl:self-start" aria-label="Döküm">
          <CalculatorResult s={s} preview={preview} />
        </aside>
      </PageBody>
      <ItemPickerModal
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        allowedTypes={["FABRIC"]}
        onPick={(r) => {
          setItem({ code: r.code, name: r.name });
          up({ itemId: r.id });
          setPickerOpen(false);
        }}
      />
    </PageShell>
  );
}

function CalculatorResult({
  s,
  preview,
}: {
  s: CalculatorState;
  preview: ReturnType<typeof useCostPreview>;
}) {
  if (preview.isError) {
    if (isModuleDisabled(preview.error)) return <CostModuleClosed />;
    return (
      <p
        role="alert"
        className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
      >
        {apiErrorMessage(preview.error)}
      </p>
    );
  }
  if (!preview.data) {
    return (
      <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        {preview.isFetching
          ? "Hesaplanıyor…"
          : s.mode === "item"
            ? "Hesap için bir kumaş seçin."
            : "Hesap için tel sayısı ya da atkı sıklığı girin."}
      </p>
    );
  }
  return (
    <CostBreakdown
      sonuc={preview.data.sonuc}
      eksikler={preview.data.eksikler}
      uyarilar={preview.data.uyarilar}
    />
  );
}

interface SourceBarProps {
  mode: CalculatorState["mode"];
  itemLabel: string | null;
  onMode: (m: CalculatorState["mode"]) => void;
  onPick: () => void;
}

/** Kaynak: kayıtlı kumaş (seçici doğrudan modal) ya da elle yapı. */
function SourceBar({ mode, itemLabel, onMode, onPick }: SourceBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Kaynak">
      <Button size="sm" variant={mode === "item" ? "default" : "outline"} onClick={() => onMode("item")}>
        Ürün seç
      </Button>
      <Button size="sm" variant={mode === "adHoc" ? "default" : "outline"} onClick={() => onMode("adHoc")}>
        Elle yapı
      </Button>
      {mode === "item" && (
        <Button size="sm" variant="outline" onClick={onPick}>
          <PackageSearch className="mr-1 h-4 w-4" />
          {itemLabel ?? "Kumaş seç…"}
        </Button>
      )}
    </div>
  );
}
