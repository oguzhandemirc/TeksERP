// Telefon push DERLEME KAPISI + izin istemi (bildirim v2 F5, N5-PATRON). Kapı kapalıyken (varsayılan) mağaza paketi
// bugünküyle BİREBİR; açıkken yalnız bildirim izinleri engelden çıkar. Android 13+ istemi kanal VARKEN çıkar.
// NEGATİF SONDA (2026-10-25, geri alındı): `withNativePush` bayrağa bakmadan izinleri kaldırınca 1 ❌ ("⭐ bayrak yok");
// `register-native` kanalı izinden SONRA kurunca 1 ❌ ("⭐ kanal izinden ÖNCE"); 7/7 geri alındıktan sonra.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Platform } from "react-native";

const mockSira: string[] = [];
let mockIzin: "granted" | "denied" = "granted";
jest.mock("expo-notifications", () => ({
  AndroidImportance: { HIGH: 4 },
  setNotificationChannelAsync: jest.fn(async () => { mockSira.push("kanal"); }),
  getPermissionsAsync: jest.fn(async () => { mockSira.push("izin-oku"); return { granted: false, status: "undetermined" }; }),
  requestPermissionsAsync: jest.fn(async () => { mockSira.push("izin-iste"); return { status: mockIzin }; }),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: "ExponentPushToken[sonda]" })),
}));
jest.mock("expo-device", () => ({ isDevice: true, deviceName: "Sonda" }));
jest.mock("expo-constants", () => ({ __esModule: true, default: { expoConfig: { extra: { eas: { projectId: "p1" } } } } }));

const kok = path.join(__dirname, "..");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const appConfig = require("../app.config.js") as ((a: { config: Record<string, unknown> }) => Record<string, unknown>) & {
  withNativePush: (c: Record<string, unknown>, o: { env: Record<string, string | undefined>; root: string; warn: (m: string) => void }) => Record<string, unknown>;
  NATIVE_PUSH_IZINLERI: string[];
};
const appJson = (JSON.parse(readFileSync(path.join(kok, "app.json"), "utf8")) as { expo: Record<string, unknown> }).expo;
type Android = { blockedPermissions: string[]; googleServicesFile?: string };

describe("derleme kapısı (app.config.js)", () => {
  it("⭐ bayrak yok → app.json BİREBİR (izin engeli, eklenti, extra aynı)", () => {
    const warn = jest.fn();
    const out = appConfig.withNativePush(appJson, { env: {}, root: kok, warn });
    expect(out).toBe(appJson);
    expect(warn).not.toHaveBeenCalled();
    expect(JSON.stringify(appConfig({ config: appJson }))).toBe(JSON.stringify(appJson));
    expect((appJson.android as Android).blockedPermissions).toEqual(expect.arrayContaining(appConfig.NATIVE_PUSH_IZINLERI));
  });

  it("⭐ bayrak var ama google-services.json yok → kapalı derlenir, TEK satır uyarı, çökme yok", () => {
    const bos = mkdtempSync(path.join(os.tmpdir(), "n5-bos-"));
    try {
      const warn = jest.fn();
      const out = appConfig.withNativePush(appJson, { env: { PATRON_NATIVE_PUSH: "1" }, root: bos, warn });
      expect(out).toBe(appJson);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(bos, { recursive: true, force: true });
    }
  });

  it("bayrak + Firebase dosyası → yalnız bildirim izinleri engelden çıkar, eklenti + extra.nativePush", () => {
    const d = mkdtempSync(path.join(os.tmpdir(), "n5-fb-"));
    try {
      writeFileSync(path.join(d, "google-services.json"), "{}");
      const out = appConfig.withNativePush(appJson, { env: { PATRON_NATIVE_PUSH: "1" }, root: d, warn: jest.fn() });
      const once = (appJson.android as Android).blockedPermissions;
      const sonra = (out.android as Android).blockedPermissions;
      expect(sonra).toEqual(once.filter((p) => !appConfig.NATIVE_PUSH_IZINLERI.includes(p)));
      expect(sonra).toEqual(expect.arrayContaining(["android.permission.SYSTEM_ALERT_WINDOW", "com.google.android.gms.permission.AD_ID"]));
      expect((out.android as Android).googleServicesFile).toBe("./google-services.json");
      expect(out.plugins).toEqual([...(appJson.plugins as unknown[]), "expo-notifications"]);
      expect(out.extra).toEqual({ nativePush: true });
      expect((appJson.android as Android).googleServicesFile).toBeUndefined();
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("⭐ Firebase proje dosyası repoya girmez: .gitignore'da; örnek dosyada gerçek anahtar yok", () => {
    const gi = readFileSync(path.join(kok, ".gitignore"), "utf8").split("\n");
    expect(gi).toEqual(expect.arrayContaining(["google-services.json", "GoogleService-Info.plist"]));
    const ornek = readFileSync(path.join(kok, "google-services.example.json"), "utf8");
    expect(ornek).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/);
    expect(existsSync(path.join(kok, "google-services.example.json"))).toBe(true);
  });
});

describe("çalışma zamanı kapısı", () => {
  const { nativePushEnabled } = jest.requireActual("../src/push/support") as typeof import("../src/push/support");
  it("⭐ yalnız extra.nativePush=true ∧ native modül bağlı → açık", () => {
    expect(nativePushEnabled({ nativePush: true }, true)).toBe(true);
    expect(nativePushEnabled({ nativePush: true }, false)).toBe(false);
    expect(nativePushEnabled({}, true)).toBe(false);
    expect(nativePushEnabled(undefined, true)).toBe(false);
    expect(nativePushEnabled({ nativePush: "true" }, true)).toBe(false);
  });
});

describe("izin istemi (register-native, Android 13+)", () => {
  const { registerNative } = require("../src/push/register-native") as typeof import("../src/push/register-native");
  const api = { deviceRegister: jest.fn(async () => ({ id: "d1" })) } as unknown as import("../src/api/endpoints").Api;
  let restore: { restore(): void };
  beforeEach(() => { mockSira.length = 0; restore = jest.replaceProperty(Platform, "OS", "android"); });
  afterEach(() => restore.restore());

  it("⭐ kanal izinden ÖNCE kurulur; izin verilince belirteç bulut cihaz kaydına gider", async () => {
    mockIzin = "granted";
    await expect(registerNative(api)).resolves.toEqual({ kind: "KAYITLI", deviceId: "d1" });
    expect(mockSira).toEqual(["kanal", "izin-oku", "izin-iste"]);
    expect(api.deviceRegister).toHaveBeenCalledWith({ platform: "android", belirtec: "ExponentPushToken[sonda]", ad: "Sonda" });
  });

  it("izin reddedilirse kayıt denenmez, Türkçe yönlendirme döner", async () => {
    mockIzin = "denied";
    const r = await registerNative(api);
    expect(r).toEqual({ kind: "IZIN_YOK", message: expect.stringContaining("telefon ayarlarından") });
    expect(api.deviceRegister).not.toHaveBeenCalled();
  });
});
