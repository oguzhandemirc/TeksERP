import { renderHook, act } from "@testing-library/react-native";

// Görünürlük kaynakları mock'lanır — burada test edilen ŞEY React Query değil,
// "izin ∖ koşulu sağlanmayan ekran" elemesi. (Mock import'lardan ÖNCE tanımlanmalı.)
let mockKursunBypassEnabled = false;
let mockPendingKursunAssignments = 0;
jest.mock("./useFeatureFlags", () => ({
  useKursunBypassEnabled: () => mockKursunBypassEnabled,
}));
jest.mock("./useKursunBypassVisibility", () => ({
  usePendingKursunAssignmentCount: () => mockPendingKursunAssignments,
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
// KOŞUL: Kurşun Dağıtım görünür ⇔ `bayrak AÇIK || bekleyen atama > 0`
//
// Korunan davranışlar:
//   1. Bayrak kapalı + bekleyen iş YOK → ekran ELENİR, diğer izinli ekranlar
//      dokunulmaz ("iş bitince kendiliğinden kaybolur")
//   2. Bayrak açık → ekran izinle birlikte görünür
//   3. Bayrak KAPALI ama bekleyen atama VAR → ekran GÖRÜNÜR: saha personeli
//      dağıtılmış işi iptal/tamamlayabilsin (bu ekran olmadan iş kilitlenirdi)
//   4. Koşul yetkiyi EZMEZ — iş olsa da izinsiz kullanıcı ekranı görmez
//   5. TEK yetkisi Kurşun Dağıtım olan kullanıcı, koşul sağlanmazken SIFIR görünür
//      ekrana düşer (MainNavigator bunu ModuleSelect'e çevirir — gizli ekrana
//      zorla girilmemesinin garantisi)
// =============================================================================
describe("useVisibleScreens (izin ∖ koşulu sağlanmayan ekranlar)", () => {
  afterEach(() => {
    mockKursunBypassEnabled = false;
    mockPendingKursunAssignments = 0;
    act(() => useAuthStore.setState({ user: null }));
  });

  it("bayrak kapalı + bekleyen iş yokken Kurşun Dağıtım elenir, diğer ekranlar kalır", () => {
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

  it("bayrak KAPALI ama bekleyen atama VARSA Kurşun Dağıtım görünür", () => {
    // Bayrak kapatıldığında dağıtılmış işler bypass rejiminde bitmeye devam eder.
    // Ekran gizlenirse saha o işi ne iptal ne de tamamlayabilir (mobilde adres
    // çubuğu/komut paleti gibi bir kaçış yolu yok) — bu senaryo o regresyonun bekçisi.
    mockPendingKursunAssignments = 2;
    setPerms(["mobile:*"]);
    const visible = keys();
    expect(visible).toContain("KursunDagitim");
    expect(visible).toHaveLength(MOBILE_SCREENS.length);
  });

  it("sayaç 0'a düşünce (son iş bitti) ekran yeniden gizlenir", () => {
    mockPendingKursunAssignments = 1;
    setPerms(["mobile:*"]);
    expect(keys()).toContain("KursunDagitim");
    mockPendingKursunAssignments = 0;
    expect(keys()).not.toContain("KursunDagitim");
  });

  it("yetki yoksa bayrak açık olsa da görünmez", () => {
    mockKursunBypassEnabled = true;
    setPerms(["mobile:depo"]);
    expect(keys()).toEqual(["Depo"]);
  });

  it("yetki yoksa bekleyen atama olsa da görünmez (koşul yetkiyi EZMEZ)", () => {
    mockPendingKursunAssignments = 5;
    setPerms(["mobile:depo"]);
    expect(keys()).toEqual(["Depo"]);
  });

  it("tek yetkisi Kurşun Dağıtım + bayrak kapalı + iş yok → sıfır görünür ekran", () => {
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

  it("tek yetkisi Kurşun Dağıtım + bayrak kapalı ama iş VAR → tek görünür ekran", () => {
    mockPendingKursunAssignments = 1;
    setPerms(["mobile:kursun-dagitim"]);
    const { result } = renderHook(() => useVisibleScreens());
    // MainNavigator bu listeden hem ekran kaydını hem initialRouteName'i türetir:
    // tek görünür ekran → ModuleSelect atlanır ve doğrudan Kurşun Dağıtım açılır.
    expect(result.current.visibleScreens.map((s) => s.key)).toEqual(["KursunDagitim"]);
    expect(result.current.hasAnyVisibleScreen).toBe(true);
    expect(result.current.hasMultipleVisibleScreens).toBe(false);
  });
});
