import { useEffect, useMemo, useState } from "react";
import { Link2, Package, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import type { PickedOrderLine } from "@/pages/Operations/WorkOrders/OrderPickerDialog";
import { useTabsStore } from "@/store/tabs";
import type { WoTarget, BalanceLine } from "./types";

type Mode = "bind" | "stock";

const fmt = (n: number) => n.toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 0 });

function toPicked(l: BalanceLine): PickedOrderLine {
  return {
    lineId: l.lineId,
    orderId: l.orderId,
    orderNumber: l.orderNumber,
    orderDeadline: l.deadline,
    customerId: l.customerId,
    customerName: l.customerName,
    // Kumaş Dengesi satırı şube taşımaz (spec-toplaması) → null (gösterimde gizlenir).
    branchName: null,
    branchCode: null,
    itemId: l.itemId,
    itemName: l.itemName,
    colorId: l.colorId,
    itemColorHex: l.colorHex,
    itemColorName: l.colorName,
    quantity: l.quantity,
    openQty: l.open,
    width: l.width,
    requiredProperties: l.requiredProperties,
  };
}

interface Props {
  spec: WoTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Kumaş Dengesi → "İş Emri Aç". İki mod:
 *  - Siparişlere bağla (termin): açık siparişlere en acil terminden başlayarak
 *    miktar kadar tahsis (seedPickedLines) → ORDER_PRODUCTION.
 *  - Stoğa üret: sipariş bağı yok, hedef spec + miktar (seedTarget) → STOCK_PRODUCTION.
 */
export function ProductBalanceWoDialog({ spec, open, onOpenChange }: Props) {
  const openTab = useTabsStore((s) => s.openTab);
  const [mode, setMode] = useState<Mode>("bind");
  const [qty, setQty] = useState("");

  useEffect(() => {
    if (spec) {
      setQty(String(Math.round(spec.uretilecek)));
      setMode("bind");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec?.key]);

  // Açık talep toplamı = Σ (quantity − sevk). "Stoğa üret"e yönlendiren eşik;
  // fazlası bağlanamaz (üretilebilir ama stoğa düşer).
  const demandTotal = useMemo(
    () => (spec?.lines ?? []).reduce((s, l) => s + l.open, 0),
    [spec],
  );

  if (!spec) return null;

  const qtyNum = Number(qty) || 0;
  const label =
    spec.itemName +
    (spec.colorName ? ` · ${spec.colorName}` : "") +
    (spec.width ? ` · ${spec.width}cm` : "");
  // ⚠️ ARZ = ham + yarı mamul. Yarı mamul dışarıdan alınmış olsa da rafta duran,
  // üretime sokulabilir maldır — açığı yalnız `ham`a bakarak hesaplamak olmayan
  // bir "kumaş tedarik et" uyarısı üretirdi (backend `malzemeAcigi` de ikisini
  // birden düşer; iki taraf ayrışmamalı).
  const supply = spec.ham + spec.yariMamul;
  const rawShort = qtyNum > supply;
  const bindCapped = mode === "bind" && qtyNum > demandTotal;

  const handleConfirm = () => {
    if (qtyNum <= 0) return;
    if (mode === "bind" && demandTotal > 0) {
      // Link-only: en acil terminden başlayarak, istenen miktar karşılanana
      // kadar kalemleri bağla (metraj taşımaz — form targetQuantity'yi önerir).
      let left = qtyNum;
      const picked: PickedOrderLine[] = [];
      for (const l of spec.lines) {
        if (left <= 0) break;
        if (l.open <= 0) continue;
        picked.push(toPicked(l));
        left -= l.open;
      }
      // Yeni (odaklı) sekmede aç → Kumaş Dengesi açık kalır, listeden başka
      // satırlar için de iş emri açılabilir. forceNew: kaydedilmemiş formu
      // ezmemek için her zaman taze sekme.
      openTab("/operations/work-orders/new", {
        state: { seedPickedLines: picked },
        forceNew: true,
      });
    } else {
      // stoğa üret (veya bind ama açık talep kalmamış → stoğa düşer)
      openTab("/operations/work-orders/new", {
        state: {
          seedTarget: {
            itemId: spec.itemId,
            colorId: spec.colorId,
            width: spec.width,
            targetQuantity: qtyNum,
          },
        },
        forceNew: true,
      });
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>İş emri aç</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{label}</span> için
            üretim emri. Talep {fmt(spec.talep)} · Depo {fmt(spec.depo)} ·
            Üretimde {fmt(spec.uretimde)} · Ham havuzu {fmt(spec.ham)}
            {spec.yariMamul > 0 ? ` (+${fmt(spec.yariMamul)} yarı mamul)` : ""}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Üretilecek miktar (m)
            </label>
            <Input
              type="number"
              min={0}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="mt-1"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={mode === "bind" ? "default" : "outline"}
              size="sm"
              className="gap-1.5"
              onClick={() => setMode("bind")}
            >
              <Link2 className="h-3.5 w-3.5" /> Siparişlere bağla
            </Button>
            <Button
              type="button"
              variant={mode === "stock" ? "default" : "outline"}
              size="sm"
              className="gap-1.5"
              onClick={() => setMode("stock")}
            >
              <Package className="h-3.5 w-3.5" /> Stoğa üret
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            {mode === "bind"
              ? "Açık siparişlere en acil terminden başlayarak tahsis edilir; formda düzenleyebilirsin."
              : "Hiçbir siparişe bağlanmaz; kumaş havuzunu besler, eşleşme sevkte kurulur."}
          </p>

          {bindCapped && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Açık talep {fmt(demandTotal)} m — fazlası bağlanamaz. Kalan için
              "Stoğa üret" kullan.
            </p>
          )}

          {rawShort && (
            <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              Kullanılabilir kumaş {fmt(supply)} m
              {spec.yariMamul > 0 ? ` (ham ${fmt(spec.ham)} + yarı mamul ${fmt(spec.yariMamul)})` : ""} —{" "}
              {fmt(qtyNum - supply)} m kumaş tedariki gerekir (fabrika kumaş
              üretmez, işler).
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button onClick={handleConfirm} disabled={qtyNum <= 0}>
            Forma git
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
