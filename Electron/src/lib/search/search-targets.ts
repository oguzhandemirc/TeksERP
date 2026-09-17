import type { LucideIcon } from "lucide-react";
import {
  Boxes,
  Building2,
  ClipboardList,
  Factory,
  Package,
  Palette,
  ScrollText,
  Layers,
  Truck,
} from "lucide-react";

// =============================================================================
// ARAMA SONUCU → HEDEF (2026-08-19)
// =============================================================================
// Backend `GET /api/search` yalnız VERİ döner — hedef route BİLMEZ ve bilmemeli
// (`scan-resolvers.ts` ile aynı sınır: panel route'ları panelde yaşar). Bu dosya
// `entity` + satır → "nereye gidilir"i çözer.
//
// ⚠️ BİLİNMEYEN `entity` SESSİZCE DÜŞÜRÜLMEZ. Backend'e yeni kova eklenip bu
// dosya güncellenmezse palet o grubu ATMAZ: başlığı çizer, satırları devre dışı
// bırakır ve sebebini yazar. İki proje ayrı sürümlenebiliyor, yani bu sapma
// OLACAK; sorunun sessiz olmaması gerekiyor (`lib/fold-catalog.ts:10-13`
// kuralının aynısı: "fallback KOYMA, görünür uyarı ver").
//
// ⚠️ `to()` üç mevcut navigasyon deseninden birini kullanır, yenisi icat edilmez:
//   (a) route parametresi   → gerçek detay sayfası olan varlıklar
//   (b) URL sorgusu         → liste + `?search=` / `?focus=`
//   (c) `location.state`    → `useScanSeed` köprüsü (detay sheet'i açar)
// =============================================================================

export interface SearchRow {
  id: string;
  title: string;
  subtitle: string | null;
  code: string | null;
}

export interface SearchTarget {
  label: string;
  icon: LucideIcon;
  /** Palet grubunu çizmek için gereken izin(ler) — herhangi biri yeter. */
  permissions: string[];
  /** Satıra tıklayınca açılacak hedef. */
  to: (row: SearchRow) => { to: string; state?: Record<string, unknown> };
  /** "Tümünü aç" — liste sayfası + arama terimi. */
  listTo: (term: string) => string;
}

const q = (v: string): string => encodeURIComponent(v);

export const SEARCH_TARGETS: Record<string, SearchTarget> = {
  customer: {
    label: "Müşteriler",
    icon: Building2,
    permissions: ["customer:read"],
    to: (r) => ({ to: `/definitions/customers?search=${q(r.code ?? r.title)}` }),
    listTo: (t) => `/definitions/customers?search=${q(t)}`,
  },
  item: {
    label: "Ürünler",
    icon: Package,
    permissions: ["item:read"],
    to: (r) => ({ to: `/definitions/items?search=${q(r.code ?? r.title)}` }),
    listTo: (t) => `/definitions/items?search=${q(t)}`,
  },
  color: {
    label: "Renkler",
    icon: Palette,
    permissions: ["property:read"],
    to: (r) => ({ to: `/definitions/colors?search=${q(r.code ?? r.title)}` }),
    listTo: (t) => `/definitions/colors?search=${q(t)}`,
  },
  order: {
    label: "Siparişler",
    icon: ClipboardList,
    permissions: ["order:read"],
    // ⚠️ `?focus=` detay sheet'ini AÇAR — `OrdersPage` bu deep-link'i zaten
    // uyguluyor ve parametreyi sonra temizliyor. Yeni mekanizma gerekmedi.
    to: (r) => ({ to: `/operations/orders?focus=${q(r.id)}` }),
    listTo: (t) => `/operations/orders?search=${q(t)}`,
  },
  workOrder: {
    label: "İş Emirleri",
    icon: Factory,
    permissions: ["workorder:read"],
    to: (r) => ({ to: `/operations/work-orders/${r.id}` }),
    listTo: (t) => `/operations/work-orders?search=${q(t)}`,
  },
  shipment: {
    label: "Sevkiyatlar",
    icon: Truck,
    permissions: ["shipping:read", "shipping:write"],
    to: (r) => ({ to: `/operations/shipments/${r.id}` }),
    listTo: (t) => `/operations/shipments?search=${q(t)}`,
  },
  sack: {
    label: "Çuvallar",
    icon: Boxes,
    permissions: ["shipping:read", "shipping:write"],
    // Çuval detayı sayfa-lokal sheet — `scanCode` seed köprüsüyle açılır.
    to: (r) => ({
      to: "/operations/sack-store",
      state: { scanCode: r.code ?? r.title },
    }),
    listTo: (t) => `/operations/sack-store?search=${q(t)}`,
  },
  subcontractor: {
    label: "Fason Firmalar",
    icon: Layers,
    permissions: ["subcontractor:read"],
    to: (r) => ({ to: `/definitions/subcontractors?search=${q(r.code ?? r.title)}` }),
    listTo: (t) => `/definitions/subcontractors?search=${q(t)}`,
  },
  batch: {
    label: "Partiler",
    icon: ScrollText,
    permissions: ["report:production"],
    // ⚠️ Parti no BENZERSİZ DEĞİL (P01…P99 döner) — hedef tek kayda değil,
    // izleme ekranındaki ADAY LİSTESİNE gider. `batchTerm` seed'i orada okunur.
    to: (r) => ({
      to: "/reports/production/batch-trace",
      state: { batchTerm: r.code ?? r.title },
    }),
    listTo: (t) => `/reports/production/batch-trace`,
  },
  roll: {
    label: "Toplar",
    icon: Package,
    permissions: ["roll:read"],
    // Barkod hızlı yolunun sonucu — `scan-resolvers.ts` ile AYNI köprü.
    to: (r) => ({ to: "/operations/rolls", state: { scanBarcode: r.code ?? r.title } }),
    listTo: (t) => `/operations/rolls?search=${q(t)}`,
  },
  swatch: {
    label: "Kartelalar",
    icon: Palette,
    permissions: ["kartela:read"],
    to: (r) => ({ to: "/operations/kartela", state: { scanCode: r.code ?? r.title } }),
    listTo: (t) => `/operations/kartela?search=${q(t)}`,
  },
};

/** Sunucu satırlarının cmdk `value`'su — sorgudan BAĞIMSIZ, kararlı. */
export const SERVER_ITEM_PREFIX = "srv:";
export const serverItemValue = (entity: string, id: string): string => `${SERVER_ITEM_PREFIX}${entity}:${id}`;
