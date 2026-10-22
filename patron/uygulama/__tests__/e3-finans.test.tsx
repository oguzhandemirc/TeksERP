// E3 bekçisi — Finans, Raporlar, jenerik kayıt: §1 izinsiz finans segmenti/alanı çizilmez · §2 her tutar para birimli
// (formatMoney; düz sayı yok, aritmetik yok) · §3 rapor durumu/başlığı sözlükten · §4 rapor iptali iki adım ·
// §5 liste ilk sayfası etiketle tazelenir (useRemote) · §6 bekleyen rapor kısa yoklaması · §7 alt satır listesi bulut aynası.
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type React from "react";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { REPORT_STATUSES } from "../src/api/wire";

const mockApi = { snapshot: jest.fn(), list: jest.fn(), record: jest.fn(), reportGet: jest.fn(), reportCancel: jest.fn(), reportList: jest.fn() };
const mockCache = {
  load: jest.fn(async (_k: string, f: () => Promise<unknown>) => ({ data: await f(), offline: false, savedAt: "2026-10-22T09:00:00.000Z" })),
  peek: jest.fn(async () => null),
};
const mockSession = {
  api: mockApi, cache: mockCache, markOnline: jest.fn(), permissions: [] as string[], offline: false, offlineSince: null,
  facility: null, facilities: [], switchError: null, factoryStamp: "2026-10-22T08:55:00Z",
};
const mockParams: { value: Record<string, string> } = { value: {} };
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn(), canGoBack: () => true };
jest.mock("../src/state/session", () => ({ useSession: () => mockSession }));
jest.mock("expo-router", () => ({ useRouter: () => mockRouter, usePathname: () => "/finans", useLocalSearchParams: () => mockParams.value }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

// mock'lar kurulduktan SONRA yüklenir.
const Finance = (require("../app/(app)/(tabs)/finans") as { default: () => React.ReactElement }).default;
const ReportDetail = (require("../app/(app)/raporlar/[id]") as { default: () => React.ReactElement }).default;
const RecordDetail = (require("../app/(app)/kayit/[projeksiyon]/[id]") as { default: () => React.ReactElement }).default;
const { ReceivableHero, ChequeDue } = require("../src/ui/finans/FinanceSummary") as typeof import("../src/ui/finans/FinanceSummary");
const rows = require("../src/ui/finans/rows") as typeof import("../src/ui/finans/rows");
const { ProjectionList } = require("../src/ui/data") as typeof import("../src/ui/data");
const { ReportStatusBadge } = require("../src/ui/raporlar/parts") as typeof import("../src/ui/raporlar/parts");
const { usePendingPoll, PENDING_POLL_MS } = require("../src/ui/raporlar/usePendingPoll") as typeof import("../src/ui/raporlar/usePendingPoll");
const { periodText } = require("../src/ui/raporlar/periods") as typeof import("../src/ui/raporlar/periods");
const { invalidate } = require("../src/state/changes") as typeof import("../src/state/changes");
const labels = require("../src/lib/labels/finans") as typeof import("../src/lib/labels/finans");

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const OZET = {
  kasalar: [], bankalar: [], cekDurum: [],
  cekVade: [
    { kova: "OVERDUE", tur: "RECEIVED", doviz: "TRY", adet: 2, tutar: "1500.00" },
    { kova: "SOON", tur: "RECEIVED", doviz: "TRY", adet: 1, tutar: "250.00" },
    { kova: "LATER", tur: "ISSUED", doviz: "USD", adet: 3, tutar: "900.00" },
  ],
  yaslandirma: [
    { doviz: "TRY", kovalar: { notDue: "1000.00", d0_30: "200.50", d31_60: "50.00", d61_90: "0.00", d90plus: "0.00", noDueDate: "0.00" }, acikToplam: "1250.50", gecikmis: "250.50", avans: "10.00" },
    { doviz: "USD", kovalar: { notDue: "300.00", d0_30: "0.00", d31_60: "0.00", d61_90: "0.00", d90plus: "0.00", noDueDate: "0.00" }, acikToplam: "300.00", gecikmis: "0.00", avans: "0.00" },
  ],
};
const page = (kayitlar: unknown[]) => ({ kayitlar, sonraki: null });

async function flush() {
  await act(async () => undefined);
  await act(async () => undefined);
}

beforeEach(() => {
  for (const f of Object.values(mockApi)) f.mockReset();
  mockApi.snapshot.mockImplementation(async (p: string) => ({ projeksiyon: p, veri: p === "ozet-finans" ? OZET : { raporlar: [] }, surum: "1" }));
  mockApi.list.mockImplementation(async () => page([]));
  mockSession.permissions = [];
  mockSession.offline = false;
  mockParams.value = {};
});

describe("§1 izinsiz finans segmenti ve alanı çizilmez", () => {
  it("yalnız izinli segmentler; özet izni yoksa özet istenmez", async () => {
    mockSession.permissions = ["bulut:kasa:oku", "bulut:fatura:oku"];
    render(<Finance />);
    await flush();
    expect(screen.getByTestId("sekme-kasa")).toBeTruthy();
    expect(screen.getByTestId("sekme-fatura")).toBeTruthy();
    expect(screen.queryByTestId("sekme-cek")).toBeNull();
    expect(screen.queryByTestId("sekme-tahsilat")).toBeNull();
    expect(screen.queryByTestId("finans-alacak")).toBeNull();
    expect(mockApi.snapshot).not.toHaveBeenCalledWith("ozet-finans");
    fireEvent.press(screen.getByTestId("sekme-fatura"));
    await flush();
    expect(mockApi.list).toHaveBeenLastCalledWith("fatura", expect.objectContaining({ limit: 50 }));
  });

  it("özet izniyle alacak kahramanı; çek izni yoksa çek vadeleri çizilmez", async () => {
    mockSession.permissions = ["bulut:cari-bakiye:oku"];
    render(<Finance />);
    await flush();
    expect(screen.getByTestId("finans-alacak")).toBeTruthy();
    expect(screen.queryByTestId("finans-cek-vade")).toBeNull();
    expect(screen.queryByTestId("sekme-kasa")).toBeNull();
  });

  it("alt satır (`.finans`) yoksa liste tutarı basmaz, kilit gösterir", async () => {
    mockSession.permissions = ["bulut:kasa:oku"];
    mockApi.list.mockImplementation(async (p: string) =>
      p === "kasa" ? page([{ id: U(1), kayit: { ad: "Merkez kasa", kod: "K1", doviz: "TRY" }, surum: "1" }]) : page([]),
    );
    render(<Finance />);
    await flush();
    expect(screen.getByText("Merkez kasa")).toBeTruthy();
    expect(screen.getByTestId(`kilit-${U(1)}`).props.accessibilityLabel).toBe("Bu alanı görme iznin yok");
    expect(screen.queryByText(/₺/)).toBeNull();
  });

  it("jenerik kayıt: finans alt satırı taşıyan projeksiyonda alt satır yoksa kilit; tutar yok", async () => {
    mockParams.value = { projeksiyon: "fatura", id: U(2) };
    mockApi.record.mockResolvedValue({ id: U(2), kayit: { belgeNo: "FT-1", doviz: "EUR", tarih: "2026-10-01" }, surum: "1" });
    render(<RecordDetail />);
    await flush();
    expect(screen.getByTestId("kayit-tutarlar-kilitli")).toBeTruthy();
    expect(screen.getByText("Bu alanı görme iznin yok")).toBeTruthy();
    expect(screen.queryByTestId("kayit-tutarlar")).toBeNull();
  });
});

describe("§2 her tutar para birimli (fabrikanın değeri; uygulama hesaplamaz)", () => {
  it("alacak kahramanı: döviz ayrı satır, toplam/gecikmiş/avans/kovalar fabrikanın dizisinden", () => {
    render(<ReceivableHero veri={OZET} />);
    expect(screen.getByText("1.250,5 ₺")).toBeTruthy();
    expect(screen.getAllByText("300 $").length).toBe(2); // toplam + "vadesi gelmemiş" kovası
    expect(screen.getByText("250,5 ₺")).toBeTruthy(); // gecikmiş — fabrikanın, kovaların toplamı DEĞİL
    expect(screen.getByText("200,5 ₺")).toBeTruthy(); // 0–30 kovası
    expect(screen.getByTestId("alacak-TRY")).toBeTruthy();
    expect(screen.getByTestId("alacak-USD")).toBeTruthy();
    // Net/borç anlıkta yok → uydurulmaz.
    expect(screen.queryByText(/Net/)).toBeNull();
  });

  it("çek vadeleri (tür, döviz) grubunda, kova adı + adet + para birimli tutar", () => {
    render(<ChequeDue veri={OZET} />);
    expect(screen.getByText("Vadesi geçmiş (2)")).toBeTruthy();
    expect(screen.getByText("1.500 ₺")).toBeTruthy();
    expect(screen.getByText("900 $")).toBeTruthy();
    expect(screen.getByTestId("cek-vade-ISSUED-USD")).toBeTruthy();
  });

  it("liste satırları: tutar `.finans`ten, para birimi kaydın dövizinden; yön işareti yalnız gösterim", () => {
    const kasa = rows.kasaRow({ id: U(1), kayit: { ad: "K", doviz: "TRY" }, finans: { bakiye: "1000.00" }, surum: "1" });
    expect(kasa.value).toBe("1.000 ₺");
    const fat = rows.faturaRow({ id: U(2), kayit: { belgeNo: "F", doviz: "USD", tur: "SALES", vadesiGecti: true }, finans: { genelToplam: "12.5" }, surum: "1" });
    expect(fat.value).toBe("12,5 $");
    expect(fat.valueTone).toBe("kritik");
    expect(fat.subtitle).toContain("Satış faturası");
    const out = rows.tahsilatRow({ id: U(3), kayit: { belgeNo: "T", doviz: "EUR", yon: "OUT", yontem: "BANK_TRANSFER" }, finans: { tutar: "50" }, surum: "1" });
    expect(out.value).toBe("− 50 €");
    expect(out.subtitle).toContain("Havale/EFT");
    const cek = rows.cekRow({ id: U(4), kayit: { belgeNo: "C", doviz: "TRY", tur: "RECEIVED", belgeTuru: "CHEQUE", durum: "BOUNCED" }, finans: { tutar: "1" }, surum: "1" });
    expect(cek.subtitle).toContain("Alınan çek");
    expect(cek.subtitle).toContain("Karşılıksız");
    // Döviz bilinmiyorsa simge uydurulmaz.
    expect(rows.financeAmount({ id: U(5), kayit: {}, finans: { tutar: "5" }, surum: "1" }, "tutar")).toBe("5");
  });

  it("jenerik kayıt: `.finans` tutarları kaydın dövizi ile, `…Tl` ₺, kur düz sayı", async () => {
    mockParams.value = { projeksiyon: "fatura", id: U(6) };
    mockApi.record.mockResolvedValue({ id: U(6), kayit: { belgeNo: "FT-9", doviz: "USD" }, finans: { genelToplam: "100.00", genelToplamTl: "3400.00", kur: "34.0000" }, surum: "1" });
    render(<RecordDetail />);
    await flush();
    expect(screen.getByText("100 $")).toBeTruthy();
    expect(screen.getByText("3.400 ₺")).toBeTruthy();
    expect(screen.getByText("34")).toBeTruthy();
    expect(screen.getByText("Genel toplam")).toBeTruthy();
  });

  it("finans kaynağında aritmetik ve düz sayı biçimi yok", () => {
    const dir = join(__dirname, "../src/ui/finans");
    const files = [...readdirSync(dir).map((f) => join(dir, f)), join(__dirname, "../app/(app)/(tabs)/finans.tsx")];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/toFixed|\* 100|\/ 100|formatNumber|\.reduce\(/);
    }
  });
});

describe("§3 rapor durumu ve başlığı sözlükten", () => {
  it("her REPORT_STATUSES değeri Türkçe etiket + beklenen ton", () => {
    const tone = { HAZIR: "iyi", HESAPLANIYOR: "bilgi", HATA: "kritik", BEKLIYOR: "uyari", IPTAL: "bilgi" } as const;
    for (const s of REPORT_STATUSES) {
      expect(labels.REPORT_STATUS[s].label).not.toBe(s);
      expect(labels.REPORT_STATUS[s].tone).toBe(tone[s]);
    }
  });
  it("rozet sözlük etiketini basar; hesaplanırken nabız", () => {
    render(<ReportStatusBadge status="HESAPLANIYOR" testID="r" />);
    expect(screen.getByText("Hesaplanıyor")).toBeTruthy();
    expect(screen.getByLabelText("Hesaplanıyor")).toBeTruthy();
  });
  it("başlık: katalogdaki ad önce, sözlük yedek; ham anahtar ekrana basılmaz", () => {
    expect(labels.reportTitle("finance/aging", [{ anahtar: "finance/aging", baslik: "Cari Yaşlandırma" }])).toBe("Cari Yaşlandırma");
    expect(labels.reportTitle("finance/aging")).toBe("Alacak yaşlandırma");
    expect(labels.reportTitle("x/y")).toBe("Rapor");
    for (const k of Object.keys(require("../src/lib/reports").REPORT_KEY_PERMISSION)) expect(labels.REPORT_TITLE[k]).toBeTruthy();
  });
});

describe("§4 rapor isteği iptali iki adım", () => {
  it("ilk dokunuş sorar, ikincisi uygular; başlık sözlükten", async () => {
    mockSession.permissions = ["bulut:rapor:oku"];
    mockParams.value = { id: U(7) };
    mockApi.reportGet.mockResolvedValue({ id: U(7), raporAnahtari: "finance/aging", aile: "finance", parametreler: { dateFrom: "2026-09-01" }, durum: "BEKLIYOR", hataKodu: null, olusturulma: "2026-10-22T09:00:00Z", tamamlanma: null, sonuc: null });
    mockApi.reportCancel.mockResolvedValue({});
    render(<ReportDetail />);
    await flush();
    expect(screen.getAllByText("Alacak yaşlandırma").length).toBeGreaterThan(0);
    expect(screen.getByText("Bekliyor")).toBeTruthy();
    expect(screen.getByText("01.09.2026")).toBeTruthy();
    fireEvent.press(screen.getByTestId("rapor-iptal"));
    expect(mockApi.reportCancel).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId("rapor-iptal-evet"));
    await flush();
    expect(mockApi.reportCancel).toHaveBeenCalledTimes(1);
    expect(mockApi.reportCancel).toHaveBeenCalledWith(U(7));
  });
  it("HAZIR istekte iptal düğmesi yok, sonuç çizilir", async () => {
    mockSession.permissions = ["bulut:rapor:oku"];
    mockParams.value = { id: U(8) };
    mockApi.reportGet.mockResolvedValue({ id: U(8), raporAnahtari: "inventory/scorecard", aile: "inventory", parametreler: {}, durum: "HAZIR", hataKodu: null, olusturulma: "2026-10-22T09:00:00Z", tamamlanma: "2026-10-22T09:01:00Z", sonuc: { veri: { toplam: 3 }, hesaplandi: "2026-10-22T09:01:00Z", kaynakUfuk: null } });
    render(<ReportDetail />);
    await flush();
    expect(screen.queryByTestId("rapor-iptal")).toBeNull();
    expect(screen.getByTestId("rapor-sonuc")).toBeTruthy();
  });
});

describe("§5 liste ilk sayfası etiket geçersizleştirmesiyle tazelenir", () => {
  it("invalidate([projeksiyon]) listeyi yeniden çeker; başka etiket çekmez", async () => {
    mockApi.list.mockImplementation(async () => page([{ id: U(9), kayit: { ad: "A" }, surum: "1" }]));
    render(<ProjectionList projection="kasa" compact />);
    await flush();
    expect(mockApi.list).toHaveBeenCalledTimes(1);
    act(() => invalidate(["fatura"]));
    await flush();
    expect(mockApi.list).toHaveBeenCalledTimes(1);
    act(() => invalidate(["kasa"]));
    await flush();
    expect(mockApi.list).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId(`kayit-${U(9)}`)).toBeTruthy();
  });
});

describe("§6 bekleyen rapor kısa yoklaması", () => {
  function Probe({ pending, reload }: { pending: boolean; reload: () => void }) {
    usePendingPoll(pending, reload);
    return null;
  }
  it("3 → 6 → 10 sn adımlarla yükler; kesinleşince durur; en çok ~2 dk", () => {
    jest.useFakeTimers();
    try {
      const reload = jest.fn();
      const r = render(<Probe pending reload={reload} />);
      act(() => jest.advanceTimersByTime(2_999));
      expect(reload).toHaveBeenCalledTimes(0);
      act(() => jest.advanceTimersByTime(1));
      expect(reload).toHaveBeenCalledTimes(1);
      act(() => jest.advanceTimersByTime(6_000));
      expect(reload).toHaveBeenCalledTimes(2);
      r.rerender(<Probe pending={false} reload={reload} />);
      act(() => jest.advanceTimersByTime(60_000));
      expect(reload).toHaveBeenCalledTimes(2);
      const total = PENDING_POLL_MS.reduce((a, b) => a + b, 0);
      expect(total).toBeLessThanOrEqual(125_000);
    } finally {
      jest.useRealTimers();
    }
  });
  it("dönem kısayolu metni fabrika gününden doldurur", () => {
    const now = new Date("2026-10-22T09:00:00Z");
    expect(periodText("bu-ay", now)).toEqual({ from: "01.10.2026", to: "22.10.2026" });
    expect(periodText("gecen-ay", now)).toEqual({ from: "01.09.2026", to: "30.09.2026" });
    expect(periodText("son-30-gun", now)).toEqual({ from: "23.09.2026", to: "22.10.2026" });
    expect(periodText("ozel", now)).toBeNull();
  });
});

describe("§7 finans alt satırı listesi bulut kataloğunun aynası", () => {
  it("`subRows` içinde finans olan her projeksiyon listede, fazlası yok", () => {
    const src = readFileSync(join(__dirname, "../../sunucu/src/catalog/projections.ts"), "utf8");
    const found: string[] = [];
    const re = /name: "([^"]+)"[\s\S]*?(?=\n\s*\{\s*name:|\n\s*\{\n\s*name:|\n\];)/g;
    for (const m of src.matchAll(re)) if (/subRows: \[[^\]]*"finans"/.test(m[0])) found.push(m[1]!);
    expect(found.length).toBeGreaterThan(5);
    expect([...labels.FINANCE_SUBROW_PROJECTIONS].sort()).toEqual([...new Set(found)].sort());
  });
});
