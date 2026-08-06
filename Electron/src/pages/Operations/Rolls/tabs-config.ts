import {
  Package,
  Cog,
  Send,
  FlaskConical,
  Disc3,
  Warehouse,
  Columns3,
  ShoppingBag,
  type LucideIcon,
} from "lucide-react";
import type { RollStatusTabKey } from "./service";

export type RollTabKey = RollStatusTabKey | "KANBAN";

export interface RollTabDef {
  key: RollTabKey;
  label: string;
  Icon: LucideIcon;
}

/**
 * Envanter sekmeleri — TEK KAYNAK. `RollsPage` sekme şeridini, komut paleti ise
 * `?tab=<key>` derin bağlantılarını buradan üretir; kopyalanırsa palette
 * gösterilen bir sekme sayfada olmayabilir (ya da tersi) ve tıklayan kullanıcı
 * sessizce varsayılan sekmede açılır.
 *
 * Sıralama: stoklar (giriş/çıkış) önde yan yana → üretim akışı (super-set +
 * alt-kümeler) → kartela. Operatör en sık giriş/çıkış sayım için stoklara bakar,
 * üretim akışı sekmeleri orta blokta.
 */
export const ROLL_TABS: RollTabDef[] = [
  { key: "RAW_STOCK",      label: "Ham Stok",        Icon: Package },
  { key: "FINISHED_STOCK", label: "Bitmiş Depo",     Icon: Warehouse },
  { key: "IN_SACK",        label: "Çuvalda",         Icon: ShoppingBag },
  { key: "PRODUCTION",     label: "Üretimde",        Icon: Cog },
  { key: "KANBAN",         label: "Üretim Akışı",    Icon: Columns3 },
  { key: "SUBCONTRACTOR",  label: "Fasonda",         Icon: Send },
  { key: "KURSUN_PENDING", label: "Kurşun Bekleyen", Icon: FlaskConical },
  { key: "TAMBUR_PENDING", label: "Tambur Bekleyen", Icon: Disc3 },
];
// ⚠️ "Arşiv" sekmesi 2026-08-05'te BURADAN KALDIRILDI → Sistem → Top Arşivi
// (`/system/roll-archive`, admin:settings). Kullanıcı kararı: "arşiv oradan
// kalksın, kimsenin tıklamayacağı zor bulunan bir yere koyalım."
// STATUS_GROUPS.ARCHIVE anahtarı DURUYOR ve yeni sayfa onu kullanıyor —
// silinirse tip hatası verir (`RollStatusTabKey` union'ı) ve arşiv statüleri
// için tek kaynak kaybolur.

const TAB_KEYS = new Set<RollTabKey>(ROLL_TABS.map((t) => t.key));

export function isRollTabKey(v: string | null): v is RollTabKey {
  return v !== null && TAB_KEYS.has(v as RollTabKey);
}
