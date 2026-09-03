import type { LucideIcon } from "lucide-react";
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";

export interface CommandEntry {
  key: string;
  label: string;
  description?: string;
  icon: LucideIcon;
  to: string;
  permission?: string;
  /** Birden çok izinden HERHANGİ biri yeterli (tile permissionAny ile hizalı). */
  permissionAny?: string[];
  adminOnly?: boolean;
  /**
   * Yalnız satıcı (süperadmin) hesabına gösterilir — `SystemTile.superadminOnly`
   * aynası.
   *
   * ⚠️ `visibleWhen` ile ANLATILAMAZ: o yüklem modül bağlamını (`ctx`) okur,
   * bu ise KİMLİK sorusudur ve bağlam kimlik taşımaz (taşısaydı karo bağlamı
   * bir yetki nesnesine dönüşürdü). Süzgeç `CommandPalette` içinde, tek
   * kaynaktan (`lib/superadmin-gate.ts`) uygulanır.
   *
   * ⚠️ İZNİN YERİNE GEÇMEZ: giriş kendi `permission`ını taşımaya devam eder.
   */
  superadminOnly?: boolean;
  /** Görünmeyen ek arama anahtarları (cmdk eşleşme değerine eklenir). */
  keywords?: string;
  /**
   * "Alt başlık" girişi: bir sayfanın SEKMESİ, bir ayarın tek satırı ya da bir
   * hub bölümü. ARANDIĞINDA çıkar, boş paletin varsayılan listesinde çıkmaz.
   *
   * NEDEN: bunlar sayfa değil, sayfanın İÇİ. Hepsi varsayılan listeye konsaydı
   * palet ilk açılışta ~150 satırla açılır ve asıl işi olan "sayfaya sıçra"
   * gürültüye gömülürdü. Kullanıcı bir şey yazdığı an tam katalog aranır —
   * yani "bulunamıyor" sorunu doğmaz, yalnız boş liste sade kalır.
   */
  deep?: boolean;
  /**
   * Operasyon karolarının DURUMA BAĞLI görünürlüğü (`OperationsTile.visibleWhen`
   * ile AYNI yüklem — kopyalanmaz, taşınır).
   *
   * NEDEN PALET DE SÜZÜLÜR: hub karosu gizlendiğinde palet girişi kalırsa üçüncü
   * bir giriş kapısı kuralla çelişir. "Kurşun Sırası"nda bu somut bir hataya
   * dönüşüyordu — route kapısı da aynı koşulu uyguladığı için paletten seçen
   * kullanıcı sayfa yerine hub'a atılıyor ve sebebini hiçbir yerde göremiyordu.
   * (`OperationsTile` dışındaki girişlerde bu alan yoktur → her zaman görünür.)
   */
  visibleWhen?: (ctx: OperationsVisibilityContext) => boolean;
}

export interface CommandSection {
  heading: string;
  entries: CommandEntry[];
  /**
   * Bu bölümdeki sayfaların breadcrumb ÜST bağlantısı. Verilmezse
   * `findBreadcrumbParent` bölüm başlığından çözer (Operasyon/Sistem/…).
   */
  parent?: { label: string; to: string };
}
