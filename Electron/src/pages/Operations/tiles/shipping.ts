// Operasyon › Sevkiyat & İade karoları (sıra = hub sırası).
import { ClipboardList, PackageCheck, ScanBarcode, Truck, Undo2, FileCheck2 } from "lucide-react";
import type { OperationsTile } from "../tile-config";
import { TERIM, TERIM_AD } from "@/lib/terim";

export const shippingTiles: OperationsTile[] = [
  {
    key: "shipments",
    title: "Sevkiyatlar",
    description: "Müşteri sevkiyatları + sevk irsaliyesi",
    icon: Truck,
    to: "/operations/shipments",
    group: "shipping",
    permission: "shipping:read",
  },
  {
    // Sevke Hazır İşler (D4-J3, ister 2.4 / 2.10): hazırlık sunucuda türetilir; modül anahtarı yok (çekirdek sevkiyat).
    key: "sevke-hazir-isler",
    title: "Sevke Hazır İşler",
    description: `${TERIM.terbiyeIsEmri.tekil} / gelen belge / parti / müşteri başına hazır toplar — oradan sevke al`,
    icon: PackageCheck,
    to: "/operations/sevke-hazir-isler",
    group: "shipping",
    permission: "shipping:read",
  },
  {
    // Eski "Çuval Depo" + "Okutarak Sevk" tek ekranda birleşti (Sevk Kapısı).
    key: "sack-store",
    title: "Sevk Kapısı",
    description: "Çuval okut → sevk et / irsaliye bas; planlı (çıkış bekleyen) sevkler",
    icon: ScanBarcode,
    to: "/operations/sack-store",
    group: "shipping",
    permission: "shipping:read",
    // Sevk Kapısı = "sevk onayı adımı" bayrağının EKRANI. Bayrak KAPALIYKEN
    // (varsayılan) sevkler doğrudan çıkar → board'un işi yok → karo gizli.
    //
    // 2026-08-05 → 08-22 arasında kural "bayrak açık VEYA çıkış bekleyen PLANNED
    // sevkiyat varsa" idi: storno (sevki geri al) sevkiyatı PLANNED'a düşürüyordu
    // ve çıkış onayı YALNIZ bu ekrandaydı → karo gizlenirse mal kapıda, ekran yok.
    // Saha vakası (SVK2008260008, 2026-08-21): bayrak kapalı fabrikada geri alınan
    // bir sevkiyat yüzünden karo beklenmedik şekilde belirdi ve çuval bir gün
    // kilitli kaldı. 2026-08-22 kararı: PLANNED sevkiyatın bu ekrana ihtiyacı
    // KALMADI — storno kapalı rejimde varsayılan olarak sevkiyatı KAPATIR
    // (`releaseSacks`, çuvallar depoya) ve Sevkiyatlar detayı PLANNED sevkiyata
    // "Sevk Et" verir. Kural saf bayrağa indi; sonda sorgusu da kalktı.
    // Route (`/operations/sack-store`) bayrağa bakmaz — eski sekme/okutma hedefi
    // yine açılır, yalnız menüde çizilmez.
    visibleWhen: (ctx) => ctx.shipmentConfirmationEnabled,
  },
  {
    key: "accounting-dispatch",
    // Ana "Sevkiyatlar" ekranından ayrı: yalnız sevk edilmişler, salt-okunur muhasebe/export ekranı.
    title: TERIM_AD.sevkEdilenler,
    description: "Sevki tamamlananlar — salt-okunur + kumaş/çuval/çeki fişi",
    icon: ClipboardList,
    to: "/operations/accounting-dispatch",
    group: "shipping",
    permission: "shipping:read",
  },
  {
    key: "returns",
    title: "İade Takibi",
    description: "Müşteri iadeleri — hangi siparişten/kumaştan ne kadar döndü",
    icon: Undo2,
    to: "/operations/returns",
    group: "shipping",
    permission: "return:read",
  },
  {
    // Modül anahtarı yok (E-IRS P1): yapılandırılmamış kurulumda da görünür; sayfa
    // "yapılandırılmamış — <ayar yolu>" der (bulunabilirlik şartı).
    key: "e-irsaliye",
    title: "e-İrsaliye Kayıtları",
    description: "Sevkiyatların e-İrsaliye kayıtları — durum, numara/ETTN, süzgeç ve özet",
    icon: FileCheck2,
    to: "/operations/e-irsaliye",
    group: "shipping",
    permission: "eirsaliye:read",
  },
];
