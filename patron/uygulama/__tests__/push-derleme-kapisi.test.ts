// Push köprüsü P4 — derleme kapısının PAKET tarafı (`scripts/lib/push-kapisi.cjs` + `build-aab.mjs` kablolaması). Kapı
// kapalıyken paket bugünküyle aynı: izin kümesi aynı, bildirim bileşeni yasak, package.json dışlaması dokunulmaz.
import { readFileSync } from "node:fs";
import path from "node:path";

const kok = path.join(__dirname, "..");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pk = require("../scripts/lib/push-kapisi.cjs") as {
  PUSH_PAKETLERI: string[];
  izinliIzinler(paket: string, acik: boolean, push: string[]): string[];
  bilesenSorunlari(b: string[], acik: boolean): string[];
  autolinkingKapiya<T>(pkg: T, acik: boolean): T;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const appConfig = require("../app.config.js") as { pushKapisi(o: { env: Record<string, string | undefined>; root: string }): { acik: boolean; eksik: string[] | null }; NATIVE_PUSH_IZINLERI: string[] };
const PAKET = "com.etkiliyazilim.tekserp.yonetim";
/** 2026-11-13 mağaza paketinin ölçülmüş izin kümesi (PATRON-MAGAZA-ANDROID §5 doğrulama). */
const BUGUNKU = ["android.permission.INTERNET", "android.permission.CAMERA", `${PAKET}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`];
const pkg = JSON.parse(readFileSync(path.join(kok, "package.json"), "utf8")) as { expo: { autolinking: { android: { exclude: string[] } } } };

describe("izin kümesi kapıya göre", () => {
  it("⭐ kapalı → bugünkü küme BİREBİR (bildirim izni yok)", () => {
    expect(pk.izinliIzinler(PAKET, false, appConfig.NATIVE_PUSH_IZINLERI)).toEqual(BUGUNKU);
  });
  it("açık → bugünkü + POST_NOTIFICATIONS/c2dm/WAKE_LOCK", () => {
    const acik = pk.izinliIzinler(PAKET, true, appConfig.NATIVE_PUSH_IZINLERI);
    expect(acik).toEqual([...BUGUNKU, ...appConfig.NATIVE_PUSH_IZINLERI]);
    expect(acik).toContain("android.permission.POST_NOTIFICATIONS");
  });
});

describe("bildirim bileşeni denetimi", () => {
  const firebase = ["expo.modules.notifications.service.ExpoFirebaseMessagingService", "com.google.firebase.components.ComponentDiscoveryService"];
  const yalin = ["expo.modules.filesystem.FileSystemFileProvider", "androidx.startup.InitializationProvider"];
  it("⭐ kapalı → Firebase/bildirim bileşeni KIRMIZI, yalın paket yeşil", () => {
    expect(pk.bilesenSorunlari(yalin, false)).toEqual([]);
    expect(pk.bilesenSorunlari([...yalin, ...firebase], false)).toHaveLength(1);
  });
  it("açık → expo-notifications servisi YOKSA kırmızı (bağlama dışlaması kalmış)", () => {
    expect(pk.bilesenSorunlari([...yalin, ...firebase], true)).toEqual([]);
    expect(pk.bilesenSorunlari(yalin, true)).toHaveLength(1);
  });
});

describe("Android bağlama dışlaması", () => {
  it("⭐ depodaki package.json push paketlerini dışlar (kapalı varsayılan) ve kapalı kapı ona dokunmaz", () => {
    expect(pkg.expo.autolinking.android.exclude).toEqual(expect.arrayContaining(pk.PUSH_PAKETLERI));
    expect(pk.autolinkingKapiya(pkg, false)).toBe(pkg);
  });
  it("açık kapı yalnız push paketlerini dışlamadan çıkarır; özgün nesne değişmez", () => {
    const once = JSON.stringify(pkg);
    const out = pk.autolinkingKapiya(pkg, true);
    expect(out.expo.autolinking.android.exclude.filter((p) => pk.PUSH_PAKETLERI.includes(p))).toEqual([]);
    expect(JSON.stringify(pkg)).toBe(once);
    expect({ ...out, expo: undefined }).toEqual({ ...pkg, expo: undefined });
  });
});

describe("build-aab kablolaması", () => {
  const betik = readFileSync(path.join(kok, "scripts/build-aab.mjs"), "utf8");
  it("⭐ izin kümesi, bileşen denetimi ve kapı kararı tek kaynaktan; literal izin listesi yok", () => {
    expect(betik).toMatch(/pushKapisi\(\{ env: process\.env, root: UYGULAMA \}\)/);
    expect(betik).toMatch(/pushDerleme\.izinliIzinler\(PAKET, PUSH\.acik, NATIVE_PUSH_IZINLERI\)/);
    expect(betik).toMatch(/pushDerleme\.bilesenSorunlari\(bilesenler, PUSH\.acik\)/);
    expect(betik).not.toMatch(/IZINLI_IZINLER = \[/);
  });
  it("⭐ package.json yalnız kapı açıkken yeniden yazılır ve çıkışta özgün metin geri konur", () => {
    const blok = /if \(PUSH\.acik\) \{([\s\S]*?)\n\}/.exec(betik)?.[1] ?? "";
    expect(blok).toMatch(/process\.on\("exit", \(\) => fs\.writeFileSync\(PKG, ozgun\)\)/);
    expect(blok).toMatch(/autolinkingKapiya\(JSON\.parse\(ozgun\), true\)/);
    expect(betik.match(/writeFileSync\(PKG/g)).toHaveLength(2);
  });
  it("kapı kararı: bayrak yoksa sessiz kapalı", () => {
    expect(appConfig.pushKapisi({ env: {}, root: kok })).toEqual(expect.objectContaining({ acik: false, eksik: null }));
  });
});
