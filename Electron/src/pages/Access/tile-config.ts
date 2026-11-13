import { Users2, Layers, BookOpen, Tablet, ShieldCheck, Cpu, CloudCog, Smartphone, type LucideIcon } from "lucide-react";

/** Yetkilendirme = "sisteme kim/ne girebilir": insanlar (kullanıcı erişimi) +
 *  saha tabletleri (cihaz erişimi). İki grup ayrı başlık altında sunulur. */
export type AccessTileGroup = "user" | "device";

export interface AccessTile {
  key: string;
  title: string;
  description: string;
  icon: LucideIcon;
  to: string;
  group: AccessTileGroup;
}

export interface AccessGroup {
  key: AccessTileGroup;
  title: string;
  description: string;
  icon: LucideIcon;
}

export const accessGroups: AccessGroup[] = [
  {
    key: "user",
    title: "Kullanıcı Erişimi",
    description: "Sistem kullanıcıları, yetki atamaları ve şablonlar",
    icon: ShieldCheck,
  },
  {
    key: "device",
    title: "Cihaz Erişimi",
    description: "Saha tabletlerinin bağlantı onayı ve patron telefonunun bağlanması",
    icon: Cpu,
  },
];

export const accessTiles: AccessTile[] = [
  {
    key: "users",
    title: "Kullanıcılar",
    description: "Sistem kullanıcıları ve yetki atamaları",
    icon: Users2,
    to: "/access/users",
    group: "user",
  },
  {
    key: "templates",
    title: "Yetki Şablonları",
    description: "Sık kullanılan yetki kümelerini şablonla",
    icon: Layers,
    to: "/access/templates",
    group: "user",
  },
  {
    key: "permissions",
    title: "Yetki Kataloğu",
    description: "Sistemdeki tüm yetkilerin referans listesi",
    icon: BookOpen,
    to: "/access/permissions",
    group: "user",
  },
  {
    // Bulut hesapları bulutta yönetilir; burada teknik kullanıcı doğar ve hesaplar salt okunur görünür.
    key: "patron-bulut",
    title: "Yönetim Bulutu",
    description: "Buluttan gelen sipariş/cari kaydının kullanıcısı ve bulut hesapları",
    icon: CloudCog,
    to: "/access/patron-bulut",
    group: "user",
  },
  {
    // Saha tabletleri: announce → onay → makineye atama. "Cihaz Kaydı" (Donanım:
    // metre/yazıcı/tartı) ile karışmasın diye "Tabletler" adı kullanılır.
    key: "devices",
    title: "Tabletler",
    description: "Sahadaki tabletler, eşli makineler ve kopya kayıtların birleştirilmesi",
    icon: Tablet,
    to: "/access/devices",
    group: "device",
  },
  {
    // Karekod yalnız sunucu adresini taşır; giriş patron uygulamasında kullanıcı adı + parolayla.
    key: "patron-telefon",
    title: "Patron Telefonu",
    description: "Patron uygulamasını karekodla bu sunucuya bağla",
    icon: Smartphone,
    to: "/access/patron-telefon",
    group: "device",
  },
];
