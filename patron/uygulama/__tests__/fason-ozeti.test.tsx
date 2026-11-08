// PB1 — fason · emanet anlıkları: §1 Stok › müşteri malı (karne emanet satırı + müşteri başına bakiye) · §2 Üretim ›
// fasondaki işler (F10 kokpit özeti) · §3 Finans › Fatura üstünde hizmet geliri (dönem segmenti) · §4 eski fabrika
// (anlık 404 / alan yok) boş durum, çökme yok · §5 görünüm hesap yapmaz (rakam fabrikanınki, yalnız biçim).
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type React from "react";

const mockApi = { snapshot: jest.fn(), list: jest.fn(), record: jest.fn() };
const mockCache = {
  load: jest.fn(async (_k: string, f: () => Promise<unknown>) => ({ data: await f(), offline: false, savedAt: "2026-11-08T09:00:00.000Z" })),
  peek: jest.fn(async () => null),
};
const mockSession = {
  api: mockApi, cache: mockCache, markOnline: jest.fn(), permissions: [] as string[], offline: false, offlineSince: null,
  facility: null, facilities: [], switchError: null, factoryStamp: "2026-11-08T08:55:00Z",
};
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn(), canGoBack: () => true };
jest.mock("../src/state/session", () => ({ useSession: () => mockSession }));
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  usePathname: () => "/",
  useLocalSearchParams: () => ({}),
  useFocusEffect: (cb: () => void | (() => void)) => (require("react") as typeof import("react")).useEffect(() => cb(), [cb]),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const Stock = (require("../app/(app)/stok") as { default: () => React.ReactElement }).default;
const Production = (require("../app/(app)/(tabs)/uretim") as { default: () => React.ReactElement }).default;
const Finance = (require("../app/(app)/(tabs)/finans") as { default: () => React.ReactElement }).default;
const view = require("../src/lib/fason-summary") as typeof import("../src/lib/fason-summary");
const { areaSummary } = require("../src/ui/pano/read") as typeof import("../src/ui/pano/read");
const { ApiError } = require("../src/api/client") as typeof import("../src/api/client");

const C1 = "11111111-1111-4111-8111-111111111111";
const F1 = "22222222-2222-4222-8222-222222222222";
const H1 = "33333333-3333-4333-8333-333333333333";
const KARNE = {
  ozet: {
    bitmisMiktar: 5000, bitmisAdet: 50, hamMiktar: 2000, hamAdet: 20, yariMamulMiktar: 0, yariMamulAdet: 0, yasliMiktar: 0, oluMiktar: 0, oluStokGun: 90, yassizAdet: 0, yassizMiktar: 0,
    emanet: { bitmisMiktar: 300, bitmisAdet: 3, hamMiktar: 1240.5, hamAdet: 12, yariMamulMiktar: 0, yariMamulAdet: 0 },
  },
  yasKovalari: [], urunler: [],
};
const EMANET = {
  toplam: { topAdet: 15, topMiktar: 1540.5, iplikKg: "120.000", leventAdet: 2 },
  cariler: [{ cariKartId: C1, etiket: "Akın Tekstil", topAdet: 15, topMiktar: 1540.5, iplikKg: "120.000", leventAdet: 2 }],
};
const FASON = {
  acikSevk: 7, geciken: 2, yaklasan: 1, kalanMiktar: "3456.000", kirpildi: false,
  firmalar: [{ fasonFirmaId: F1, etiket: "Boyahane A", acikSevk: 4, geciken: 2, kalanMiktar: "2000.000", iplikKg: "0.000", leventAdet: 0 }],
};
const blok = (toplamTl: string) => ({ toplamTl, kalemler: toplamTl === "0.00" ? [] : [{ hizmetId: H1, etiket: "Kurşun 30 gr", miktar: "1500.000", birim: "m", tutarTl: toplamTl }] });
const GELIR = { bugun: blok("0.00"), buAy: blok("45000.00"), gecenAy: blok("38000.50"), son30Gun: blok("52000.00") };
const DATA: Record<string, unknown> = { "stok-karnesi": KARNE, "emanet-bakiye": EMANET, "fason-acik": FASON, "hizmet-geliri": GELIR };

async function flush() {
  await act(async () => undefined);
  await act(async () => undefined);
}

function serve(missing: readonly string[] = []) {
  mockApi.snapshot.mockImplementation(async (p: string) => {
    if (missing.includes(p) || !(p in DATA)) throw new ApiError(404, "BULUNAMADI", "Anlık görüntü bulunamadı");
    return { projeksiyon: p, veri: DATA[p], surum: "2026-11-08T08:55:00.000Z" };
  });
}

beforeEach(() => {
  for (const f of Object.values(mockApi)) f.mockReset();
  mockApi.list.mockImplementation(async () => ({ kayitlar: [], sonraki: null }));
  serve();
  mockSession.permissions = [];
});

describe("§1 Stok › müşteri malı", () => {
  it("karnenin emanet satırı + müşteri başına bakiye aynen", async () => {
    mockSession.permissions = ["bulut:stok:oku"];
    render(<Stock />);
    await flush();
    expect(screen.getByTestId("bolum-emanet")).toBeTruthy();
    expect(screen.getByText("1.241 m · 12 top")).toBeTruthy();
    expect(screen.getByText("Akın Tekstil")).toBeTruthy();
    expect(screen.getByText("1.541 m")).toBeTruthy();
    expect(screen.getByText("15 top · 120 kg iplik · 2 levent")).toBeTruthy();
  });

  it("emanet kullanmayan / eski fabrika: alan ve anlık yok → bölüm hiç çizilmez, çökme yok", async () => {
    mockSession.permissions = ["bulut:stok:oku"];
    DATA["stok-karnesi"] = { ...KARNE, ozet: { ...KARNE.ozet, emanet: undefined } };
    serve(["emanet-bakiye"]);
    render(<Stock />);
    await flush();
    expect(screen.getByTestId("kpi-bitmis")).toBeTruthy();
    expect(screen.queryByTestId("emanet-bolumu")).toBeNull();
    DATA["stok-karnesi"] = KARNE;
  });
});

describe("§2 Üretim › fasondaki işler", () => {
  it("açık sevk, gecikme, kalan ve firma satırı fabrikanın", async () => {
    mockSession.permissions = ["bulut:uretim:oku"];
    render(<Production />);
    await flush();
    expect(screen.getByText("7 açık sevk")).toBeTruthy();
    expect(screen.getByTestId("fason-acik-geciken").props.children).toBe("2 sevkin dönüşü gecikti");
    expect(screen.getByTestId("fason-acik-yaklasan").props.children).toBe("1 sevkin dönüşü yaklaşıyor");
    expect(screen.getByTestId("fason-acik-kalan").props.children).toBe("Fasonda 3.456 m kumaş");
    expect(screen.getByText("Boyahane A")).toBeTruthy();
    expect(screen.getByText("4 açık sevk · 2 gecikmiş")).toBeTruthy();
  });

  it("izinsiz hesapta istenmez; eski fabrika 404 → boş durum", async () => {
    mockSession.permissions = [];
    const first = render(<Production />);
    await flush();
    expect(mockApi.snapshot).not.toHaveBeenCalledWith("fason-acik");
    first.unmount();
    mockSession.permissions = ["bulut:uretim:oku"];
    serve(["fason-acik"]);
    render(<Production />);
    await flush();
    expect(screen.getByTestId("fason-acik-bos")).toBeTruthy();
    expect(screen.queryByTestId("fason-acik-hata")).toBeNull();
  });
});

describe("§3 Finans › Fatura › hizmet geliri", () => {
  it("bu ay varsayılan; dönem değişince fabrikanın o dönem bloğu", async () => {
    mockSession.permissions = ["bulut:fatura:oku"];
    render(<Finance />);
    await flush();
    expect(screen.getByTestId("hizmet-geliri-tutar").props.children).toBe("45.000 ₺");
    expect(screen.getByText("Kurşun 30 gr")).toBeTruthy();
    fireEvent.press(screen.getByTestId("gelir-donem-gecenAy"));
    await flush();
    expect(screen.getByTestId("hizmet-geliri-tutar").props.children).toBe("38.000,5 ₺");
    fireEvent.press(screen.getByTestId("gelir-donem-bugun"));
    await flush();
    expect(screen.getByTestId("hizmet-geliri-yok")).toBeTruthy();
  });

  it("eski fabrika (404) → boş durum, fatura listesi yine çizilir", async () => {
    mockSession.permissions = ["bulut:fatura:oku"];
    serve(["hizmet-geliri"]);
    render(<Finance />);
    await flush();
    expect(screen.getByTestId("hizmet-geliri-bos")).toBeTruthy();
    expect(screen.getByText("Faturalar")).toBeTruthy();
  });
});

describe("§4 bozuk / eksik şekil çökmez", () => {
  it("görünümler tanınmayan veride null", () => {
    expect(view.consignedView({ x: 1 })).toBeNull();
    expect(view.subcontractOpenView(null)).toBeNull();
    expect(view.serviceRevenueView({ buAy: {} }, "buAy")).toBeNull();
    expect(view.scorecardConsignedLines({})).toBeNull();
    expect(view.stockConsignedText({ bitmisMiktar: 1 })).toBeNull();
  });
  it("pano stok satırı: emanet varsa ek, yoksa eski metin aynen", () => {
    expect(areaSummary("ozet.stok", { bitmisMiktar: 100, oluMiktar: 0 })).toBe("Bitmiş 100 m · ölü 0 m");
    expect(areaSummary("ozet.stok", { bitmisMiktar: 100, oluMiktar: 0, emanet: { adet: 3, miktar: 250 } })).toBe("Bitmiş 100 m · ölü 0 m · müşteri malı 250 m");
  });
});

describe("§5 görünüm hesap yapmaz", () => {
  it("kapalı modül (null) ve sıfır alan yazılmaz; toplam fabrikadan", () => {
    const v = view.consignedView({ toplam: { topAdet: 2, topMiktar: 10, iplikKg: null, leventAdet: null }, cariler: [] })!;
    expect(v.totalLine).toBe("2 top");
    expect(v.totalValue).toBe("10 m");
    expect(view.subcontractOpenView({ ...FASON, geciken: 0 })!.late).toBe(false);
  });
});
