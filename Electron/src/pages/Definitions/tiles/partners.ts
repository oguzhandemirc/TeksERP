// Tanımlar › İş Ortakları karoları (sıra = hub sırası).
import { Users2, Tag, Building2 } from "lucide-react";
import type { DefinitionTile } from "../tile-config";

export const partnerTiles: DefinitionTile[] = [
  {
    // Birleşik görünüm (2026-08-14): müşteri + tedarikçi + fason TEK listede,
    // rol rozetiyle. Kartlar kendi tablolarında/formlarında yaşamaya devam
    // eder — bu bir GÖRÜNÜM birleştirmesi, tablo birleştirmesi değil.
    // ⚠️ Karo ile route AYNI izin listesini taşır (content-routes aynası).
    key: "cariler",
    title: "Cariler",
    description: "Müşteri, tedarikçi ve fason kartları — tek liste, rol rozetiyle",
    icon: Users2,
    to: "/definitions/cariler",
    group: "partners",
    permissionAny: ["customer:read", "subcontractor:read"],
    // TİCARET REJİMİ (2026-08-14, kullanıcı kararı): bayrak açıkken TEK cari
    // listesi bu; Müşteriler + Fason karoları gizlenir (üç örtüşen liste
    // karışıklığı). Fabrikada (bayrak kapalı) bu karo HİÇ görünmez.
    visibleWhen: (ctx) => ctx.financeEnabled,
  },
  {
    key: "customers",
    title: "Müşteriler",
    description: "Müşteri ve tedarikçi firmalar",
    icon: Users2,
    to: "/definitions/customers",
    group: "partners",
    permission: "customer:read",
    // Ticaret rejiminde Cariler'in içinde — karo gizlenir, ROUTE DURUR
    // (derin bağlantı/favori kırılmaz).
    visibleWhen: (ctx) => !ctx.financeEnabled,
  },
  {
    key: "subcontractors",
    title: "Fason Firmalar",
    description: "Dış hizmet sağlayan firmalar ve verdikleri hizmetler",
    icon: Building2,
    to: "/definitions/subcontractors",
    group: "partners",
    permission: "subcontractor:read",
    // Ticaret rejiminde Cariler'in içinde (Müşteriler karosuyla aynı kural).
    visibleWhen: (ctx) => !ctx.financeEnabled,
  },
  {
    key: "subcontractor-categories",
    title: "Fason Kategorileri",
    description: "Boyahane, baskı, yıkama gibi hizmet türleri",
    icon: Tag,
    to: "/definitions/subcontractor-categories",
    group: "partners",
    permission: "subcontractor:read",
  },
];
