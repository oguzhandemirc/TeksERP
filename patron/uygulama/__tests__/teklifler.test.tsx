// MAL-8 bekçisi — Teklifler + Standart Maliyetler: §1 menüde bulunur (Diğer › İş), izin yoksa gizli · §2 tutar yalnız
// `.finans` geldiyse; yoksa toplam/maliyetten HESAPLANMAZ (sonda a'nın uygulama ayağı) · §3 "Süresi doldu" fabrikanın
// `suresiDoldu`su, tarih gün-yalnız · §4 teklif detayı kalemleri sunucu `teklifId` süzgeciyle · §5 boş durum.
import { act, render, screen } from "@testing-library/react-native";
import type React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LIST_ID_FILTERS, LIST_SEARCH } from "../src/api/wire";

const mockApi = { snapshot: jest.fn(), list: jest.fn(), record: jest.fn() };
const mockCache = {
  load: jest.fn(async (_k: string, f: () => Promise<unknown>) => ({ data: await f(), offline: false, savedAt: "2026-10-26T09:00:00.000Z" })),
  peek: jest.fn(async () => null),
};
const mockSession = {
  api: mockApi, cache: mockCache, markOnline: jest.fn(), permissions: [] as string[], offline: false, offlineSince: null,
  facility: null as unknown, facilities: [], switchError: null, factoryStamp: "2026-10-26T08:55:00Z",
};
const mockParams: { value: Record<string, string> } = { value: {} };
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn(), canGoBack: () => true };
jest.mock("../src/state/session", () => ({ useSession: () => mockSession }));
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  usePathname: () => "/teklifler",
  useLocalSearchParams: () => mockParams.value,
  useFocusEffect: (cb: () => void | (() => void)) => (require("react") as typeof import("react")).useEffect(() => cb(), [cb]),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const Quotes = (require("../app/(app)/teklifler") as { default: () => React.ReactElement }).default;
const StandardCosts = (require("../app/(app)/standart-maliyetler") as { default: () => React.ReactElement }).default;
const RecordDetail = (require("../app/(app)/kayit/[projeksiyon]/[id]") as { default: () => React.ReactElement }).default;
const access = require("../src/lib/access") as typeof import("../src/lib/access");
const { MORE_GROUPS, RAIL_GROUPS } = require("../src/ui/tabs") as typeof import("../src/ui/tabs");
const rows = require("../src/ui/teklif/rows") as typeof import("../src/ui/teklif/rows");

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const page = (kayitlar: unknown[]) => ({ kayitlar, sonraki: null });
const QUOTE = { no: "TK-0007", revizyon: 2, musteriAdi: "Akın Tekstil", durum: "SENT", tarih: "2026-10-20", gecerlilik: "2026-10-25", doviz: "USD", suresiDoldu: true };

async function flush() {
  await act(async () => undefined);
  await act(async () => undefined);
}

beforeEach(() => {
  for (const f of Object.values(mockApi)) f.mockReset();
  mockApi.list.mockImplementation(async () => page([]));
  mockSession.permissions = [];
  mockSession.facility = null;
  mockParams.value = {};
});

describe("§1 menüde bulunur, izin yoksa gizli", () => {
  it("Diğer › İş ve geniş ekran rayı İş grubunda iki ekran", () => {
    const is = (g: readonly { title: string | null; modules: readonly string[] }[]) => g.find((x) => x.title === "İş")?.modules ?? [];
    for (const g of [MORE_GROUPS, RAIL_GROUPS]) expect(is(g)).toEqual(expect.arrayContaining(["teklifler", "standart-maliyetler"]));
  });
  it("teklif izni Teklifler'i açar; Standart Maliyetler teklif + maliyet izninin İKİSİNİ ister", () => {
    const keys = (p: string[]) => access.visibleModules(p).map((m) => m.key);
    expect(keys([])).not.toContain("teklifler");
    expect(keys(["bulut:teklif:oku"])).toContain("teklifler");
    expect(keys(["bulut:teklif:oku"])).not.toContain("standart-maliyetler");
    expect(keys(["bulut:maliyet:oku"])).not.toContain("standart-maliyetler");
    expect(keys(["bulut:teklif:oku", "bulut:maliyet:oku"])).toContain("standart-maliyetler");
    expect(access.moduleVisible(["bulut:fiyat:oku"], "teklifler")).toBe(false);
  });
});

describe("§2 tutar yalnız `.finans`tan; istemci hesaplamaz", () => {
  it("`.finans` yoksa satırda tutar YOK, durum rozeti var", async () => {
    mockSession.permissions = ["bulut:teklif:oku"];
    mockApi.list.mockImplementation(async (p: string) => (p === "teklif" ? page([{ id: U(1), kayit: QUOTE, surum: "1" }]) : page([])));
    render(<Quotes />);
    await flush();
    expect(screen.getByText("Akın Tekstil")).toBeTruthy();
    expect(screen.queryByText(/\$|₺/)).toBeNull();
    expect(screen.getByText("Süresi doldu")).toBeTruthy();
  });
  it("`.finans` brutMarjPct taşımasa da toplamTutar + toplamMaliyetTl'den marj türetilmez", () => {
    const x = rows.quoteRowText({ id: U(1), kayit: QUOTE, finans: { toplamTutar: "1000.00", toplamMaliyetTl: "20000.00", kur: "34" }, surum: "1" } as never);
    expect(x.value).toBe("1.000 $");
    expect(JSON.stringify(x)).not.toMatch(/%|marj/i);
  });
  it("standart maliyet: metre maliyeti ve gruplar `.finans`tan aynen; yoksa hiç basılmaz", () => {
    const locked = rows.standardCostRowText({ id: U(2), kayit: { urunAdi: "Kumaş A", surum: 3, durum: "ACTIVE", hesapTarihi: "2026-10-20T10:00:00Z" }, surum: "1" } as never);
    expect(locked.value).toBeUndefined();
    expect(locked.groups).toBe("");
    expect(locked.line).toContain("Geçerli");
    const open = rows.standardCostRowText({ id: U(2), kayit: { urunAdi: "Kumaş A", surum: 3, durum: "ACTIVE" }, finans: { metreMaliyetiTl: "42.5000", cozguTl: "10.0000", atkiTl: "12.0000" }, surum: "1" } as never);
    expect(open.value).toBe("42,5 ₺/m");
    expect(open.groups).toMatch(/^Çözgü .*Atkı /);
  });
  it("teklif kaynaklarında aritmetik yok", () => {
    for (const f of ["../src/ui/teklif/rows.ts", "../src/ui/teklif/QuoteLines.tsx", "../app/(app)/teklifler.tsx", "../app/(app)/standart-maliyetler.tsx"]) {
      const src = readFileSync(join(__dirname, f), "utf8");
      expect(src).not.toMatch(/toFixed|\* 100|\/ 100|\.reduce\(|\bNumber\(|parseFloat/);
    }
  });
});

describe("§3 süre ve tarih", () => {
  it("`suresiDoldu` yoksa rozet durum sözlüğünden; tarih gün-yalnız (dilim kaydırması yok)", () => {
    const x = rows.quoteRowText({ id: U(1), kayit: { ...QUOTE, suresiDoldu: false, tarih: "2026-10-20T00:00:00.000Z" }, surum: "1" } as never);
    expect(x.expired).toBe(false);
    expect(x.line).toContain("20.10.2026");
    expect(x.line).toContain("TK-0007/R2");
  });
});

describe("§4 teklif detayı kalemleri sunucu süzgeciyle", () => {
  it("süzgeç beyanlıysa `teklifId` ile ister; izinsiz kalemde tutar yok, kilit kartı var", async () => {
    mockSession.facility = { liste: { kimlikSuzgecleri: LIST_ID_FILTERS, aranabilir: Object.keys(LIST_SEARCH) } };
    mockParams.value = { projeksiyon: "teklif", id: U(3) };
    mockApi.record.mockResolvedValue({ id: U(3), kayit: QUOTE, surum: "1" });
    mockApi.list.mockImplementation(async () => page([{ id: U(4), kayit: { tanim: "Gabardin 240", miktar: "1200", birim: "MT" }, surum: "1" }]));
    render(<RecordDetail />);
    await flush();
    expect(mockApi.list).toHaveBeenCalledWith("teklif-kalemi", expect.objectContaining({ teklifId: U(3) }));
    expect(screen.getByText("Gabardin 240")).toBeTruthy();
    expect(screen.getByTestId("kayit-tutarlar-kilitli")).toBeTruthy();
    expect(screen.queryByText(/\$/)).toBeNull();
  });
  it("eski bulut süzgeci beyan etmiyorsa kalem bölümü çizilmez ve istek gitmez", async () => {
    mockParams.value = { projeksiyon: "teklif", id: U(3) };
    mockApi.record.mockResolvedValue({ id: U(3), kayit: QUOTE, surum: "1" });
    render(<RecordDetail />);
    await flush();
    expect(mockApi.list).not.toHaveBeenCalled();
    expect(screen.queryByText("Kalemler")).toBeNull();
  });
});

describe("§5 boş durum", () => {
  it("teklif ve standart maliyet listeleri boşken açıklayıcı metin", async () => {
    mockSession.permissions = ["bulut:teklif:oku", "bulut:maliyet:oku"];
    render(<Quotes />);
    await flush();
    expect(screen.getByText("Henüz gönderilmiş teklif yok")).toBeTruthy();
    render(<StandardCosts />);
    await flush();
    expect(screen.getByText("Henüz standart maliyet hesaplanmadı")).toBeTruthy();
  });
});

describe("§6 görsel kayıt (emülatör yok: PNG yerine ekran metinleri anlık görüntüsü)", () => {
  it("maliyet izinli teklif listesi", async () => {
    mockSession.permissions = ["bulut:teklif:oku", "bulut:maliyet:oku"];
    mockApi.list.mockImplementation(async () => page([
      { id: U(1), kayit: QUOTE, finans: { toplamTutar: "1000.00", kur: "34", toplamMaliyetTl: "28000.00", brutMarjPct: "17.65" }, surum: "1" },
      { id: U(2), kayit: { ...QUOTE, no: "TK-0008", revizyon: 1, musteriAdi: null, durum: "ACCEPTED", suresiDoldu: false }, surum: "1" },
    ]));
    render(<Quotes />);
    await flush();
    const texts = screen.queryAllByText(/./).map((n) => [n.props.children].flat().join(""));
    expect(texts).toMatchSnapshot();
  });
});
