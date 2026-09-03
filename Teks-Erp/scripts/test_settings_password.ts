// =============================================================================
// BEKÇİ — AYAR ŞİFRESİ (ikinci kapı): uyuyan kapı · muafiyetler · kilit · sır
// =============================================================================
// NE KORUYOR (tasarım §7.2): davranış bayrağı ekranı her değişiklikte İKİNCİ bir
// şifre sorar — açık kalmış bir admin oturumundan (masa başında bırakılmış panel)
// bayrak çevrilmesin. Şifreyi SÜPERADMİN üretir/değiştirir/iptal eder; fabrika
// yöneticisi onu ne yazabilir ne de okuyabilir.
//
// ON SESSİZ BOZULMA YOLU VAR, ONU DA BURADA KİLİTLİ:
//   1. KAPI BİR UÇTAN DÜŞER — `requireSettingsPassword` BEŞ yazma yüzeyinin
//      birinden silinirse (örn. `documents-logo`) o yüzey şifresiz kalır ve
//      HİÇBİR test kırılmaz: kalan uçlar yeşil çalışmaya devam eder. §J zinciri
//      ROUTER STACK'inden okur (metin değil — import edilmiş gerçek katman adı).
//   1b. ALTINCI YÜZEY KAPISIZ DOĞAR — §J'nin elle listesi tam da böyle
//      eksikti (spec "üç" dedi, D2 turu `PATCH /admin/backups/offsite` ile
//      `POST /admin/backups/offsite/authorize`i buldu: ayar YAZIYORLAR ama
//      "yedek" ekranında yaşadıkları için kapsam sayımına girmemişlerdi).
//      Artık §J'nin sonunda bir TRIPWIRE var: `src/routes/**` içinde
//      `systemSettingService.set(` / `setFeatureFlags(` / `systemSetting.upsert(`
//      çağıran HER uç bloğu kapıyı taşımak ZORUNDA (muaflar gerekçeli + iki yönlü).
//   2. SIRA TERSİNE DÖNER — `reserveLoginAttempt` `bcrypt.compare`den SONRAYA
//      kayarsa deneme sınırı fiilen ölür (kilitli anahtar da bcrypt maliyeti
//      koşturmaya devam eder: hem brute-force hem CPU/DoS ayağı açılır). §F bunu
//      HEM kaynakta HEM davranışta ölçer: kilitliyken DOĞRU şifre de 429 almalı.
//   3. BELGE MUAFİYETİ YÖN DEĞİŞTİRİR — `.every` `.some` olursa karma gövde
//      (`{documentsConfig, backupHour}`) şifresiz geçer: KAÇAK. §D ölçer.
//   4. SÜPERADMİN MUAFİYETİ DÜŞER — satıcı kendi kurduğu kapıda kilitli kalır ve
//      şifre unutulduğunda kurtarma yolu YOK olur. §E ölçer.
//   5. HASH HAM AYAR UCUNDAN YAZILIR — `admin:settings` taşıyan herkes kendi
//      bildiği şifrenin hash'ini basıp kapıyı KENDİNE açar (koruma, tam da
//      korumaya çalıştığı iznin sahibince ele geçirilir). §I ölçer.
//   6. HASH LİSTEDE/AUDIT'TE GÖRÜNÜR — `GET /admin/settings` tüm satırları
//      döndürür; bcrypt gövdesi çevrimdışı kırma için yeterlidir. §H ölçer
//      (liste · bayrak yükü · `system_logs` metin taraması).
//   7. YAZMA `systemSettingService.set()`e KAYAR — `set()` audit'i `oldData`/
//      `newData` ile HAM çağırır (maskeleme yalnız `changes` kolonuna uygulanır),
//      yani hash denetim tablosuna DÜZ METİN düşer. §K kaynakta ölçer.
//   8. ŞİFRE İKİNCİ BİR KANALDAN OKUNUR — query/gövde/cookie yedeği eklenirse
//      sır iki deftere düşer (morgan erişim logu URL'yi basar; USED audit yükü
//      isteğin yolunu taşır). Eski bekçi burada KÖRDÜ: yalnız METİN regex'i
//      vardı ve `?sp=` yedeği eklendiğinde koşum 90/0 yeşil kaldı. §C artık
//      DAVRANIŞ ölçer (dokuz yanlış kanal → 403) + USED `path`inde `?` yok.
//   9. KULLANILAMAZ ŞİFRE TANIMLANIR — Türkçe harf/boşluk HTTP başlığında
//      taşınamaz, 72 bayttan uzunu bcrypt SESSİZCE kırpar. Şema reddetmezse
//      süperadmin "tanımlandı" görür, sonra hiçbir istemci o şifreyi
//      iletemez ve fabrika rotasyona kadar kilitli kalır. §B ölçer.
//  10. KİLİT AUDIT'İ SELE DÖNER — satır `blocked` dalında yazılırsa kilitliyken
//      gelen HER istek bir satır üretir (ölçüldü: 60 istek → +60). §F "tur
//      başına ≤1" ölçer. Ayrıca 429 sözleşmesi (`Retry-After`) §N'de.
//
// ⚠️ BU BEKÇİ YAZAR: ayar şifresinin hash satırını KENDİ kurar ve `finally`de
//    ÖNCEKİ HÂLE döndürür (satır yoksa siler, varsa birebir geri yazar). Fabrika
//    DB'sinde hash YOKSA koşum sonunda yine YOKTUR — uyuyan kapı korunur.
//    Hedef-DB kapısından geçer (`lib/hedef-db-kapisi.ts`).
// ⚠️ KİMLİK SİMÜLE EDİLİR, HESAP YARATILMAZ: süperadmin ayağı `req.isSystemAccount`
//    ile ölçülür (kaynak: `verifyToken`in TAZE DB okuması — istemci seçemez).
//    İkinci bir sistem hesabı doğurmak `test_db_invariants` §10'u ("sistem hesabı
//    ≤ 1") kırardı; `bakim`in parolası ise bu DB'de bilinmiyor.
// ⚠️ KİLİT KOVASI SAHTE IP'lerle ayrılır: gerçek 127.0.0.1 kovasına dokunulmaz,
//    yani bekçi kimseyi kilitlemez. §F kendi IP'sini kullanır ki §C/§D'nin
//    sayacını yakmasın.
//
// Koşum: DATABASE_URL=… JWT_SECRET=… npx tsx scripts/test_settings_password.ts
//        (HTTP ayağı için ayrıca: PORT=4112 … npx tsx src/server.ts & → TEST_API_URL)
//
// TABAN (2026-09-03 düzeltme turu sonrası, `tekserp_modul_test`):
//   • sunucu YOK             → **128 geçti / 0 başarısız / 13 atlandı**
//   • sunucu AYAKTA          → +12 HTTP kontrolü (atlanan 13 → 1)
// (Düzeltme turu öncesi taban 90/0/13 idi; artış §B karakter kümesi, §C kanal
//  davranışı, §F kilit seli, §J tripwire ve §N `Retry-After` kontrolleridir.)
// Sayılar DB durumuna bağlıdır; kalıcı olan "hangi kontrol kırmızı olur" cümlesidir.
//
// NEGATİF SONDALAR — 2026-09-03'te ÖLÇÜLDÜ; her sondadan sonra `cp` + `md5 -q`
// ile birebir geri alındı (sondalar KAYNAKTA koşar → sunucu restart'ı GEREKMEZ:
// in-process kollar her koşumda yeniden import edilir).
//   SONDA-1 -> çıkış 1 · 3 ❌ · kapı `documents-logo` ucundan silindi
//              (§C "belge muafiyetine düşmez" + §J zincir ×2)
//   SONDA-2 -> çıkış 1 · 2 ❌ (+4 atlandı) · `reserveLoginAttempt` compare'den
//              SONRAYA taşındı → §F kaynak sırası ❌ VE kilit HİÇ KURULMUYOR
//              (yanlış şifre compare'de erken dönüyor, sayaç hiç artmıyor)
//   SONDA-3 -> çıkış 1 · 3 ❌ · USED audit yüküne `password: supplied` kondu
//              (§C yük + §H `system_logs` metin taraması + §K kaynak)
//   SONDA-4 -> çıkış 1 · 3 ❌ · hash `systemSettingService.set()` ile yazıldı →
//              §K ×2 VE §H "system_logs'ta BCRYPT GÖVDESİ 0" ❌ (1 satır).
//              ⚠️ EN ÖĞRETİCİ SONDA: sızıntı GERÇEKTEN oldu — `set()`in yazdığı
//              `newData` satırında bcrypt gövdesi düz metin olarak duruyordu.
//   SONDA-5 -> çıkış 1 · 1 ❌ · belge muafiyeti `.every` → `.some` (§D karma gövde;
//              yalnız BU kontrol kırmızı — kaçağın tamamı orada yaşıyor)
//   SONDA-6 -> çıkış 1 · 3 ❌ · süperadmin muafiyeti kaldırıldı (§E ×2 + §F kurtarma)
//   SONDA-7 -> çıkış 1 · 4 ❌ · `isReservedSettingKey` reddi silindi (§I ×4 —
//              hash ham ayar ucundan 200 ile YAZILDI)
//   SONDA-8 -> çıkış 1 · 3 ❌ · `list()` ön ek süzgeci silindi (§H liste ×2 + kaynak)
//
// D2 DÜZELTME TURU SONDALARI — 2026-09-03'te ÖLÇÜLDÜ (cp + `md5 -q` ile birebir
// geri alındı; taban sunucusuz **128 geçti / 0 başarısız / 13 atlandı**):
//   SONDA-9  -> 125/4 · `requireSettingsPassword` `PATCH /backups/offsite`
//               zincirinden silindi → §J "zincirde" + "idx" ❌ VE TRIPWIRE ×2 ❌
//               ("ayar YAZAN uç kapısız: admin.routes.ts::/backups/offsite").
//               ⚠️ Tripwire'ın DEĞERİ tam burada: elle liste güncellenmeden yeni
//               bir yazıcı uç doğsaydı yalnız tripwire kırmızı olurdu.
//   SONDA-10 -> 112/16 · `settingsPasswordSchema`den `.regex(...)` düştü →
//               §B'nin üç red kontrolü 200 döndü (Türkçe / baş-boşluklu /
//               boşluklu şifre KABUL edildi) + "hash değişmedi" ❌; kalanı
//               kaskad (son kabul edilen şifre hash'i ezdi → §C/§D/§F).
//   SONDA-11 -> 127/1 · `readHeaderPassword`e `?sp=` yedeği eklendi (KS8) →
//               §C "query `?sp=` ile kapı AÇILMAZ" ❌. ⚠️ ESKİ BEKÇİDE BU SONDA
//               90/0 YEŞİL KALIYORDU — bu satır tam o kör noktanın kapağıdır.
//   SONDA-12 -> 126/2 · USED audit yükü `req.path` yerine `req.originalUrl`e
//               döndü → §C `path` ×2 ❌ (yükte `?sp=sizmamali-deger…` göründü).
//   SONDA-13 -> 127/1 · LOCKED audit'i `justLocked` yerine `blocked` dalına
//               döndü → §F "tur başına ≤1" ❌ (1 yerine 3 satır).
//   SONDA-14 -> 127/1 · `error.middleware`ten `Retry-After` dalı silindi → §N ❌.
// =============================================================================

import * as fs from "node:fs";
import * as path from "node:path";
import type { NextFunction, Request, Response } from "express";
import prisma, { pool } from "../src/lib/prisma";
import featureFlagRouter from "../src/routes/feature-flag.routes";
import adminRouter from "../src/routes/admin.routes";
import { AppError } from "../src/utils/app-error";
import {
  SETTINGS_PASSWORD_HASH_KEY,
  SECURITY_SETTING_PREFIX,
} from "../src/constants/reserved-settings";
import { systemSettingService } from "../src/services/system-setting.service";
import {
  assertSettingsPasswordUsable,
  SETTINGS_PASSWORD_MAX_LENGTH,
} from "../src/services/settings-password.service";
import { errorHandler } from "../src/middlewares/error.middleware";
import bcrypt from "bcryptjs";
import { hedefDbAdi, hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { yorumlariSok } from "./lib/regime-gate-scan";

const SRC = path.join(__dirname, "..", "src");
const BASE = process.env.TEST_API_URL ?? "http://localhost:4112";

/** Bu koşumun sahte şifreleri — GERÇEK bir kurulumda kullanılmaz. */
const DOGRU_SIFRE = `bekci-ayar-sifresi-${process.pid}`;
const YANLIS_SIFRE = "bekci-yanlis-sifre-0000";

/** Kilit kovaları IP bazlıdır; bekçi kendi sahte IP'lerini kullanır. */
const IP_ANA = `10.77.${process.pid % 200}.11`;
const IP_KILIT = `10.77.${process.pid % 200}.12`;

let pass = 0;
let fail = 0;
let atlanan = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
function atla(label: string, sebep: string): void {
  atlanan++;
  console.log(`⏭️  ATLANDI ${label} — ${sebep}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Route zinciri koşturucu (`test_superadmin.ts` sözleşmesinin uzantısı)
//
// ⚠️ `null` dönüşü "reddedildi" DEĞİL "ZİNCİR OKUNAMADI"dır. Sessizce `false`
// saymak bu bekçiyi süse çevirirdi: bir refactor uç yolunu değiştirir, tüm
// "red bekleniyordu → red geldi" kontrolleri vakumen yeşil kalırdı. Bu yüzden
// her bölüm ÖNCE zemin kontrolü yapar.
// ─────────────────────────────────────────────────────────────────────────────
type RouteLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{
      name: string;
      handle: (req: Request, res: Response, next: NextFunction) => unknown;
    }>;
  };
};
type Yontem = "get" | "post" | "put" | "patch" | "delete";

function katmanlar(router: unknown, yontem: Yontem, yol: string) {
  const stack = (router as { stack: RouteLayer[] }).stack;
  const layer = stack.find((l) => l.route?.path === yol && l.route.methods[yontem]);
  return layer?.route?.stack ?? null;
}

interface Sonuc {
  /** Zincir sonuna kadar `next()` ile ilerledi mi (hata yok, yanıt yok)? */
  gecti: boolean;
  hata: unknown;
  /** Handler koştuysa yanıt gövdesi. */
  status: number;
  body: unknown;
}

interface KosumSecenek {
  permissions?: string[];
  body?: unknown;
  headers?: Record<string, string>;
  isSystemAccount?: boolean;
  params?: Record<string, string>;
  /** Query string — ŞİFRE BURADAN OKUNMAMALI (§C davranış kontrolü). */
  query?: Record<string, string>;
  ip?: string;
  userId?: string;
  /** true → son katman (handler) da koşar; false → yalnız middleware'ler. */
  handler?: boolean;
}

function sahteRes() {
  const kayit = { status: 0, body: null as unknown };
  const res: Record<string, unknown> = {};
  res.status = (c: number) => {
    kayit.status = c;
    return res;
  };
  res.json = (b: unknown) => {
    kayit.body = b;
    (res as { __bitti?: () => void }).__bitti?.();
    return res;
  };
  res.send = res.json;
  res.setHeader = () => res;
  return { res: res as unknown as Response, kayit };
}

function tekKatman(
  handle: (req: Request, res: Response, next: NextFunction) => unknown,
  req: Request,
  res: Response,
): Promise<{ ilerledi: boolean; hata: unknown }> {
  return new Promise((resolve) => {
    let bitti = false;
    const t = setTimeout(() => {
      if (!bitti) {
        bitti = true;
        resolve({ ilerledi: false, hata: null });
      }
    }, 5000);
    if (typeof t.unref === "function") t.unref();
    const kapat = (ilerledi: boolean, hata: unknown) => {
      if (bitti) return;
      bitti = true;
      clearTimeout(t);
      resolve({ ilerledi, hata });
    };
    // Yanıt gönderildiyse zincir orada BİTER (handler dalı).
    (res as unknown as { __bitti?: () => void }).__bitti = () => kapat(false, null);
    const next: NextFunction = ((e?: unknown) => kapat(true, e)) as NextFunction;
    try {
      const r = handle(req, res, next);
      if (r && typeof (r as Promise<unknown>).catch === "function") {
        void (r as Promise<unknown>).catch((e) => kapat(true, e));
      }
    } catch (e) {
      kapat(true, e);
    }
  });
}

let aktorId = "00000000-0000-4000-8000-000000000001";

/** Sahte mount ön eki: gerçek Express'te `req.baseUrl` bu, `req.path` mount'a görelidir. */
const MOUNT_ONEKI = "/api/sonda-mount";

async function kostur(
  router: unknown,
  yontem: Yontem,
  yol: string,
  opt: KosumSecenek = {},
): Promise<Sonuc | null> {
  const zincir = katmanlar(router, yontem, yol);
  if (!zincir || zincir.length < 2) return null;
  // İlk katman `verifyToken` OLMAK ZORUNDA (kimliksiz istek 401 alır); kimliği
  // burada simüle ettiğimiz için onu ATLARIZ ama varlığını ölçeriz (§J).
  if (zincir[0]!.name !== "verifyToken") return null;

  const { res, kayit } = sahteRes();
  const req = {
    user: { userId: opt.userId ?? aktorId, permissions: opt.permissions ?? [] },
    body: opt.body ?? {},
    headers: opt.headers ?? {},
    params: opt.params ?? {},
    query: opt.query ?? {},
    ip: opt.ip ?? IP_ANA,
    isSystemAccount: opt.isSystemAccount,
    method: yontem.toUpperCase(),
    // ⚠️ ÜÇ ALAN BİLEREK AYRIŞTIRILIR — gerçek Express'i modellemek için:
    //    `originalUrl` = tam yol + QUERY · `baseUrl` = MOUNT ön eki ·
    //    `path` = mount'a GÖRELİ yol. Audit hangisini yazıyor sorusu ancak
    //    üçü ayrıyken ölçülebilir: salt `req.path` yazımı `PATCH
    //    /api/feature-flags` için "/" üretir (kimlik kaybı, P3 doğrulayıcısı
    //    ölçtü), `originalUrl` ise query'yi sızdırır (KS8).
    baseUrl: MOUNT_ONEKI,
    path: yol,
    originalUrl: `${MOUNT_ONEKI}${yol}${
      opt.query && Object.keys(opt.query).length > 0
        ? `?${new URLSearchParams(opt.query).toString()}`
        : ""
    }`,
  } as unknown as Request;

  const kosulacak = opt.handler ? zincir.slice(1) : zincir.slice(1, -1);
  for (const halka of kosulacak) {
    const { ilerledi, hata } = await tekKatman(halka.handle, req, res);
    if (hata) return { gecti: false, hata, status: kayit.status, body: kayit.body };
    if (!ilerledi) {
      // Yanıt gönderildi (ya da zincir asılı kaldı) → handler dalı bitti.
      return { gecti: false, hata: null, status: kayit.status, body: kayit.body };
    }
  }
  return { gecti: true, hata: null, status: kayit.status, body: kayit.body };
}

function kod(s: Sonuc | null): string {
  const h = s?.hata;
  if (h instanceof AppError) {
    const d = (h as unknown as { details?: { code?: string } }).details;
    return d?.code ?? `(kodsuz ${h.statusCode})`;
  }
  return h ? `(AppError değil: ${String(h)})` : "—";
}
/** `SystemSetting.value` Json kolondur — sır ölçümleri metin üzerinden yapılır. */
function metin(v: unknown): string {
  return typeof v === "string" ? v : v === null || v === undefined ? "" : JSON.stringify(v);
}

function statu(s: Sonuc | null): number {
  const h = s?.hata;
  return h instanceof AppError ? h.statusCode : (s?.status ?? 0);
}

// Kısayollar — üç yazma yüzeyi.
const BAYRAK = (opt: KosumSecenek) => kostur(featureFlagRouter, "patch", "/", opt);
const LOGO = (opt: KosumSecenek) => kostur(featureFlagRouter, "put", "/documents-logo", opt);
const AYAR = (opt: KosumSecenek) =>
  kostur(adminRouter, "put", "/settings/:key", { params: { key: "backupHour" }, ...opt });

const ADMIN = ["admin:settings"];
const basligi = (sifre: string) => ({ "x-settings-password": sifre });

/** Koşum başlangıcı — audit taraması yalnız BU koşumun satırlarına bakar. */
const KOSUM_BASI = new Date();
/** `finally`de geri yüklenecek önceki hash satırı (yoksa null). */
let oncekiHashSatiri: { value: unknown; description: string | null } | null = null;
let hashSatiriVardi = false;

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.error(`\n⛔ DURDURULDU — ${engel}\n`);
    fail++;
    return;
  }
  console.log(`Hedef veritabanı: ${hedefDbAdi()}\n`);

  // Audit yazımı FK'lıdır (`SystemLog.userId`) ve best-effort olduğu için hata
  // SESSİZCE yutulur — uydurma bir UUID kullanılsaydı "USED satırı yazıldı"
  // kontrolü kendi fixture'ı yüzünden vakumen KIRMIZI kalırdı.
  const gercekAktor = await prisma.user.findFirst({
    where: { isSystemAccount: false, isActive: true },
    select: { id: true },
  });
  if (gercekAktor) aktorId = gercekAktor.id;

  // Önceki hâli sakla (fabrika DB'sinde satır YOKTUR — uyuyan kapı korunur).
  const mevcut = await prisma.systemSetting.findUnique({
    where: { key: SETTINGS_PASSWORD_HASH_KEY },
    select: { value: true, description: true },
  });
  hashSatiriVardi = mevcut !== null;
  oncekiHashSatiri = mevcut ? { value: mevcut.value, description: mevcut.description } : null;
  if (hashSatiriVardi) {
    // Kapıyı ölçmek için kendi şifremizi yazacağız; sonunda BİREBİR geri konur.
    console.log("ℹ️  Bu DB'de zaten bir ayar şifresi tanımlı — koşum sonunda birebir geri yazılır.\n");
    await prisma.systemSetting.delete({ where: { key: SETTINGS_PASSWORD_HASH_KEY } });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("=== A) HASH YOKKEN KAPI UYUR (Adnan sıfır fark) ===");
  // ⚠️ ZEMİN: zincirler okunabiliyor mu? Okunamazsa aşağıdaki her "geçti"
  // kontrolü anlamsızdır (null → check false).
  const a1 = await BAYRAK({ permissions: ADMIN, body: { backupHour: 3 } });
  check("PATCH /api/feature-flags zinciri okundu (körlük zemini)", a1 !== null);
  if (a1 === null) return;
  check("hash yok → PATCH /feature-flags şifresiz GEÇER", a1.gecti === true, kod(a1));
  const a2 = await LOGO({ permissions: ADMIN, body: { dataUrl: "data:image/png;base64,AA" } });
  check("hash yok → PUT /feature-flags/documents-logo şifresiz GEÇER", a2?.gecti === true, kod(a2));
  const a3 = await AYAR({ permissions: ADMIN, body: { value: "3" } });
  check("hash yok → PUT /admin/settings/:key şifresiz GEÇER", a3?.gecti === true, kod(a3));
  const a4 = await kostur(featureFlagRouter, "get", "/", { permissions: ADMIN, handler: true });
  const a4data = (a4?.body as { data?: Record<string, unknown> })?.data ?? {};
  check(
    "hash yok → GET /feature-flags `settingsPasswordRequired: false`",
    a4data.settingsPasswordRequired === false,
    JSON.stringify(a4data.settingsPasswordRequired),
  );

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n=== B) Yönetim ucu YALNIZ SÜPERADMİN (403 değil 404) ===");
  // ⚠️ 404 load-bearing: 403 "böyle bir uç var, sen yetkisizsin" der — yani
  // satıcı hesabının ve yönettiği yüzeyin VARLIĞINI doğrular. Fabrika yöneticisi
  // için bu uç hiç YOKTUR (`blockSystemAccountTarget` ile aynı gerekçe).
  for (const [yontem, etiket] of [
    ["get", "GET"],
    ["put", "PUT"],
    ["delete", "DELETE"],
  ] as Array<[Yontem, string]>) {
    const zincir = katmanlar(adminRouter, yontem, "/settings-password");
    check(`${etiket} /admin/settings-password ucu var`, zincir !== null);
    check(
      `${etiket} /admin/settings-password ilk katman verifyToken (kimliksiz → 401)`,
      zincir?.[0]?.name === "verifyToken",
      zincir?.[0]?.name ?? "(yok)",
    );
    const r = await kostur(adminRouter, yontem, "/settings-password", {
      permissions: ["admin:settings", "admin:users"],
      body: { password: DOGRU_SIFRE },
      handler: true,
    });
    check(`${etiket} /admin/settings-password: fabrika admini → 404`, statu(r) === 404, `${statu(r)}`);
  }
  const bSet = await kostur(adminRouter, "put", "/settings-password", {
    isSystemAccount: true,
    body: { password: DOGRU_SIFRE },
    handler: true,
  });
  const bSetData = (bSet?.body as { data?: Record<string, unknown> })?.data ?? {};
  check("süperadmin PUT /admin/settings-password → 200", bSet?.status === 200, `${statu(bSet)}`);
  check("yanıt `configured:true, rotated:false` (ilk tanım)", bSetData.configured === true && bSetData.rotated === false, JSON.stringify(bSetData));
  check(
    "yanıt ŞİFRE/HASH TAŞIMAZ",
    !JSON.stringify(bSet?.body ?? {}).includes(DOGRU_SIFRE) && !JSON.stringify(bSet?.body ?? {}).includes("$2"),
  );
  const bKisa = await kostur(adminRouter, "put", "/settings-password", {
    isSystemAccount: true,
    body: { password: "kisa" },
    handler: true,
  });
  // ⚠️ Zod hatası `AppError` DEĞİLDİR (error.middleware onu 400'e çevirir) —
  // zincir düzeyinde ölçtüğümüz şey "reddedildi mi", HTTP kodu §L'de ölçülür.
  const kisaHata = bKisa?.hata as { name?: string } | undefined;
  check(
    "8 karakterden kısa şifre reddedilir (Zod min)",
    Boolean(kisaHata) && (kisaHata?.name === "ZodError" || statu(bKisa) === 400),
    kisaHata?.name ?? `${statu(bKisa)}`,
  );
  // ── KULLANILAMAZ ŞİFRE SINIFI (D2 bulgusu #2) ─────────────────────────────
  // ⚠️ Şifre `X-Settings-Password` BAŞLIĞIYLA taşınır. HTTP başlık değeri
  // (RFC 7230 field-value) Türkçe harf taşıyamaz — Node/undici/axios istemcide
  // `ByteString` hatası verir (istek HİÇ ÇIKMAZ), curl ham UTF-8 gönderse
  // sunucu latin1 çözer ve bcrypt uyuşmaz. Boşluk da OWS kırpmasına uğrar.
  // ÖLÇÜLDÜ: böyle bir şifre PUT'ta 200 alıyordu ve fabrika, rotasyona kadar
  // BEŞ yazma yüzeyinin hepsinden kilitli kalıyordu. Red YAZMA ANINDA verilir.
  const reddedilmeli: Array<[string, string]> = [
    ["Türkçe karakterli şifre", "Ayarsifresi-Ğüçlü2026"],
    ["baş/son boşluklu şifre", "  bosluklu-sifre-2026"],
    ["içinde boşluk olan şifre", "bosluklu sifre 2026"],
    ["73 karakterlik şifre (bcrypt 72 bayt sınırı)", "A".repeat(73)],
  ];
  for (const [etiket, sifre] of reddedilmeli) {
    const r = await kostur(adminRouter, "put", "/settings-password", {
      isSystemAccount: true,
      body: { password: sifre },
      handler: true,
    });
    const h = r?.hata as { name?: string } | undefined;
    check(
      `${etiket} REDDEDİLİR (sessizce kabul edilmez)`,
      Boolean(h) && (h?.name === "ZodError" || statu(r) === 400),
      h?.name ?? `${statu(r)}`,
    );
  }
  // Reddedilen denemeler DB'ye dokunmadı — hash hâlâ DOĞRU_SIFRE'nin.
  const bHalaDogru = await prisma.systemSetting.findUnique({
    where: { key: SETTINGS_PASSWORD_HASH_KEY },
    select: { value: true },
  });
  check(
    "reddedilen şifreler hash'i DEĞİŞTİRMEDİ (yarım yazım yok)",
    await bcrypt.compare(DOGRU_SIFRE, metin(bHalaDogru?.value)),
  );
  // 72 karakter SINIRDA kabul edilir (kural "72'den uzun", "72" değil).
  check(
    "72 karakter bcrypt tarafından KIRPILMAZ (sınır doğru yerde)",
    !bcrypt.truncates("A".repeat(72)) && bcrypt.truncates("A".repeat(73)),
  );
  // Servis katmanı da kendi başına korur (şema ileride gevşerse).
  let truncHata: unknown = null;
  try {
    assertSettingsPasswordUsable("A".repeat(73));
  } catch (e) {
    truncHata = e;
  }
  check(
    "`assertSettingsPasswordUsable` 400 SETTINGS_PASSWORD_TOO_LONG atar",
    truncHata instanceof AppError &&
      truncHata.statusCode === 400 &&
      (truncHata as unknown as { details?: { code?: string } }).details?.code ===
        "SETTINGS_PASSWORD_TOO_LONG",
    truncHata instanceof AppError ? `${truncHata.statusCode}` : String(truncHata),
  );

  const bGet = await kostur(adminRouter, "get", "/settings-password", {
    isSystemAccount: true,
    handler: true,
  });
  check(
    "süperadmin GET /admin/settings-password → configured:true",
    ((bGet?.body as { data?: { configured?: boolean } })?.data ?? {}).configured === true,
  );
  const hashDb = await prisma.systemSetting.findUnique({
    where: { key: SETTINGS_PASSWORD_HASH_KEY },
    select: { value: true },
  });
  check(
    "hash DB'de bcrypt gövdesi olarak duruyor (düz metin DEĞİL)",
    /^\$2[aby]\$\d\d\$/.test(metin(hashDb?.value)),
    metin(hashDb?.value).slice(0, 7),
  );

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n=== C) Hash VARKEN kapı: REQUIRED → INVALID → geçer ===");
  const c1 = await BAYRAK({ permissions: ADMIN, body: { backupHour: 3 } });
  check("başlıksız PATCH → 403 SETTINGS_PASSWORD_REQUIRED", kod(c1) === "SETTINGS_PASSWORD_REQUIRED" && statu(c1) === 403, `${statu(c1)} ${kod(c1)}`);
  const c2 = await BAYRAK({ permissions: ADMIN, body: { backupHour: 3 }, headers: basligi(YANLIS_SIFRE) });
  check("yanlış şifre → 403 SETTINGS_PASSWORD_INVALID", kod(c2) === "SETTINGS_PASSWORD_INVALID" && statu(c2) === 403, `${statu(c2)} ${kod(c2)}`);
  const c3 = await BAYRAK({ permissions: ADMIN, body: { backupHour: 3, kk1Enabled: true }, headers: basligi(DOGRU_SIFRE) });
  check("doğru şifre → zincir GEÇER", c3?.gecti === true, kod(c3));
  const c4 = await AYAR({ permissions: ADMIN, body: { value: "3" }, headers: basligi(DOGRU_SIFRE) });
  check("doğru şifre → PUT /admin/settings/:key de GEÇER", c4?.gecti === true, kod(c4));
  const c5 = await LOGO({ permissions: ADMIN, body: { dataUrl: "data:image/png;base64,AA" } });
  check("documents-logo başlıksız → 403 REQUIRED (gövde belge muafiyetine DÜŞMEZ)", kod(c5) === "SETTINGS_PASSWORD_REQUIRED", kod(c5));
  const c6 = await kostur(featureFlagRouter, "get", "/", { permissions: ADMIN, handler: true });
  const c6data = (c6?.body as { data?: Record<string, unknown> })?.data ?? {};
  check("hash var → GET /feature-flags `settingsPasswordRequired: true`", c6data.settingsPasswordRequired === true, JSON.stringify(c6data.settingsPasswordRequired));

  // ── ŞİFRE YALNIZ BAŞLIKTAN OKUNUR — DAVRANIŞ KOLU (D2 bulgusu #3 / KS8) ──
  // ⚠️ ESKİ BEKÇİ BURADA KÖRDÜ: §K yalnız METİN regex'iyle "gövdeden okumuyor"
  //    diyordu. `readHeaderPassword`e bir `?sp=` yedeği eklendiğinde koşum
  //    90/0 YEŞİL kaldı. Sink gerçek ve ölçüldü: query string erişim loguna
  //    (morgan) ve USED audit'inin `path` alanına düz metin olarak düşer.
  //    Bu yüzden "yalnız başlık" artık DAVRANIŞLA ölçülür: doğru şifre yanlış
  //    kanalla gelirse kapı AÇILMAMALI.
  const kanallar: Array<[string, KosumSecenek]> = [
    ["gövde `settingsPassword`", { body: { backupHour: 3, settingsPassword: DOGRU_SIFRE } }],
    ["gövde `password`", { body: { backupHour: 3, password: DOGRU_SIFRE } }],
    ["gövde `x-settings-password`", { body: { backupHour: 3, "x-settings-password": DOGRU_SIFRE } }],
    ["query `?sp=`", { body: { backupHour: 3 }, query: { sp: DOGRU_SIFRE } }],
    ["query `?password=`", { body: { backupHour: 3 }, query: { password: DOGRU_SIFRE } }],
    [
      "query `?settingsPassword=`",
      { body: { backupHour: 3 }, query: { settingsPassword: DOGRU_SIFRE } },
    ],
    ["Cookie", { body: { backupHour: 3 }, headers: { cookie: `settingsPassword=${DOGRU_SIFRE}` } }],
    [
      "`Settings-Password` başlığı (yanlış ad)",
      { body: { backupHour: 3 }, headers: { "settings-password": DOGRU_SIFRE } },
    ],
    [
      "`X-Settings-Password-2` başlığı (yanlış ad)",
      { body: { backupHour: 3 }, headers: { "x-settings-password-2": DOGRU_SIFRE } },
    ],
  ];
  for (const [etiket, opt] of kanallar) {
    const r = await BAYRAK({ permissions: ADMIN, ...opt });
    check(
      `DOĞRU şifre ${etiket} ile gelirse kapı AÇILMAZ (403 REQUIRED)`,
      kod(r) === "SETTINGS_PASSWORD_REQUIRED" && statu(r) === 403,
      `${statu(r)} ${kod(r)}`,
    );
  }
  // Zemin: aynı yükü DOĞRU KANALDAN gönderince geçiyor (yukarısı vakumen yeşil değil).
  const cKanalZemin = await BAYRAK({
    permissions: ADMIN,
    body: { backupHour: 3 },
    headers: basligi(DOGRU_SIFRE),
  });
  check("zemin: aynı yük BAŞLIKLA geçer (kanal kontrolleri vakumen değil)", cKanalZemin?.gecti === true, kod(cKanalZemin));

  // Query TAŞIYAN başarılı bir istek — USED audit'i query'yi YAZMAMALI.
  const cQueryIzi = await BAYRAK({
    permissions: ADMIN,
    body: { backupHour: 3 },
    query: { sp: "sizmamali-deger", password: "sizmamali-deger" },
    headers: basligi(DOGRU_SIFRE),
  });
  check("query'li istek doğru başlıkla GEÇER (zemin)", cQueryIzi?.gecti === true, kod(cQueryIzi));

  // Audit: USED satırı yazıldı mı ve yükü TEMİZ mi (best-effort → küçük bekleme).
  await new Promise((r) => setTimeout(r, 400));
  const usedSatirlar = await prisma.systemLog.findMany({
    where: { action: "SETTINGS_PASSWORD_USED", createdAt: { gte: KOSUM_BASI } },
    orderBy: { createdAt: "desc" },
    select: { newData: true },
  });
  check("audit `SETTINGS_PASSWORD_USED` satırı yazıldı", usedSatirlar.length >= 1, `${usedSatirlar.length} satır`);
  const usedYuk = JSON.stringify(usedSatirlar.map((r) => r.newData));
  // ⚠️ `keys` denetimin ASIL sorusudur ("hangi bayrak çevrildi") — bu koşumda
  // iki farklı yüzeyden geçildi, ikisinin de alan listesi yükte olmalı.
  check(
    "USED yükünde `keys` var (hangi alan değiştirildi)",
    usedYuk.includes("keys") && usedYuk.includes("backupHour") && usedYuk.includes("value"),
    usedYuk.slice(0, 160),
  );
  check("USED yükünde ŞİFRE/HASH YOK", !usedYuk.includes(DOGRU_SIFRE) && !usedYuk.includes("$2"), usedYuk.slice(0, 160));
  // ⚠️ `path` QUERY'SİZ olmalı (`req.path`, `req.originalUrl` DEĞİL): query'ye
  //    konan her şey — bir gün şifre de olabilir — denetim tablosuna DÜZ METİN
  //    düşerdi. Yukarıdaki `cQueryIzi` isteği tam da bunu ölçmek için query
  //    taşıyor; `originalUrl`e dönülürse burası KIRMIZI olur (KS8).
  const usedPathlar = usedSatirlar
    .map((r) => (r.newData as { path?: unknown } | null)?.path)
    .filter((v): v is string => typeof v === "string");
  check("zemin: USED yükünde `path` alanı var", usedPathlar.length > 0, `${usedPathlar.length} satır`);
  check(
    "USED `path` QUERY STRING taşımaz (`req.path`, `originalUrl` DEĞİL)",
    usedPathlar.length > 0 && usedPathlar.every((v) => !v.includes("?")),
    usedPathlar.join(" | ").slice(0, 160),
  );
  check(
    "USED `path` ucun TAM yolunu taşır (mount ön eki DAHİL — salt `req.path` DEĞİL)",
    usedPathlar.length > 0 && usedPathlar.every((v) => v.startsWith(MOUNT_ONEKI) && v.length > MOUNT_ONEKI.length),
    `beklenen ön ek ${MOUNT_ONEKI} — gelen: ${usedPathlar.join(" | ").slice(0, 120)}`,
  );
  check(
    "USED `path` query'ye konan değeri SIZDIRMAZ",
    !usedYuk.includes("sizmamali-deger"),
    usedYuk.slice(0, 200),
  );
  const failedSatir = await prisma.systemLog.count({
    where: { action: "SETTINGS_PASSWORD_FAILED", createdAt: { gte: KOSUM_BASI } },
  });
  check("audit `SETTINGS_PASSWORD_FAILED` satırı yazıldı (yanlış deneme izi)", failedSatir >= 1, `${failedSatir} satır`);
  const requiredSatir = await prisma.systemLog.count({
    where: { action: "SETTINGS_PASSWORD_REQUIRED", createdAt: { gte: KOSUM_BASI } },
  });
  // ⚠️ "İstemcinin ilk turu" audit'e YAZILMAZ: her kayıtta bir kez koşar,
  // denetim tablosunu gürültüye boğardı (spec A3 ⑤).
  check("başlıksız ilk tur audit'e YAZILMAZ (gürültü yok)", requiredSatir === 0, `${requiredSatir} satır`);

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n=== D) Belge-only gövde MUAF — ama KARMA gövde DEĞİL (.every) ===");
  const d1 = await BAYRAK({ permissions: ["document-template:write"], body: { documentsConfig: {} } });
  check("yalnız belge anahtarı → şifresiz GEÇER", d1?.gecti === true, kod(d1));
  const d2 = await BAYRAK({ permissions: ["document-template:write"], body: { documentsConfig: {}, travelerCardConfig: {} } });
  check("iki belge anahtarı → şifresiz GEÇER", d2?.gecti === true, kod(d2));
  // ⚠️ EN KRİTİK KONTROL: `.some` yazılsaydı bu gövde şifresiz geçerdi.
  const d3 = await BAYRAK({ permissions: ADMIN, body: { documentsConfig: {}, backupHour: 3 } });
  check("KARMA gövde (belge + ayar) → 403 REQUIRED (.some KAÇAĞI)", kod(d3) === "SETTINGS_PASSWORD_REQUIRED", kod(d3));
  const d4 = await BAYRAK({ permissions: ADMIN, body: {} });
  check("BOŞ gövde muafiyet sayılmaz → 403 REQUIRED", kod(d4) === "SETTINGS_PASSWORD_REQUIRED", kod(d4));

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n=== E) Süperadmin MUAF (kapıyı o kurar) ===");
  const e1 = await BAYRAK({ isSystemAccount: true, permissions: ["*"], body: { backupHour: 3 } });
  check("süperadmin PATCH şifresiz GEÇER", e1?.gecti === true, kod(e1));
  const e2 = await AYAR({ isSystemAccount: true, permissions: ["*"], body: { value: "3" } });
  check("süperadmin PUT /admin/settings/:key şifresiz GEÇER", e2?.gecti === true, kod(e2));

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n=== F) Deneme kilidi — rezervasyon `bcrypt.compare`den ÖNCE ===");
  // KAYNAK KOLU: sıra metinde de ölçülür. Davranış kolu tek başına yeterli
  // görünür ama sıra ters çevrilse bile "sonunda kilitleniyor" gözlemi sürer;
  // ayrışan şey KİLİTLİYKEN ne olduğudur (aşağıdaki f-doğru kontrolü) — ikisi
  // birlikte yolu kapatır.
  const mwKaynak = yorumlariSok(
    fs.readFileSync(path.join(SRC, "middlewares", "settings-password.middleware.ts"), "utf8"),
  );
  const iRez = mwKaynak.indexOf("reserveLoginAttempt(");
  const iCmp = mwKaynak.indexOf("verifySettingsPassword(");
  check("kaynak: `reserveLoginAttempt` çağrısı var", iRez > -1);
  check("kaynak: `verifySettingsPassword` çağrısı var", iCmp > -1);
  check("kaynak: rezervasyon KARŞILAŞTIRMADAN ÖNCE", iRez > -1 && iCmp > -1 && iRez < iCmp, `rez@${iRez} cmp@${iCmp}`);
  check(
    "kaynak: kilit kovaları GİRİŞ kovalarından ayrı (`sp:` ön eki anahtarda)",
    /key:\s*`sp:\$\{spec\.key\}`/.test(mwKaynak),
  );

  // DAVRANIŞ KOLU — kendi sahte IP'siyle (gerçek kovaya dokunulmaz).
  let kilitlendiSonra = 0;
  let sonKod = "";
  for (let i = 1; i <= 8; i++) {
    const r = await BAYRAK({ permissions: ADMIN, body: { backupHour: 3 }, headers: basligi(YANLIS_SIFRE), ip: IP_KILIT });
    sonKod = kod(r);
    if (sonKod === "SETTINGS_PASSWORD_LOCKED") {
      kilitlendiSonra = i;
      break;
    }
  }
  check("ardışık yanlış denemeler → 429 SETTINGS_PASSWORD_LOCKED", kilitlendiSonra > 0, `${kilitlendiSonra}. denemede (son kod: ${sonKod})`);
  if (kilitlendiSonra > 0) {
    const fDogru = await BAYRAK({ permissions: ADMIN, body: { backupHour: 3 }, headers: basligi(DOGRU_SIFRE), ip: IP_KILIT });
    // ⚠️ KİLİTLİYKEN DOĞRU ŞİFRE DE 429: rezervasyonun compare'den ÖNCE
    // koştuğunun DAVRANIŞSAL kanıtı. Ters sırada burası 200 dönerdi.
    check("kilitliyken DOĞRU şifre de 429 (sıranın davranışsal kanıtı)", kod(fDogru) === "SETTINGS_PASSWORD_LOCKED" && statu(fDogru) === 429, `${statu(fDogru)} ${kod(fDogru)}`);
    const fBasliksiz = await BAYRAK({ permissions: ADMIN, body: { backupHour: 3 }, ip: IP_KILIT });
    check("kilitliyken başlıksız istek de 429 (kilit REQUIRED'dan önce)", kod(fBasliksiz) === "SETTINGS_PASSWORD_LOCKED", kod(fBasliksiz));
    // ⚠️ TEK SATIR: kilit bir DURUM değil bir GEÇİŞTİR (D2 bulgusu #4).
    //    Eskiden audit `blocked` dalında yazılıyordu, yani kilitliyken gelen
    //    HER istek bir satır üretiyordu (60 paralel istek → +60 satır ölçüldü):
    //    yetkili bir oturumdan `system_logs`u şişirmenin bedava yolu ve asıl
    //    sinyali ("kim, ne zaman kilitlendi") gürültüye gömen bir sel.
    //    Bu koşumda kilit BİR KEZ kuruldu; üstüne EN AZ ÜÇ bloklu istek geldi
    //    (429 kod ölçümü + doğru şifre + başlıksız) → satır sayısı yine 1.
    await new Promise((r) => setTimeout(r, 300));
    const lockedSatir = await prisma.systemLog.count({
      where: { action: "SETTINGS_PASSWORD_LOCKED", createdAt: { gte: KOSUM_BASI } },
    });
    check("audit `SETTINGS_PASSWORD_LOCKED` satırı yazıldı", lockedSatir >= 1, `${lockedSatir} satır`);
    check(
      "KİLİT TURU BAŞINA EN FAZLA 1 LOCKED satırı (429 seli YOK)",
      lockedSatir === 1,
      `${lockedSatir} satır — bloklu istek sayısı ≥3`,
    );
    // Süperadmin kilitten de MUAF (kapı ①'de biter — kurtarma yolu kapanmasın).
    const fSuper = await BAYRAK({ isSystemAccount: true, permissions: ["*"], body: { backupHour: 3 }, ip: IP_KILIT });
    check("kilitli IP'den bile süperadmin GEÇER (kurtarma yolu)", fSuper?.gecti === true, kod(fSuper));
  } else {
    atla("kilit davranışı", "kilit hiç kurulmadı (auth.pinLockoutEnabled kapalı olabilir) — 4 kontrol ölçülmedi");
    atlanan += 4;
  }
  // §C/§D'nin ana kovası kilitlenmediğini doğrula (kova ayrımı: farklı IP).
  const fAna = await BAYRAK({ permissions: ADMIN, body: { backupHour: 3 }, headers: basligi(DOGRU_SIFRE) });
  check("kilit YALNIZ kendi kovasında (ana IP hâlâ geçer)", fAna?.gecti === true, kod(fAna));

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n=== H) SIR HİJYENİ (§12 kural 8): hash hiçbir yüzeyde görünmez ===");
  const hashDegeri = metin(
    (
      await prisma.systemSetting.findUnique({
        where: { key: SETTINGS_PASSWORD_HASH_KEY },
        select: { value: true },
      })
    )?.value,
  );
  check(
    "zemin: hash satırı bu noktada TANIMLI (aksi halde §H vakumen yeşil olurdu)",
    hashDegeri.length > 20,
  );

  const liste = await systemSettingService.list();
  const listeMetni = JSON.stringify(liste);
  const listeSatirlari = (liste as { data?: Array<{ key?: string }> }).data ?? [];
  check(
    "zemin: ayar listesi DOLU (süzgeç her şeyi silmedi)",
    listeSatirlari.length > 5,
    `${listeSatirlari.length} satır`,
  );
  check(
    "ayar listesinde `security.` ön ekli satır YOK",
    !listeSatirlari.some((r) => (r.key ?? "").startsWith(SECURITY_SETTING_PREFIX)),
  );
  check("ayar listesi yükünde bcrypt gövdesi YOK", hashDegeri.length > 0 && !listeMetni.includes(hashDegeri));

  const bayrakYuku = JSON.stringify(c6data);
  check(
    "bayrak yükünde `security` ön ekli alan YOK",
    !Object.keys(c6data).some((k) => k.startsWith("security")),
  );
  check("bayrak yükünde bcrypt gövdesi YOK", hashDegeri.length > 0 && !bayrakYuku.includes(hashDegeri));
  check("bayrak yükünde `settingsPasswordHash` alanı YOK", !bayrakYuku.includes("settingsPasswordHash"));

  // ⚠️ AUDIT TARAMASI HAM SQL İLE, TÜM KOLONLAR ÜZERİNDE (`to_jsonb(satır)`):
  // sır yalnız `newData`ya değil `changes`/`oldData`ya da sızabilir ve maskeleme
  // YALNIZ `changes` kolonuna uygulanır (audit-diff.helper başlığı).
  const sifreIzi = await prisma.$queryRaw<Array<{ c: number }>>`
    SELECT count(*)::int AS c FROM system_logs
    WHERE "createdAt" >= ${KOSUM_BASI} AND to_jsonb(system_logs)::text LIKE ${`%${DOGRU_SIFRE}%`}`;
  check("system_logs'ta DÜZ ŞİFRE metni 0 satır", (sifreIzi[0]?.c ?? -1) === 0, `${sifreIzi[0]?.c} satır`);
  const hashIzi = await prisma.$queryRaw<Array<{ c: number }>>`
    SELECT count(*)::int AS c FROM system_logs
    WHERE "createdAt" >= ${KOSUM_BASI} AND to_jsonb(system_logs)::text LIKE ${`%${hashDegeri}%`}`;
  check("system_logs'ta BCRYPT GÖVDESİ 0 satır", (hashIzi[0]?.c ?? -1) === 0, `${hashIzi[0]?.c} satır`);

  // ⚠️ TRIPWIRE — bugün vakumen doğru, yarın olmayabilir: yapılandırma paketi
  // (`config-bundle`) beş şablon türünü taşır ve `system_settings`e HİÇ dokunmaz,
  // yani dışa aktarımda hash yoktur. Pakete bir "ayar" türü eklenirse bu kontrol
  // KIRMIZI olur ve ön ek süzgeci oraya da uygulanmalıdır.
  const bundleKaynak = yorumlariSok(
    fs.readFileSync(path.join(SRC, "services", "import", "config-bundle.service.ts"), "utf8"),
  );
  check(
    "config-bundle `system_settings`e dokunmuyor (tripwire: dokunursa süzgeç gerekir)",
    !bundleKaynak.includes("systemSetting"),
  );

  const ayarKaynak = yorumlariSok(
    fs.readFileSync(path.join(SRC, "services", "system-setting.service.ts"), "utf8"),
  );
  const listeIdx = ayarKaynak.indexOf("async list(");
  const listeGovde = listeIdx > -1 ? ayarKaynak.slice(listeIdx, listeIdx + 600) : "";
  check(
    "`list()` gövdesinde ÖN EK süzgeci var (tek anahtar değil)",
    listeGovde.includes("SECURITY_SETTING_PREFIX") && listeGovde.includes("startsWith"),
  );

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n=== L) HTTP turu (sunucu yoksa ATLANIR) ===");
  const HTTP_KONTROL = 12;
  if (!(await sunucuAyakta())) {
    atla("HTTP turu", `${BASE} ayakta değil — ${HTTP_KONTROL} kontrol ölçülmedi`);
    atlanan += HTTP_KONTROL;
  } else {
    await httpTuru(hashDegeri, HTTP_KONTROL);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n=== G) İPTAL → kapı UYUR (sıfır farka geri dönüş) ===");
  const g1 = await kostur(adminRouter, "delete", "/settings-password", {
    isSystemAccount: true,
    handler: true,
  });
  const g1data = (g1?.body as { data?: Record<string, unknown> })?.data ?? {};
  check("süperadmin DELETE /admin/settings-password → 200", g1?.status === 200, `${statu(g1)}`);
  check(
    "yanıt `configured:false, removed:true`",
    g1data.configured === false && g1data.removed === true,
    JSON.stringify(g1data),
  );
  const g2 = await BAYRAK({ permissions: ADMIN, body: { backupHour: 3 } });
  check("iptal sonrası PATCH şifresiz GEÇER (kapı uyudu)", g2?.gecti === true, kod(g2));
  const g3 = await kostur(featureFlagRouter, "get", "/", { permissions: ADMIN, handler: true });
  const g3data = (g3?.body as { data?: Record<string, unknown> })?.data ?? {};
  check(
    "iptal sonrası `settingsPasswordRequired: false`",
    g3data.settingsPasswordRequired === false,
    JSON.stringify(g3data.settingsPasswordRequired),
  );
  await new Promise((r) => setTimeout(r, 300));
  const revokeSatir = await prisma.systemLog.count({
    where: { action: "SETTINGS_PASSWORD_REVOKED", createdAt: { gte: KOSUM_BASI } },
  });
  check("audit `SETTINGS_PASSWORD_REVOKED` satırı yazıldı", revokeSatir >= 1, `${revokeSatir} satır`);
  const setSatir = await prisma.systemLog.count({
    where: { action: "SETTINGS_PASSWORD_SET", createdAt: { gte: KOSUM_BASI } },
  });
  check("audit `SETTINGS_PASSWORD_SET` satırı yazıldı", setSatir >= 1, `${setSatir} satır`);

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n=== I) Hash HAM AYAR UCUNDAN yazılamaz (400 SETTING_KEY_RESERVED) ===");
  // ⚠️ Bu kontrol kapı UYURKEN koşar: ret şifreye DEĞİL anahtara bağlıdır.
  const i1 = await kostur(adminRouter, "put", "/settings/:key", {
    permissions: ADMIN,
    params: { key: SETTINGS_PASSWORD_HASH_KEY },
    body: { value: "sahte-hash-degeri-degil-bcrypt" },
    handler: true,
  });
  check("PUT /admin/settings/security.settingsPasswordHash → 400", statu(i1) === 400, `${statu(i1)}`);
  check("hata kodu SETTING_KEY_RESERVED", kod(i1) === "SETTING_KEY_RESERVED", kod(i1));
  const i2 = await kostur(adminRouter, "put", "/settings/:key", {
    permissions: ADMIN,
    params: { key: "security.yarinEklenecekBirSir" },
    body: { value: "x" },
    handler: true,
  });
  check(
    "ret ÖN EK bazlı (`security.*` tümü) — gelecekteki sır satırı da kapalı",
    kod(i2) === "SETTING_KEY_RESERVED",
    kod(i2),
  );
  const i3 = await prisma.systemSetting.findUnique({ where: { key: SETTINGS_PASSWORD_HASH_KEY } });
  check("reddedilen yazım DB'ye HİÇ düşmedi", i3 === null);
  // ⚠️ Bu kontrol GERÇEKTEN YAZAR (ret DAR mı diye ölçtüğümüz şey yazımın
  // kendisidir) → önce mevcut değeri okur, sonra BİREBİR geri koyar. Bekçi
  // fabrikanın yedek saatini değiştirmez.
  const oncekiBackup = await prisma.systemSetting.findUnique({
    where: { key: "backupHour" },
    select: { value: true, description: true },
  });
  const i4 = await kostur(adminRouter, "put", "/settings/:key", {
    permissions: ADMIN,
    params: { key: "backupHour" },
    body: { value: metin(oncekiBackup?.value) || "3" },
    handler: true,
  });
  check("normal ayar anahtarı hâlâ yazılabilir (ret DAR)", statu(i4) !== 400, `${statu(i4)}`);
  if (oncekiBackup === null) {
    await prisma.systemSetting.deleteMany({ where: { key: "backupHour" } });
  } else {
    await prisma.systemSetting.update({
      where: { key: "backupHour" },
      data: { value: oncekiBackup.value as string, description: oncekiBackup.description },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n=== J) Kapı ÜÇ YAZMA YÜZEYİNİN zincirinde (router stack'ten) ===");
  // ⚠️ METİN DEĞİL KATMAN ADI: zincirler import edilmiş GERÇEK router'dan okunur.
  // Grep'le ölçülseydi, import edilip route'a takılmayan bir middleware yeşil
  // kalırdı (aynı sınıf: "alan eklemek yetmez, hangi YANITTA döndüğünü doğrula").
  const KAPI = "requireSettingsPassword";
  const yuzeyler: Array<[string, unknown, Yontem, string, string]> = [
    ["PATCH /api/feature-flags", featureFlagRouter, "patch", "/", "flagWriteGuard"],
    ["PUT /api/feature-flags/documents-logo", featureFlagRouter, "put", "/documents-logo", ""],
    ["PUT /api/admin/settings/:key", adminRouter, "put", "/settings/:key", ""],
    // ⚠️ 2026-09-03 / D2 bulgusu #1 — BU İKİSİ KAPSAM DIŞINDA KALMIŞTI.
    //    "Yedek" ekranında yaşıyorlar ama `systemSettingService.set()` ile
    //    `system_settings`e yazıyorlar; yazdıkları şey YEDEKLERİN GİDECEĞİ
    //    YERDİR (gece dökümü = kullanıcı hash'leri + PIN/kart + ayar şifresi
    //    hash'i). Ölçümde açık kalmış admin oturumundan ŞİFRESİZ 200 alındı.
    ["PATCH /api/admin/backups/offsite", adminRouter, "patch", "/backups/offsite", ""],
    ["POST /api/admin/backups/offsite/authorize", adminRouter, "post", "/backups/offsite/authorize", ""],
  ];
  for (const [etiket, router, yontem, yol, oncekiKatman] of yuzeyler) {
    const zincir = katmanlar(router, yontem, yol);
    const adlar = (zincir ?? []).map((k) => k.name);
    check(`${etiket}: zincir okundu (körlük zemini)`, zincir !== null, adlar.join(" → "));
    const idx = adlar.indexOf(KAPI);
    check(`${etiket}: \`${KAPI}\` zincirde`, idx > -1, adlar.join(" → "));
    check(`${etiket}: ilk katman verifyToken (kimliksiz → 401)`, adlar[0] === "verifyToken", adlar[0] ?? "(yok)");
    // Kapı İZİN KARARINDAN SONRA, handler'dan HEMEN ÖNCE olmalı: ters sırada
    // yetkisiz bir kullanıcı da şifre denemesi yakarak meşru yöneticiyi kilitler.
    check(
      `${etiket}: kapı izin katmanından SONRA, handler'dan hemen ÖNCE`,
      idx > 0 && idx === adlar.length - 2,
      `idx=${idx}, uzunluk=${adlar.length}`,
    );
    if (oncekiKatman) {
      const gIdx = adlar.indexOf(oncekiKatman);
      check(
        `${etiket}: \`${oncekiKatman}\` kapıdan ÖNCE (senkron guard bozulmaz)`,
        gIdx > -1 && gIdx < idx,
        `${oncekiKatman}@${gIdx} ${KAPI}@${idx}`,
      );
    }
  }
  // OKUMA yüzeyi kapıyı TAŞIMAZ (kapı yalnız yazmada — okuma 403'e düşerse panel açılmaz).
  const getAdlar = (katmanlar(featureFlagRouter, "get", "/") ?? []).map((k) => k.name);
  check("GET /api/feature-flags kapıyı TAŞIMAZ (okuma serbest)", !getAdlar.includes(KAPI), getAdlar.join(" → "));

  // ── TRIPWIRE: ALTINCI YÜZEY KAPISIZ DOĞAMAZ ────────────────────────────────
  // ⚠️ Yukarıdaki liste ELLE yazılır ve bu onun körlüğüdür: spec "üç yazma
  //    yüzeyi" dedi, ölçüm iki tane daha buldu (D2 #1). Elle listeyi genişletmek
  //    aynı hatayı bir kez daha yapmaya davettir. Bu yüzden kapsamın yüklemi
  //    ARTIK ADLARDAN DEĞİL DAVRANIŞTAN türer: `src/routes/**` içinde ayar
  //    yazan HER uç bloğu (`systemSettingService.set(` / `setFeatureFlags(` /
  //    `systemSetting.upsert(`) zincirinde `requireSettingsPassword` TAŞIMALI.
  //    Muafiyet mümkün ama GEREKÇELİ ve İKİ YÖNLÜ denetlenir (artık uymayan bir
  //    muafiyet de kırmızıdır — ölü muaf satırı yarınki kaçağı gizler).
  {
    const YAZICI_KALIPLARI = [
      "systemSettingService.set(",
      "setFeatureFlags(",
      "systemSetting.upsert(",
    ];
    /**
     * `dosya::yolAdı` → gerekçe. Dolduran kişi gerekçeyi YAZAR (ölü satır da kırmızı).
     *
     * ⚠️ TRIPWIRE'IN SINIRI: yalnız route dosyasında LİTERAL çağrıyı görür.
     *    SERVİS üzerinden dolaylı yazan uç (ör. `db-copy.service` içindeki
     *    `prisma.systemSetting.upsert`) bu taramaya GİRMEZ — böyle bir uç
     *    bulunduğunda elle bu listeye ya da §J'nin adlı listesine yazılır.
     *    P3 doğrulayıcısı üç böyle uç ölçtü (aşağıda) ve karar burada yazılı.
     */
    const MUAF: Record<string, string> = {};

    // ── DOLAYLI YAZICILAR (tripwire'ın GÖREMEDİĞİ sınıf — karar kaydı) ───────
    // Tripwire route dosyasındaki LİTERAL çağrıyı arar; servis üzerinden yazan
    // uç ona görünmez. P3 doğrulayıcısı böyle ÜÇ uç ölçtü ve kararı burada:
    //   `db-copy.routes.ts` POST / · POST /:name/verify · DELETE /:name
    //   → `db-copy.service` `prisma.systemSetting.upsert` ile `dbRestore.copies`
    //     anahtarını yazar. KAPI TAKILMADI: yazdığı şey politika AYARI değil
    //     MAKİNE DEFTERİ (hangi kopya ne zaman alındı); ayar şifresinin koruduğu
    //     senaryo "açık oturumdan DAVRANIŞ değiştirilmesi" ve kopya alma zaten
    //     `admin:settings` + kendi onay akışıyla korunuyor.
    // ⚠️ Bu liste MUAF değildir (tripwire onları hiç bulmaz, muaf ölü kalırdı) —
    //    bayatlamasın diye aşağıdaki kontrol dolaylı yazımın HÂLÂ var olduğunu ölçer.
    {
      const dbCopySrc = fs.readFileSync(path.join(SRC, "services", "db-copy.service.ts"), "utf8");
      check(
        "dolaylı yazıcı kaydı bayat değil: db-copy.service hâlâ systemSetting'e yazıyor",
        /systemSetting\.(upsert|update|create)\(/.test(yorumlariSok(dbCopySrc)),
        "yazmıyorsa yukarıdaki karar kaydı silinmeli (ölü gerekçe)",
      );
    }
    const kullanilanMuaf = new Set<string>();

    const routesDir = path.join(SRC, "routes");
    // ⚠️ ÖZYİNELİ: `src/routes/` altında ALT DİZİNLER var (`reports/` 8 dosya).
    //    Düz `readdirSync` onları görmez ve P3 doğrulayıcısı bunu ÖLÇTÜ: alt
    //    dizindeki kapısız bir yazıcı uçla bekçi 128/0 YEŞİL kalıyordu.
    const dosyalar = fs
      .readdirSync(routesDir, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".ts"))
      .sort();
    check("zemin: route dosyaları okundu", dosyalar.length > 10, `${dosyalar.length} dosya`);
    check(
      "zemin: ALT DİZİN dosyaları da okundu (özyineli tarama)",
      dosyalar.some((f) => f.includes("/")),
      dosyalar.filter((f) => f.includes("/")).length + " alt dizin dosyası",
    );

    const bulunanlar: string[] = [];
    let kapisiz = 0;
    for (const dosya of dosyalar) {
      // ⚠️ YORUMLAR SÖKÜLÜR: bu bekçinin ve kaynağın kendi açıklama satırları
      //    kalıpları METİN olarak içerir; sökülmezse her dosya "yazıcı" sanılır.
      const kaynak = yorumlariSok(fs.readFileSync(path.join(routesDir, dosya), "utf8"));
      // Uç blokları: bir `router.<yöntem>(`den bir SONRAKİNE kadar.
      const kayitlar = [...kaynak.matchAll(/router\.(get|post|put|patch|delete|use)\(/g)];
      for (let i = 0; i < kayitlar.length; i++) {
        const bas = kayitlar[i]!.index ?? 0;
        const son = i + 1 < kayitlar.length ? (kayitlar[i + 1]!.index ?? kaynak.length) : kaynak.length;
        const blok = kaynak.slice(bas, son);
        if (!YAZICI_KALIPLARI.some((k) => blok.includes(k))) continue;
        const yolAdi = blok.match(/^router\.\w+\(\s*\n?\s*"([^"]*)"/)?.[1] ?? "(yolsuz)";
        const anahtar = `${dosya}::${yolAdi}`;
        bulunanlar.push(anahtar);
        if (MUAF[anahtar]) {
          kullanilanMuaf.add(anahtar);
          continue;
        }
        if (!blok.includes(KAPI)) {
          kapisiz++;
          check(`ayar YAZAN uç kapısız: ${anahtar}`, false, "zincirde `requireSettingsPassword` YOK");
        }
      }
    }
    // ⚠️ Zemin: tarayıcı gerçekten YAZICI blok buluyor mu ve BİLDİĞİMİZ üçünü
    //    de görüyor mu? Puf bir sayı (">0") yetmez: regex bozulunca ya da dosya
    //    taşınınca döngü sessizce hiçbir şey ölçmez ve tripwire vakumen yeşile
    //    döner — yani tam da eklenme sebebi kaybolur.
    //    ⚠️ `POST /backups/offsite/authorize` bu listede YOKTUR ve olması da
    //    gerekmez: o uç `system_settings`e değil rclone yapılandırma DOSYASINA
    //    yazar (`writeRcloneDriveToken`). Kapısı §J'nin elle listesinde ölçülür;
    //    tripwire yalnız "ayar tablosuna yazan" sınıfı tarar.
    const BEKLENEN = [
      "admin.routes.ts::/settings/:key",
      "admin.routes.ts::/backups/offsite",
      "feature-flag.routes.ts::/",
    ];
    for (const beklenen of BEKLENEN) {
      check(
        `zemin: tripwire ayar YAZAN ucu görüyor — ${beklenen}`,
        bulunanlar.includes(beklenen),
        bulunanlar.join(", "),
      );
    }
    check("ayar yazan HER uç ayar şifresi kapısını taşıyor", kapisiz === 0, `${kapisiz} kapısız`);
    const oluMuaf = Object.keys(MUAF).filter((k) => !kullanilanMuaf.has(k));
    check(
      "muaf listesi ÖLÜ satır taşımıyor (iki yönlü denetim)",
      oluMuaf.length === 0,
      oluMuaf.join(", "),
    );

    // ── Electron AYNASI (sınır sabitleri) ───────────────────────────────────
    // ⚠️ Backend sınırı daralırsa panel kartı geçerli gösterir, kayıt 400 alır
    //    ve sebebi hiçbir yerde yazmaz (P3 doğrulayıcısı ölçtü: backend 72→64
    //    yapıldığında iki tarafın testleri de yeşil kaldı). Emsal:
    //    `test_document_template_permission`ın Electron `permissions.ts` aynası.
    //    İki taraf da METİNDEN okunur: sabit hangi dosyada olursa olsun ayna tutar.
    const elServis = path.join(SRC, "..", "..", "Electron", "src", "services", "systemSettingService.ts");
    const beCharsetSrc = fs.readFileSync(path.join(SRC, "routes", "admin.routes.ts"), "utf8");
    const beCharset = beCharsetSrc.match(/SETTINGS_PASSWORD_CHARSET\s*=\s*(\/[^;\n]+\/)/)?.[1] ?? null;
    check("zemin: backend CHARSET sabiti okunabildi", beCharset !== null, String(beCharset));
    if (fs.existsSync(elServis)) {
      const el = fs.readFileSync(elServis, "utf8");
      const elMax = el.match(/SETTINGS_PASSWORD_MAX_LENGTH\s*=\s*(\d+)/)?.[1] ?? null;
      const elCharset = el.match(/SETTINGS_PASSWORD_CHARSET\s*=\s*(\/[^;\n]+\/)/)?.[1] ?? null;
      check(
        "Electron aynası: MAX_LENGTH backend ile birebir",
        elMax === String(SETTINGS_PASSWORD_MAX_LENGTH),
        `Electron=${elMax ?? "yok"} · backend=${SETTINGS_PASSWORD_MAX_LENGTH}`,
      );
      check(
        "Electron aynası: CHARSET backend ile birebir",
        elCharset !== null && elCharset === beCharset,
        `Electron=${elCharset ?? "yok"} · backend=${beCharset ?? "yok"}`,
      );
    } else {
      atla("Electron aynası", "Electron dosyası yok (backend-only checkout) — 2 kontrol ölçülmedi");
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n=== N) 429 sözleşmesi: `Retry-After` başlığı (tek noktadan) ===");
  // ⚠️ Süreyi HESAPLAYAN yer `details.retryAfterSec` yazar, BAŞLIĞI basan yer
  //    `error.middleware`dir. İki yerde hesaplansaydı ayrışırlardı; kilit
  //    yolları (`LOGIN_LOCKED`, `SETTINGS_PASSWORD_LOCKED`) eskiden başlığı
  //    HİÇ basmıyordu — repo'nun kendi hız sınırlayıcısı basıyordu (tutarsızlık).
  {
    const basliklar = new Map<string, string>();
    const sahte = {
      headersSent: false,
      setHeader: (k: string, v: string) => basliklar.set(k.toLowerCase(), v),
      status: () => sahte,
      json: () => sahte,
    } as unknown as Response;
    const req429 = { method: "PATCH", originalUrl: "/api/feature-flags" } as unknown as Request;
    errorHandler(
      AppError.tooManyRequests("Çok fazla hatalı ayar şifresi denemesi.", {
        code: "SETTINGS_PASSWORD_LOCKED",
        retryAfterSec: 60,
      }),
      req429,
      sahte,
      (() => undefined) as NextFunction,
    );
    check("429 + retryAfterSec → `Retry-After` başlığı basılır", basliklar.get("retry-after") === "60", basliklar.get("retry-after") ?? "(yok)");

    basliklar.clear();
    errorHandler(
      AppError.forbidden("Bu değişiklik için ayar şifresi gerekli.", {
        code: "SETTINGS_PASSWORD_REQUIRED",
      }),
      req429,
      sahte,
      (() => undefined) as NextFunction,
    );
    check("403 yolunda `Retry-After` BASILMAZ (dar kural)", !basliklar.has("retry-after"), basliklar.get("retry-after") ?? "(yok)");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n=== K) Hash yazımı `systemSettingService.set()` KULLANMAZ ===");
  // ⚠️ NEDEN: `set()` her yazımda `AuditService.log`u `oldData`/`newData` ile
  // çağırır ve o iki kolon HAM yazılır (maskeleme yalnız `changes` kolonuna
  // uygulanır). Yani `set()` ile yazılan bir hash denetim tablosuna DÜZ METİN
  // düşer ve `system_logs`u okuyabilen herkes çevrimdışı kırma gövdesini alır.
  const servisKaynak = yorumlariSok(
    fs.readFileSync(path.join(SRC, "services", "settings-password.service.ts"), "utf8"),
  );
  check("settings-password.service `prisma.systemSetting.upsert` kullanır", servisKaynak.includes("prisma.systemSetting.upsert"));
  check(
    "settings-password.service `systemSettingService` HİÇ import etmez",
    !servisKaynak.includes("systemSettingService"),
  );
  check(
    "settings-password.service `AuditService.logEvent` ile ayrı iz yazar",
    servisKaynak.includes("AuditService.logEvent"),
  );
  check(
    "settings-password.service `AuditService.log(` (diff'li) KULLANMAZ",
    !/AuditService\.log\s*\(/.test(servisKaynak),
  );
  // Yükte sır yok — kaynakta da ölçülür (ölçüm + niyet birlikte).
  const yukSatirlari = servisKaynak.match(/payload:\s*\{[^}]*\}/g) ?? [];
  check("audit yüklerinde `hash`/`password` anahtarı YOK", yukSatirlari.length > 0 && !yukSatirlari.some((y) => /hash|password|sifre/i.test(y)), yukSatirlari.join(" | "));
  const mwYuk = mwKaynak.match(/payload:\s*\{[\s\S]{0,200}?\}/g) ?? [];
  check("middleware audit yüklerinde `hash`/`password` anahtarı YOK", mwYuk.length > 0 && !mwYuk.some((y) => /hash|password|sifre/i.test(y)), `${mwYuk.length} yük`);
  check(
    "middleware şifreyi BAŞLIKTAN okur (gövdeden DEĞİL)",
    mwKaynak.includes("SETTINGS_PASSWORD_HEADER") && mwKaynak.includes("req.headers[") && !/req\.body\S*password/i.test(mwKaynak),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
async function sunucuAyakta(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * HTTP ayağı — kapıyı UÇTAN UCA ölçer (gerçek Express zinciri + hata
 * middleware'i + gerçek `details.code` gövdesi). In-process ölçüm zinciri
 * doğrular ama `error.middleware`in kodu GÖVDEYE taşıdığını ölçmez; istemci
 * (Electron diyaloğu) tam da o alanı okur.
 *
 * Kullanıcı: `p2test` (admin:users + admin:settings) — parolası bilinen tek
 * fabrika-dışı hesap. Giriş düşerse ölçüm ATLANIR (sözleşme ihlali değil).
 *
 * ⚠️ BU AYAK KENDİ KİLİT KOVASINI YAKAR ve bu KAÇINILMAZ: gerçek HTTP isteği
 *    gerçek IP'den gelir (`sp:127.0.0.1`), sahte IP enjekte edilemez. Her koşum
 *    bir YANLIŞ deneme bırakır (`releaseLoginAttempt` yalnız kendi artışını
 *    düşer, birikmiş gerçek hataları SİLMEZ — F49 kuralı) → beşinci ardışık
 *    koşumda kova kilitlenir ve 60 sn sonra kendiliğinden çözülür. ÖLÇÜLDÜ.
 *    Bu bir SÖZLEŞME İHLALİ DEĞİL, ölçüm penceresinin kapanmasıdır: kilit
 *    görülünce kalan kontroller ATLANIR ve bant sebebi yazar. Sessizce
 *    "başarısız" saymak, doğru çalışan bir kapıyı kırmızı gösterirdi.
 */
async function httpTuru(hashDegeri: string, HTTP_KONTROL: number): Promise<void> {
  let basilan = 0;
  const hcheck = (label: string, ok: boolean, detail = ""): void => {
    basilan++;
    check(label, ok, detail);
  };
  const kilitliAtla = (nerede: string): void => {
    const kalan = HTTP_KONTROL - basilan;
    atla(
      "HTTP turu (kilit)",
      `${nerede} 429 SETTINGS_PASSWORD_LOCKED — ardışık koşum kovayı doldurdu, ` +
        `~60 sn sonra tekrar koş; ${kalan} kontrol ölçülmedi`,
    );
    atlanan += kalan;
  };
  const kilitliMi = (status: number, govde: { details?: { code?: string } }): boolean =>
    status === 429 && govde.details?.code === "SETTINGS_PASSWORD_LOCKED";

  const giris = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "p2test", password: "test123", clientType: "electron" }),
  });
  if (!giris.ok) {
    atla("HTTP turu", `p2test giriş yapamadı (${giris.status}) — ${HTTP_KONTROL} kontrol ölçülmedi`);
    atlanan += HTTP_KONTROL;
    return;
  }
  const token = ((await giris.json()) as { data: { token: string } }).data.token;
  const auth: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const me = (await (await fetch(`${BASE}/api/auth/me`, { headers: auth })).json()) as {
    data?: Record<string, unknown>;
  };
  hcheck(
    "HTTP: /auth/me `settingsPasswordRequired: true`",
    me.data?.settingsPasswordRequired === true,
    JSON.stringify(me.data?.settingsPasswordRequired),
  );

  const bayraklar = (await (await fetch(`${BASE}/api/feature-flags`, { headers: auth })).json()) as {
    data?: Record<string, unknown>;
  };
  hcheck(
    "HTTP: GET /feature-flags `settingsPasswordRequired: true`",
    bayraklar.data?.settingsPasswordRequired === true,
  );

  // ⚠️ Gerçek değeri DEĞİŞTİRMEDEN yazarız (bekçi durum bozmaz) — ama "aynı
  //    değeri yazmak" YETMEZ: satır HİÇ YOKSA `setFeatureFlags` onu YARATIR
  //    (`backupHour` → `backup.hour`) ve bekçi kendi izini bırakır. ÖLÇÜLDÜ:
  //    ilk HTTP koşumu `system_settings`e kalıcı bir satır ekledi (43 → 44).
  //    Bu yüzden satırın ÖNCEKİ hâli saklanır ve tur sonunda geri konur.
  const oncekiYedekSaati = await prisma.systemSetting.findUnique({
    where: { key: "backup.hour" },
    select: { value: true, description: true },
  });
  const yedekSaatiniGeriKoy = async (): Promise<void> => {
    if (oncekiYedekSaati === null) {
      await prisma.systemSetting.deleteMany({ where: { key: "backup.hour" } });
    } else {
      await prisma.systemSetting.update({
        where: { key: "backup.hour" },
        data: { value: oncekiYedekSaati.value as string, description: oncekiYedekSaati.description },
      });
    }
  };
  const govde = JSON.stringify({ backupHour: bayraklar.data?.backupHour ?? 3 });

  const y1 = await fetch(`${BASE}/api/feature-flags`, { method: "PATCH", headers: auth, body: govde });
  const y1b = (await y1.json()) as { details?: { code?: string } };
  if (kilitliMi(y1.status, y1b)) {
    kilitliAtla("başlıksız PATCH");
    await yedekSaatiniGeriKoy();
    return;
  }
  hcheck(
    "HTTP: başlıksız PATCH → 403 REQUIRED (kod GÖVDEDE)",
    y1.status === 403 && y1b.details?.code === "SETTINGS_PASSWORD_REQUIRED",
    `${y1.status} ${y1b.details?.code}`,
  );

  const y2 = await fetch(`${BASE}/api/feature-flags`, {
    method: "PATCH",
    headers: { ...auth, "x-settings-password": YANLIS_SIFRE },
    body: govde,
  });
  const y2b = (await y2.json()) as { details?: { code?: string } };
  if (kilitliMi(y2.status, y2b)) {
    kilitliAtla("yanlış şifre");
    await yedekSaatiniGeriKoy();
    return;
  }
  hcheck(
    "HTTP: yanlış şifre → 403 INVALID",
    y2.status === 403 && y2b.details?.code === "SETTINGS_PASSWORD_INVALID",
    `${y2.status} ${y2b.details?.code}`,
  );

  const y3 = await fetch(`${BASE}/api/feature-flags`, {
    method: "PATCH",
    headers: { ...auth, "x-settings-password": DOGRU_SIFRE },
    body: govde,
  });
  if (y3.status === 429) {
    kilitliAtla("doğru şifre");
    await yedekSaatiniGeriKoy();
    return;
  }
  hcheck("HTTP: doğru şifre → 200", y3.status === 200, `${y3.status}`);

  const ayarlar = await fetch(`${BASE}/api/admin/settings`, { headers: auth });
  const ayarMetni = await ayarlar.text();
  const ayarSatirlari = (JSON.parse(ayarMetni) as { data?: Array<{ key: string }> }).data ?? [];
  hcheck("HTTP: GET /admin/settings DOLU (zemin)", ayarSatirlari.length > 5, `${ayarSatirlari.length} satır`);
  hcheck(
    "HTTP: GET /admin/settings yükünde `security.` YOK",
    !ayarSatirlari.some((r) => r.key.startsWith(SECURITY_SETTING_PREFIX)),
  );
  hcheck(
    "HTTP: GET /admin/settings yükünde bcrypt gövdesi YOK",
    hashDegeri.length > 0 && !ayarMetni.includes(hashDegeri),
  );

  const y4 = await fetch(
    `${BASE}/api/admin/settings/${encodeURIComponent(SETTINGS_PASSWORD_HASH_KEY)}`,
    {
      method: "PUT",
      headers: { ...auth, "x-settings-password": DOGRU_SIFRE },
      body: JSON.stringify({ value: "sahte" }),
    },
  );
  const y4b = (await y4.json()) as { details?: { code?: string } };
  if (kilitliMi(y4.status, y4b)) {
    kilitliAtla("ham ayar ucu");
    await yedekSaatiniGeriKoy();
    return;
  }
  hcheck(
    "HTTP: ham ayar ucundan hash yazımı → 400 SETTING_KEY_RESERVED",
    y4.status === 400 && y4b.details?.code === "SETTING_KEY_RESERVED",
    `${y4.status} ${y4b.details?.code}`,
  );

  const y5 = await fetch(`${BASE}/api/admin/settings-password`, { headers: auth });
  hcheck("HTTP: fabrika admini GET /admin/settings-password → 404", y5.status === 404, `${y5.status}`);

  const y6 = await fetch(`${BASE}/api/admin/settings-password`);
  hcheck("HTTP: kimliksiz GET /admin/settings-password → 401 (404 DEĞİL)", y6.status === 401, `${y6.status}`);

  await yedekSaatiniGeriKoy();
  const kalanSatir = await prisma.systemSetting.count({ where: { key: "backup.hour" } });
  hcheck(
    "HTTP turu ayar tablosunda İZ BIRAKMADI (yedek saati satırı önceki hâlinde)",
    kalanSatir === (oncekiYedekSaati === null ? 0 : 1),
    `${kalanSatir} satır`,
  );
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    fail++;
  })
  .finally(async () => {
    // ── TEMİZLİK: ayar şifresi ÖNCEKİ hâline döner ─────────────────────────────
    // ⚠️ Fabrika DB'sinde satır YOKSA koşum sonunda yine YOKTUR: bekçi uyuyan
    // kapıyı uyanık bırakmaz (bırakırsa panel bir daha kaydetmeye izin vermez ve
    // şifreyi kimse bilmez — kurulumu bekçinin kendisi kilitlerdi).
    try {
      await prisma.systemSetting.deleteMany({ where: { key: SETTINGS_PASSWORD_HASH_KEY } });
      if (hashSatiriVardi && oncekiHashSatiri) {
        await prisma.systemSetting.create({
          data: {
            key: SETTINGS_PASSWORD_HASH_KEY,
            value: oncekiHashSatiri.value as string,
            description: oncekiHashSatiri.description,
          },
        });
      }
      // Bu koşumun kendi audit satırları (bekçi kendi gürültüsünü bırakmaz).
      await prisma.systemLog.deleteMany({
        where: {
          createdAt: { gte: KOSUM_BASI },
          action: { startsWith: "SETTINGS_PASSWORD_" },
        },
      });
      // ⚠️ İKİNCİ TEMİZLİK — `security.*` recordId'li HER satır (yalnız
      //    `SETTINGS_PASSWORD_*` olayları DEĞİL). Sebep ölçüldü (D2 NOT'u):
      //    §I "reserved key reddi" sondası ham ayar ucundan yazma DENER; reddin
      //    silindiği bir sondada o yazım GERÇEKLEŞİR ve `systemSettingService.set`
      //    arkasında `CREATE / SYSTEM_SETTING / security.settingsPasswordHash`
      //    audit satırı bırakır. Eski `finally` onu görmüyordu ve satır test
      //    DB'sinde kalıcı oldu; "security.* recordId'li audit 0 olmalı" türü
      //    bir tripwire orada YANLIŞ KIRMIZI verirdi.
      await prisma.systemLog.deleteMany({
        where: {
          createdAt: { gte: KOSUM_BASI },
          recordId: { startsWith: SECURITY_SETTING_PREFIX },
        },
      });
    } catch (e) {
      console.error("⚠️ temizlik başarısız:", e instanceof Error ? e.message : e);
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${atlanan ? `, ${atlanan} atlandı` : ""} ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
