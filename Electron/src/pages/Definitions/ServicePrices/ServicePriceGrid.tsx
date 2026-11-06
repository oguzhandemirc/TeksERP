// Yoğun kademe tablosu (Logo/Netsis fiyat kartı düzeni): satır = kademe, kolonlar genel · müşteri · ileri tarihli ·
// uygulanan fiyat + kaynak rozeti. İlk satır kademe ayrımsız "kalem fiyatı"dır.
import { useState } from "react";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import type { ServicePriceTable } from "./service";
import { ServicePriceRow, type GridRow } from "./ServicePriceRow";
import { cellKey, formatPrice, nextRowIndex, type EditScope } from "./servicePrices";
import type { useServicePriceMutations } from "./useServicePriceMutations";

interface Props {
  table: ServicePriceTable;
  canWrite: boolean;
  validFromDay: string | null;
  mutations: ReturnType<typeof useServicePriceMutations>;
  onHistory: (valueId: string | null, label: string) => void;
}

export function toGridRows(t: ServicePriceTable): GridRow[] {
  const head: GridRow = {
    valueId: null,
    label: "Kalem fiyatı",
    sub: "kademe ayrımsız",
    general: t.itemPrice.general,
    customer: t.itemPrice.customer,
    tier: null,
  };
  return [
    head,
    ...t.tiers.map((v) => ({
      valueId: v.valueId,
      label: v.name,
      sub:
        [
          v.amount ? `${formatPrice(v.amount)} gr/m` : null,
          !v.isActive ? "pasif" : null,
          !v.mapped ? "eşleme değişti" : null,
        ]
          .filter(Boolean)
          .join(" · ") || null,
      general: v.general,
      customer: v.customer,
      tier: v,
    })),
  ];
}

function useGridEditing(
  { table, validFromDay, mutations }: Pick<Props, "table" | "validFromDay" | "mutations">,
  rows: GridRow[],
) {
  const focusCell = (index: number, scope: EditScope) => {
    const r = rows[index];
    if (!r) return;
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`[data-price-cell="${cellKey(r.valueId, scope)}"]`)?.focus(),
    );
  };
  const commit = (index: number) => (scope: EditScope) => async (price: number, move: 1 | -1 | 0) => {
    const r = rows[index];
    if (!r) return false;
    const unit = (scope === "customer" ? r.customer?.current : r.general.current)?.priceUnit ?? null;
    const ok = await mutations.save(cellKey(r.valueId, scope), {
      itemId: table.item.id,
      propertyValueId: r.valueId,
      customerId: scope === "customer" ? table.customerId : null,
      currency: table.currency,
      price,
      priceUnit: unit,
      validFromDay,
    });
    if (ok && move) focusCell(nextRowIndex(index, move, rows.length), scope);
    return ok;
  };
  const move = (index: number) => (scope: EditScope, delta: 1 | -1) =>
    focusCell(nextRowIndex(index, delta, rows.length), scope);
  return { commit, move };
}

export function ServicePriceGrid(props: Props) {
  const { table, canWrite, mutations, onHistory } = props;
  const rows = toGridRows(table);
  const hasCustomer = table.customerId !== null;
  const [confirm, setConfirm] = useState<{ id: string; text: string } | null>(null);
  const { commit, move } = useGridEditing(props, rows);

  return (
    <div className="overflow-auto border-t">
      <table className="w-full text-sm" aria-label="Hizmet kademe fiyatları">
        <thead className="sticky top-0 z-10 bg-muted/80 text-xs text-muted-foreground backdrop-blur">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Kademe</th>
            <th className="w-36 px-2 py-2 text-right font-medium">Genel fiyat</th>
            {hasCustomer && <th className="w-36 px-2 py-2 text-right font-medium">Müşteri fiyatı</th>}
            <th className="px-2 py-2 text-left font-medium">İleri tarihli</th>
            <th className="w-56 px-3 py-2 text-right font-medium">Uygulanan fiyat</th>
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <ServicePriceRow
              key={r.valueId ?? "item"}
              row={r}
              first={i === 0}
              hasCustomer={hasCustomer}
              hasTiers={table.hasTiers}
              editable={canWrite && (r.tier === null || (r.tier.mapped && r.tier.isActive))}
              canWrite={canWrite}
              savingKey={mutations.savingKey}
              onCommit={commit(i)}
              onMove={move(i)}
              onHistory={() => onHistory(r.valueId, r.label)}
              onRemove={(id, text) => setConfirm({ id, text })}
            />
          ))}
        </tbody>
      </table>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Fiyat kaldırılsın mı?"
        description={`${confirm?.text ?? ""} kaldırılacak. Kayıt silinmez, geçmişte kalır; kesilmiş faturalar etkilenmez.`}
        confirmLabel="Kaldır"
        destructive
        isPending={mutations.revoke.isPending}
        onConfirm={async () => {
          if (confirm) await mutations.revoke.mutateAsync(confirm.id);
          setConfirm(null);
        }}
      />
    </div>
  );
}
