// Döküm sekmesi: sunucu önizlemesi (YAZMAZ) + kur alanları + "Standart olarak kaydet". Sayı yalnız yanıttan.
// Kur bilgisi ve kaydet düğmesi kart yüzeyinde (zemin kuralı, B18/1); kartın sağında eylem, solunda kur.
import { PermissionGate } from "@/components/PermissionGate";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Currency } from "@/pages/Finance/service";
import { CostBreakdown } from "../shared/CostBreakdown";
import type { CostPreview } from "../shared/cost-types";
import { FxRateInputs, foreignCurrencies } from "../shared/FxRateInputs";
import { fmtCalendarDay } from "@/lib/factory-time";

interface Props {
  preview: CostPreview | undefined;
  loading: boolean;
  fx: Partial<Record<Currency, string>>;
  onFx: (c: Currency, v: string) => void;
  fxFlagged: boolean;
  onSave: () => void;
}

const FX_SOURCE: Record<string, string> = { ELLE: "elle", FINANS: "Muhasebe kurları", YOK: "kur yok" };

export function BreakdownTab({ preview, loading, fx, onFx, fxFlagged, onSave }: Props) {
  if (!preview) return <p className="text-sm text-muted-foreground">{loading ? "Hesaplanıyor…" : "Önizleme yok."}</p>;
  const currencies = foreignCurrencies(preview.girdi);
  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end justify-between gap-3 p-4">
        <div className="min-w-0 space-y-1">
          <FxRateInputs
            currencies={currencies} value={fx} onChange={onFx} suggestions={preview.oneriler.fx} highlight={fxFlagged}
            incomplete={!preview.sonuc && preview.eksikler.length > 0}
          />
          {currencies.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Hesapta kullanılan kur: {FX_SOURCE[preview.kurlar.kaynak] ?? preview.kurlar.kaynak} · {fmtCalendarDay(preview.kurlar.tarih)}
            </p>
          )}
        </div>
        <PermissionGate permission="cost:write">
          <Button onClick={onSave} disabled={loading || !preview.sonuc} title={preview.sonuc ? undefined : "Eksikler giderilmeden kaydedilemez"}>Standart olarak kaydet</Button>
        </PermissionGate>
      </Card>
      <CostBreakdown sonuc={preview.sonuc} eksikler={preview.eksikler} uyarilar={preview.uyarilar} />
    </div>
  );
}
