// Kasa/Banka seçicisi — ödeme diyaloğundan çıkarıldı (dosya tavanı); metinler bayt bayt aynı.
import { Label } from "@/components/ui/label";
import type { Currency } from "./service";

export interface PaymentAccount {
  id: string;
  name: string;
  currency: Currency | string;
  kind: "CASH" | "BANK";
}

interface Props {
  accounts: PaymentAccount[];
  value: string;
  onChange: (id: string) => void;
  isError: boolean;
  resolved: boolean;
}

export function PaymentAccountSelect({ accounts, value, onChange, isError, resolved }: Props) {
  return (
    <div>
      <Label>Kasa / Banka</Label>
      <select className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Kasa / Banka">
        <option value="">Seçin…</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.kind === "CASH" ? "Kasa" : "Banka"} · {a.name} ({a.currency})
          </option>
        ))}
      </select>
      {isError && (
        <p className="mt-1 text-xs text-destructive">
          Kasa/banka listesi okunamadı — bu “tanım yok” DEMEK DEĞİLDİR. Yeni kasa açmayın;
          diyaloğu kapatıp tekrar açın.
        </p>
      )}
      {resolved && accounts.length === 0 && (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-500">
          Kasa/banka tanımı yok. Önce Muhasebe → Kasa &amp; Banka ekranından ekleyin.
        </p>
      )}
    </div>
  );
}
