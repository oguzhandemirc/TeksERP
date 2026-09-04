// =============================================================================
// BEKÇİ — Siparişler ekranı YERLEŞİM SÖZLEŞMESİ (2026-09-04)
// =============================================================================
// ⭐ NEDEN VAR. Kullanıcı üç şey istedi ve üçü de yalnız SINIF/SIRA olarak
//    yaşıyor — hiçbir davranış testi bunları ölçmez, derleyici de görmez:
//      ① özet şerit filtre satırının ÜSTÜNDE,
//      ② şerit TAM GENİŞLİK ve sola dayalı (eski `flex justify-end` sarmalayıcı
//        şeridi içeriği kadar bırakıp sağa yapıştırıyordu),
//      ③ filtreler TEK SATIR + yatay kaydırma (dikeyde yer yemesin).
//    Bir refactor sırasında `w-full` ya da sarmalayıcı sınıfı düşerse ekran
//    sessizce eski hâline döner: hata yok, log yok, yalnız kaybolan alan.
//
// ⭐ İÇERİK İKİ EKSENDE ÇÖZÜLÜR: görünüm modu TAVAN, pencere genişliği TABAN.
//    "Geniş" seçili olsa bile metraj `lg` (≥1024px), tutar/termin/iş emri
//    `2xl` (≥1536px) altında gizlenir. Ölçülen şey bu kademelerin RENDER'a
//    gerçekten yansıdığı; jsdom CSS hesaplamaz, o yüzden sınıf sözleşmesi
//    ölçülür — kademeyi silmek testi kırar.
//
// ⚠️ KÖRLÜK ZEMİNİ: "sade" modda metraj grubu HİÇ doğmaz. O yüzden kademe
//    kontrolünden önce grubun VAR olduğu ayrıca ölçülür; yoksa "sınıf yok"
//    ile "eleman yok" ayırt edilemez ve test hiçbir şey ölçmeyen bir yeşile
//    dönüşür.
//
// NEGATİF SONDA (koşuldu, kırmızı görüldü):
//   · `w-full` şerit kökünden silindi          → "tam genişlik" KIRMIZI
//   · `<OrdersStats>` yeniden filtrelerin ALTINA alındı → "sıra" KIRMIZI
//   · `[&>div]:flex-nowrap` sarmalayıcıdan düştü → "tek satır" KIRMIZI
//   · metraj grubundan `lg:flex` kaldırıldı    → "kademe" KIRMIZI
// =============================================================================
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import { renderWithProviders } from "@/test/render";
import { OrdersStats } from "./OrdersStats";
import { OrdersFilterRow } from "./OrdersFilterRow";
import type { OrderStats } from "./service";

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE_SRC = readFileSync(join(HERE, "OrdersPage.tsx"), "utf8");

const STATS: OrderStats = {
  totalCount: 12,
  byStatus: { PENDING: 5, APPROVED: 4, COMPLETED: 3 },
  totalOrderedQty: 1000,
  totalShippedQty: 400,
  totalOpenQty: 600,
  overdueCount: 2,
  dueThisWeekCount: 1,
  noWorkOrderCount: 3,
  amountByCurrency: { TRY: 125000 },
};

function renderStrip(view: "sade" | "onerilen" | "genis") {
  return renderWithProviders(
    <OrdersStats
      data={STATS}
      isLoading={false}
      scopeLabel="TÜM SİPARİŞLER"
      view={view}
      onViewChange={() => {}}
      viewLocked={false}
      pricingEnabled
      onApplyFilter={() => {}}
    />,
  );
}

describe("Siparişler — özet şerit yerleşimi", () => {
  it("⭐ şerit TAM GENİŞLİK (w-full) ve ayarlar en sağda (ml-auto)", () => {
    const { getByTestId } = renderStrip("genis");
    expect(getByTestId("orders-stats").className).toContain("w-full");
    expect(getByTestId("orders-stats-view").className).toContain("ml-auto");
  });

  it("⭐ sayfada özet şerit FİLTRE SATIRININ ÜSTÜNDE", () => {
    const stats = PAGE_SRC.indexOf("<OrdersStats");
    const filters = PAGE_SRC.indexOf("<OrdersFilterRow");
    expect(stats).toBeGreaterThan(-1);
    expect(filters).toBeGreaterThan(-1);
    expect(stats).toBeLessThan(filters);
  });

  it("⭐ şerit sağa dayalı sarmalayıcı TAŞIMAZ (justify-end geri gelmesin)", () => {
    expect(PAGE_SRC).not.toContain("justify-end");
  });

  it("⭐ METRAJ kademesi lg (≥1024px), TUTAR/TERMİN kademesi 2xl (≥1536px)", () => {
    const { getByTestId } = renderStrip("genis");
    const qty = getByTestId("orders-stats-qty").className;
    expect(qty).toContain("hidden");
    expect(qty).toContain("lg:flex");
    for (const id of ["orders-stats-money", "orders-stats-extra"]) {
      const cls = getByTestId(id).className;
      expect(cls).toContain("hidden");
      expect(cls).toContain("2xl:flex");
    }
  });

  it("KÖRLÜK ZEMİNİ: 'sade' modda metraj/tutar grupları HİÇ doğmaz", () => {
    const { queryByTestId } = renderStrip("sade");
    expect(queryByTestId("orders-stats-qty")).toBeNull();
    expect(queryByTestId("orders-stats-money")).toBeNull();
    // Ayar açılırı her modda durur (şeridin tek sabit sağ ucu).
    expect(queryByTestId("orders-stats-view")).not.toBeNull();
  });

  it("KÖRLÜK ZEMİNİ: 'onerilen' modda metraj VAR, tutar YOK", () => {
    const { queryByTestId } = renderStrip("onerilen");
    expect(queryByTestId("orders-stats-qty")).not.toBeNull();
    expect(queryByTestId("orders-stats-money")).toBeNull();
  });
});

describe("Siparişler — filtre satırı tek satır + yatay kaydırma", () => {
  it("⭐ sarmalayıcı yatay kaydırır ve kök satırı flex-nowrap'e çeker", () => {
    const { getByTestId } = renderWithProviders(<OrdersFilterRow filters={[]} />);
    const row = getByTestId("orders-filter-row");
    expect(row.className).toContain("overflow-x-auto");
    // `shrink-0` da sözleşmenin parçası: overflow'lu flex çocuğunda
    // `min-height: auto` sıfıra düşer, satır dikey alan daralınca ezilirdi.
    expect(row.className).toContain("shrink-0");
    expect(row.className).toContain("[&>div]:flex-nowrap");
    expect(row.className).toContain("[&>div>*]:shrink-0");
  });

  it("⭐ `[&>div]` seçicisinin HEDEFİ var: FilterBar kökü tek bir <div>", () => {
    // FilterBar bir Fragment'a ya da <section>'a dönerse seçici SESSİZCE ölür
    // ve satır yeniden sarmaya başlar — kırmızı burada patlar.
    const { getByTestId } = renderWithProviders(<OrdersFilterRow filters={[]} />);
    const row = getByTestId("orders-filter-row");
    expect(row.children.length).toBe(1);
    const inner = row.children[0] as HTMLElement;
    expect(inner.tagName).toBe("DIV");
    // Ezilen sınıf gerçekten orada (yoksa nowrap'in ezecek bir şeyi yok).
    expect(inner.className).toContain("flex-wrap");
  });
});
