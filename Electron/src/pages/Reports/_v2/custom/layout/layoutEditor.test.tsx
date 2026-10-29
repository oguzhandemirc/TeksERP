// =============================================================================
// Özel rapor DÜZENİ (R2-DUZEN) — panel
// =============================================================================
// §1 model: ekle / çıkar / sırala / genişlik / sayfa kesmesi → tanım JSON'u beklenen; sırala `bloklar`a DOKUNMAZ
//    (düzen yalnız sunum), önizleme anahtarı düzenle değişmez (sayı yeniden istenmez) · §2 kayıt = YENİ SÜRÜM isteği
//    (`POST /:id/surumler`, beklenen sürüm + token), 409 → Türkçe "yeniden yükleyin" · §3 görüntüleme: "Düzeni düzenle"
//    yalnız `report:builder` + düzenleme hakkıyla; bayrak kapalıyken düzen sayfası çizilmez · §4 PDF = Excel: aynı
//    spec'in her tablo hücresi iki çıktıda aynı metin, blok sırası düzenden · §5 düzensiz gövdede ekran DOM'u eski akış.
//
// NEGATİF SONDALAR (2026-10-25 ÖLÇÜLDÜ; cp + md5 ile birebir geri alındı; taban 10/0):
//   L1 `moveBlock` `bloklar`ı da yeniden sıraladı → §1 + §2 ❌ 2 · L2 `reportExport.toSheetsV2` düzen tablolarını atladı
//   → §4 ❌ 1 · L3 `CustomReportViewPage` düğmede `canEdit` denetimi kaldırıldı → §3 ❌ 1
//   L4 (R3-ANALIZ) `useLayoutEditor` önizleme engeli kaldırıldı → §2 ❌ 1
// §6 (R2-ANLATI) "Ne görüyoruz?" bloğu: paletten eklenir (4 kural, 3 cümle); ekran + PDF/Excel sunucunun `anlati`
//    metnini AYNEN basar; istemci tablodaki sayılardan cümle KURMAZ (boş `anlati` → yalnız boş durum yazısı).
// =============================================================================
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactElement } from "react";
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";

let v2 = true;
let perms: string[] = ["report:builder", "report:sales"];
let editable = true;
let versionReply: "ok" | "conflict" = "ok";
let measureUnit = "m";
const post = vi.fn();

const BODY = {
  surum: 1,
  baslik: "Sevk özeti",
  parametreler: [
    { ad: "donem", tur: "tarihAraligi", varsayilan: "son30gun" },
    { ad: "kiyas", tur: "kiyas", varsayilan: "prev" },
  ],
  bloklar: [
    { id: "ana", tur: "anaSayi", sorgu: { kup: "sevk", olculer: ["sevk.brutMetre"], boyutlar: [], zaman: { param: "donem", kiyas: "$kiyas" } } },
    { id: "tablo", tur: "tablo", baslik: "Müşteriye göre", sorgu: { kup: "sevk", olculer: ["sevk.brutMetre"], boyutlar: ["musteri"], zaman: { param: "donem" } } },
    { id: "not1", tur: "metin", metin: "Sevk rakamları brüttür." },
  ],
};

const result = (r: { rows: Array<[string, number]>; donem?: boolean }) => ({
  olculer: [{ kimlik: "sevk.brutMetre", ad: "Brüt sevk", birim: "m" }],
  boyutlar: [{ kimlik: "musteri", ad: "Müşteri" }],
  satirlar: r.rows.map(([ad, v], i) => ({ anahtarlar: { musteri: { deger: `m${i}`, etiket: ad } }, degerler: { "sevk.brutMetre": v } })),
  toplam: { degerler: { "sevk.brutMetre": r.rows.reduce((n, [, v]) => n + v, 0) } },
  kiyas: null,
  uyarilar: [],
});

const RUN = {
  tanim: { id: "r1", ad: "Sevk özeti", surumNo: 2 },
  baslik: "Sevk özeti",
  itibariylaMetni: "25.10.2026 09:00",
  bloklar: [
    { id: "ana", tur: "anaSayi", baslik: null, durum: "tamam", sonuclar: [{ ...result({ rows: [] }), boyutlar: [], toplam: { degerler: { "sevk.brutMetre": 12450.5 } } }] },
    { id: "tablo", tur: "tablo", baslik: "Müşteriye göre", durum: "tamam", sonuclar: [result({ rows: [["Kaya Tekstil", 8000.25], ["Ece Moda", 4450.25]] })] },
    { id: "not1", tur: "metin", baslik: null, durum: "tamam", sonuclar: [], metin: "Sevk rakamları brüttür." },
  ],
};

const detail = () => ({
  id: "r1", tur: "OZEL", ad: "Sevk özeti", aciklama: null, kategori: { id: "k", ad: "Kayıtlı raporlar", kod: "kayitli" }, sahip: { id: "u1", ad: "Ayşe" },
  gorunurluk: "OZEL", durum: "YAYINDA", aktifSurum: { id: "s2", no: 2, tarih: "" }, bozuk: false, duzenleyebilir: editable, guncellendi: "", govde: BODY,
});
const CATALOG = [
  {
    kimlik: "sevk", ad: "Sevk",
    olculer: [{ kimlik: "sevk.brutMetre", ad: "Brüt sevk", aciklama: "", birim: "m", boyutlar: null }],
    boyutlar: [{ kimlik: "musteri", ad: "Müşteri", tur: "kategori", islecler: ["in"] }, { kimlik: "ay", ad: "Ay", tur: "zaman", islecler: [] }],
  },
];

// Sayım ölçüsü vakası (§2): aynı ölçü "adet" birimiyle gelir → maruziyetsiz analiz kaydı bekletir.
const catalog = () => CATALOG.map((c) => ({ ...c, olculer: c.olculer.map((m) => ({ ...m, birim: measureUnit })) }));

vi.mock("@/services/apiClient", () => ({
  default: {
    get: (url: string) => Promise.resolve({ data: { success: true, data: url === "/api/rapor-semantik/katalog" ? catalog() : url.startsWith("/api/rapor-tanimlari/r1") ? detail() : [] } }),
    post: (url: string, body: unknown) => {
      post(url, body);
      if (url.endsWith("/onizle") || url.endsWith("/calistir")) return Promise.resolve({ data: { success: true, data: RUN } });
      if (url.endsWith("/surumler")) {
        return versionReply === "ok"
          ? Promise.resolve({ data: { success: true, data: { id: "s3", no: 3 } } })
          : Promise.reject({ response: { status: 409, data: { details: { code: "RAPOR_SURUM_CAKISMASI" } } } });
      }
      return Promise.reject(new Error(`beklenmeyen ${url}`));
    },
    put: vi.fn(),
    patch: vi.fn(),
  },
}));
const ctx = (): OperationsVisibilityContext => ({
  shipmentConfirmationEnabled: false, depoMultiEnabled: false, devereEnabled: true, dokumaEnabled: true, tezgahEnabled: true, kaliteGuvenceEnabled: false, maliyetEnabled: false, gelenBelgeEnabled: false,
  financeEnabled: true, productionEnabled: true, ticaretEnabled: true, iplikEnabled: true,
  reportsClosedKeys: [], isReportOpen: () => true, flagsReady: true, flagsFailed: false, reportsV2Enabled: v2,
});
vi.mock("@/pages/Operations/useOperationsVisibility", () => ({ useOperationsVisibilityContext: () => ctx() }));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ isAdmin: false, hasPermission: (c: string) => perms.includes(c) }) }));
vi.mock("@/providers/PreferencesProvider", () => ({ usePreferences: () => ({ prefs: {}, setPreference: vi.fn(), resetPreferences: vi.fn(), ready: true }) }));
vi.mock("@/store/auth", () => ({ useAuthStore: (sel: (s: { user: { userId: string } }) => unknown) => sel({ user: { userId: "u1" } }) }));

import { addBlock, moveBlock, normalizedBody, orderedLayout, removeBlock, resizeBlock, setPageBreak, type DefinitionBody } from "./layout-model";
import { contentKeyOf } from "./useLayoutEditor";
import { ReportLayoutPage } from "./ReportLayoutPage";
import { CustomReportViewPage } from "../CustomReportViewPage";
import { CustomReportRoute } from "../CustomReportRoute";
import { DefinitionResultView } from "../DefinitionResultView";
import { buildDefinitionExportSpec } from "./definition-export";
import { buildReportHtml, toSheets } from "@/pages/Reports/_components/reportExport";
import { reportCellText } from "@/lib/number-format";
import type { RunResult } from "../custom-api";


function renderAt(path: string, routePath: string, ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={routePath} element={ui} />
          <Route path="/reports/ozel/:id" element={<p>rapor görünümü</p>} />
          <Route path="/forbidden" element={<p>yasak</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  v2 = true;
  perms = ["report:builder", "report:sales"];
  editable = true;
  versionReply = "ok";
  measureUnit = "m";
  post.mockClear();
});

const body = () => normalizedBody(structuredClone(BODY) as DefinitionBody);

describe("§1 düzen modeli", () => {
  it("⭐ sırala yalnız `duzen`i değiştirir; `bloklar` ve önizleme anahtarı aynı", () => {
    const b = body();
    const moved = moveBlock(b, "not1", "ana");
    expect(moved.bloklar).toEqual(b.bloklar);
    expect(orderedLayout(moved).map((x) => x.item.i)).toEqual(["not1", "ana", "tablo"]);
    expect(moved.duzen).toEqual([
      { i: "not1", x: 0, y: 0, w: 12, h: 1 },
      { i: "ana", x: 0, y: 1, w: 12, h: 1 },
      { i: "tablo", x: 0, y: 2, w: 12, h: 1 },
    ]);
    expect(contentKeyOf(moved)).toBe(contentKeyOf(b));
  });

  it("genişlik yan yana paketler; sayfa kesmesi yeni satır açar", () => {
    let b = resizeBlock(body(), "ana", 4);
    b = resizeBlock(b, "tablo", 8);
    expect(b.duzen!.slice(0, 2)).toEqual([{ i: "ana", x: 0, y: 0, w: 4, h: 1 }, { i: "tablo", x: 4, y: 0, w: 8, h: 1 }]);
    b = setPageBreak(b, "tablo", true);
    expect(b.duzen![1]).toEqual({ i: "tablo", x: 0, y: 1, w: 8, h: 1, sayfaKesmesi: true });
    expect(b.bloklar).toEqual(BODY.bloklar);
  });

  it("ekle: konu ve dönem ilk sorgudan, düzenin sonuna; çıkar: blok ve düzen birlikte; son blok kalır", () => {
    const added = addBlock(body(), "varyant", "musteri")!;
    const blk = added.bloklar[3]!;
    expect(blk).toEqual({ id: "kirilim1", tur: "varyant", ilkN: 6, sorgu: { kup: "sevk", olculer: ["sevk.brutMetre"], boyutlar: ["musteri"], zaman: { param: "donem", kiyas: "$kiyas" } } });
    expect(added.duzen!.at(-1)).toMatchObject({ i: "kirilim1", w: 12 });
    // R3-ANALIZ: analiz bloğu artık eklenir — konunun ölçüsü × kırılım, maruziyet kullanıcıya kalır.
    expect(addBlock(body(), "analiz", "musteri")!.bloklar[3]).toEqual({ id: "analiz1", tur: "analiz", yontem: "kiKare", kup: "sevk", x: "musteri", y: "sevk.brutMetre", zaman: { param: "donem" } });
    expect(addBlock(body(), "analiz", null)).toBeNull();
    expect(addBlock(body(), "grafik", null)).toBeNull();
    const removed = removeBlock(added, "tablo");
    expect(removed.bloklar.map((x) => x.id)).toEqual(["ana", "not1", "kirilim1"]);
    expect(removed.duzen!.map((d) => d.i)).toEqual(["ana", "not1", "kirilim1"]);
    const single = { ...body(), bloklar: [BODY.bloklar[0]!] } as DefinitionBody;
    expect(removeBlock(single, "ana")).toBe(single);
  });
});

describe("§2 kayıt", () => {
  it("⭐ kayıt YENİ SÜRÜM ister: beklenen sürüm + token; bloklar aynı, düzen yeni", async () => {
    renderAt("/reports/ozel/r1/duzen", "/reports/ozel/:id/duzen", <ReportLayoutPage />);
    const down = await screen.findAllByRole("button", { name: "Aşağı taşı" });
    fireEvent.click(down[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Kaydet (yeni sürüm)" }));
    await waitFor(() => expect(post.mock.calls.some(([u]) => u === "/api/rapor-tanimlari/r1/surumler")).toBe(true));
    const sent = post.mock.calls.find(([u]) => u === "/api/rapor-tanimlari/r1/surumler")![1] as { govde: DefinitionBody; beklenenSurumId: string; clientToken: string };
    expect(sent.beklenenSurumId).toBe("s2");
    expect(sent.clientToken).toMatch(/.{8,}/);
    expect(sent.govde.bloklar).toEqual(BODY.bloklar);
    expect(sent.govde.duzen!.map((d) => d.i)).toEqual(["tablo", "ana", "not1"]);
    expect(await screen.findByText("rapor görünümü")).toBeInTheDocument();
  });

  it("409 RAPOR_SURUM_CAKISMASI → 'başka biri değiştirdi, yeniden yükleyin'", async () => {
    versionReply = "conflict";
    renderAt("/reports/ozel/r1/duzen", "/reports/ozel/:id/duzen", <ReportLayoutPage />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Aşağı taşı" }))[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Kaydet (yeni sürüm)" }));
    expect(await screen.findByText("Rapor başka biri tarafından değiştirildi, yeniden yükleyin.")).toBeInTheDocument();
  });

  it("maruziyetsiz sayım analizi: önizleme isteği gitmez, son önizleme kalır, Kaydet kapalı + Türkçe neden", async () => {
    measureUnit = "adet";
    renderAt("/reports/ozel/r1/duzen", "/reports/ozel/:id/duzen", <ReportLayoutPage />);
    expect(await screen.findByText("Kaya Tekstil")).toBeInTheDocument();
    const previews = () => post.mock.calls.filter(([u]) => String(u).endsWith("/onizle")).length;
    const before = previews();
    fireEvent.click(screen.getByRole("button", { name: /^Analiz/ }));
    expect(await screen.findByText(/Kaydedilemiyor: Sayım ölçüsü/)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 900));
    expect(previews()).toBe(before);
    expect(screen.queryByText(/Önizleme çalıştırılamadı/)).toBeNull();
    expect(screen.getByText("Kaya Tekstil")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Kaydet (yeni sürüm)" })).toBeDisabled();
  });

  it("değişiklik yokken Kaydet kapalı; önizleme gerçek veriyle çizilir", async () => {
    renderAt("/reports/ozel/r1/duzen", "/reports/ozel/:id/duzen", <ReportLayoutPage />);
    expect(await screen.findByText("Kaya Tekstil")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Kaydet (yeni sürüm)" })).toBeDisabled();
  });
});

describe("§3 bulunabilirlik ve kapılar", () => {
  it("⭐ 'Düzeni düzenle' yalnız report:builder + düzenleme hakkıyla", async () => {
    const first = renderAt("/reports/ozel/r1", "/reports/ozel/:id", <CustomReportViewPage />);
    expect(await screen.findByRole("link", { name: /Düzeni düzenle/ })).toHaveAttribute("href", "/reports/ozel/r1/duzen");
    first.unmount();
    perms = ["report:sales"];
    renderAt("/reports/ozel/r1", "/reports/ozel/:id", <CustomReportViewPage />);
    expect(await screen.findByText("Kaya Tekstil")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Düzeni düzenle/ })).toBeNull();
  });

  it("bayrak kapalı: düzen sayfası çizilmez, tanım ucu çağrılmaz", async () => {
    v2 = false;
    renderAt("/reports/ozel/r1/duzen", "/reports/ozel/:id/duzen", <CustomReportRoute><ReportLayoutPage /></CustomReportRoute>);
    expect(await screen.findByText("yasak")).toBeInTheDocument();
    expect(screen.queryByText(/Düzen:/)).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });
});

describe("§4 PDF = Excel", () => {
  it("⭐ her tablo hücresi iki çıktıda aynı metin; blok sırası ve sayfa kesmesi düzenden", () => {
    let b = moveBlock(body(), "tablo", "ana");
    b = setPageBreak(b, "not1", true);
    const spec = buildDefinitionExportSpec(RUN as RunResult, b, () => "cubuk");
    expect(spec.bloklar!.map((x) => x.tur)).toEqual(["tablo", "anaSayi", "metin"]);
    const html = buildReportHtml(spec);
    const sheets = toSheets(spec);
    const tables = spec.bloklar!.flatMap((x) => (x.tur === "tablo" ? [x.tablo] : []));
    expect(tables).toHaveLength(1);
    for (const t of tables) {
      const sheet = sheets.find((s) => s.name === t.name);
      expect(sheet, `Excel'de "${t.name}" sayfası`).toBeDefined();
      expect(sheet!.rows).toEqual(t.rows);
      for (const row of t.rows) for (const c of t.columns) expect(html).toContain(`>${reportCellText(row[c.key], c.numFmt)}</td>`);
    }
    expect(html).toContain('class="blk kesme"');
    expect(html).toContain("Sevk rakamları brüttür.");
  });
});

describe("§5 düzensiz eski kayıt", () => {
  it("layout verilmezse eski tek sütun akışı (ızgara sarmalayıcısı yok)", () => {
    const { container } = render(
      <MemoryRouter>
        <DefinitionResultView result={RUN as RunResult} chartKindOf={() => "cubuk"} />
      </MemoryRouter>,
    );
    expect(container.querySelector(".grid-cols-12")).toBeNull();
    const withLayout = render(
      <MemoryRouter>
        <DefinitionResultView result={RUN as RunResult} chartKindOf={() => "cubuk"} layout={[{ i: "not1", w: 6 }, { i: "ana", w: 6 }]} />
      </MemoryRouter>,
    );
    const order = [...withLayout.container.querySelectorAll(".grid-cols-12 > section")].map((s) => s.getAttribute("aria-label"));
    expect(order).toEqual(["metin", "anaSayi", "Müşteriye göre"]);
  });
});

describe("§6 Ne görüyoruz? bloğu (R2-ANLATI)", () => {
  const SERVER = "Sevk edilen: Ekim'de 12.400 m; eylüle göre %24 fazla.";
  const withNarrative = (anlati: Array<{ kural: string; onem: number; metin: string; kanit: Record<string, unknown> }>) =>
    ({ ...RUN, bloklar: [{ id: "anlati1", tur: "anlati", baslik: null, durum: "tamam", sonuclar: [], anlati }, ...RUN.bloklar] }) as unknown as RunResult;

  it("paletten eklenir: dört kural seçili, en çok üç cümle; sorgusu yok", () => {
    const b = addBlock(body(), "anlati", null)!;
    const blk = b.bloklar.find((x) => x.tur === "anlati")!;
    expect(blk).toMatchObject({ id: "anlati1", kurallar: ["anaSayiKiyas", "enBuyukPay", "korelasyon", "orneklemUyarisi"], enFazla: 3 });
    expect(blk.sorgu).toBeUndefined();
  });

  it("⭐ ekran ve PDF/Excel sunucunun cümlesini AYNEN basar", () => {
    const { container } = render(<DefinitionResultView result={withNarrative([{ kural: "anaSayiKiyas", onem: 0.5, metin: SERVER, kanit: {} }])} chartKindOf={() => "cubuk"} layout={[{ i: "anlati1", w: 12 }]} />);
    expect(screen.getByRole("region", { name: "Ne görüyoruz?" }).textContent).toContain(SERVER);
    expect(container.textContent).not.toContain("henüz");
    const spec = buildDefinitionExportSpec(withNarrative([{ kural: "anaSayiKiyas", onem: 0.5, metin: SERVER, kanit: {} }]), { ...body(), bloklar: [{ id: "anlati1", tur: "anlati" }, ...body().bloklar], duzen: [{ i: "anlati1", x: 0, y: 0, w: 12, h: 1 }] }, () => "cubuk");
    expect(spec.bloklar![0]).toEqual(expect.objectContaining({ tur: "anlati", cumleler: [SERVER] }));
  });

  it("⭐ istemci cümle kurmaz: boş `anlati` yanında veri dolu tablo olsa da yalnız boş durum yazısı", () => {
    render(<DefinitionResultView result={withNarrative([])} chartKindOf={() => "cubuk"} layout={[{ i: "anlati1", w: 12 }]} />);
    const box = screen.getByRole("region", { name: "Ne görüyoruz?" });
    expect(box.querySelectorAll("li")).toHaveLength(0);
    expect(box.textContent).toContain("Bu dönem için söylenecek bir şey bulunmadı.");
  });
});
