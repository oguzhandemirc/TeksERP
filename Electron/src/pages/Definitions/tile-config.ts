import type { LucideIcon } from "lucide-react";
import type { DefinitionGroupKey } from "./groups-config";
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";
import { catalogTiles } from "./tiles/catalog";
import { partnerTiles } from "./tiles/partners";
import { productionTiles } from "./tiles/production";
import { outputTiles } from "./tiles/output";

export interface DefinitionTile {
  key: string;
  title: string;
  description: string;
  icon: LucideIcon;
  to: string;
  group: DefinitionGroupKey;
  /**
   * DURUMA bağlı görünürlük — Operasyon karolarıyla AYNI bağlam (komut paleti
   * de aynı yüklemi uygular; ayrı bir tip, paletle ayrışırdı).
   * ⚠️ İZİN kontrolünden BAĞIMSIZ uygulanır ve admin kısa devresi bunu
   * ATLAMAZ: rejim bir yetki değil kurulum türü sorusudur — admin de fabrika
   * kurulumunda Cariler karosunu görmemeli.
   */
  visibleWhen?: (ctx: OperationsVisibilityContext) => boolean;
  permission?: string;
  /**
   * Bunlardan HERHANGİ biri yeterli. `permission` ile birlikte verilmez —
   * route guard'ıyla (`ProtectedRoute requireAnyPermission`) aynı listeyi
   * taşımalı, yoksa kart görünür ama tıklayınca /forbidden'a düşer.
   */
  permissionAny?: string[];
}
// Karolar grup dosyalarında (`tiles/*.ts`, UX-2 bölünmesi); bekçiler `scripts/lib/panel-karo-dosyalari.ts` ile hepsini okur.
export const definitionTiles: DefinitionTile[] = [
  ...catalogTiles,
  ...partnerTiles,
  ...productionTiles,
  ...outputTiles,
];
