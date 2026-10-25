// =============================================================================
// Oluşturucu VERİ PANELİ (R2-VERI) — ağaç · kuyular · süzgeç kurucu · önerilen grafik
// =============================================================================
// §1 ağaç YALNIZ katalog cevabını çizer (istemci alan eklemez/çıkarmaz) + veri paneli dosyalarında izin süzmesi
//    yok (sunucu süzdü) · §2 bırakma kuralları (ölçü yalnız Ölçü'ye, varyant tek boyut, yardımcı ölçünün beyansız
//    boyutu, başka küp, zaman süzgeci) Türkçe gerekçeyle · §3 süzgeç JSON'u plan §3.2 fikstürüne birebir (aynı
//    gövdeyi Teks-Erp `test_rapor_tanimi` §1i sunucu şemasından geçirir) + Türkçe işleç adları DOLU + günlük dil
//    cümlesi · §4 önerilen grafik tablosu her satır + elle seçilen tür ezilmez · §5 `dogrula` hata yolu kuyu/çipe
//    bağlanır, gövde değişince 500 ms gecikmeli doğrulama isteği gider.
//
// NEGATİF SONDALAR (2026-10-25 ÖLÇÜLDÜ; cp + md5 ile birebir geri alındı; taban 30/0):
//   V1 `OPERATOR_LABELS`tan "contains" silindi → §3 ❌ 1 · V2 `DataTree` her küpe istemci tarafı "Kayıt sayısı"
//   ölçüsü ekledi → §1 ❌ 1 · V3 `toQueryFilter` tek değerli işleçte de dizi yazdı → §3 ❌ 1 · V4 `checkDrop` ölçü/kuyu denetimi kaldırıldı → §2 ❌ 1
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DndContext } from "@dnd-kit/core";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { CatalogCube } from "../custom-api";
import type { DefinitionBlock } from "../layout/layout-model";
import fixture from "./filter-contract.fixture.json";
import { DataTree } from "./DataTree";
import { describeFilter, FILTER_OPERATORS, OPERATOR_LABELS, toQueryFilter, type FilterGroup } from "./filter-model";
import { chartAfterChange, suggestChart } from "./suggest-chart";
import { applyDrop, checkDrop, issuesForBlock, patchFor, removeFromWell, type DataField } from "./wells-model";

const CATALOG: CatalogCube[] = [
  {
    kimlik: "sevk",
    ad: "Sevkiyat",
    olculer: [
      { kimlik: "sevk.brutMetre", ad: "Brüt sevk", aciklama: "Çıkan toplam metre", birim: "m", boyutlar: null },
      { kimlik: "sevk.tutar", ad: "Sevk tutarı", aciklama: "Para birimi ayrı", birim: "TRY", boyutlar: ["musteri", "kumas", "yon"] },
    ],
    boyutlar: [
      { kimlik: "ay", ad: "Ay", tur: "zaman", islecler: [] },
      { kimlik: "musteri", ad: "Müşteri", tur: "kategori", islecler: ["=", "!=", "in", "notIn", "contains"] },
      { kimlik: "renk", ad: "Renk", tur: "kategori", islecler: ["=", "!=", "in", "notIn", "contains"] },
      { kimlik: "yon", ad: "Yön", tur: "kategori", islecler: ["=", "!=", "in", "notIn", "contains"] },
    ],
  },
  { kimlik: "hata", ad: "Kalite hataları", olculer: [{ kimlik: "kalite.hataAdedi", ad: "Hata adedi", aciklama: "", birim: "adet", boyutlar: null }], boyutlar: [{ kimlik: "vardiya", ad: "Vardiya", tur: "kategori", islecler: ["in"] }] },
];
const SEVK = CATALOG[0]!;
const m = (id: string): DataField => ({ cube: "sevk", kind: "measure", measure: SEVK.olculer.find((x) => x.kimlik === id)! });
const d = (id: string, cube = "sevk"): DataField => ({ cube, kind: "dimension", dimension: CATALOG.find((c) => c.kimlik === cube)!.boyutlar.find((x) => x.kimlik === id)! });
const block = (tur: string, olculer: string[], boyutlar: string[] = [], extra: Partial<DefinitionBlock> = {}): DefinitionBlock => ({ id: "b", tur, sorgu: { kup: "sevk", olculer, boyutlar }, ...extra });

describe("§1 ağaç yalnız katalog cevabı", () => {
  it("çizilen her alan katalogdan, katalogdaki her alan çizili (arama boşken açılmış küplerde)", () => {
    render(
      <DndContext>
        <DataTree cubes={CATALOG} loading={false} failed={false} activeCube="sevk" targetsFor={() => []} onAdd={() => {}} />
      </DndContext>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Kalite hataları/ }));
    const drawn = screen.getAllByTestId("veri-alani").map((el) => el.getAttribute("data-alan"));
    const expected = CATALOG.flatMap((c) => [...c.olculer.map((x) => x.kimlik), ...c.boyutlar.map((x) => x.kimlik)]);
    expect(drawn.sort()).toEqual(expected.sort());
    expect(screen.getAllByTestId("veri-kupu").map((el) => el.getAttribute("data-kup"))).toEqual(["sevk", "hata"]);
    expect(screen.getByText("TRY")).toBeTruthy();
  });

  it("arama Türkçe katlamalı süzer; boş katalogda yetki açıklaması", () => {
    const { unmount } = render(
      <DndContext>
        <DataTree cubes={CATALOG} loading={false} failed={false} activeCube={null} targetsFor={() => []} onAdd={() => {}} />
      </DndContext>,
    );
    fireEvent.change(screen.getByLabelText("Alan ara"), { target: { value: "musteri" } });
    expect(screen.getAllByTestId("veri-alani").map((el) => el.getAttribute("data-alan"))).toEqual(["musteri"]);
    unmount();
    render(
      <DndContext>
        <DataTree cubes={[]} loading={false} failed={false} activeCube={null} targetsFor={() => []} onAdd={() => {}} />
      </DndContext>,
    );
    expect(screen.getByText(/Görebileceğiniz veri alanı yok/)).toBeTruthy();
  });

  it("veri paneli dosyalarında istemci izin süzmesi yok (sunucu süzer)", () => {
    for (const f of ["DataTree.tsx", "Wells.tsx", "useDataPanel.ts", "wells-model.ts", "FilterBuilder.tsx"]) {
      const src = readFileSync(join(__dirname, f), "utf8");
      expect(src, f).not.toMatch(/useRoleAccess|hasPermission|permissions|useAuthStore|isModuleEnabled|reportsClosedKeys/);
    }
  });
});

describe("§2 bırakma kuralları", () => {
  const cases: Array<[string, DefinitionBlock, Parameters<typeof checkDrop>[2], DataField, string | null]> = [
    ["ölçü Satır'a gitmez", block("tablo", ["sevk.brutMetre"]), "satir", m("sevk.tutar"), "Ölçüler yalnız Ölçü kuyusuna bırakılır."],
    ["boyut Ölçü'ye gitmez", block("tablo", ["sevk.brutMetre"]), "olcu", d("musteri"), "Ölçü kuyusuna yalnız ölçü bırakılır; “Müşteri” bir boyut."],
    ["başka küpün alanı", block("tablo", ["sevk.brutMetre"]), "satir", d("vardiya", "hata"), "Bu bölüm “Sevkiyat” verisinden okuyor; başka konudan alan eklenemez."],
    ["yardımcı ölçüye beyansız boyut", block("tablo", ["sevk.tutar"]), "satir", d("renk"), "“Sevk tutarı” ölçüsü “Renk” ile kırılamaz."],
    ["yardımcı ölçü, beyansız boyut zaten varken", block("tablo", ["sevk.brutMetre"], ["renk"]), "olcu", m("sevk.tutar"), "“Sevk tutarı” ölçüsü “Renk” ile kullanılamaz; önce o alanı çıkarın."],
    ["zaman süzgeç olmaz", block("tablo", ["sevk.brutMetre"]), "suzgec", d("ay"), "Zaman süzgeç olamaz; tarih aralığını raporun dönemi belirler."],
    ["varyant zamanla kurulmaz", block("varyant", ["sevk.brutMetre"], ["musteri"]), "varyant", d("ay"), "Kırılım kartları zamanla kurulmaz; bir kategori seçin."],
    ["ana sayıda Satır kuyusu yok", block("anaSayi", ["sevk.brutMetre"]), "satir", d("musteri"), "Bu bölümde Satır kuyusu yok."],
    ["Sütun, Satır boşken", block("grafik", ["sevk.brutMetre"]), "sutun", d("musteri"), "Önce Satır kuyusunu doldurun."],
    ["aynı boyut ikinci kez", block("grafik", ["sevk.brutMetre"], ["musteri"]), "sutun", d("musteri"), "“Müşteri” zaten bu bölümde kırılım."],
    ["izinli: kategori Satır'a", block("tablo", ["sevk.brutMetre"]), "satir", d("musteri"), null],
    ["izinli: yardımcı ölçü beyanlı boyutla", block("tablo", ["sevk.tutar"]), "satir", d("yon"), null],
  ];
  it.each(cases)("%s", (...[, b, well, field, message]) => {
    const v = checkDrop(b, SEVK, well, field);
    expect(v.ok ? null : v.message).toBe(message);
  });

  it("varyant tek boyut (değiştirir), ana sayı tek ölçü (değiştirir), son ölçü çıkmaz", () => {
    expect(applyDrop(block("varyant", ["sevk.brutMetre"], ["musteri"]), "varyant", "yon").boyutlar).toEqual(["yon"]);
    expect(applyDrop(block("anaSayi", ["sevk.brutMetre"]), "olcu", "sevk.tutar").olculer).toEqual(["sevk.tutar"]);
    expect(applyDrop(block("grafik", ["sevk.brutMetre"], ["musteri"]), "sutun", "yon").boyutlar).toEqual(["musteri", "yon"]);
    expect(removeFromWell(block("tablo", ["sevk.brutMetre"]), "olcu", "sevk.brutMetre")).toBeNull();
    expect(removeFromWell(block("grafik", ["sevk.brutMetre"], ["musteri", "yon"]), "satir", "musteri")?.boyutlar).toEqual(["yon"]);
  });
});

describe("§3 süzgeç JSON'u ve Türkçe cümle", () => {
  it("kurucu çıktısı plan §3.2 fikstürüne birebir; yarım satır düşer, tek değerli işleç dizi yazmaz", () => {
    const out = toQueryFilter(fixture.kurucuGirdisi as FilterGroup);
    expect(out).toEqual(fixture.beklenenSuzgec);
    expect(fixture.govde.bloklar[0]!.sorgu.suzgec).toEqual(out);
    expect(toQueryFilter({ combinator: "and", rules: [{ field: "yon", operator: "in", value: [] }] })).toBeUndefined();
  });

  it("her sunucu işlecinin Türkçe adı DOLU (İngilizce sızmaz)", () => {
    expect([...FILTER_OPERATORS]).toEqual(fixture.operatorler);
    for (const op of fixture.operatorler) {
      const label = OPERATOR_LABELS[op as keyof typeof OPERATOR_LABELS];
      expect(label, op).toBeTruthy();
      expect(label, op).not.toMatch(/\b(equals?|contains|in|not|between|and|or)\b/i);
    }
  });

  it("günlük dil cümlesi", () => {
    const labels = {
      field: (id: string) => ({ hataGrubu: "Hata grubu", vardiya: "Vardiya", musteri: "Müşteri", urun: "Ürün" })[id] ?? id,
      value: (_f: string, v: string) => ({ COZGU: "Çözgü", GECE: "Gece", a: "Kaya Tekstil", b: "Ece Moda", c: "Nil", e: "Ada" })[v] ?? v,
    };
    expect(describeFilter({ combinator: "and", rules: [{ field: "hataGrubu", operator: "=", value: "COZGU" }, { field: "vardiya", operator: "in", value: ["GECE"] }] }, labels)).toBe("Hata grubu: Çözgü · Vardiya: Gece");
    expect(describeFilter({ combinator: "and", rules: [{ field: "musteri", operator: "notIn", value: ["a", "b", "c", "e"] }] }, labels)).toBe("Müşteri: Kaya Tekstil, Ece Moda, Nil ve 1 değer daha dışında");
    expect(describeFilter({ combinator: "or", rules: [{ field: "urun", operator: "contains", value: "pamuk" }, { combinator: "and", rules: [{ field: "vardiya", operator: "=", value: "GECE" }, { field: "hataGrubu", operator: "!=", value: "COZGU" }] }] }, labels)).toBe(
      "Ürün: “pamuk” geçen veya (Vardiya: Gece · Hata grubu: Çözgü dışında)",
    );
    expect(describeFilter({ combinator: "and", rules: [{ field: "musteri", operator: "in", value: "$musteri" }] }, labels)).toBe("Müşteri: rapordaki seçime göre");
  });
});

describe("§4 önerilen grafik", () => {
  const rows: Array<[number, Array<"zaman" | "kategori">, string]> = [
    [1, ["zaman"], "cizgi"],
    [1, ["zaman", "kategori"], "cizgi"],
    [2, [], "sacilim"],
    [2, ["kategori"], "sacilim"],
    [1, ["kategori", "kategori"], "isiHaritasi"],
    [1, ["kategori"], "cubuk"],
    [1, [], "anaSayi"],
  ];
  it.each(rows)("%i ölçü · %j → %s", (measureCount, dimensionKinds, kind) => {
    const s = suggestChart({ measureCount, dimensionKinds });
    expect(s.kind).toBe(kind);
    expect(s.reason.length).toBeGreaterThan(10);
  });

  it("öneride kalan grafik güncellenir, elle seçilen tür ezilmez", () => {
    expect(chartAfterChange("cubuk", { measureCount: 1, dimensionKinds: ["kategori"] }, { measureCount: 1, dimensionKinds: ["kategori", "kategori"] })).toBe("isiHaritasi");
    expect(chartAfterChange("pasta", { measureCount: 1, dimensionKinds: ["kategori"] }, { measureCount: 1, dimensionKinds: ["kategori", "kategori"] })).toBe("pasta");
    const p = patchFor(block("grafik", ["sevk.brutMetre"], ["musteri"], { gorsel: "cubuk" }), { kup: "sevk", olculer: ["sevk.brutMetre"], boyutlar: ["ay"] }, SEVK);
    expect(p.gorsel).toBe("cizgi");
  });
});

describe("§5 sunucu doğrulaması kuyuya bağlanır", () => {
  it("JSON yolu → kuyu + çip", () => {
    const issues = [
      { yol: "bloklar[1].sorgu.olculer[0]", mesaj: "ölçü yok" },
      { yol: "bloklar[1].sorgu.boyutlar[1]", mesaj: "boyut yok" },
      { yol: "bloklar[1].sorgu.suzgec.rules[2].field", mesaj: "süzgeç alanı yok" },
      { yol: "bloklar[1].sorgu.zaman.param", mesaj: "tarih değil" },
      { yol: "bloklar[0].sorgu.olculer[0]", mesaj: "başka bölüm" },
    ];
    expect(issuesForBlock(issues, 1, block("grafik", ["x"], ["a", "b"]))).toEqual([
      { well: "olcu", index: 0, mesaj: "ölçü yok" },
      { well: "sutun", index: 0, mesaj: "boyut yok" },
      { well: "suzgec", index: 2, mesaj: "süzgeç alanı yok" },
      { well: null, index: null, mesaj: "tarih değil" },
    ]);
  });
});

// ── Ekran: düzen sayfasında kuyular + gecikmeli `dogrula` ─────────────────────
const post = vi.fn();
let validateReply: { gecerli: boolean; hatalar: Array<{ yol: string; mesaj: string }> } = { gecerli: true, hatalar: [] };
const BODY = {
  surum: 1,
  baslik: "Sevk özeti",
  parametreler: [{ ad: "donem", tur: "tarihAraligi", varsayilan: "son30gun" }],
  bloklar: [
    { id: "ana", tur: "anaSayi", sorgu: { kup: "sevk", olculer: ["sevk.brutMetre"], boyutlar: [], zaman: { param: "donem" } } },
    { id: "tablo", tur: "tablo", baslik: "Müşteriye göre", sorgu: { kup: "sevk", olculer: ["sevk.brutMetre"], boyutlar: ["musteri"], zaman: { param: "donem" }, suzgec: { combinator: "and", rules: [{ field: "yon", operator: "=", value: "EXPORT" }] } } },
  ],
};
const RUN = { tanim: { id: "r1", ad: "Sevk özeti", surumNo: 1 }, baslik: "Sevk özeti", itibariylaMetni: "25.10.2026 09:00", bloklar: [] };
const DETAIL = { id: "r1", tur: "OZEL", ad: "Sevk özeti", aciklama: null, kategori: { id: "k", ad: "K", kod: null }, sahip: null, gorunurluk: "OZEL", durum: "YAYINDA", aktifSurum: { id: "s1", no: 1, tarih: "" }, bozuk: false, duzenleyebilir: true, guncellendi: "", govde: BODY };

vi.mock("@/services/apiClient", () => ({
  default: {
    get: (url: string) => Promise.resolve({ data: { success: true, data: url === "/api/rapor-semantik/katalog" ? CATALOG : DETAIL } }),
    post: (url: string, body: unknown) => {
      post(url, body);
      if (url.endsWith("/dogrula")) return Promise.resolve({ data: { success: true, data: validateReply } });
      if (url.endsWith("/onizle")) return Promise.resolve({ data: { success: true, data: RUN } });
      if (url === "/api/rapor-semantik/sorgu") return Promise.resolve({ data: { success: true, data: { satirlar: [{ anahtarlar: { yon: { deger: "EXPORT", etiket: "Yurtdışı" } }, degerler: {} }] } } });
      return Promise.reject(new Error(`beklenmeyen ${url}`));
    },
  },
}));

vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ isAdmin: false, hasPermission: () => true }) }));
vi.mock("@/providers/PreferencesProvider", () => ({ usePreferences: () => ({ prefs: {}, setPreference: vi.fn(), resetPreferences: vi.fn(), ready: true }) }));
vi.mock("@/store/auth", () => ({ useAuthStore: (sel: (s: { user: { userId: string } }) => unknown) => sel({ user: { userId: "u1" } }) }));

import { ReportLayoutPage } from "../layout/ReportLayoutPage";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/reports/ozel/r1/duzen"]}>
        <Routes>
          <Route path="/reports/ozel/:id/duzen" element={<ReportLayoutPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("§5 ekran", () => {
  beforeEach(() => {
    post.mockClear();
    validateReply = { gecerli: true, hatalar: [] };
  });

  it("seçili bölümün kuyuları dolu, süzgeç Türkçe cümle; dogrula hatası çipe bağlanır", async () => {
    validateReply = { gecerli: false, hatalar: [{ yol: "bloklar[1].sorgu.boyutlar[0]", mesaj: "“Sevkiyat” küpünde “musteri” boyutu yok." }] };
    renderPage();
    fireEvent.click(await screen.findByText("Müşteriye göre"));
    const satir = await screen.findByTestId("kuyu-satir");
    expect(within(satir).getByText("Müşteri")).toBeTruthy();
    expect(within(screen.getByTestId("kuyu-olcu")).getByText("Brüt sevk")).toBeTruthy();
    await waitFor(() => expect(within(screen.getByTestId("kuyu-suzgec")).getByText("Yön: Yurtdışı")).toBeTruthy());
    await waitFor(() => expect(post.mock.calls.some(([u]) => u === "/api/rapor-tanimlari/dogrula")).toBe(true), { timeout: 2000 });
    await waitFor(() => expect(within(satir).getByTitle("“Sevkiyat” küpünde “musteri” boyutu yok.")).toBeTruthy());
  });

  it("süzgeç çipi kaldırılınca gövdeden `suzgec` anahtarı düşer ve yeniden doğrulanır", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("Müşteriye göre"));
    const well = await screen.findByTestId("kuyu-suzgec");
    await waitFor(() => expect(post.mock.calls.filter(([u]) => u === "/api/rapor-tanimlari/dogrula").length).toBe(1), { timeout: 2000 });
    fireEvent.click(within(well).getByRole("button", { name: "Koşulu kaldır" }));
    await waitFor(() => expect(post.mock.calls.filter(([u]) => u === "/api/rapor-tanimlari/dogrula").length).toBe(2), { timeout: 2000 });
    const last = post.mock.calls.filter(([u]) => u === "/api/rapor-tanimlari/dogrula").at(-1)![1] as { govde: typeof BODY };
    expect("suzgec" in last.govde.bloklar[1]!.sorgu).toBe(false);
  });
});
