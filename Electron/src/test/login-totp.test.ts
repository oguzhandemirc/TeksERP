import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isTotpEnrollmentRequired,
  isTotpInvalid,
  isTotpRequired,
  TOTP_ENROLLMENT_REQUIRED_CODE,
  TOTP_INVALID_CODE,
  TOTP_REQUIRED_CODE,
} from "@/lib/totp-auth";
import { buildTotpEnrollUrl, TOTP_ENROLL_PATH } from "@/lib/totp-enroll-url";
import { ERP_DIS_ADRESI, MUSTERI_KODU } from "@shared/update-feed";
import { panelChannel, registeredChannelCodes } from "../../build-channel";

/**
 * İKİ ADIMLI DOĞRULAMA — istemci tarafı sözleşmesi.
 *
 * ⭐ ASIL İDDİA: üç durum BİRBİRİNE KARIŞMIYOR. Backend bunları üç farklı HTTP
 * koduyla ayırıyor ve ayrım keyfi değil — giriş kilidi yalnız 401'i kaba kuvvet
 * sayıyor. İstemci bunları karıştırırsa iki kötü sonuçtan biri doğar:
 *   • 409'u 401 sanmak → meşru kullanıcı kod istendiği için kilitlenir;
 *   • 401'i 409 sanmak → yanlış kod girmek sonsuz denemeye dönüşür.
 *
 * ⭐ İKİNCİ İDDİA: `clientType` build hedefine göre ayrışıyor. Web paneli
 * Electron renderer'ının aynı kodudur; ikisi de "electron" gönderirse patronun
 * telefon tarayıcısından girmesi masaüstü oturumunu DÜŞÜRÜR (aynı-tip politikası
 * varsayılanı `kick`). Kaynak taraması yapılıyor çünkü bu, çalışma zamanında
 * yalnız GERÇEK bir tarayıcıda gözlemlenebilir bir davranış.
 */

/** Axios hata iskeleti — yalnız dedektörlerin okuduğu alanlar. */
const err = (status: number, code?: string) => ({
  response: { status, data: code ? { details: { code } } : {} },
});

describe("TOTP hata dedektörleri", () => {
  it("409 TOTP_REQUIRED yalnız 'kod gerekli' sayılır", () => {
    const e = err(409, TOTP_REQUIRED_CODE);
    expect(isTotpRequired(e)).toBe(true);
    expect(isTotpInvalid(e)).toBe(false);
    expect(isTotpEnrollmentRequired(e)).toBe(false);
  });

  it("401 TOTP_INVALID yalnız 'kod yanlış' sayılır", () => {
    const e = err(401, TOTP_INVALID_CODE);
    expect(isTotpInvalid(e)).toBe(true);
    expect(isTotpRequired(e)).toBe(false);
    expect(isTotpEnrollmentRequired(e)).toBe(false);
  });

  it("403 TOTP_ENROLLMENT_REQUIRED yalnız 'kurulum gerekli' sayılır", () => {
    const e = err(403, TOTP_ENROLLMENT_REQUIRED_CODE);
    expect(isTotpEnrollmentRequired(e)).toBe(true);
    expect(isTotpRequired(e)).toBe(false);
    expect(isTotpInvalid(e)).toBe(false);
  });

  it("⚠️ KOD ile DURUM birlikte aranır — yalnız status YETMEZ", () => {
    // 409 SESSION_EXISTS de 409'dur; koda bakılmazsa oturum çakışması
    // "TOTP gerekli" sanılır ve kullanıcıya kod kutusu açılırdı.
    expect(isTotpRequired(err(409, "SESSION_EXISTS"))).toBe(false);
    expect(isTotpRequired(err(409))).toBe(false);
    // Doğru kod ama yanlış statü de kabul edilmemeli (sözleşme çifttir).
    expect(isTotpRequired(err(401, TOTP_REQUIRED_CODE))).toBe(false);
    expect(isTotpInvalid(err(409, TOTP_INVALID_CODE))).toBe(false);
  });

  it("LAN girişinin sıradan hataları hiçbirine düşmez", () => {
    // Fabrika yolu: yanlış şifre (401, kodsuz) ve yetki reddi (403, kodsuz).
    // Bunlar TOTP ekranını AÇMAMALI — LAN'da ikinci faktör hiç istenmiyor.
    for (const e of [err(401), err(403), err(500), err(404), undefined, null]) {
      expect(isTotpRequired(e)).toBe(false);
      expect(isTotpInvalid(e)).toBe(false);
      expect(isTotpEnrollmentRequired(e)).toBe(false);
    }
  });
});

/**
 * ⚠️ YORUMLAR ÖNCE SİLİNİR. İlk yazımda taranmıyordu ve bekçi kendi belgesini
 * yakaladı: `authService.ts`in doküman bloğunda geçen `clientType:"electron"`
 * ifadesi "sabit gömülü" sanıldı. Aynı ders bu depoda `print-merge`te de
 * ölçülmüştü (CSS yorumundaki `@page` sayacı yanıltıyordu) — kaynak taraması
 * yapan HER bekçi önce yorumları atmalı, yoksa prose'u kod sanar.
 */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("clientType — build hedefine göre ayrışır", () => {
  const src = stripComments(
    readFileSync(resolve(process.cwd(), "src/services/authService.ts"), "utf-8"),
  );

  it("Electron'da 'electron', tarayıcıda 'web' gönderilir", () => {
    expect(src).toMatch(/IS_ELECTRON\s*\?\s*"electron"\s*:\s*"web"/);
  });

  it("⚠️ 'electron' SABİT olarak gömülü DEĞİL", () => {
    // Eski hâli `{ clientType: "electron", ...credentials }` idi. Sabit dönerse
    // web paneli kendini masaüstü sanar ve iki oturum aynı yuvayı paylaşır.
    expect(src).not.toMatch(/clientType:\s*"electron"/);
  });

  it("gövdeye clientType GERÇEKTEN ekleniyor (körlük zemini)", () => {
    expect(src).toMatch(/clientType:\s*CLIENT_TYPE/);
  });
});

describe("ClientType birliği backend enum'unu yansıtır", () => {
  it("üç değer de tanımlı — 'web' unutulmamış", () => {
    const t = readFileSync(resolve(process.cwd(), "src/types/auth.ts"), "utf-8");
    const m = /export type ClientType =([^;]+);/.exec(t);
    expect(m).toBeTruthy();
    for (const v of ["electron", "mobile", "web"]) {
      expect(m?.[1]).toContain(`"${v}"`);
    }
  });
});

describe("2FA kurulum bağlantısı", () => {
  it("açık dış adres verilince onu kullanır", () => {
    const url = buildTotpEnrollUrl("abc-123", "https://musteri-erp.etkiliyazilim.com");
    expect(url).toBe(`https://musteri-erp.etkiliyazilim.com/#${TOTP_ENROLL_PATH}?token=abc-123`);
  });

  it("sondaki eğik çizgi çift slash üretmez", () => {
    const url = buildTotpEnrollUrl("t", "https://x.example.com///");
    expect(url).toBe(`https://x.example.com/#${TOTP_ENROLL_PATH}?token=t`);
  });

  it("token URL-kodlanır", () => {
    expect(buildTotpEnrollUrl("a b&c", "https://x.y")).toContain("token=a%20b%26c");
  });

  it("⚠️ dış adres yoksa mevcut origin'e düşer — ama `file://` ASLA kullanılmaz", () => {
    // Electron'da konum `file://`dir ve oradan üretilen bir bağlantı patronun
    // telefonunda AÇILMAZ. Boş origin, yöneticiye eksik bir adres göstererek
    // sorunu GÖRÜNÜR kılar; `file:///#/...` sessizce yanlış olurdu.
    const url = buildTotpEnrollUrl("t", undefined);
    expect(url.startsWith("file:")).toBe(false);
    expect(url).toContain(`#${TOTP_ENROLL_PATH}?token=t`);
  });

  it("yol sabiti tek kaynaktan gelir (router + App kapısı onu okur)", () => {
    expect(TOTP_ENROLL_PATH.startsWith("/")).toBe(true);
    const routerSrc = readFileSync(resolve(process.cwd(), "src/router.tsx"), "utf-8");
    const appSrc = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf-8");
    // ⚠️ Yol ÜÇ yerde kullanılıyor; elle yazılsaydı biri değişince bağlantı
    // sessizce "Bağlantı geçersiz" ekranına düşerdi.
    expect(routerSrc).toContain("TOTP_ENROLL_PATH");
    expect(appSrc).toContain("TOTP_ENROLL_PATH");
    expect(routerSrc).not.toMatch(/path:\s*"\/2fa-kurulum"/);
  });
});

describe("fabrikanın dış adresi — tek kaynak (kanal kaydı)", () => {
  it("derlenen kanalın dış adresi kaydın O KANALININ değeri (yanlış müşterinin paketine doğru adres giremez)", () => {
    // Adres ve kod AYNI kayıt satırından gelir; biri başka kanaldan gelemez.
    expect(ERP_DIS_ADRESI).toBe(panelChannel(MUSTERI_KODU).publicErpUrl);
  });

  it("her kanalda dış adres boş ya da http(s)://host[:port]; üretim kanalında https (tünel)", () => {
    const kayit = JSON.parse(readFileSync(resolve(process.cwd(), "../deploy/kanallar.json"), "utf-8")) as {
      kanallar: Record<string, { tur: string }>;
    };
    for (const kod of registeredChannelCodes()) {
      const adres = panelChannel(kod).publicErpUrl;
      if (!adres) continue;
      expect(adres, kod).toMatch(/^https?:\/\/[a-z0-9.-]+(:\d+)?$/);
      if (kayit.kanallar[kod]?.tur === "uretim") expect(adres, kod).toMatch(/^https:\/\//);
    }
    // Sahadaki fabrika: tünel adresi (DONMUŞ değer scripts/check-kanallar.mjs §2'de de).
    expect(panelChannel("adnansahin").publicErpUrl).toBe("https://adnansahin-erp.etkiliyazilim.com");
  });

  it("⚠️ GÜNCELLEME ADRESİNDEN TÜRETİLMEZ", () => {
    // İkisi ayrı kanal: güncelleme yayın sunucusundan, ERP fabrikanın kendi
    // tünelinden gelir. Aynı müşteri kodunu paylaşmaları tesadüf; birini
    // diğerinden üretmek, biri değiştiğinde ötekini sessizce yanlışlar.
    const cfg = readFileSync(resolve(process.cwd(), "shared/update-feed.ts"), "utf-8");
    expect(cfg).toContain("export const ERP_DIS_ADRESI: string = PUBLIC_ERP_URL;");
    // Adres güncelleme kökünden ŞABLONLA kurulmuş olmamalı.
    expect(cfg).not.toMatch(/ERP_DIS_ADRESI[^\n]*UPDATE_BASE_URL/);
    for (const kod of registeredChannelCodes()) {
      const adres = panelChannel(kod).publicErpUrl;
      if (adres) expect(adres.startsWith("https://guncelleme."), kod).toBe(false);
    }
  });

  it("build (web) bu adresi pakete kanal kaydından gömüyor", () => {
    const vite = readFileSync(resolve(process.cwd(), "vite.config.web.ts"), "utf-8");
    expect(vite).toContain("VITE_PUBLIC_APP_URL");
    expect(vite).toContain("channel.publicErpUrl");
  });

  it("kurulum bağlantısı her kanalın adresiyle üretilince dışarıdan açılabilir olur", () => {
    for (const kod of registeredChannelCodes()) {
      const adres = panelChannel(kod).publicErpUrl;
      if (!adres) continue;
      const url = buildTotpEnrollUrl("abc", adres);
      expect(url.startsWith(`${adres}/`), kod).toBe(true);
      // ⚠️ Asıl arıza buydu: LAN adresiyle üretilen bağlantı kullanıcının
      // telefonunda AÇILMAZ ve hata da vermez, sadece boş sayfa gelir.
      expect(url, kod).not.toMatch(/localhost|127\.0\.0\.1|192\.168\./);
      expect(url).toContain(`#${TOTP_ENROLL_PATH}?token=abc`);
    }
  });
});
