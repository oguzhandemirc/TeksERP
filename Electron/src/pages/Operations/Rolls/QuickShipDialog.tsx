// =============================================================================
// HIZLI SEVK — "seç ya da miktar söyle → sevk et"
// =============================================================================
// Persona denetiminin kritik bulgusunun panel ayağı: alım-satım firmasının en
// sık işi "depodan N top seç → müşteriye gönder"di ve sistem bunu üç ekran +
// top başına barkod okutma olarak dayatıyordu.
//
// ÜÇ GİRİŞ YOLU, tek diyalog:
//   ① Listeden seçim (Kumaş Stoğu'nda satır işaretle → bu diyalog seçimle açılır)
//   ② MİKTAR MODU — "3 top patos" de, sistem FIFO ile en eskileri önerir
//   ③ Barkod okutma — opsiyonel, isteyene (bu diyalogda ayrı bir yol değil;
//      Paketleme/Çuvallar ekranı fiziksel okutma akışını taşımaya devam eder)
//
// ⚠️ ÇUVAL BU EKRANDA HİÇ GEÇMEZ. Backend tek transaction içinde otomatik
// açıyor; kullanıcı "çuval" kelimesini görmüyor. Fiziksel çuvalla çalışanlar
// için Paketleme/Çuvallar ekranı aynen duruyor.
//
// ⚠️ ETİKET/BARKOD ZORUNLU DEĞİL: uç `rollIds` alıyor, barkod değil.
// =============================================================================
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Truck, Trash2, Wand2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { customerService } from "@/pages/Customers/service";
import { itemService } from "@/pages/Items/service";
import { colorService } from "@/pages/Colors/service";
import type { Customer } from "@/pages/Customers/types";
import type { Item } from "@/pages/Items/types";
import type { Color } from "@/pages/Colors/types";
import { quickShip, findRollsForQuickShip, quickShipDestination, type QuickShipRoll } from "./quickShipService";
import { invalidateDestinationLock, useDestinationLock } from "@/pages/Operations/SackContentEdit/destinationDefault";
import { DestinationLockField } from "@/pages/Operations/SackContentEdit/DestinationLockField";
import type { ShipmentDestination } from "@/pages/Operations/SackContentEdit/types";
import { Callout } from "@/components/ui/callout";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Kumaş Stoğu'ndan işaretlenerek gelen toplar (① listeden seçim yolu). */
  initialRolls?: QuickShipRoll[];
  /** Sevk sonrası irsaliyeyi açmak için — sevkiyat id'si döner. */
  onShipped?: (shipmentId: string) => void;
}

export function QuickShipDialog({ open, onOpenChange, initialRolls = [], onShipped }: Props) {
  const qc = useQueryClient();
  const [customerId, setCustomerIdRaw] = useState<string | null>(null);
  const [picked, setPicked] = useState<ShipmentDestination | null>(null);
  // İlk seçim cariye aittir — cari değişince sıfırlanır.
  const setCustomerId = (id: string | null) => {
    setCustomerIdRaw(id);
    setPicked(null);
  };
  const [rolls, setRolls] = useState<QuickShipRoll[]>(initialRolls);

  // ② MİKTAR MODU — "3 top patos gri" de, sistem FIFO ile seçsin.
  const [pickItemId, setPickItemId] = useState<string | null>(null);
  const [pickColorId, setPickColorId] = useState<string | null>(null);
  const [pickCount, setPickCount] = useState<number>(1);

  // ⚠️ Dışarıdan gelen seçim YALNIZ ilk değerdir (`useState` başlangıcı) ve
  // bilinçli olarak senkronlanmaz: çağıran diyaloğu koşullu mount eder, yani
  // her açılış taze bir bileşendir. Render fazında `setState` ile senkronlamak
  // (ilk yazım) çağıranın her render'ında kimliği değişen bir prop'la sonsuz
  // döngü kurardı — ve seçimden sonra kullanıcının listeden çıkardığı topu da
  // geri getirirdi.
  const totals = useMemo(
    () => ({ count: rolls.length, meters: rolls.reduce((s, r) => s + r.qty, 0) }),
    [rolls],
  );

  // FIFO önerisi — backend "en eski önce" sırasıyla döner; istemci sırayı
  // YENİDEN KURMAZ (iki yerde iki sıra, aynı isteğe farklı cevap demekti).
  const pickQ = useQuery({
    queryKey: ["quick-ship-pick", pickItemId, pickColorId, pickCount],
    queryFn: () => findRollsForQuickShip({ itemId: pickItemId!, colorId: pickColorId, limit: pickCount }),
    enabled: false,
  });

  const addByQuantity = async () => {
    if (!pickItemId) return;
    const res = await pickQ.refetch();
    const found = res.data ?? [];
    if (found.length === 0) {
      toast.warning("Bu kumaş/renkten depoda sevke uygun top bulunamadı.");
      return;
    }
    if (found.length < pickCount) {
      // Sessizce az eklemek "istediğim kadar aldı" sanısı yaratır.
      toast.warning(`Depoda yalnız ${found.length} uygun top var — hepsi eklendi.`);
    }
    setRolls((prev) => {
      const seen = new Set(prev.map((r) => r.id));
      return [...prev, ...found.filter((r) => !seen.has(r.id))];
    });
  };

  // Yurtdışı (kilitli ya da ilk seçimde seçilen) Hızlı Sevk'i kapatır — gerekçe sunucunun 400 metni.
  const lockQ = useDestinationLock(customerId, null, open);
  const yon = quickShipDestination(lockQ.data, picked);
  const blockedReason = yon.blockedReason;
  const valid = Boolean(customerId) && rolls.length > 0 && !yon.blocked && yon.destination != null;

  const shipM = useMutation({
    mutationFn: () =>
      quickShip({
        rollIds: rolls.map((r) => r.id),
        customerId: customerId as string,
        destination: yon.destination ?? undefined,
        ...(yon.chosen ? { destinationChosen: true as const } : {}),
        clientToken: crypto.randomUUID(),
      }),
    onSuccess: (res) => {
      toast.success(res.message ?? "Sevk edildi.");
      void qc.invalidateQueries({ queryKey: ["rolls"] });
      void qc.invalidateQueries({ queryKey: ["shipments"] });
      invalidateDestinationLock(qc);
      setRolls([]);
      setCustomerId(null);
      onOpenChange(false);
      onShipped?.(res.data.id);
    },
  });


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Hızlı Sevk</DialogTitle>
          <DialogDescription>
            Depodaki topları doğrudan sevk edin. Listeden seçebilir ya da{" "}
            <b>miktar söyleyip</b> sistemin en eski topları seçmesini
            isteyebilirsiniz — barkod okutmanız gerekmez.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Müşteri</Label>
            <div className="mt-1">
              <ReferenceSelect<Customer>
                value={customerId}
                onChange={setCustomerId}
                service={customerService}
                queryKey="customers"
                getLabel={(c) => `${c.code} — ${c.name}`}
                placeholder="Müşteri ara..."
              />
            </div>
            {customerId && (
              <div className="mt-2">
                <DestinationLockField lock={lockQ.data} isLoading={lockQ.isLoading} picked={picked} onPick={setPicked} hasBranch={false} />
              </div>
            )}
          </div>

          {/* ② MİKTAR MODU */}
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">
              Miktarla ekle — en eski toplar önce (FIFO)
            </p>
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <Label className="text-xs">Kumaş</Label>
                <div className="mt-1">
                  <ReferenceSelect<Item>
                    value={pickItemId}
                    onChange={setPickItemId}
                    service={itemService}
                    queryKey="items"
                    getLabel={(it) => `${it.code} — ${it.name}`}
                    placeholder="Kumaş ara..."
                  />
                </div>
              </div>
              <div className="w-40">
                <Label className="text-xs">Renk (ops.)</Label>
                <div className="mt-1">
                  <ReferenceSelect<Color>
                    value={pickColorId}
                    onChange={setPickColorId}
                    service={colorService}
                    queryKey="colors"
                    getLabel={(c) => c.name}
                    placeholder="Renk..."
                  />
                </div>
              </div>
              <div className="w-24">
                <Label className="text-xs">Kaç top</Label>
                <Input
                  type="number" min={1} step="1"
                  className="mt-1"
                  value={pickCount}
                  onChange={(e) => setPickCount(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                />
              </div>
              <Button
                variant="outline"
                disabled={!pickItemId || pickQ.isFetching}
                onClick={() => void addByQuantity()}
              >
                <Wand2 className="mr-1 h-4 w-4" />
                {pickQ.isFetching ? "Seçiliyor…" : "Ekle"}
              </Button>
            </div>
          </div>

          <div className="max-h-[34vh] overflow-auto rounded-md border">
            {rolls.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                Henüz top eklenmedi — yukarıdan miktarla ekleyin ya da Kumaş Stoğu'ndan seçip gelin.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/80 text-[11px] uppercase text-muted-foreground backdrop-blur">
                  <tr>
                    <th className="px-3 py-2 text-left">Barkod</th>
                    <th className="px-3 py-2 text-left">Kumaş / Renk</th>
                    <th className="px-3 py-2 text-right">Metre</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rolls.map((r) => (
                    <tr key={r.id} className="border-t">
                      {/* Barkodsuz top MEŞRU — etiket basmayan kullanıcıda olağan. */}
                      <td className="px-3 py-2 font-mono text-xs">{r.barcode ?? "—"}</td>
                      <td className="px-3 py-2">
                        {r.itemName}
                        {r.colorName ? ` · ${r.colorName}` : ""}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.qty}</td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setRolls((prev) => prev.filter((x) => x.id !== r.id))}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {blockedReason && (
            <Callout tone="danger" title="Hızlı sevk yapılamaz">
              {blockedReason}
            </Callout>
          )}

          <p className="text-right text-sm text-muted-foreground">
            Toplam: <b className="text-foreground">{totals.count}</b> top ·{" "}
            <b className="text-foreground">{totals.meters.toLocaleString("tr-TR")}</b> m
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>İptal</Button>
          <Button disabled={!valid || shipM.isPending} onClick={() => shipM.mutate()}>
            <Truck className="mr-1 h-4 w-4" />
            {shipM.isPending ? "Sevk ediliyor…" : `Sevk Et (${totals.count} top)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
