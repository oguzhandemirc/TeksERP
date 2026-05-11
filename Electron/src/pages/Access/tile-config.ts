import { Users2, Layers, BookOpen, type LucideIcon } from "lucide-react";

export interface AccessTile {
  key: string;
  title: string;
  description: string;
  icon: LucideIcon;
  to: string;
}

export const accessTiles: AccessTile[] = [
  {
    key: "users",
    title: "Kullanıcılar",
    description: "Sistem kullanıcıları ve yetki atamaları",
    icon: Users2,
    to: "/access/users",
  },
  {
    key: "templates",
    title: "Yetki Şablonları",
    description: "Sık kullanılan yetki kümelerini şablonla",
    icon: Layers,
    to: "/access/templates",
  },
  {
    key: "permissions",
    title: "Yetki Kataloğu",
    description: "Sistemdeki tüm yetkilerin referans listesi",
    icon: BookOpen,
    to: "/access/permissions",
  },
];
