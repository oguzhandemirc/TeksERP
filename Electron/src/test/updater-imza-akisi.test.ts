import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { UpdateStatus } from "@shared/ipc-contract";
import { UPDATE_FEED_OVERRIDE_KEY } from "@shared/update-feed";
import { API_BASE_URL_STORE_KEY, AUTH_TOKEN_STORE_KEY, DOWNLOAD_TOKEN_HEADER } from "@shared/download-token";
import {
  DIZIN,
  INSTALLER_FILE,
  INSTALLER_BODY,
  REVOCATION_FILE,
  IZINLI,
  TOKEN,
  UYGULAMA,
  YABANCI,
  YABANCI_SERTIFIKA,
  YENI,
  Z,
  akis,
  bilgi,
  getStatus,
  h,
  hazirla,
  izin,
  kur,
  latestYml,
  tik,
  updaterFiksturKancalari,
} from "./helpers/updater-ipc-fikstur";


/**
 * GÜNCELLEME AKIŞI — İMZALI KÜNYE (gerçek `registerUpdaterIpc`, sahte electron/electron-updater).
 *
 * ⭐ İDDİA 1 (yönetici şartı): `autoDownload=false` İÇ AYRINTIDIR. Künye doğrulanınca indirme KENDİLİĞİNDEN
 * başlar ve kullanıcının gördüğü akış bugünküyle aynıdır: checking → available ("Yeni sürüm indiriliyor…") →
 * downloading → ready (geri sayım → kur). Elle "Şimdi kontrol et" de aynı yoldan geçer.
 * ⭐ İDDİA 2: doğrulama düşerse TR uyarı (`error` + `imzaReddi`) ve kurulum YOK — indirme hiç başlamaz, inmiş
 * dosya künyeyle eşleşmezse silinir, kurulum anında dosya değişmişse `quitAndInstall` çağrılmaz.
 * ⭐ İDDİA 3: güncelleme adresi ezmesi yalnız https + kanal kaydının ana makinesi + `/<kanal>/electron/`;
 * kural YAZARKEN ve OKURKEN ana süreçte; indirme belirteci yalnız izinli adrese.
 * ⭐ İDDİA 5 (künye v:2): dağıtım iptali belirteç yanıtından gelir, `userData/lisans-iptal.jws`e yazılır ve geri
 * alınamaz — sonraki yanıt iptalsiz olsa da iptal edilmiş anahtarın sürümü KURULMAZ; bozuk yerel dosya yok sayılır.
 * İDDİA 4: kanallar gönderen denetimli tek geçitten (`handleTrusted`/`onTrusted`); yabancı belge işleyiciye ulaşamaz.
 * Grup akışının kendi iddiaları: `updater-grup-akisi.test.ts`; kapanışta kurulum: `updater-kapanista-kur.test.ts`.
 */
updaterFiksturKancalari();

describe("imzalı künye — görünen akış bugünküyle aynı", () => {
  it("künye doğrulanınca indirme KENDİLİĞİNDEN başlar: checking → available → downloading → ready → kur", async () => {
    await kur();
    expect(h.updater.autoDownload, "iç ayrıntı: indirme künyeden sonra").toBe(false);
    await hazirla();
    expect(h.updater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(akis()).toEqual(["idle", "checking", "available", "downloading", "ready"]);
    expect(getStatus()).toMatchObject({ newVersion: YENI, percent: 100, imzaReddi: null });
    h.onHandlers.get("updater:install")!(UYGULAMA);
    await vi.waitFor(() => expect(h.updater.quitAndInstall).toHaveBeenCalledWith(true, true));
  });

  it("elle 'Şimdi kontrol et' (updater:check) aynı yoldan: kullanıcı ikinci bir şey yapmadan indirme başlar", async () => {
    await kur();
    h.updater.checkForUpdates.mockImplementationOnce(async () => {
      h.emit("checking-for-update");
      h.emit("update-available", bilgi());
      return null;
    });
    await h.handlers.get("updater:check")!(UYGULAMA);
    expect(h.updater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(getStatus().state).toBe("available");
  });
});

/** Red: indirme başlamaz, durum `error` + TR metin + kod. */
const reddedildi = (kod: string) => {
  expect(h.updater.downloadUpdate).not.toHaveBeenCalled();
  expect(getStatus().state).toBe("error");
  expect(getStatus().imzaReddi?.kod).toBe(kod);
  expect(getStatus().error).toMatch(/kurulmadı/);
};

describe("imzalı künye — doğrulama düşerse TR uyarı + kurulum YOK", () => {

  it("imzasız latest.yml (bugünkü yayın) → indirme yok, KUNYE_YOK; electron-updater yine de 'indi' derse kurulum yok", async () => {
    await kur();
    h.emit("update-available", bilgi(latestYml({ imza: false })));
    reddedildi("KUNYE_YOK");
    writeFileSync(INSTALLER_FILE, INSTALLER_BODY);
    h.updater.installerPath = INSTALLER_FILE;
    h.emit("update-downloaded", { ...bilgi(latestYml({ imza: false })), downloadedFile: INSTALLER_FILE });
    await tik();
    expect(getStatus().state).toBe("error");
    h.onHandlers.get("updater:install")!(UYGULAMA);
    await tik();
    expect(h.updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("başka kanalın künyesi → KUNYE_KANAL · çapada olmayan kökün sertifikası → SERTIFIKA_GECERSIZ", async () => {
    await kur();
    const baska = "genel";
    h.emit("update-available", bilgi(latestYml({ kanal: baska })));
    reddedildi("KUNYE_KANAL");
    await kur();
    h.emit("update-available", bilgi(latestYml({ sertifika: YABANCI_SERTIFIKA })));
    reddedildi("SERTIFIKA_GECERSIZ");
  });

  it("inen dosya künyeyle eşleşmiyor → ready OLMAZ, dosya silinir, DOSYA_OZETI", async () => {
    await kur();
    h.emit("update-available", bilgi());
    writeFileSync(INSTALLER_FILE, Buffer.concat([INSTALLER_BODY, Buffer.from("x")]));
    h.updater.installerPath = INSTALLER_FILE;
    h.emit("update-downloaded", { ...bilgi(), downloadedFile: INSTALLER_FILE });
    await vi.waitFor(() => expect(getStatus().imzaReddi?.kod).toBe("DOSYA_OZETI"));
    expect(getStatus().state).toBe("error");
    expect(existsSync(INSTALLER_FILE)).toBe(false);
    h.onHandlers.get("updater:install")!(UYGULAMA);
    await tik();
    expect(h.updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("kurulum anında dosya değiştirilmiş (indirme ile kurulum arası) → quitAndInstall YOK", async () => {
    await kur();
    await hazirla();
    writeFileSync(INSTALLER_FILE, Buffer.from("başka exe"));
    h.onHandlers.get("updater:install")!(UYGULAMA);
    await vi.waitFor(() => expect(getStatus().imzaReddi?.kod).toBe("DOSYA_OZETI"));
    await tik();
    expect(h.updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("electron-updater'ın çalıştıracağı dosya doğrulanan dosya değil → kurulum YOK", async () => {
    await kur();
    await hazirla();
    h.updater.installerPath = join(DIZIN, "baska.exe");
    h.onHandlers.get("updater:install")!(UYGULAMA);
    await vi.waitFor(() => expect(getStatus().imzaReddi?.kod).toBe("KUNYE_YOK"));
    expect(h.updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("red denetim boyunca KALIR (şerit titremez), 'güncel' sonucu temizler", async () => {
    await kur();
    h.emit("update-available", bilgi(latestYml({ imza: false })));
    h.emit("checking-for-update");
    expect(getStatus().imzaReddi?.kod).toBe("KUNYE_YOK");
    h.emit("update-not-available", {});
    expect(getStatus().imzaReddi).toBeNull();
  });
});

describe("güncelleme adresi ezmesi — ana süreç kuralı (yazarken + okurken)", () => {
  const ezme = (u: string | null) => h.handlers.get("updater:set-feed-url")!(UYGULAMA, u) as Promise<UpdateStatus>;

  it("http · yabancı ana makine · yanlış yol · kimlik/port/sorgu → yazılmaz (hata döner)", async () => {
    await kur();
    for (const kotu of [
      IZINLI.replace("https:", "http:"),
      "https://kotu.example/adnansahin/electron/",
      new URL("../../baska/", IZINLI).toString(),
      IZINLI.replace("https://", "https://u:p@"),
      IZINLI.replace(".com/", ".com:8443/"),
      `${IZINLI}?x=1`,
    ]) {
      await expect(ezme(kotu), kotu).rejects.toThrow();
      expect(h.store.has(UPDATE_FEED_OVERRIDE_KEY), kotu).toBe(false);
    }
  });

  it("izinli adres normalize edilerek yazılır (sonda /)", async () => {
    await kur();
    const s = await ezme(IZINLI.slice(0, -1));
    expect(h.store.get(UPDATE_FEED_OVERRIDE_KEY)).toBe(IZINLI);
    expect(s).toMatchObject({ feedUrl: IZINLI, feedUrlOverridden: true });
  });

  it("⭐ yabancı belgeden ezme · kontrol · kurulum işleyiciye ULAŞMAZ (izinli adres bile yazılmaz)", async () => {
    const guvenilir = await kur();
    expect(() => h.handlers.get("updater:set-feed-url")!(YABANCI, IZINLI)).toThrow(guvenilir.UNTRUSTED_SENDER_ERROR);
    expect(h.store.has(UPDATE_FEED_OVERRIDE_KEY)).toBe(false);
    expect(() => h.handlers.get("updater:check")!(YABANCI)).toThrow(guvenilir.UNTRUSTED_SENDER_ERROR);
    expect(h.updater.checkForUpdates).not.toHaveBeenCalled();
    h.onHandlers.get("updater:install")!(YABANCI);
    expect(h.updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("kasaya başka yoldan yazılmış http/yabancı ezme OKURKEN yok sayılır; belirteç yalnız izinli adrese gider", async () => {
    await kur();
    h.store.set(API_BASE_URL_STORE_KEY, "http://10.0.0.5:4000");
    h.store.set(AUTH_TOKEN_STORE_KEY, "jwt");
    h.fetchMock.mockResolvedValue(izin());
    h.store.set(UPDATE_FEED_OVERRIDE_KEY, "http://10.0.0.9/adnansahin/electron/");
    await h.handlers.get("updater:check")!(UYGULAMA);
    const son = h.updater.setFeedURL.mock.calls.at(-1)?.[0] as { url: string };
    expect(son.url).toBe(IZINLI);
    expect(h.updater.requestHeaders).toEqual({ [DOWNLOAD_TOKEN_HEADER]: TOKEN });
    expect(getStatus().feedUrlOverridden).toBe(false);
  });
});

describe("dağıtım iptali — belirteç yanıtı → yerel depo → geri alınamaz", () => {
  const iptal = (sira: number) => Z.iptalBas([{ kid: Z.ist.kid, sertifikaId: Z.sertifikaId }], sira);

  it("⭐ belirteç yanıtındaki iptal → SERTIFIKA_IPTAL ve userData/lisans-iptal.jws yazılır", async () => {
    const t = iptal(2);
    await kur({ iptal: t });
    h.emit("update-available", bilgi());
    reddedildi("SERTIFIKA_IPTAL");
    expect(readFileSync(REVOCATION_FILE, "utf8")).toBe(t);
  });

  it("⭐ sonraki denetimde yanıt iptalsiz olsa da yerel iptal uygulanır (geri alınamaz)", async () => {
    writeFileSync(REVOCATION_FILE, iptal(3));
    await kur({ iptal: null });
    h.emit("update-available", bilgi());
    reddedildi("SERTIFIKA_IPTAL");
  });

  it("yereldeki iptal yanıttakinden yüksek sıralıysa dosya DEĞİŞMEZ", async () => {
    const yuksek = iptal(7);
    writeFileSync(REVOCATION_FILE, yuksek);
    await kur({ iptal: iptal(4) });
    h.emit("update-available", bilgi());
    reddedildi("SERTIFIKA_IPTAL");
    expect(readFileSync(REVOCATION_FILE, "utf8")).toBe(yuksek);
  });

  it("bozuk yerel dosya yok sayılır: iptalsiz yanıtla geçerli künye KABUL, indirme başlar", async () => {
    writeFileSync(REVOCATION_FILE, "bozuk.iptal.dosyasi");
    await kur({ iptal: null });
    h.emit("update-available", bilgi());
    expect(h.updater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(getStatus().imzaReddi ?? null).toBeNull();
  });
});
