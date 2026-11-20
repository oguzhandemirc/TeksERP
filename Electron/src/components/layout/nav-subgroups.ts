// =============================================================================
// MENÜ SÜREÇ ALT GRUPLARI (2026-11-20) — yan menü + bölüm sayfası ızgarası TEK kaynaktan
// =============================================================================
// Sıra = tül üretiminin sahadaki akışı (mal kabul/iplik → devere/çözgü → dokuma → terbiye → kurşun → fason →
// kalite → paket → sevk); grup içinde planla/emir → yürüt → izle. Ekran kimliği YOLDUR (rotalar değişmez).
// Aynı yol başka kökün grubunda da durabilir (çapraz listeleme, ör. Fasondaki İplik: Üretim + Depo); bir kökte
// bir kez. Görünürlük burada KARAR VERİLMEZ: girdi zaten süzülmüş listedir, boş grup düşer.
// =============================================================================
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";
import { TERIM, terimDokumaRejimi } from "@/lib/terim";

export interface NavSubgroupDef {
  key: string;
  /** Grup başlığı; bağlama göre değişebilir (dokumasız profil). */
  label: string | ((ctx: OperationsVisibilityContext) => string);
  /** Ekran yolları, görüntü sırasıyla. */
  paths: readonly string[];
}

/** Grupta olmayan ekranların düştüğü son grup — yeni ekran menüde kaybolmasın. */
export const OTHER_SUBGROUP_KEY = "diger";
const OTHER_SUBGROUP_LABEL = "Diğer";

const OPS = (k: string) => `/operations/${k}`;

/** Kök yolu → alt gruplar. Tanımı olmayan kök düz liste çizer (tek adsız grup). */
export const NAV_SUBGROUPS: Readonly<Record<string, readonly NavSubgroupDef[]>> = {
  "/sales": [
    { key: "satis", label: "", paths: ["/cost/quotes", OPS("orders"), OPS("product-balance"), OPS("allocation-repair")] },
  ],
  "/warehouse": [
    { key: "mal-kabul", label: "Satın Alma / Mal Kabul", paths: [OPS("purchase-orders"), OPS("goods-receipts"), OPS("gelen-belgeler")] },
    { key: "iplik-sarf", label: "İplik ve Sarf", paths: [OPS("yarn-stock"), OPS("fasondaki-iplik"), OPS("sarf-stogu")] },
    { key: "kumas-paket", label: "Kumaş ve Paketleme", paths: [OPS("rolls"), OPS("sack-content-edit"), OPS("relabel-station")] },
    { key: "sayim-transfer", label: "Sayım ve Transfer", paths: [OPS("stock-counts"), OPS("warehouse-transfers")] },
  ],
  "/production": [
    { key: "devere", label: "Devere / Çözgü", paths: [OPS("fason-devere"), OPS("cozgu-hesabi"), OPS("warp-beams"), OPS("fasondaki-iplik"), "/reports/dokuma/denye-sapma"] },
    {
      key: "dokuma",
      // Dokumasız profilde (Gülkesim) grupta yalnız "Makine Duruşları" kalır — başlık da onu anlatır.
      label: (ctx) => (ctx.dokumaEnabled || ctx.tezgahEnabled ? "Dokuma" : "Makine Takibi"),
      paths: [OPS("weaving-orders"), OPS("weaving-floor"), OPS("loom-load"), OPS("machine-stops"), OPS("loom-alarms")],
    },
    {
      key: "terbiye",
      // İş emri adı rejimle değişir (`TERIM.terbiyeIsEmri`); başlık aynı kaynağa bakar.
      label: () => (terimDokumaRejimi() ? "Terbiye" : TERIM.terbiyeIsEmri.cogul),
      paths: [OPS("work-orders"), OPS("work-orders/new"), OPS("kartela"), OPS("work-order-events")],
    },
    { key: "kursun", label: "Kurşun", paths: [OPS("kursun-dagitim"), OPS("kursun-sapmalar")] },
    { key: "fason", label: "Fason", paths: [OPS("fason-kokpiti"), OPS("icerideki-isler"), OPS("emanet-cikis")] },
  ],
  "/quality": [
    { key: "kalite", label: "", paths: ["/quality/inspection-rules", "/quality/inspections", "/quality/lab-tests", "/quality/certificates", "/quality/inspections?report=1"] },
  ],
  "/shipping": [
    { key: "sevk-cikis", label: "Sevk Çıkışı", paths: [OPS("sevke-hazir-isler"), OPS("shipments"), OPS("sack-store")] },
    { key: "sevk-sonrasi", label: "Sevk Sonrası", paths: [OPS("accounting-dispatch"), OPS("e-irsaliye"), OPS("returns")] },
  ],
  "/cost": [
    { key: "girdi", label: "Girdi Fiyatları", paths: ["/cost/parameters", "/cost/yarn-prices", "/cost/finishing-rates", "/cost/machine-rates", "/cost/consumable-norms"] },
    { key: "hesap", label: "Hesap ve Fiyat", paths: ["/cost/items", "/cost/calculator", "/cost/price-lists"] },
    { key: "analiz", label: "İhtiyaç ve Kârlılık", paths: ["/cost/yarn-need", "/reports/maliyet/karlilik"] },
  ],
  "/finance": [
    { key: "cari-fatura", label: "Cari ve Fatura", paths: ["/finance/cari", "/finance/invoices", "/finance/allocations", "/definitions/service-prices"] },
    { key: "tahsilat-kasa", label: "Tahsilat ve Kasa", paths: ["/finance/payments", "/finance/accounts", "/finance/cash-transactions", "/finance/cheques"] },
    { key: "donem", label: "Dönem ve Kur", paths: ["/finance/rates", "/finance/period-close"] },
  ],
};

export interface NavSubgroup<T> {
  key: string;
  /** Boş ad = başlıksız (düz liste). */
  label: string;
  items: T[];
}

/**
 * Kökün görünür ekranlarını alt gruplara böler (saf). `home`: kökün kendi ekranları (görünür, ev sırası);
 * `pool`: çapraz listeleme için bütün görünür ekranlar (verilmezse yalnız `home`). Tanımsız kökte tek adsız grup.
 * Kendi ekranı olup hiçbir gruba yazılmamış ekran "Diğer"e düşer; boş grup çıkar.
 */
export function layoutSubgroups<T extends { to: string }>(
  root: string,
  home: readonly T[],
  ctx: OperationsVisibilityContext,
  pool: readonly T[] = home,
): NavSubgroup<T>[] {
  const defs = NAV_SUBGROUPS[root];
  if (!defs) return home.length > 0 ? [{ key: OTHER_SUBGROUP_KEY, label: "", items: [...home] }] : [];
  const byPath = new Map<string, T>();
  for (const t of [...home, ...pool]) if (!byPath.has(t.to)) byPath.set(t.to, t);
  const used = new Set<string>();
  const out: NavSubgroup<T>[] = [];
  for (const d of defs) {
    const items: T[] = [];
    for (const p of d.paths) {
      const t = byPath.get(p);
      if (t && !used.has(p)) {
        used.add(p);
        items.push(t);
      }
    }
    if (items.length > 0) out.push({ key: d.key, label: typeof d.label === "function" ? d.label(ctx) : d.label, items });
  }
  const rest = home.filter((t) => !used.has(t.to));
  if (rest.length > 0) out.push({ key: OTHER_SUBGROUP_KEY, label: out.length > 0 ? OTHER_SUBGROUP_LABEL : "", items: rest });
  return out;
}
