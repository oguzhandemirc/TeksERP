import { useState } from "react";
import { toast } from "sonner";
import { Factory } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PermissionGate } from "@/components/PermissionGate";
import { useTabsStore } from "@/store/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  buildPicked,
  type PickedOrderLine,
} from "@/pages/Operations/WorkOrders/OrderPickerDialog";
import type { Order, OrderLine } from "./types";

/**
 * Tek iş emri = tek kumaş + renk + en. Bir iş emrine birleştirilebilecek
 * kalemler bu üçlüde aynı olmalı (OrderPickerDialog.mismatchReason ile aynı kural).
 */
function lineSignature(l: OrderLine): string {
  return `${l.itemId}::${l.colorId ?? ""}::${l.width ?? ""}`;
}

/** Kalan (sevk edilmemiş) miktar — yeni iş emrine bu kadar alınır. */
function lineRemaining(l: OrderLine): number {
  return Number(l.quantity) - Number(l.shippedQty ?? 0);
}

/** Sevki tamamlanmamış kalem yeni iş emrine alınabilir. */
function isLineOpen(l: OrderLine): boolean {
  return lineRemaining(l) > 0;
}

interface EligibleLine {
  order: Order;
  line: OrderLine;
}

interface GroupInfo {
  sig: string;
  itemName: string;
  colorName: string | null;
  colorHex: string | null;
  width: number | null;
  /** Bu imzadaki kalemlerin toplam üretim açığı (openQty). */
  openTotal: number;
  /** Bu imzaya bir açık kalemi olan siparişlerin numaraları. */
  orderNumbers: string[];
  /** İş emri formuna seed edilecek hazır picker satırları (openQty=kalan; link-only). */
  pickedLines: PickedOrderLine[];
}

function groupEligible(lines: EligibleLine[]): GroupInfo[] {
  const map = new Map<string, GroupInfo>();
  const orderSets = new Map<string, Set<string>>();
  for (const { order, line } of lines) {
    const sig = lineSignature(line);
    let g = map.get(sig);
    if (!g) {
      g = {
        sig,
        itemName: line.item?.name ?? "—",
        colorName: line.color?.name ?? null,
        colorHex: line.color?.hex ?? null,
        width: line.width ?? null,
        openTotal: 0,
        orderNumbers: [],
        pickedLines: [],
      };
      map.set(sig, g);
      orderSets.set(sig, new Set());
    }
    const rem = lineRemaining(line);
    g.pickedLines.push(buildPicked(order, { ...line, openQty: rem }));
    g.openTotal += rem;
    const set = orderSets.get(sig)!;
    if (!set.has(order.id)) {
      set.add(order.id);
      g.orderNumbers.push(order.orderNumber);
    }
  }
  return Array.from(map.values());
}

interface Props {
  /** Seçili sipariş satırları (tablo seçimi). */
  orders: Order[];
  /** Yönlendirince tablo seçimini temizlemek için. */
  onDone: () => void;
}

/**
 * Siparişler tablosunun toplu seçim çubuğuna eklenen aksiyon: aynı kumaş/renk/en
 * olan birden çok siparişi tek iş emrine taşır. Farklı kumaşlar birleşemez —
 * o durumda engelleyip grupları açıklar.
 */
export function BulkCreateWorkOrderAction({ orders, onDone }: Props) {
  const navigateActive = useTabsStore((s) => s.navigateActive);
  const [incompatGroups, setIncompatGroups] = useState<GroupInfo[] | null>(null);

  // Seçili açık kalemleri (openQty=kalan; link-only) tek iş emri formuna taşır. Yalnız
  // ilgili spec'in açık kalemleri seed edilir — başka kumaş/renk karışmaz.
  const goToForm = (pickedLines: PickedOrderLine[]) => {
    navigateActive("/operations/work-orders/new", { state: { seedPickedLines: pickedLines } });
    onDone();
  };

  // Uyumsuzluk diyaloğunda bir gruba tıkla → modal kapanır ve doğrudan o grubun
  // iş emri formu açılır (tek tıkla seç + git).
  const handlePickGroup = (g: GroupInfo) => {
    setIncompatGroups(null);
    goToForm(g.pickedLines);
  };

  const handleClick = () => {
    const eligibleOrders = orders.filter(
      (o) => o.status === "APPROVED" || o.status === "PARTIAL_SHIPPED",
    );
    const eligibleLines: EligibleLine[] = eligibleOrders.flatMap((o) =>
      (o.lines ?? []).filter(isLineOpen).map((line) => ({ order: o, line })),
    );

    if (eligibleLines.length === 0) {
      toast.warning(
        "Seçili siparişlerde sevki tamamlanmamış kalem yok — onaylı/kısmi sevk sipariş gerekir.",
      );
      return;
    }

    const groups = groupEligible(eligibleLines);
    if (groups.length > 1) {
      // En çok kalan metrajı olan grup üstte — operatör önce büyük işi görür.
      setIncompatGroups([...groups].sort((a, b) => b.openTotal - a.openTotal));
      return;
    }

    // Tek kumaş+renk+en — uyumlu tüm açık kalemler tek iş emrine.
    const [only] = groups;
    if (only) goToForm(only.pickedLines);
  };

  const hasSelection = orders.length > 0;

  return (
    <PermissionGate permission="workorder:write">
      <Button
        variant="default"
        size="sm"
        className="h-8 gap-1.5"
        onClick={handleClick}
        disabled={!hasSelection}
        title={hasSelection ? undefined : "Önce bir veya daha fazla sipariş seçin"}
      >
        <Factory className="h-3.5 w-3.5" />
        Seçili siparişlerden iş emri oluştur
      </Button>

      <Dialog
        open={incompatGroups !== null}
        onOpenChange={(o) => !o && setIncompatGroups(null)}
      >
        <DialogContent className="flex max-h-[85vh] max-w-lg flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b px-6 py-4">
            <DialogTitle>Bu siparişler tek iş emrinde birleşemez</DialogTitle>
            <DialogDescription>
              Bir iş emri yalnızca aynı kumaş, renk ve en için açılır. Seçimin{" "}
              {incompatGroups?.length} farklı grup içeriyor — birleştirmek
              istediğin gruba tıkla; o siparişlerle iş emri formu doğrudan açılır.
            </DialogDescription>
          </DialogHeader>
          <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto px-6 py-4">
            {incompatGroups?.map((g) => (
              <li key={g.sig}>
                <button
                  type="button"
                  onClick={() => handlePickGroup(g)}
                  className="w-full rounded-md border p-3 text-left text-sm transition-colors hover:border-primary hover:bg-primary/5"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{g.itemName}</span>
                    {g.colorName && (
                      <Badge variant="muted" className="gap-1 text-[10px]">
                        {g.colorHex && (
                          <span
                            className="h-2 w-2 rounded-full border"
                            style={{ backgroundColor: g.colorHex }}
                          />
                        )}
                        {g.colorName}
                      </Badge>
                    )}
                    <Badge variant="muted" className="text-[10px]">
                      {g.width != null ? `${g.width} cm` : "en serbest"}
                    </Badge>
                    <span className="ml-auto text-xs font-medium text-primary">
                      İş emri oluştur →
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {g.orderNumbers.length} sipariş ·{" "}
                    {g.openTotal.toLocaleString("tr-TR", { useGrouping: false })} m kalan ·{" "}
                    {g.orderNumbers.join(", ")}
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <DialogFooter className="shrink-0 border-t px-6 py-4">
            <Button variant="outline" onClick={() => setIncompatGroups(null)}>
              Kapat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PermissionGate>
  );
}
