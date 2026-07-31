import { renderHook, act } from "@testing-library/react-native";

// Bayrak kaynağı mock'lanır — burada test edilen ŞEY React Query değil, "izin ∖
// bayrak" elemesi. (Mock import'lardan ÖNCE tanımlanmalı.)
let mockKursunBypassEnabled = false;
jest.mock("./useFeatureFlags", () => ({
  useKursunBypassEnabled: () => mockKursunBypassEnabled,
}));

import { useVisibleScreens } from "./useVisibleScreens";
import { useAuthStore } from "../store/authStore";
import { MOBILE_SCREENS } from "../types/permissions";

// authStore.user tipi JwtPayload — testte yalnız permissions okunur; minimal cast.
function setPerms(permissions: string[]) {
  act(() => useAuthStore.setState({ user: { permissions } as never }));
}
const keys = () => renderHook(() => useVisibleScreens()).result.current.visibleScreens.map((s) => s.key);

// =============================================================================
// Korunan davranışlar:
//   1. Bayrak kapalı → Kurşun Dağıtım ELENİR, diğer izinli ekranlar dokunulmaz
//   2. Bayrak açık → ekran izinle birlikte görünür
//   3. TEK yetkisi Kurşun Dağıtım olan kullanıcı, bayrak kapalıyken SIFIR görünür
//      ekrana düşer (MainNavigator bunu ModuleSelect'e çevirir — gizli ekrana
//      zorla girilmemesinin garantisi)
// =============================================================================
describe("useVisibleScreens (izin ∖ bayrağı kapalı ekranlar)", () => {
  afterEach(() => {
    mockKursunBypassEnabled = false;
    act(() => useAuthStore.setState({ user: null }));
  });

  it("bayrak kapalıyken Kurşun Dağıtım elenir, diğer ekranlar kalır", () => {
    setPerms(["mobile:*"]);
    const visible = keys();
    expect(visible).not.toContain("KursunDagitim");
    expect(visible).toHaveLength(MOBILE_SCREENS.length - 1);
    expect(visible).toContain("KursunQc");
  });

  it("bayrak açıkken Kurşun Dağıtım görünür", () => {
    mockKursunBypassEnabled = true;
    setPerms(["mobile:*"]);
    const visible = keys();
    expect(visible).toContain("KursunDagitim");
    expect(visible).toHaveLength(MOBILE_SCREENS.length);
  });

  it("yetki yoksa bayrak açık olsa da görünmez", () => {
    mockKursunBypassEnabled = true;
    setPerms(["mobile:depo"]);
    expect(keys()).toEqual(["Depo"]);
  });

  it("tek yetkisi Kurşun Dağıtım + bayrak kapalı → sıfır görünür ekran", () => {
    setPerms(["mobile:kursun-dagitim"]);
    const { result } = renderHook(() => useVisibleScreens());
    expect(result.current.visibleScreens).toHaveLength(0);
    expect(result.current.hasAnyVisibleScreen).toBe(false);
    expect(result.current.hasMultipleVisibleScreens).toBe(false);
  });

  it("tek yetkisi Kurşun Dağıtım + bayrak açık → tek görünür ekran (doğrudan açılır)", () => {
    mockKursunBypassEnabled = true;
    setPerms(["mobile:kursun-dagitim"]);
    const { result } = renderHook(() => useVisibleScreens());
    expect(result.current.visibleScreens.map((s) => s.key)).toEqual(["KursunDagitim"]);
    expect(result.current.hasMultipleVisibleScreens).toBe(false);
  });
});
