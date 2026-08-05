import { renderHook, act } from "@testing-library/react-native";

import { useVisibleScreens } from "./useVisibleScreens";
import { useAuthStore } from "../store/authStore";
import { MOBILE_SCREENS } from "../types/permissions";

// authStore.user tipi JwtPayload — testte yalnız permissions okunur; minimal cast.
function setPerms(permissions: string[]) {
  act(() => useAuthStore.setState({ user: { permissions } as never }));
}
const keys = () =>
  renderHook(() => useVisibleScreens()).result.current.visibleScreens.map((s) => s.key);

// =============================================================================
// 2026-08-05: KOŞULLU EKRAN KALMADI.
//
// Tek koşullu ekran Kurşun Dağıtım'dı (`kursunBypassEnabled || bekleyen > 0`).
// Electron'da Kurşun Sırası + Kurşun Dağıtım "Kurşun Planlama"da birleşip
// bayraktan bağımsızlaşınca mobil ikizi de hizalandı — ekran bayrak kapalıyken
// de anlamlı (bekleyen kuyruğu gösteriyor) ve zaten `mobile:kursun-dagitim`
// diye dar bir izne bağlı.
//
// Bu dosya artık iki şeyi kilitler:
//   1. Görünürlük = SAF YETKİ. Kurşun Dağıtım bayrak/sayaç yüzünden ELENMEZ —
//      eski davranışın geri sızması (ve sahada ekranın kaybolması) buradan düşer.
//   2. Eleme mekanizması hâlâ ÇALIŞIYOR (bugün kümesi boş). Mekanizma sessizce
//      bozulursa yeni bir koşullu ekran eklendiği gün fark edilmezdi.
// =============================================================================
describe("useVisibleScreens (izin ∖ koşulu sağlanmayan ekranlar)", () => {
  afterEach(() => {
    act(() => useAuthStore.setState({ user: null }));
  });

  it("izinli TÜM ekranlar görünür — koşul elemesi yok", () => {
    setPerms(["mobile:*"]);
    const visible = keys();
    expect(visible).toHaveLength(MOBILE_SCREENS.length);
    expect(visible).toContain("KursunQc");
  });

  it("Kurşun Dağıtım bayrak/sayaçtan BAĞIMSIZ görünür (regresyon bekçisi)", () => {
    // Eskiden bu senaryo (bayrak kapalı + bekleyen atama yok) ekranı ELİYORDU.
    // Feature-flag hook'u burada MOCK'LANMIYOR: gerçek hook sorgu yokken false
    // döner, yani "bayrak kapalı" hâli zaten test edilen durumdur.
    setPerms(["mobile:kursun-dagitim"]);
    const { result } = renderHook(() => useVisibleScreens());
    expect(result.current.visibleScreens.map((s) => s.key)).toEqual(["KursunDagitim"]);
    // Tek görünür ekran → MainNavigator ModuleSelect'i atlar ve doğrudan açar.
    expect(result.current.hasAnyVisibleScreen).toBe(true);
    expect(result.current.hasMultipleVisibleScreens).toBe(false);
  });

  it("yetki yoksa ekran görünmez (koşulsuzluk yetkiyi EZMEZ)", () => {
    setPerms(["mobile:depo"]);
    expect(keys()).toEqual(["Depo"]);
  });

  it("hiç yetki yoksa sıfır görünür ekran", () => {
    setPerms([]);
    const { result } = renderHook(() => useVisibleScreens());
    expect(result.current.visibleScreens).toHaveLength(0);
    expect(result.current.hasAnyVisibleScreen).toBe(false);
    expect(result.current.hasMultipleVisibleScreens).toBe(false);
  });
});
