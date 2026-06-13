import { renderHook, act } from "@testing-library/react-native";
import { usePermissions } from "./usePermission";
import { useAuthStore } from "../store/authStore";

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
