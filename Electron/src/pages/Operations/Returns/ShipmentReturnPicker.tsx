// =============================================================================
// İADE — "SEVKİYATTAN SEÇ" (barkodsuz yol)
// =============================================================================
// Müşteriden dönen malın üstünde etiket OLMAYABİLİR: ticaret personası hiç
// etiket basmıyor. Bugüne kadar iade girişinin tek yolu top barkodu ya da
// çuval kodu okutmaktı — yani o kullanıcı iade alamıyordu.
//
// ⚠️ BU BİLEŞEN İADE OLUŞTURMAZ. Tek işi ÇUVAL KODUNU yazdırmadan bulmak;
// seçim yapılınca kod çağırana döner ve iade akışı MEVCUT `lookupSack`
// yolundan devam eder. Gerekçe: o yol aday siparişleri, kalite kapısını ve
// guard'ları zaten taşıyor — ikinci bir "iade girişi" yolu açmak, aynı
// kararların iki yerde yaşaması demekti.
//
// ⚠️ Sevkiyat okuma izni ayrı bir katman: bu yüzey `shipping:read` olmadan
// HİÇ ÇİZİLMEZ (çağıran süzer) — gri buton, arkasında 403 olan bir yolu vaat
// ederdi.
// =============================================================================
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, PackageOpen, ChevronRight } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { safeFormat } from "@/lib/format";
import { listDispatchedShipments, getShipmentSacks } from "./shipmentPickService";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Seçilen çuvalın kodu — çağıran mevcut `lookupSack` akışını başlatır. */
  onPick: (sackNo: string) => void;
  /**
   * "Sevkiyatın tamamı" (2026-09-22) — verilirse sevkiyat satırında ikinci bir düğme
   * çizilir; çağıran `lookupShipment` kapsamını açar. Verilmezse bugünkü çuval yolu.
   */
  onPickShipment?: (shipmentId: string) => void;
  /** `mode="shipment"`: liste doğrudan sevkiyat seçtirir (çuval adımı yok). */
  mode?: "sack" | "shipment";
}

export function ShipmentReturnPicker({ open, onOpenChange, onPick, onPickShipment, mode = "sack" }: Props) {
  const [search, setSearch] = useState("");
  const [shipmentId, setShipmentId] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: ["return-pick-shipments", search],
    queryFn: () => listDispatchedShipments(search),
    enabled: open && !shipmentId,
  });
  const sacksQ = useQuery({
    queryKey: ["return-pick-sacks", shipmentId],
    queryFn: () => getShipmentSacks(shipmentId as string),
    enabled: Boolean(shipmentId),
  });

  const close = () => {
    setShipmentId(null);
    setSearch("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{shipmentId ? "Çuval Seç" : "Sevkiyat Seç"}</DialogTitle>
          <DialogDescription>
            {shipmentId
              ? "İade edilen mal hangi çuvaldan çıktıysa onu seçin — sonraki adımda topları tek tek işaretleyeceksiniz."
              : mode === "shipment"
                ? "Sevkiyatı seçin; bütün çuvalları iade kapsamına gelir, topları sonra işaretlersiniz."
                : "Malın çıktığı sevkiyatı bulun. Barkod okutmanız gerekmez."}
          </DialogDescription>
        </DialogHeader>

        {!shipmentId ? (
          <>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                autoFocus
                placeholder="Sevkiyat no veya müşteri ara..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="max-h-[46vh] overflow-auto rounded-md border">
              {listQ.isLoading ? (
                <p className="p-6 text-center text-sm text-muted-foreground">Yükleniyor…</p>
              ) : (listQ.data ?? []).length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  Sevk edilmiş sevkiyat bulunamadı.
                </p>
              ) : (
                (listQ.data ?? []).map((s) => (
                  <div key={s.id} className="flex items-stretch border-b last:border-0">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted/50"
                      onClick={() => (mode === "shipment" && onPickShipment ? (onPickShipment(s.id), close()) : setShipmentId(s.id))}
                    >
                      <span className="font-mono">{s.shipmentNo}</span>
                      <span className="min-w-0 flex-1 truncate">{s.customerName}</span>
                      <span className="whitespace-nowrap text-xs text-muted-foreground">
                        {s.dispatchedAt ? safeFormat(s.dispatchedAt, "dd.MM.yyyy") : "—"}
                      </span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </button>
                    {mode === "sack" && onPickShipment && (
                      <button
                        type="button"
                        className="shrink-0 border-l px-3 text-xs text-primary hover:bg-muted/50"
                        title="Sevkiyatın tamamını iade kapsamına al"
                        onClick={() => {
                          onPickShipment(s.id);
                          close();
                        }}
                      >
                        Tamamı
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          <>
            <div className="max-h-[46vh] overflow-auto rounded-md border">
              {sacksQ.isLoading ? (
                <p className="p-6 text-center text-sm text-muted-foreground">Yükleniyor…</p>
              ) : (sacksQ.data ?? []).length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  Bu sevkiyatta çuval bulunamadı.
                </p>
              ) : (
                (sacksQ.data ?? []).map((sk) => (
                  <button
                    key={sk.id}
                    type="button"
                    className="flex w-full items-center gap-3 border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-muted/50"
                    onClick={() => {
                      onPick(sk.sackNo);
                      close();
                    }}
                  >
                    <PackageOpen className="h-4 w-4 text-muted-foreground" />
                    <span className="font-mono">{sk.sackNo}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {sk.rollCount} top
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                ))
              )}
            </div>
            <div>
              <Button variant="outline" size="sm" onClick={() => setShipmentId(null)}>
                ← Sevkiyat listesine dön
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
