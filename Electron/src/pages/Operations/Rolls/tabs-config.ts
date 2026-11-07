import {
  Package,
  Cog,
  Send,
  FlaskConical,
  Disc3,
  Warehouse,
  Columns3,
  ShoppingBag,
  Layers,
  type LucideIcon,
} from "lucide-react";
import type { RollStatusTabKey } from "./service";

export type RollTabKey = RollStatusTabKey | "KANBAN";

/** Şerit grubu: "durum" = ürünün durumu (ham/yarı mamul/bitmiş), "yer" = yer/süreç. */
export type RollTabGroup = "durum" | "yer";

/** Grupların şeritteki sırası; aralarına tek ince ayraç çizilir (başlık/yazı yok). */
export const ROLL_TAB_GROUP_ORDER: readonly RollTabGroup[] = ["durum", "yer"];

export interface RollTabDef {
  key: RollTabKey;
  label: string;
  Icon: LucideIcon;
  group: RollTabGroup;
}

/**
 * Envanter sekmeleri — TEK KAYNAK. `RollsPage` sekme şeridini, komut paleti ise
 * `?tab=<key>` derin bağlantılarını buradan üretir; kopyalanırsa palette
 * gösterilen bir sekme sayfada olmayabilir (ya da tersi) ve tıklayan kullanıcı
 * sessizce varsayılan sekmede açılır.
 *
 * Sıralama: önce ürün DURUMU grubu (Ham · Yarı Mamul · Bitmiş), ince ayraç, sonra
 * YER/SÜREÇ grubu. Kullanıcının sürükle-bırak sırası yalnız grup İÇİNDE geçerlidir
 * (`orderRollTabsByGroup`).
 */
export const ROLL_TABS: RollTabDef[] = [
  { key: "RAW_STOCK",      label: "Ham Stok",        Icon: Package, group: "durum" },
  // YARI MAMUL (2026-08-26) — dışarıdan alınan boyalı/işlenmiş kumaş. Ayrı DEPO
  // değil ayrı GÖRÜNÜM: statü (STOCK) ve stok mekaniği ham stokla aynı, ayıran
  // şey `entrySource=SEMI_FINISHED`. Eskiden Ham Stok'ta bir FİLTRE arkasındaydı
  // (2026-08-17 kararı) ve fiilen görünmüyordu: sayım ve metraj toplamı ham
  // kumaşla tek rakamda birleşiyordu.
  { key: "SEMI_FINISHED",  label: "Yarı Mamul",      Icon: Layers, group: "durum" },
  { key: "FINISHED_STOCK", label: "Bitmiş Depo",     Icon: Warehouse, group: "durum" },
  { key: "IN_SACK",        label: "Çuvalda",         Icon: ShoppingBag, group: "yer" },
  { key: "PRODUCTION",     label: "Üretimde",        Icon: Cog, group: "yer" },
  { key: "KANBAN",         label: "Üretim Akışı",    Icon: Columns3, group: "yer" },
  { key: "SUBCONTRACTOR",  label: "Fasonda",         Icon: Send, group: "yer" },
  { key: "KURSUN_PENDING", label: "Kurşun Bekleyen", Icon: FlaskConical, group: "yer" },
  { key: "TAMBUR_PENDING", label: "Tambur Bekleyen", Icon: Disc3, group: "yer" },
];
// ⚠️ "Arşiv" sekmesi 2026-08-05'te BURADAN KALDIRILDI → Sistem → Top Arşivi
// (`/system/roll-archive`, admin:settings). Kullanıcı kararı: "arşiv oradan
// kalksın, kimsenin tıklamayacağı zor bulunan bir yere koyalım."
// STATUS_GROUPS.ARCHIVE anahtarı DURUYOR ve yeni sayfa onu kullanıyor —
// silinirse tip hatası verir (`RollStatusTabKey` union'ı) ve arşiv statüleri
// için tek kaynak kaybolur.

/**
 * Kayıtlı (kullanıcı) sırayı grup sırasına oturtur: grup içi sıra korunur, gruplar
 * `ROLL_TAB_GROUP_ORDER` sırasında. Eski kayıtlı sıra grupları karıştırmış olabilir.
 */
export function orderRollTabsByGroup<T extends { group: RollTabGroup }>(tabs: readonly T[]): T[] {
  return ROLL_TAB_GROUP_ORDER.flatMap((g) => tabs.filter((t) => t.group === g));
}

const TAB_KEYS = new Set<RollTabKey>(ROLL_TABS.map((t) => t.key));

export function isRollTabKey(v: string | null): v is RollTabKey {
  return v !== null && TAB_KEYS.has(v as RollTabKey);
}
