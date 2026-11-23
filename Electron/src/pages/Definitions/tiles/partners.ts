// Tanımlar › İş Ortakları karoları (sıra = hub sırası).
import { Users2, Tag } from "lucide-react";
import type { DefinitionTile } from "../tile-config";

export const partnerTiles: DefinitionTile[] = [
  {
    // Birleşik görünüm: müşteri + tedarikçi + fason TEK listede, rol rozetiyle (kimlik tek, rol bayrak).
    // T1/T9 (2026-11-23): her rejimde TEK cari ekranı; eski Müşteriler / Fason Firmalar adresleri buraya
    // rol süzgeciyle yönlenir (`LegacyCariRedirect`). ⚠️ Karo ile route AYNI izin listesini taşır.
    key: "cariler",
    title: "Cariler",
    description: "Müşteri, tedarikçi ve fason kartları — tek liste, rol rozetiyle",
    icon: Users2,
    to: "/definitions/cariler",
    group: "partners",
    permissionAny: ["customer:read", "subcontractor:read"],
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
