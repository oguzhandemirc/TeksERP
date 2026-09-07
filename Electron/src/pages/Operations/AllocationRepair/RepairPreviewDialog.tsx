import { useQuery } from "@tanstack/react-query";
import { Info, Loader2, Wrench } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { allocationRepairService, type RepairPreview, type RepairableShipment } from "./service";

const m = (n: number) => `${Math.round(n).toLocaleString("tr-TR")} m`;

/**
 * ONARIM ÖNİZLEMESİ — HANGİ SATIRA KAÇ METRE.
 *
 * ⚠️ ESKİ HÂLİ NEDEN YETMİYORDU (2026-09-07 saha turu): diyalog üç toplam sayı
 * ve DÖRT MADDE DÜZ YAZI gösteriyordu. Kullanıcının sözü: *"neler olacağını tam
 * anlayamıyorum. daha çok yazı istemiyorum, anlayabilmek istiyorum."*
 * Haklıydı — "1374 m yazılacak" cümlesi hangi siparişin hangi ürün/renk/en
 * satırına gideceğini söylemiyordu ve anlamak için gereken TEK bilgi oydu.
 *
 * Artık satır satır gösterir; dört maddelik anlatı tek cümleye indi, gerisi
 * (i) balonunda. Sayı yerine DAĞILIM.
 *
 * ⚠️ ÖNİZLEME SUNUCUDAN GELİR ve onarımın kullanacağı motorun AYNISIYLA
 * hesaplanır. İstemcide "tahmini dağılım" kurmak, önizleme ile sonucun sessizce
 * ayrışması demekti (bu depoda o sınıfın adı "ayrışan yüzey").
 */
export function RepairPreviewDialog({
  satir,
  calisiyor,
  onOpenChange,
  onOnar,
}: {
  satir: RepairableShipment | null;
  calisiyor: boolean;
  onOpenChange: (open: boolean) => void;
  onOnar: (shipmentId: string) => void;
}) {
  const open = !!satir;
  const onizleme = useQuery({
    queryKey: ["allocation-repair-preview", satir?.shipmentId],
    queryFn: () => allocationRepairService.preview(satir!.shipmentId),
    enabled: open,
    staleTime: 0,
  });
  const veri = onizleme.data?.data;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" /> {satir?.shipmentNo} — defteri onar
          </DialogTitle>
          <DialogDescription>
            Aşağıdaki satırlara yazılacak. İrsaliyenin yeni bir sürümü basılır.
            <NeDegisir />
          </DialogDescription>
        </DialogHeader>

        {onizleme.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <Govde veri={veri} />
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={calisiyor}>
            Vazgeç
          </Button>
          <Button
            onClick={() => satir && onOnar(satir.shipmentId)}
            disabled={calisiyor || !satir || onizleme.isLoading || (veri?.kalemler.length ?? 0) === 0}
            className="gap-1.5"
          >
            {calisiyor && <Loader2 className="h-4 w-4 animate-spin" />}
            {veri ? `${m(veri.yazilacakMetraj)} yaz` : "Defteri onar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Uzun anlatı satır ARASINDA değil (i) balonunda — ekran okunur kalsın. */
function NeDegisir() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Ne değişecek"
          className="ml-1 inline-flex align-middle text-muted-foreground hover:text-foreground"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-96 text-xs">
        <ul className="list-inside list-disc space-y-1">
          <li>Siparişin “Sevk edilen” miktarı artar, “Açık” miktarı düşer.</li>
          <li>
            İrsaliye <strong>yeni bir sürüm</strong> olarak yeniden basılır; eski sürüm tarihsel
            kayıt olarak kalır.
          </li>
          <li>
            Sevkiyata bağlı sipariş kümesi <strong>değişmez</strong> — yeni sipariş eklenmez.
          </li>
          <li>
            Mal, çuval ve metraj <strong>değişmez</strong>; değişen yalnız deftere yazılan rakamdır.
          </li>
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function Govde({ veri }: { veri?: RepairPreview }) {
  if (!veri) return <p className="text-sm text-muted-foreground">Önizleme alınamadı.</p>;
  if (veri.kalemler.length === 0) {
    return (
      <p className="rounded-md border bg-muted/40 px-3 py-4 text-sm">
        Bugünün verisiyle <strong>yazılabilecek satır yok</strong> — siparişler dolu ya da
        ürün/renk/en tutmuyor. Onarım bir şey değiştirmez.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 text-center">
        <Kutu baslik="Çıkan mal" deger={veri.icerikMetraj} />
        <Kutu baslik="Şu an yazılı" deger={veri.yazilanMetraj} />
        <Kutu baslik="Yazılacak" deger={veri.yazilacakMetraj} vurgu />
      </div>

      <div className="max-h-72 overflow-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/60 text-xs">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">Sipariş</th>
              <th className="px-2 py-1.5 text-left font-medium">Ürün</th>
              <th className="px-2 py-1.5 text-left font-medium">Renk</th>
              <th className="px-2 py-1.5 text-right font-medium">En</th>
              <th className="px-2 py-1.5 text-right font-medium">Şu an açık</th>
              <th className="px-2 py-1.5 text-right font-medium">Yazılacak</th>
              <th className="px-2 py-1.5 text-right font-medium">Kalan açık</th>
            </tr>
          </thead>
          <tbody>
            {veri.kalemler.map((k) => (
              <tr key={k.orderLineId} className="border-t">
                <td className="px-2 py-1.5 font-mono text-xs">{k.orderNumber}</td>
                <td className="px-2 py-1.5">{k.itemName}</td>
                <td className="px-2 py-1.5">{k.colorName ?? "Ham"}</td>
                <td className="px-2 py-1.5 text-right">{k.width != null ? `${k.width} cm` : "—"}</td>
                <td className="px-2 py-1.5 text-right text-muted-foreground">{m(k.acikOnce)}</td>
                <td className="px-2 py-1.5 text-right font-semibold text-emerald-700 dark:text-emerald-400">
                  {m(k.yazilacak)}
                </td>
                <td className="px-2 py-1.5 text-right text-muted-foreground">{m(k.acikSonra)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Eşleşmeyi GEVŞETEN iki ayar açıksa söylenir: sonucu onlar belirliyor
          ve kullanıcı neden bu satırların seçildiğini bilmeli. */}
      {(veri.enToleransCm > 0 || veri.fazlaSevkYazilir) && (
        <p className="text-xs text-muted-foreground">
          {veri.enToleransCm > 0 && <>En toleransı <strong>{veri.enToleransCm} cm</strong> uygulandı. </>}
          {veri.fazlaSevkYazilir && <>Fazla sevk deftere yazılıyor.</>}
        </p>
      )}
    </div>
  );
}

function Kutu({ baslik, deger, vurgu }: { baslik: string; deger: number; vurgu?: boolean }) {
  return (
    <div
      className={`rounded-md border px-2 py-2 ${
        vurgu
          ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40"
          : "bg-muted/40"
      }`}
    >
      <div className="text-xs text-muted-foreground">{baslik}</div>
      <div className="text-lg font-semibold">{m(deger)}</div>
    </div>
  );
}
