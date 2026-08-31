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
}

export function ShipmentReturnPicker({ open, onOpenChange, onPick }: Props) {
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
                  <button
                    key={s.id}
                    type="button"
                    className="flex w-full items-center gap-3 border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-muted/50"
                    onClick={() => setShipmentId(s.id)}
                  >
                    <span className="font-mono">{s.shipmentNo}</span>
                    <span className="min-w-0 flex-1 truncate">{s.customerName}</span>
                    <span className="whitespace-nowrap text-xs text-muted-foreground">
                      {s.dispatchedAt ? safeFormat(s.dispatchedAt, "dd.MM.yyyy") : "—"}
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
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
