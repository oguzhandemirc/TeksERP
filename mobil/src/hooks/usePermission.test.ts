import { renderHook, act } from "@testing-library/react-native";
import { usePermissions } from "./usePermission";
import { useAuthStore } from "../store/authStore";
import { MOBILE_SCREENS } from "../types/permissions";

// authStore.user tipi JwtPayload — testte yalnız permissions okunur; minimal cast.
function setPerms(permissions: string[]) {
  act(() => useAuthStore.setState({ user: { permissions } as never }));
}

describe("usePermissions.has (mobil RBAC)", () => {
  afterEach(() => act(() => useAuthStore.setState({ user: null })));

  it("birebir kod eşleşir", () => {
    setPerms(["mobile:kk1"]);
    const { result } = renderHook(() => usePermissions());
    expect(result.current.has("mobile:kk1")).toBe(true);
    expect(result.current.has("mobile:tambur")).toBe(false);
  });

  it("mobile:* tüm mobil ekranları açar", () => {
    setPerms(["mobile:*"]);
    const { result } = renderHook(() => usePermissions());
    expect(result.current.has("mobile:tambur")).toBe(true);
    expect(result.current.has("mobile:fason-sevk")).toBe(true);
    // admin'i açmaz
    expect(result.current.has("admin:users")).toBe(false);
  });

  it("admin:* yalnız admin kodlarını açar", () => {
    setPerms(["admin:*"]);
    const { result } = renderHook(() => usePermissions());
    expect(result.current.has("admin:users")).toBe(true);
    expect(result.current.has("mobile:kk1")).toBe(false);
  });

  // ⚠️ SATICI (SÜPERADMİN) HESABI — backend ona tek eleman olarak `["*"]`
  // döner. Global joker dalı olmadan `has()` HER kod için false döner,
  // `allowedScreens` BOŞ kalır ve RootNavigator "yetkin yok" ekranına düşer:
  // giriş başarılı görünür, hata yoktur, ekran yoktur.
  // NEGATİF SONDA (2026-09-03): `if (hasGlobalWildcard) return true;` satırı
  // silindi → bu iki test kırmızı (3 assertion), diğer 5 test yeşil kaldı.
  it("global * (satıcı hesabı) her izni açar", () => {
    setPerms(["*"]);
    const { result } = renderHook(() => usePermissions());
    expect(result.current.has("mobile:kk1")).toBe(true);
    expect(result.current.has("admin:users")).toBe(true);
    expect(result.current.has("roll:manual-adjust")).toBe(true);
  });

  it("global * ile TÜM mobil ekranlar açılır (NoAccess kapısı açılır)", () => {
    setPerms(["*"]);
    const { result } = renderHook(() => usePermissions());
    expect(result.current.allowedScreens.length).toBe(MOBILE_SCREENS.length);
    expect(result.current.allowedScreens.length).toBeGreaterThan(0); // körlük zemini
    expect(result.current.hasAnyMobileScreen).toBe(true);
    expect(result.current.hasMultipleMobileScreens).toBe(true);
  });

  it("izinsiz kullanıcı hiçbir ekran görmez", () => {
    setPerms([]);
    const { result } = renderHook(() => usePermissions());
    expect(result.current.hasAnyMobileScreen).toBe(false);
    expect(result.current.allowedScreens).toHaveLength(0);
  });

  it("tek mobil ekran → hasMultipleMobileScreens false", () => {
    setPerms(["mobile:depo"]);
    const { result } = renderHook(() => usePermissions());
    expect(result.current.hasAnyMobileScreen).toBe(true);
    expect(result.current.hasMultipleMobileScreens).toBe(false);
  });
});
