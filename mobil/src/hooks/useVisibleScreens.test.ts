import { renderHook, act } from "@testing-library/react-native";

import { useVisibleScreens } from "./useVisibleScreens";
import { useAuthStore } from "../store/authStore";
import { MOBILE_SCREENS } from "../types/permissions";
import { SCREEN_MODULE } from "../constants/screenModules";

// Bayrak hook'u MOCK: gerçek hook React Query ister; burada ölçülen şey koşul
// elemesinin bayrağa NASIL bağlandığıdır, sorgunun kendisi değil.
let mockFlagsData: { productionEnabled?: boolean } | undefined;
jest.mock("./useFeatureFlags", () => ({
  useFeatureFlags: () => ({ data: mockFlagsData }),
}));

// authStore.user tipi JwtPayload — testte yalnız permissions okunur; minimal cast.
function setPerms(permissions: string[]) {
  act(() => useAuthStore.setState({ user: { permissions } as never }));
}
const keys = () =>
  renderHook(() => useVisibleScreens()).result.current.visibleScreens.map((s) => s.key);
const ALL = MOBILE_SCREENS.map((s) => s.key);
const PRODUCTION = Object.keys(SCREEN_MODULE);

// =============================================================================
// 2026-09-14: KOŞULLU EKRAN GERÇEK — tablet modül kapısı.
//
// 2026-08-05'ten beri koşul kümesi boştu (Kurşun Dağıtım bayraktan bağımsızlaştı).
// Tablette modül kapısı YOKTU: kapalı modülün kartı çiziliyor, tıklayan 403
// `MODULE_DISABLED` yiyordu. Koşul artık `SCREEN_MODULE` (kataloğun `modul`
// aynası) → bayrak. Üç sonda (1e): KAPALI → o modülün ekranları yok · AÇIK →
// bugünkü liste BİREBİR (diff 0) · bayrak OKUNAMADI → backend satır-yok yönü.
// Kurşun Dağıtım regresyon bekçisi KALIR: ekran kurşun BAYRAĞINA/sayaca değil
// yalnız ÜRETİM MODÜLÜNE bağlıdır.
// =============================================================================
describe("useVisibleScreens (izin ∖ modülü kapalı ekranlar)", () => {
  beforeEach(() => {
    mockFlagsData = { productionEnabled: true };
  });
  afterEach(() => {
    act(() => useAuthStore.setState({ user: null }));
  });

  it("⭐ AÇIK: izinli TÜM ekranlar görünür — bugünkü liste birebir (diff 0)", () => {
    setPerms(["mobile:*"]);
    expect(keys()).toEqual(ALL);
  });

  it("⭐ KAPALI: üretim modülünün beş ekranı elenir, çekirdek ekranlar kalır", () => {
    setPerms(["mobile:*"]);
    mockFlagsData = { productionEnabled: false };
    const visible = keys();
    for (const k of PRODUCTION) expect(visible).not.toContain(k);
    expect(visible).toEqual(ALL.filter((k) => !PRODUCTION.includes(k)));
    expect(visible).toContain("Depo");
    expect(visible).toContain("Sevkiyat");
  });

  it("⭐ bayrak OKUNAMADI (data yok): backend satır-yok yönü — üretim AÇIK, liste bugünkü", () => {
    setPerms(["mobile:*"]);
    mockFlagsData = undefined;
    expect(keys()).toEqual(ALL);
  });

  it("Kurşun Dağıtım kurşun bayrağı/sayaçtan BAĞIMSIZ, yalnız ÜRETİM modülüne bağlı (regresyon)", () => {
    setPerms(["mobile:kursun-dagitim"]);
    const { result } = renderHook(() => useVisibleScreens());
    expect(result.current.visibleScreens.map((s) => s.key)).toEqual(["KursunDagitim"]);
    expect(result.current.hasAnyVisibleScreen).toBe(true);
    expect(result.current.hasMultipleVisibleScreens).toBe(false);
    mockFlagsData = { productionEnabled: false };
    expect(keys()).toEqual([]);
  });

  it("modül kapısı yetkiyi GENİŞLETMEZ: kapalı modül + dar izin → yalnız izinli çekirdek ekran", () => {
    setPerms(["mobile:depo", "mobile:kk1"]);
    mockFlagsData = { productionEnabled: false };
    expect(keys()).toEqual(["Depo"]);
  });

  it("hiç yetki yoksa sıfır görünür ekran (modül açık olsa da)", () => {
    setPerms([]);
    const { result } = renderHook(() => useVisibleScreens());
    expect(result.current.visibleScreens).toHaveLength(0);
    expect(result.current.hasAnyVisibleScreen).toBe(false);
    expect(result.current.hasMultipleVisibleScreens).toBe(false);
  });
});
