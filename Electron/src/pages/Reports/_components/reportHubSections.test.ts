// =============================================================================
// BEKÇİ — HUB BÖLÜMLEMESİ KARO KAYBETMEZ
// =============================================================================
// ⭐ NEDEN VAR (R6 ②): karoları "basit / gelişmiş" diye bölmek bir SIRALAMADIR,
// bir süzgeç değil. Sınıfı katalogda olmayan bir karo (kategori karoları) bölüm
// uğruna düşerse, kullanıcı o raporu HİÇ göremez — kapatmakla aynı sonuç, üstelik
// sessiz. Kapı bu yüzden "giren karo = çıkan karo" eşitliğini ölçer.
// =============================================================================
import { describe, expect, it } from "vitest";
import { FileText } from "lucide-react";
import { groupBySinif, sinifOf, type HubTile } from "./ReportHubGrid";

const tile = (key: string, to: string): HubTile => ({ key, to, title: key, description: key, icon: FileText });

describe("hub bölümlemesi", () => {
  it("sınıf ADRESTEN çözülür, karo tanımına alan eklenmez", () => {
    expect(sinifOf("/reports/sales/order-intake")).toBe("gelismis");
    expect(sinifOf("/reports/audit/user-activity")).toBe("basit");
    expect(sinifOf("/reports/sales")).toBeNull(); // kategori karosu
    expect(sinifOf("/operations/rolls")).toBeNull();
  });

  it("⭐ hiçbir karo kaybolmaz (giren = çıkan)", () => {
    const tiles = [
      tile("a", "/reports/sales/order-intake"),
      tile("b", "/reports/audit/user-activity"),
      tile("c", "/reports/sales"), // sınıfsız: bölümsüz listede kalır
    ];
    const { sections, unclassified } = groupBySinif(tiles);
    const cikan = [...sections.flatMap((b) => b.list), ...unclassified].map((t) => t.key).sort();
    expect(cikan).toEqual(["a", "b", "c"]);
  });

  it("tek sınıflı kategoride bölüm BAŞLIĞI gösterilmez", () => {
    const tekSinif = [tile("a", "/reports/dokuma/randiman"), tile("b", "/reports/dokuma/durus-pareto")];
    expect(groupBySinif(tekSinif).showSections).toBe(false);
    const karisik = [tile("a", "/reports/sales/order-intake"), tile("b", "/reports/sales/order-cancellation")];
    expect(groupBySinif(karisik).showSections).toBe(true);
  });
});
