// TV bağlantısı: kapı sırası `ProtectedRoute` ile aynı (izin → bayrak bekle → okunamadıysa çiz →
// modül kapalıysa kapalı); adres yalnız http(s) kökte üretilir; düğme bu pencereyi TV yoluna taşır.
import { afterEach, describe, expect, it } from "vitest";
import { ROUTE_MODULE } from "@/lib/route-modules";
import { TEZGAH_TV_PATH, TEZGAH_TV_PERMISSION, TEZGAH_TV_SCREEN, buildTezgahTvUrl, openTezgahTvHere, tvGateOf } from "./tv-entry";

const open = { permitted: true, flagsReady: true, flagsFailed: false, moduleOpen: true };

describe("tvGateOf", () => {
  it("⭐ izin yoksa bayrak beklemeden kapalı (fail-closed)", () => {
    expect(tvGateOf({ ...open, permitted: false })).toBe("NO_PERMISSION");
    expect(tvGateOf({ ...open, permitted: false, flagsReady: false })).toBe("NO_PERMISSION");
  });
  it("bayrak yüklenene dek bekler — 'bilinmiyor' kapalı sayılmaz", () => {
    expect(tvGateOf({ ...open, flagsReady: false, moduleOpen: false })).toBe("WAIT");
  });
  it("⭐ modül kapalı → MODULE_CLOSED; bayrak okunamadıysa çizilir (gerçek kapı backend)", () => {
    expect(tvGateOf({ ...open, moduleOpen: false })).toBe("MODULE_CLOSED");
    expect(tvGateOf({ ...open, flagsFailed: true, moduleOpen: false })).toBe("OPEN");
    expect(tvGateOf(open)).toBe("OPEN");
  });
  it("kapılar uygulama route'uyla aynı: loom:live-view + tezgahEnabled", () => {
    expect(TEZGAH_TV_PERMISSION).toBe("loom:live-view");
    expect(ROUTE_MODULE[TEZGAH_TV_SCREEN.slice(1)]).toBe("tezgahEnabled");
  });
});

describe("TV adresi", () => {
  afterEach(() => {
    window.location.hash = "";
  });
  it("web kökünden mutlak adres; Electron (file://) ve kökün yoksa null", () => {
    expect(buildTezgahTvUrl(undefined, "https://panel.fabrika.local:4443")).toBe(`https://panel.fabrika.local:4443/#${TEZGAH_TV_PATH}`);
    expect(buildTezgahTvUrl("https://x.example/", "")).toBe("https://x.example/#/tezgah-tv");
    expect(buildTezgahTvUrl(undefined, "")).toBeNull();
    expect(buildTezgahTvUrl("file:///app", "")).toBeNull();
  });
  it("bu pencereyi TV yoluna taşır", () => {
    openTezgahTvHere();
    expect(window.location.hash).toBe("#/tezgah-tv");
  });
});
