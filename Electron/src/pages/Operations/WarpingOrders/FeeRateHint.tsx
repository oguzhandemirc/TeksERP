// Devere ücretinin fasoncu tarifesinden önerisi: yeni siparişte devereci seçilince aktif tarife birim/fiyat/parayı
// doldurur (kullanıcı ezebilir → "tariften farklı" notu). Düzenlemede doldurma YOK — kayıtlı fiyat donar.
// Maliyet modülü kapalı ya da `cost:read` yoksa sorgu atılmaz (bugünkü davranış).
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useMaliyetEnabled } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { finishingRateService, type FinishingRate } from "@/pages/Cost/FinishingRates/service";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { WarpingOrderFormState } from "./order-model";
import { basisLabel, feeDiffersFromRate, feeFromRate, pickRate, rateLabel, usableRates, type FeeFields } from "./fee-rate";

interface Props {
  s: WarpingOrderFormState;
  up: (patch: Partial<WarpingOrderFormState>) => void;
  /** Yeni sipariş: tarife alanları doldurur. Düzenleme: yalnız not. */
  autoFill: boolean;
}

const sameFee = (a: FeeFields, b: FeeFields) => a.feeUnit === b.feeUnit && a.feeUnitPrice === b.feeUnitPrice && a.feeCurrency === b.feeCurrency;

export function FeeRateHint({ s, up, autoFill }: Props) {
  // Birden çok aday varsa kullanıcının seçtiği tarife; null = öneri (pickRate).
  const [selectedRateId, setSelectedRateId] = useState<string | null>(null);
  const maliyet = useMaliyetEnabled();
  const canRead = useRoleAccess().hasPermission("cost:read");
  const firm = s.subcontractorId;
  const q = useQuery({
    queryKey: ["cost-finishing-rates", "subcontractor", firm],
    queryFn: () => finishingRateService.listForSubcontractor(firm as string),
    enabled: maliyet && canRead && Boolean(firm),
  });
  const rates = q.data ?? [];
  const usable = usableRates(rates);
  const rate = usable.find((r) => r.id === selectedRateId) ?? (q.isSuccess ? pickRate(rates, s.feeUnit) : null);
  // Son doldurulan değer: form hâlâ ona eşitse (kullanıcı ezmediyse) firma değişiminde yeniden doldurulur.
  const lastFill = useRef<FeeFields | null>(null);
  const current: FeeFields = { feeUnit: s.feeUnit, feeUnitPrice: s.feeUnitPrice, feeCurrency: s.feeCurrency };
  const rateId = rate?.id ?? null;

  useEffect(() => {
    if (!autoFill || !rate) return;
    const untouched = current.feeUnitPrice.trim() === "" || (lastFill.current !== null && sameFee(current, lastFill.current));
    if (!untouched) return;
    const fill = feeFromRate(rate);
    lastFill.current = fill;
    if (!sameFee(current, fill)) up(fill);
    // Yalnız seçili tarife değişince; form alanları bağımlılık değildir (ezme notu render'da).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFill, rateId]);

  if (!maliyet || !canRead || !firm || !q.isSuccess) return null;
  if (rates.length === 0) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="wo-fee-rate-none">
        Bu deverecinin tarifesi yok.{" "}
        <Link to="/cost/finishing-rates" className="font-medium text-primary underline-offset-2 hover:underline">
          Tarife tanımla
        </Link>
      </p>
    );
  }
  if (!rate) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="wo-fee-rate-unmatched">
        Tarifenin birimi ({[...new Set(rates.map((r) => basisLabel(r.basis)))].join(", ")}) devere ücret birimiyle eşleşmiyor; ücret otomatik doldurulmadı.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      {usable.length > 1 && <span className="text-muted-foreground">Tarife</span>}
      {usable.length > 1 && (
        <Select value={rate.id} onValueChange={(v) => {
          // Açık seçim her zaman doldurur: mevcut değer "dokunulmamış" sayılır.
          lastFill.current = current;
          setSelectedRateId(v);
        }}>
          <SelectTrigger aria-label="Tarife" className="h-8 w-72 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {usable.map((r: FinishingRate) => (
              <SelectItem key={r.id} value={r.id}>
                {r.name} — {rateLabel(r)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {feeDiffersFromRate(current, rate) ? (
        <span className="text-amber-700 dark:text-amber-400" data-testid="wo-fee-rate-diff">
          Tariften farklı (tarife: {rateLabel(rate)})
        </span>
      ) : (
        <span className="text-muted-foreground" data-testid="wo-fee-rate-applied">
          {usable.length > 1 ? "Tarifeden dolduruldu" : `Tarifeden: ${rate.name} (${rateLabel(rate)})`}
        </span>
      )}
    </div>
  );
}
