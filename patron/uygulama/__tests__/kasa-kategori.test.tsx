// D4-KUC3c — Finans › Kasa: kasa hareketleri + kategori süzgeci; anlık 404 boş durumu.
// §1 SnapshotGate: 404 → boş durum (hata değil) · başka hata → "Tekrar dene"
// §2 ⭐ süzgeç SUNUCUDA: çipten seçilen fabrika anahtarı `kategoriAnahtari` olarak gider; istemci gelen satırı süzmez
// §3 Masraf'ta anahtarlı kategoriye dokunmak Kasa listesini o kategoriyle açar; "Diğer" dokunulamaz
// §4 eski sunucu (yetenek yok): çip yok, parametre gitmez, masraf satırı dokunulamaz · §5 eski fabrika: "güncellenince gelir"
// ⭐ NEGATİF SONDA (ölçüldü 2026-11-01): ProjectionList satırları istemcide `kategori` ile süzdü → §2b ❌;
//    SnapshotGate'te notFound denetimi kaldırıldı → §1a + §1c ❌; geri alındı → 8/8 yeşil.
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type React from "react";
import { Text } from "react-native";

const mockApi = { snapshot: jest.fn(), list: jest.fn(), record: jest.fn() };
const mockCache = {
  load: jest.fn(async (_k: string, f: () => Promise<unknown>) => ({ data: await f(), offline: false, savedAt: "2026-10-31T09:00:00.000Z" })),
  peek: jest.fn(async () => null),
};
const NEW_SERVER = { liste: { kimlikSuzgecleri: {}, aranabilir: [], anahtarSuzgecleri: { kategoriAnahtari: ["kasa-hareketi"] } } };
const OLD_SERVER = { liste: { kimlikSuzgecleri: {}, aranabilir: [] } };
const mockSession = {
  api: mockApi, cache: mockCache, markOnline: jest.fn(), permissions: ["bulut:kasa:oku"] as string[], offline: false, offlineSince: null,
  facility: NEW_SERVER as unknown, facilities: [], switchError: null, factoryStamp: "2026-10-31T08:55:00Z",
};
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn(), canGoBack: () => true };
jest.mock("../src/state/session", () => ({ useSession: () => mockSession }));
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  usePathname: () => "/finans",
  useLocalSearchParams: () => ({}),
  useFocusEffect: (cb: () => void | (() => void)) => (require("react") as typeof import("react")).useEffect(() => cb(), [cb]),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const Finance = (require("../app/(app)/(tabs)/finans") as { default: () => React.ReactElement }).default;
const { SnapshotGate } = require("../src/ui/pano/SnapshotGate") as typeof import("../src/ui/pano/SnapshotGate");
const { ApiError } = require("../src/api/client") as typeof import("../src/api/client");

const ay = [{ ay: "2026-10", tutar: "10.00" }];
const row = (etiket: string, key: string | null | undefined, digerMi = false) => ({
  etiket, ...(key !== undefined ? { kategoriAnahtari: key } : {}), digerMi, kategoriSayisi: 1, toplam: "10.00", buAy: "10.00", gecenAy: "0.00", fark: "10.00", buAyPay: 50, aylik: ay,
});
const summary = (rows: unknown[]) => ({
  aylar: ["2026-10"], buAy: "2026-10", gecenAy: "2026-09", toplam: "20.00", buAyToplam: "20.00", gecenAyToplam: "0.00", fark: "20.00", aylikToplam: ay, kategoriler: rows,
});
const NEW_FACTORY = summary([row("Maaş", "CAT:Maaş"), row("Kira", "CAT:Kira"), row("Diğer", null, true)]);
const OLD_FACTORY = summary([row("Maaş", undefined), row("Kira", undefined)]);
const tx = (id: string, kategori: string) => ({ id, kayit: { id, belgeNo: id, tur: "EXPENSE", yon: "OUT", durum: "ACTIVE", doviz: "TRY", tarih: "2026-10-30T09:00:00.000Z", kategori }, surum: "2026-10-31T08:55:00.000Z" });

async function flush() {
  await act(async () => undefined);
  await act(async () => undefined);
}

const listCalls = () => mockApi.list.mock.calls.filter((c) => c[0] === "kasa-hareketi").map((c) => (c[1] as { kategoriAnahtari?: string }).kategoriAnahtari);

beforeEach(() => {
  for (const f of Object.values(mockApi)) f.mockReset();
  mockSession.facility = NEW_SERVER;
  mockApi.snapshot.mockImplementation(async (p: string) => ({ projeksiyon: p, veri: p === "ozet-masraf" ? NEW_FACTORY : {}, surum: "2026-10-31T08:55:00.000Z" }));
  // Sunucu ne dönerse o: "Maaş" süzgecinde bile başka kategorili satır dönerse istemci onu GİZLEMEZ (süzme sunucuda).
  mockApi.list.mockImplementation(async (p: string, q: { kategoriAnahtari?: string }) =>
    p === "kasa-hareketi" ? { kayitlar: q.kategoriAnahtari ? [tx("kh-1", "Maaş"), tx("kh-2", "Kira")] : [tx("kh-1", "Maaş"), tx("kh-2", "Kira"), tx("kh-3", "Yakıt")], sonraki: null } : { kayitlar: [], sonraki: null });
});

describe("§1 SnapshotGate 404 → boş durum", () => {
  const remote = (over: object) => ({ data: null, error: null, loading: false, refreshing: false, stale: false, offline: false, savedAt: null, reload: jest.fn(), ...over });
  it("§1a 404 (notFound) hata değil, boş durum metni", () => {
    render(<SnapshotGate remote={remote({ error: "Anlık görüntü bulunamadı", notFound: true })} domain="finans" empty="Henüz gelmedi" testID="g">{() => <Text>içerik</Text>}</SnapshotGate>);
    expect(screen.getByTestId("g-bos")).toBeTruthy();
    expect(screen.getByText("Henüz gelmedi")).toBeTruthy();
    expect(screen.queryByTestId("g-hata")).toBeNull();
  });
  it("§1b başka hata → Tekrar dene", () => {
    render(<SnapshotGate remote={remote({ error: "Sunucu hatası" })} domain="finans" testID="g">{() => <Text>içerik</Text>}</SnapshotGate>);
    expect(screen.getByTestId("g-hata")).toBeTruthy();
  });
  it("§1c gerçek 404 akışı: useRemote notFound'u taşır (Masraf segmenti boş durum)", async () => {
    mockApi.snapshot.mockImplementation(async () => { throw new ApiError(404, "BULUNAMADI", "Anlık görüntü bulunamadı"); });
    render(<Finance />);
    await flush();
    fireEvent.press(screen.getByTestId("sekme-masraf"));
    await flush();
    expect(screen.getByTestId("masraf-ozeti-bos")).toBeTruthy();
    expect(screen.queryByTestId("masraf-ozeti-hata")).toBeNull();
  });
});

describe("§2 Kasa: kategori süzgeci sunucuda", () => {
  it("§2a çip seçenekleri fabrikanın anahtarlı kategorileri ('Diğer' yok)", async () => {
    render(<Finance />);
    await flush();
    expect(screen.getByText("Kasa hareketleri")).toBeTruthy();
    fireEvent.press(screen.getByTestId("kasa-kategori"));
    expect(screen.getByTestId("kasa-kategori-CAT:Maaş")).toBeTruthy();
    expect(screen.getByTestId("kasa-kategori-CAT:Kira")).toBeTruthy();
    expect(screen.queryByText("Diğer")).toBeNull();
    expect(listCalls()).toEqual([undefined]);
  });
  it("§2b ⭐ seçim anahtarı sunucuya gider; dönen satırlar süzülmeden çizilir", async () => {
    render(<Finance />);
    await flush();
    fireEvent.press(screen.getByTestId("kasa-kategori"));
    fireEvent.press(screen.getByTestId("kasa-kategori-CAT:Maaş"));
    await flush();
    expect(listCalls().at(-1)).toBe("CAT:Maaş");
    expect(screen.getByTestId("kayit-kh-1")).toBeTruthy();
    expect(screen.getByTestId("kayit-kh-2")).toBeTruthy();
    expect(screen.queryByTestId("kayit-kh-3")).toBeNull();
    fireEvent.press(screen.getByTestId("kasa-kategori"));
    fireEvent.press(screen.getByTestId("kasa-kategori-tumu"));
    await flush();
    expect(listCalls().at(-1)).toBeUndefined();
  });
});

describe("§3 Masraf → Kasa geçişi", () => {
  it("anahtarlı kategoriye dokununca Kasa listesi o anahtarla; 'Diğer' dokunulamaz", async () => {
    render(<Finance />);
    await flush();
    fireEvent.press(screen.getByTestId("sekme-masraf"));
    await flush();
    expect(screen.getByTestId("masraf-kategori-2-Diğer").props.accessibilityRole).not.toBe("button");
    fireEvent.press(screen.getByTestId("masraf-kategori-1-Kira"));
    await flush();
    expect(screen.getByText("Kasa hareketleri")).toBeTruthy();
    expect(listCalls().at(-1)).toBe("CAT:Kira");
    expect(screen.getByText("Kategori: Kira")).toBeTruthy();
  });
});

describe("§4–§5 eski sunucu / eski fabrika", () => {
  it("§4 eski sunucu: çip yok, parametre gitmez, özet istenmez, masraf satırı dokunulamaz", async () => {
    mockSession.facility = OLD_SERVER;
    render(<Finance />);
    await flush();
    expect(screen.queryByTestId("kasa-kategori")).toBeNull();
    expect(listCalls()).toEqual([undefined]);
    expect(mockApi.snapshot).not.toHaveBeenCalledWith("ozet-masraf");
    fireEvent.press(screen.getByTestId("sekme-masraf"));
    await flush();
    const before = listCalls().length;
    fireEvent.press(screen.getByTestId("masraf-kategori-0-Maaş"));
    await flush();
    expect(listCalls().length).toBe(before);
    expect(screen.queryByText("Kasa hareketleri")).toBeNull();
  });
  it("§5 eski fabrika (anahtarsız özet): çip yok, 'fabrika güncellenince gelir'", async () => {
    mockApi.snapshot.mockImplementation(async (p: string) => ({ projeksiyon: p, veri: p === "ozet-masraf" ? OLD_FACTORY : {}, surum: "2026-10-31T08:55:00.000Z" }));
    render(<Finance />);
    await flush();
    expect(screen.queryByTestId("kasa-kategori")).toBeNull();
    expect(screen.getByTestId("kasa-kategori-sonra")).toBeTruthy();
  });
});
