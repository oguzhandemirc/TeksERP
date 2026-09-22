// =============================================================================
// Bekçi: Paketleme grubu — panel yüzeyi (2026-09-10)
//   §1 Şerit YALNIZ bayrak açık + TEK cari seçiliyken çizilir
//   §2 Çip filtreyi yazarken `cursor`u SİLER (bayat imleç = boş liste yalanı)
//   §3 "Gruplanmamış" sentineli ayrı sabitten gelir, çıplak "none" yazılmaz
//   §4 Grup dökümü ve gruba iz kapsamı SUNUCUYA bırakılır (sayfa ≠ grup)
//   §5 Grup sütunu adı `packingGroup.name`den okur, `seq`ten KURMAZ
//   §6 Grup ve iz sütunları SIRALANMAZ; not ve kg sıralanır (keyset kısıtı)
//   §7 Döküm ad rejimi: `musterideki` karşılığı yoksa hücre BOŞ kalır
//   §8 Excel kolon kümesi ad rejimine göre daralır
//   §9 Grup çıktısı ÇALIŞMA KÂĞIDIDIR: başlıkta cari + grup + basım anı
//
// ⭐ NEGATİF SONDA (ölçüldü 2026-09-10):
//   (a) şeritteki `next.delete("cursor")` silindi -> §2 KIRMIZI
//   (b) grup sütunu `seq`ten ad kurmaya çevrildi -> §5 KIRMIZI
//   (c) `adHucresi` musterideki dalı bizim ada FAIL-OPEN yapıldı -> §7 KIRMIZI
//   (d) Excel kolonlarındaki mod koşulları kaldırıldı -> §8 KIRMIZI (2 kontrol)
// =============================================================================
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSackDumpHtml } from "./sackDump/dumpHtml";
import { buildSackDumpSheets } from "./sackDump/dumpSheets";
import type { SackDump } from "./sackDump/types";
import { UNGROUPED_FILTER_VALUE } from "./types";

const bar = readFileSync(resolve(__dirname, "./PackingGroupBar.tsx"), "utf-8");
const list = readFileSync(resolve(__dirname, "./SacksListView.tsx"), "utf-8");
const cols = readFileSync(resolve(__dirname, "./sacksColumns.tsx"), "utf-8");
const tagMenu = readFileSync(resolve(__dirname, "./SackTagsBulkMenu.tsx"), "utf-8");

function dump(over: Partial<SackDump> = {}): SackDump {
  return {
    sackNo: "CV1",
    customerName: "ACME",
    branchName: null,
    branchCode: null,
    weightKg: null,
    notes: null,
    shipmentNo: null,
    rolls: [
      {
        barcode: "T1",
        itemName: "PATOS",
        colorName: "Mavi",
        musteriItemName: null,
        musteriColorName: "MUSTERI MAVI",
        width: 280,
        qty: 100,
        qualityGrade: "1.KALITE",
      },
    ],
    swatches: [],
    ...over,
  } as SackDump;
}

describe("§1 şerit ön koşulu", () => {
  it("bayrak VE tek cari birlikte aranır", () => {
    // 2026-09-21: şerit moda göre dallanır (grup ↔ sevk partisi) — bayrak kapısı aynı.
    // 2026-09-22: parti modunda şerit YOK (rozet başlıkta, eylemler alt şeritte); grup modunda çip şeridi — bayrak kapısı aynı.
    expect(list).toMatch(/groupsEnabled && !lotMode && <PackingGroupBar customerId=\{tekCariId\} \/>/);
    expect(list).toContain("usePackingGroupsEnabled()");
    // Tek cari kuralı: CSV bölünür ve müşterisiz sentineli DIŞLANIR.
    expect(list).toContain("cariFiltresi.length === 1");
  });

  it("şerit cari yoksa ya da grup yoksa hiç çizilmez", () => {
    expect(bar).toContain("if (!customerId || gruplar.length === 0) return null;");
  });
});

describe("§2 imleç tuzağı", () => {
  it("⭐ çip filtreyi yazarken cursor SİLİNİR", () => {
    expect(bar).toContain('next.delete("cursor")');
  });
});

describe("§3 sentinel", () => {
  it("gruplanmamış sentineli ayrı sabitten gelir", () => {
    expect(UNGROUPED_FILTER_VALUE).toBe("none");
    expect(bar).toContain("UNGROUPED_FILTER_VALUE");
    // Çıplak "none" yazımı sentineli iki kaynaklı yapar.
    expect(bar).not.toContain('sec("none")');
  });
});

describe("§4 kapsamı sunucu çözer", () => {
  it("⭐ grup dökümü sackIds GÖNDERMEZ, packingGroupId gönderir", () => {
    expect(bar).toContain("contentDump([], secili)");
  });

  it("⭐ gruba iz de aynı kalıptan geçer", () => {
    expect(tagMenu).toContain("packingGroupId ? { ...payload!, sackIds: [], packingGroupId } : payload!");
  });
});

describe("§5 grup sütunu", () => {
  it("⭐ ad packingGroup.name'den okunur", () => {
    expect(cols).toContain("id: \"packingGroup\"");
    expect(cols).toContain("s.packingGroup?.name ?? \"\"");
  });

  it("ad seq'ten KURULMAZ (elle adlandırılmış grupta seq null)", () => {
    expect(cols).not.toMatch(/`P\$\{[^}]*seq/);
  });
});

describe("§6 sıralanabilirlik (keyset cursor kısıtı)", () => {
  it("not ve kg SIRALANIR", () => {
    expect(cols).toContain('<SortableHeader field="notes"');
    expect(cols).toContain('<SortableHeader field="weightKg"');
  });

  it("⭐ grup ve iz SIRALANMAZ — ikisi de ilişki", () => {
    expect(cols).not.toContain('field="packingGroup"');
    expect(cols).not.toContain('field="tags"');
  });
});

describe("§7 döküm ad rejimi — musterideki BOŞ bırakır", () => {
  it("⭐ karşılığı olmayan kumaş adı hücresi BOŞ (bizimki yazılmaz)", () => {
    const html = buildSackDumpHtml([dump()], { nameMode: "musterideki" });
    expect(html).not.toContain("PATOS");
    // Karşılığı OLAN renk basılır — kural "hep boş" değil, "uydurma yok".
    expect(html).toContain("MUSTERI MAVI");
  });

  it("bizdeki modda müşteri adı hiç geçmez", () => {
    const html = buildSackDumpHtml([dump()], { nameMode: "bizdeki" });
    expect(html).toContain("PATOS");
    expect(html).not.toContain("MUSTERI MAVI");
  });

  it("varsayılan (ikisi) bugünkü çıktıdır — ikisi de var", () => {
    const html = buildSackDumpHtml([dump()], {});
    expect(html).toContain("PATOS");
    expect(html).toContain("MUSTERI MAVI");
  });
});

describe("§8 Excel kolon kümesi rejime göre daralır", () => {
  const basliklar = (mode: "ikisi" | "bizdeki" | "musterideki"): string[] => {
    const sheets = buildSackDumpSheets([dump()], { nameMode: mode });
    const s = sheets.find((x) => x.name === "CV1")!;
    return s.columns.map((c) => c.header);
  };

  it("⭐ bizdeki → müşteri sütunları YOK", () => {
    const h = basliklar("bizdeki");
    expect(h).toContain("Kumaş");
    expect(h).not.toContain("Müşteri kumaş");
    expect(h).not.toContain("Müşteri renk");
  });

  it("⭐ musterideki → bizim sütunlarımız YOK", () => {
    const h = basliklar("musterideki");
    expect(h).not.toContain("Kumaş");
    expect(h).not.toContain("Renk");
    expect(h).toContain("Müşteri kumaş");
  });

  it("ikisi (varsayılan) → dört sütun da var", () => {
    const h = basliklar("ikisi");
    expect(h).toEqual(expect.arrayContaining(["Kumaş", "Müşteri kumaş", "Renk", "Müşteri renk"]));
  });
});

describe("§9 grup çıktısı çalışma kâğıdıdır", () => {
  it("⭐ başlık cari + grup adını taşır", () => {
    const html = buildSackDumpHtml([dump()], { scopeLabel: "P2" });
    expect(html).toContain("ACME — P2");
  });

  it("⭐ başlık BASIM ANINI taşır (iki kâğıdı ayıran ikinci şey)", () => {
    const html = buildSackDumpHtml([dump()], { scopeLabel: "P2" });
    expect(html).toContain("Basım:");
  });

  it("Excel özetinde Kapsam sütunu YALNIZ grup dökümünde çizilir", () => {
    const ile = buildSackDumpSheets([dump()], { scopeLabel: "P2" }).find((s) => s.name === "Özet")!;
    const siz = buildSackDumpSheets([dump()], {}).find((s) => s.name === "Özet")!;
    expect(ile.columns.map((c) => c.header)).toContain("Kapsam");
    expect(siz.columns.map((c) => c.header)).not.toContain("Kapsam");
  });

  it("kapsam etiketi yoksa başlık bugünkü haliyle kalır (regresyon)", () => {
    expect(buildSackDumpHtml([dump()], {})).toContain("ÇUVAL İÇERİK DÖKÜMÜ — CV1");
  });
});
