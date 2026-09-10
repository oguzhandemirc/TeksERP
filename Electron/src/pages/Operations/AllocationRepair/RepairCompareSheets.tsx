import { useQuery } from "@tanstack/react-query";
import { OrderDetailSheet } from "@/pages/Operations/Orders/OrderDetailSheet";
import { ShipmentDetailSheet } from "@/pages/Operations/Shipments/ShipmentDetailSheet";
import { orderService } from "@/pages/Operations/Orders/service";

/**
 * YAN YANA KARŞILAŞTIRMA — sipariş SOLDAN, sevkiyat SAĞDAN.
 *
 * ⚠️ NEDEN AYNI ANDA İKİSİ (2026-09-07 saha isteği): bu ekrandaki satırlar
 * "gözden kaçmış, unutulmuş" sevkiyatlardır. Onarmadan önce sorulan soru hep
 * aynı: *sevkiyattan çıkan mal, siparişte açık duran kaleme gerçekten uyuyor
 * mu?* İki ekran arasında gidip gelerek bu karşılaştırılamıyordu.
 *
 * ⚠️ KARARTMA ÇİZİLMEZ (`hideOverlay`): iki panel de kendi karartmasını
 * çizseydi aradaki şerit çift kararır ve karşılaştırma imkânsızlaşırdı. Yan
 * etkisi FAYDALIDIR: alttaki tablo tıklanabilir kalır, kullanıcı paneller
 * açıkken başka bir sipariş numarasına geçebilir.
 *
 * ⚠️ SİPARİŞ PANELİ SALT OKUNUR AÇILIR: `onEdit`/`onCreateWorkOrder`
 * verilmez. Bu ekranın işi defteri onarmak; siparişi düzenlemek ya da iş emri
 * açmak buradan başlayacak bir iş değil (kendi ekranları var).
 */
export function RepairCompareSheets({
  orderId,
  shipmentId,
  onOrderClose,
  onShipmentClose,
}: {
  orderId: string | null;
  shipmentId: string | null;
  onOrderClose: () => void;
  onShipmentClose: () => void;
}) {
  // `OrderDetailSheet` id değil KAYDIN KENDİSİNİ ister (kalem listesi, alias,
  // rejim… hepsi order nesnesinden okunur) — tabloda yalnız id var.
  const orderQuery = useQuery({
    queryKey: ["orders", "detail", orderId],
    queryFn: () => orderService.getById(orderId!),
    enabled: !!orderId,
    staleTime: 30_000,
  });

  return (
    <>
      <OrderDetailSheet
        order={orderQuery.data?.data ?? null}
        open={!!orderId && !!orderQuery.data?.data}
        onOpenChange={(o) => !o && onOrderClose()}
        side="left"
        hideOverlay
      />
      <ShipmentDetailSheet
        shipmentId={shipmentId}
        open={!!shipmentId}
        onOpenChange={(o) => !o && onShipmentClose()}
        hideOverlay
      />
    </>
  );
}
