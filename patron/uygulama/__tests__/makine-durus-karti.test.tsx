// D4-A4b: Üretim sekmesi "Makineler neden durdu?" kartı — katalogda anahtar varsa rapor isteme rotası,
// yoksa "fabrika güncellenince gelir" boş durumu; izin yoksa kart yok ve katalog çekilmez.
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type React from "react";
import { createCache } from "../src/state/cache";

function mockMem() {
  const m = new Map<string, string>();
  return {
    get: async (k: string) => m.get(k) ?? null,
    set: async (k: string, v: string) => void m.set(k, v),
    remove: async (k: string) => void m.delete(k),
    keys: async () => [...m.keys()],
    removeMany: async (ks: readonly string[]) => ks.forEach((k) => m.delete(k)),
  };
}

const KEY = "production/makine-duruslari";
let mockCatalog: unknown[] = [];
const mockApi = {
  snapshot: jest.fn(async (p: string) => ({ projeksiyon: p, veri: p === "rapor-katalogu" ? { raporlar: mockCatalog } : {}, surum: "1" })),
};
const mockSession = {
  api: mockApi,
  cache: null as ReturnType<typeof createCache> | null,
  markOnline: jest.fn(),
  permissions: [] as string[],
};
const mockRouter = { navigate: jest.fn(), push: jest.fn(), back: jest.fn(), canGoBack: () => false, replace: jest.fn() };
jest.mock("../src/state/session", () => ({ useSession: () => mockSession }));
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  usePathname: () => "/uretim",
  useFocusEffect: (cb: () => unknown) => require("react").useEffect(() => cb(), [cb]),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const { MachineStopsCard } = require("../src/ui/pano/MachineStopsCard") as typeof import("../src/ui/pano/MachineStopsCard");
const Card = MachineStopsCard as () => React.ReactElement | null;

const ALLOWED = ["bulut:oturum", "bulut:rapor:oku", "bulut:uretim:oku"];

beforeEach(() => {
  mockSession.cache = createCache(mockMem(), "t1:h1", () => new Date("2026-10-30T09:00:00Z"));
  mockApi.snapshot.mockClear();
  mockRouter.push.mockClear();
  mockCatalog = [];
});

describe("Makineler neden durdu? kartı", () => {
  it("§1 katalogda anahtar varken kart görünür ve rapor isteme rotasını açar", async () => {
    mockSession.permissions = ALLOWED;
    mockCatalog = [{ anahtar: KEY, baslik: "Makine duruşları", aile: "production", parametreler: ["dateFrom", "dateTo"], soru: "Makineler neden durdu?" }];
    render(<Card />);
    fireEvent.press(await screen.findByTestId(`katalog-${KEY}`));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/raporlar/yeni", params: { anahtar: KEY } });
    expect(screen.queryByTestId("makine-duruslari-yok")).toBeNull();
  });

  it("§2 katalogda anahtar yoksa 'fabrika güncellenince gelir' boş durumu", async () => {
    mockSession.permissions = ALLOWED;
    mockCatalog = [{ anahtar: "dokuma/duruslar", baslik: "Duruşlar", aile: "dokuma", parametreler: [] }];
    render(<Card />);
    expect(await screen.findByTestId("makine-duruslari-yok")).toBeTruthy();
    expect(screen.getByText(/fabrika güncellenince gelir/)).toBeTruthy();
    expect(screen.queryByTestId(`katalog-${KEY}`)).toBeNull();
  });

  it("§2b katalog hata verirse ayrı metin ve 'Tekrar dene' yeniden çeker", async () => {
    mockSession.permissions = ALLOWED;
    mockApi.snapshot.mockRejectedValueOnce(new Error("ağ yok"));
    render(<Card />);
    expect(await screen.findByTestId("makine-duruslari-katalog-hata")).toBeTruthy();
    expect(screen.queryByTestId("makine-duruslari-yok")).toBeNull();
    mockCatalog = [{ anahtar: KEY, baslik: "Makine duruşları", aile: "production", parametreler: [] }];
    fireEvent.press(screen.getByText("Tekrar dene"));
    expect(await screen.findByTestId(`katalog-${KEY}`)).toBeTruthy();
  });

  it("§3 requestable false (rapor ya da üretim izni yok) iken kart kapalı ve katalog çekilmez", async () => {
    for (const perms of [["bulut:oturum", "bulut:uretim:oku"], ["bulut:oturum", "bulut:rapor:oku"]]) {
      mockSession.permissions = perms;
      mockCatalog = [{ anahtar: KEY, baslik: "Makine duruşları", aile: "production", parametreler: [] }];
      const view = render(<Card />);
      await act(async () => undefined);
      expect(screen.queryByTestId("bolum-makine-duruslari")).toBeNull();
      expect(screen.queryByTestId(`katalog-${KEY}`)).toBeNull();
      view.unmount();
    }
    expect(mockApi.snapshot).not.toHaveBeenCalled();
  });
});
