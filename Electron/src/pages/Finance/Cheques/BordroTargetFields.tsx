// =============================================================================
// TESLİM BORDROSU — TESLİM TÜRÜ (hareket fişi, K3; yalnız bayrak açık + aldığımız çekler)
// =============================================================================
// Bankaya → banka hesabı seçilir ve kayıtla çekler bankaya verilir; Cariye ciro → cari seçilir ve
// çekler ciro edilir; Diğer → serbest metin, çek DEĞİŞMEZ (avukat/noter gibi teslimler). Cari
// seçici kart döner; hesabı Z-A tek yolundan (`getCariByCustomer`) çözülür — hesabı olmayan kart
// seçilemez (bordro hedefi cari HESAPTIR).
// =============================================================================
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CustomerPickerField } from "@/components/forms/CustomerPickerField";
import { getCariByCustomer, listBankAccounts } from "../service";
import { TARGET_KIND_LABEL, type DeliveryTarget, type DeliveryTargetKind } from "./chequeNoteMovement";

interface Props {
  target: DeliveryTarget;
  onTargetChange: (t: DeliveryTarget) => void;
  targetLabel: string;
  onTargetLabelChange: (v: string) => void;
  /** Seçimin tek para birimi — banka listesi ona süzülür (karışık seçimde süzülmez, backend satır satır söyler). */
  currency: string | null;
}

const KINDS: DeliveryTargetKind[] = ["BANK", "CARI", "TEXT"];

export function BordroTargetFields({ target, onTargetChange, targetLabel, onTargetLabelChange, currency }: Props) {
  const setKind = (k: DeliveryTargetKind) => onTargetChange({ targetKind: k, bankAccountId: null, cariId: null });

  return (
    <div className="space-y-2">
      <Label>Teslim türü</Label>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Teslim türü">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={target.targetKind === k}
            className={`rounded-md border px-2 py-2 text-xs ${target.targetKind === k ? "border-primary bg-primary/10 font-medium" : "hover:bg-muted"}`}
            onClick={() => setKind(k)}
          >
            {TARGET_KIND_LABEL[k]}
          </button>
        ))}
      </div>

      {target.targetKind === "BANK" && (
        <BankTarget value={target.bankAccountId} currency={currency} onChange={(id) => onTargetChange({ ...target, bankAccountId: id })} />
      )}
      {target.targetKind === "CARI" && (
        <CariTarget cariId={target.cariId} onChange={(id) => onTargetChange({ ...target, cariId: id })} />
      )}

      {target.targetKind && (
        <div>
          <Label>{target.targetKind === "TEXT" ? "Teslim edilen yer / firma" : "Şube / açıklama (opsiyonel)"}</Label>
          <Input
            className="mt-1"
            maxLength={200}
            placeholder={target.targetKind === "TEXT" ? "Örn: Av. Ayşe Yılmaz — takip dosyası" : "Örn: Merkez Şubesi"}
            value={targetLabel}
            onChange={(e) => onTargetLabelChange(e.target.value)}
          />
          {target.targetKind === "TEXT" && (
            <p className="mt-1 text-xs text-muted-foreground">Yalnız belge: çeklerin durumu değişmez.</p>
          )}
        </div>
      )}
    </div>
  );
}

function BankTarget({ value, currency, onChange }: { value: string | null; currency: string | null; onChange: (id: string | null) => void }) {
  const bankQ = useQuery({ queryKey: ["finance", "bank-accounts"], queryFn: listBankAccounts });
  const banks = useMemo(
    () => (bankQ.data?.data ?? []).filter((a) => a.isActive && (!currency || a.currency === currency)),
    [bankQ.data, currency],
  );
  return (
    <div>
      <select
        aria-label="Banka hesabı"
        className="h-9 w-full rounded-md border bg-background px-2 text-sm"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">Banka hesabı seçin…</option>
        {banks.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name} ({a.currency})
          </option>
        ))}
      </select>
      {bankQ.isSuccess && banks.length === 0 && (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-500">
          {currency ?? ""} aktif banka hesabı yok. Önce Muhasebe → Kasa &amp; Banka ekranından ekleyin.
        </p>
      )}
    </div>
  );
}

/** Kart seçilir, hesabı Z-A tek yolundan çözülür; çözülen hesap kimliği yukarı verilir. */
function CariTarget({ cariId, onChange }: { cariId: string | null; onChange: (id: string | null) => void }) {
  const [customerId, setCustomerId] = useState<string | null>(null);
  const cariQ = useQuery({
    queryKey: ["finance", "cari", "by-customer", customerId],
    queryFn: () => getCariByCustomer(customerId as string),
    enabled: Boolean(customerId),
  });
  const resolved = customerId ? (cariQ.data?.id ?? null) : null;
  useEffect(() => {
    if (resolved !== cariId) onChange(resolved);
  }, [resolved, cariId, onChange]);
  return (
    <div>
      <CustomerPickerField variant="cari" value={customerId} onChange={setCustomerId} />
      {customerId && cariQ.isSuccess && !cariQ.data && (
        <p className="mt-1 text-xs text-destructive">Bu kartın cari hesabı yok — ciro edilemez.</p>
      )}
      <p className="mt-1 text-xs text-muted-foreground">
        Çeki veren cariye geri vermek ciro değil iadedir; o satır kayıtta reddedilir.
      </p>
    </div>
  );
}
