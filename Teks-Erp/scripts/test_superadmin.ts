// =============================================================================
// BEKÇİ — SATICI (SÜPERADMİN) HESABI: kimlik · tam yetki · modül kilidi · gizlilik
// =============================================================================
// NE KORUYOR: modül anahtarları (`ticaretEnabled`, `iplikEnabled`, …) fabrikanın
// ayarı DEĞİL, kurulumun hangi ürünü satın aldığının kaydıdır. Onları yalnız
// SATICI değiştirebilir. Bunun için DB'de gerçek ama GÖRÜNMEZ bir kullanıcı
// satırı (`User.isSystemAccount`) doğar ve dört mekanizma birlikte çalışır:
//
//   ① KİMLİK   — `verifyToken` her istekte TAZE okur (`req.isSystemAccount`),
//                JWT claim'i DEĞİL (eski token yeni gerçeği taşıyamaz).
//   ② YETKİ    — `getEffectivePermissions` süperadminde `["*"]` döner; grant
//                satırı DOĞMAZ (izin koddan gelir, panelden atanamaz).
//   ③ KİLİT    — `flagWriteGuard`ın ÜÇÜNCÜ dalı gövdedeki modül anahtarlarını
//                görünce süperadmin şartı koyar.
//   ④ SUPAP    — sistem hesabı HİÇ YOKSA kilit devre dışıdır; aksi halde
//                `SUPERADMIN_*` yazılmamış her kurulumda modül anahtarını HİÇ
//                KİMSE değiştiremezdi (`document-design.ts`teki "admin:settings
//                dört ekranı da açmaya devam eder" dersinin birebir tekrarı).
//
// SEKİZ SESSİZ BOZULMA YOLU VAR, SEKİZİ DE BURADA KİLİTLİ:
//   1. GUARD YÖN DEĞİŞTİRİR — `.some` `.every` olursa `{ ticaretEnabled,
//      backupHour }` KARMA gövdesi dala hiç girmez ve `admin:settings` taşıyan
//      yönetici modülü sessizce açar. Hiçbir test kırılmaz, hiçbir log çıkmaz.
//   2. DAL SIRASI KAYAR — modül dalı belge dalının ARDINA düşerse ileride
//      eklenecek bir `.every` dalı karışımı önce yutabilir.
//   3. GUARD ASYNC OLUR — zincir `next`i aynı tick'te çağırmazsa Express çalışır
//      ama BEKÇİ HARNESS'I sessizce "reddedildi" der; asıl tehlike registry'nin
//      DB'ye gitmeye başlaması (istek başına sorgu + boot penceresinde bypass).
//   4. SUPAP AÇIK KALIR — `systemAccountLockActive()` daima `false` dönerse
//      kilit hiç yürürlüğe girmez ve kimse fark etmez (davranış "eskisi gibi").
//   5. YETKİ ROLE DÖNER — `["*"]` grant satırı olarak yazılırsa panelin yetki
//      sayacı gizli hesabı SIZDIRIR ve `code: "*"` panelden atanabilir olur.
//   6. id → PIN ZİNCİRİ AÇILIR — audit satırı aktörün id'sini basar (karar #8);
//      `/api/admin/users/:id/credentials` o id'nin DÜZ PIN'ini döner ve
//      yönetici satıcının kimliğine bürünür. Kapı `404` olmak ZORUNDA (403
//      hesabın VARLIĞINI doğrular).
//   7. AKTÖR MASKESİ SESSİZCE DÜŞER — audit satırı SÜZÜLMEZ, aktörü NÖTRLENİR
//      (karar #8). Maskenin tek uygulaması `system-log.service`in dört okuma
//      yoludur ve 2026-09-03'e dek HİÇBİR bekçi onu ölçmüyordu: silmek 99/0'ı
//      hiç bozmuyordu (D2'de ölçüldü). §L bunu HTTP'den, `hidden_single_source`
//      §7 kaynaktan kilitler. Maskenin İKİNCİ yarısı `recordId`dir: `AUTH`
//      satırlarının `recordId`'si giriş adıdır ve aynı JSON satırında takma adı
//      çürütüyordu.
//   8. ÖNEK KAPISI ALT ROTADAN DAR KALIR — `/users/:id` öneki her alt rotadan
//      ÖNCE koşar; izni birleşimden dar olursa alt rotanın ilan ettiği izne
//      sahip kullanıcı ucu HİÇ göremez ve 403 rotanın istemediği izni suçlar
//      ("kart görür, tıklar, /forbidden" sınıfı). §M mekanik olarak ölçer.
//
// ⚠️ BU BEKÇİ GEÇİCİ OLARAK İKİNCİ BİR SİSTEM HESABI YARATIR (kendi fixture'ı,
//    `bekci.superadmin.<pid>`) ve `finally`de siler. `test_db_invariants` §10
//    ("sistem hesabı ≤ 1") ile EŞZAMANLI KOŞMAZ. Yazma yaptığı için hedef-DB
//    kapısından geçer (`lib/hedef-db-kapisi.ts`).
// ⚠️ FORCE_SYNC (rotasyon) yalnız TEK sistem hesabı varsa ve o BİZİM fixture'ımız
//    ise ölçülür — aksi halde gerçek bir satıcı hesabının parolasını döndürürdü.
//    Ölçülemediğinde ATLANIR (kırmızı DEĞİL): eksik ölçüm kendini söyler.
//
// Koşum: npx tsx scripts/test_superadmin.ts
//        (HTTP ayağı için: PORT=<port> … npx tsx src/server.ts &  → TEST_API_URL)
//
// NEGATİF SONDALAR — 2026-09-03'te ÖLÇÜLDÜ. Taban (İKİ kurulum, ikisi de yeşil):
//   • hesap VAR  (`tekserp_modul_test`, `bakim`): **126 geçti / 0 / 16 atlandı**
//   • hesap YOK  (aynı DB, `bakim` geçici pasif; sunucu hesapsız açıldı): **138 / 0 / 3**
//     — doğum yolu · supap davranışı · FORCE_SYNC rotasyonu burada GERÇEKTEN koşar.
// Sayılar DB durumuna bağlıdır; kalıcı olan 'hangi kontrol kırmızı olur' cümlesidir.
// ⚠️ Atlananların HEPSİ gerekçeli ve gerekçe DB'nin durumundan doğar: bu DB'de
// zaten bir satıcı hesabı (`bakim`) var → doğum yolu · tam rotasyon · "supap
// DAVRANIŞI" ölçülemez; onların yerine "tembel doğrulama" ölçülür (ikisi mantıken
// dışlayıcıdır ve bekçi hangisini koştuğunu her koşumda YAZAR).
// Her sondadan sonra `cp` + `md5 -q` ile birebir geri alındı; HTTP davranışını
// ölçen sondalarda sunucu YENİDEN BAŞLATILDI (tsx sıcak yükleme yapmaz — aksi
// halde sonda "yeşil" görünürdü, ölçüldü).
//   SONDA-S1  → çıkış 1 · 4 ❌ · guard `.some` → `.every` (§C ×2 + §D + §E metni)
//               ⚠️ EN KRİTİK: karma gövde modül dalına HİÇ girmez.
//   SONDA-S2  → çıkış 1 · 1 ❌ · modül dalı belge dalının ARDINA taşındı (§E)
//   SONDA-S3  → çıkış 1 · 39 ❌ · `flagWriteGuard` `async` yapıldı
//   SONDA-S4  → çıkış 1 · 29 ❌ · registry supabı sahte açık
//   SONDA-S5  → çıkış 1 · 1 ❌ · job audit yüküne `quickPin` kondu (§I2)
//   SONDA-S6  → çıkış 1 · 1 ❌ · İKİNCİ sistem hesabı INSERT edildi (db_invariants §10)
//   ── 2026-09-03 düzeltme turu (D1/D2 bulguları) ────────────────────────────
//   SONDA-F1  → 122/4 · `list()` dönüşünden `withMaskedActor` kaldırıldı →
//               §L'de aktör + `recordId` + gövde + `isSystemAccount` dördü de ❌
//   SONDA-F2  → 124/2 · `findById()` dönüşünden maske kaldırıldı (§L detay ×2)
//   SONDA-F3  → 120/6 · `recordId` nötrlemesi kaldırıldı (aktör maskesi DURUYOR)
//               — canlı liste + detay + arşiv liste + arşiv detay ❌
//   SONDA-F4  → 125/1 · `listArchive` ESKİ yazıma döndü (elle `maskSystemActor`)
//   SONDA-F6  → 124/2 · G5: `setSystemAccountExists(parsed.kind !== "absent" &&
//               existing !== null)` → §I3(e2) "env YOK + hesap VAR" ❌.
//               ⚠️ Aynı sondada UÇTAN UCA kontrol YEŞİL kaldı ve bu doğrudur:
//               A3'ün tembel doğrulaması ikinci hat olarak kilidi geri getiriyor.
//               Defter yükleminin kendisi yine de ölçülmeli — ikinci hat kalkarsa
//               tek koruma odur.
//   SONDA-F7  → 124/2 · A3: guard'ın SUPAP dalındaki tembel doğrulama silindi
//               (§F "defter 'yok' derken DB'de hesap VAR → KİLİTLER") ❌
//   SONDA-F8  → 125/1 · A2: önek `requirePermission("admin:users")`e daraltıldı →
//               §M "önek ⊇ alt rota" ❌ (`/users/:id/credentials → admin:settings`)
//   SONDA-F9  → 124/2 · A5: `/auth/me` ham `systemAccountExistsKnown()`e döndü (§K ×2)
//   SONDA-F10 → çıkış 1 · 3 ❌ · A4: `update` yolundaki P2002 sargısı kalktı —
//               §I2 kaynak sözleşmesi ×2 + ham Prisma hatası koşumu düşürdü
//   SONDA-F11 → 125/1 · A4: `update` gövdesine `username: cfg.username` eklendi
//               (giriş kimliği sessizce değişir) → §I2 ❌.
//               ⚠️ İLK DENEME ETKİSİZ SONDAYDI: `perl` deseni 8 boşluk girintili
//               `data:` alanlarını arıyordu ama update artık `try {` içinde (10
//               boşluk) → yama CREATE bloğuna düştü ve bekçi haklı olarak yeşil
//               kaldı. Sonda "kırmızı vermedi" ise ÖNCE sondayı doğrula.
//   SONDA-F12 → 125/1 · A1: job audit yüküne `username: cfg.username` geri kondu
//               → §I2 "audit yükünde `username` alanı YOK" ❌
// =============================================================================

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import prisma, { pool } from "../src/lib/prisma";
import featureFlagRouter from "../src/routes/feature-flag.routes";
import { MODULE_FLAG_KEYS } from "../src/constants/module-flags";
import { DOCUMENT_DESIGN_FLAG_KEYS } from "../src/constants/document-design";
import { PERMISSION_CATALOG } from "../src/constants/permission-catalog";
import {
  setSystemAccountExists,
  systemAccountLockActive,
  systemAccountExistsKnown,
  __resetSystemAccountRegistryForTests,
} from "../src/services/helpers/system-account.registry";
import {
  readSuperadminEnv,
  ensureSuperadminAccount,
  SYSTEM_ACCOUNT_FULLNAME,
} from "../src/jobs/superadmin.job";
import { blockSystemAccountTarget } from "../src/middlewares/system-account.middleware";
import { AuthService } from "../src/services/auth.service";
import { AppError } from "../src/utils/app-error";
import { hedefDbAdi, hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { yorumlariSok } from "./lib/regime-gate-scan";

const BASE = process.env.TEST_API_URL ?? "http://localhost:4104";
const SRC = path.join(__dirname, "..", "src");

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
// Route zinciri koşturucu — `test_document_template_permission.ts` sözleşmesinin
// süperadmin uzantısı: `req.isSystemAccount` de kurulabilir.
//
// ⚠️ `null` dönüşü "reddedildi" DEĞİL "ZİNCİR OKUNAMADI"dır ve testi DÜŞÜRÜR.
// Sessizce `false` saymak bu bekçiyi süse çevirirdi (bir refactor zinciri
// değiştirir, tüm kontroller "red bekleniyordu, red geldi" diye yeşil kalır).
// ─────────────────────────────────────────────────────────────────────────────
type RouteLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{
      name: string;
      handle: (req: Request, res: Response, next: NextFunction) => void;
    }>;
  };
};

interface ZincirSonuc {
  gecti: boolean;
  hata: unknown;
  /** `next` AYNI TICK'te mi çağrıldı (senkronluk sözleşmesi)? */
  senkron: boolean;
}

async function zinciriKostur(
  router: unknown,
  method: "patch",
  routePath: string,
  permissions: string[],
  body: unknown,
  isSystemAccount?: boolean,
): Promise<ZincirSonuc | null> {
  const layers = (router as { stack: RouteLayer[] }).stack;
  const layer = layers.find((l) => l.route?.path === routePath && l.route.methods[method]);
  if (!layer?.route) return null;
  const zincir = layer.route.stack;
  if (zincir.length < 3 || zincir[0]!.name !== "verifyToken") return null;

  const req = {
    user: { userId: aktorId, permissions },
    body,
    isSystemAccount,
    method: "PATCH",
    originalUrl: "/api/feature-flags",
  } as unknown as Request;
  const res = {} as Response;

  let senkron = true;
  for (const halka of zincir.slice(1, -1)) {
    let hata: unknown;
    let cagrildi = false;
    // ⚠️ HARNESS ASENKRONU DA ÖLÇER, AMA "SENKRON MU" BİLGİSİNİ KAYBETMEZ
    //    (2026-09-03). Guard'ın SUPAP dalı artık tek indeksli bir DB okuması
    //    yapıyor (defteri tazeleme — boot'tan sonra doğan hesap kilidi kapatsın).
    //    Eski harness `next` aynı tick'te çağrılmazsa KOŞULSUZ "reddedildi" derdi
    //    → supap senaryolarının HEPSİ yanlış kırmızı olurdu. Yeni sözleşme:
    //    beklenir, ama `senkron` bayrağı düşer ve §E onu KİLİTLİ dalda ölçer.
    //    Yani "guard tümden async'e kaydı" bozulması hâlâ yakalanır.
    const bekle = new Promise<void>((resolve) => {
      let bittiMi = false;
      const zamanAsimi = setTimeout(() => {
        if (!bittiMi) resolve();
      }, 5000);
      if (typeof zamanAsimi.unref === "function") zamanAsimi.unref();
      halka.handle(req, res, ((e?: unknown) => {
        cagrildi = true;
        bittiMi = true;
        hata = e;
        clearTimeout(zamanAsimi);
        resolve();
      }) as NextFunction);
      // `next` handle dönmeden çağrıldıysa AYNI TICK demektir.
      if (cagrildi) resolve();
    });
    const ayniTick = cagrildi;
    await bekle;
    if (!cagrildi) {
      // `next` hiç çağrılmadı (5 sn) → zincir ASILI kaldı.
      return { gecti: false, hata: null, senkron: false };
    }
    if (!ayniTick) senkron = false;
    if (hata) return { gecti: false, hata, senkron };
  }
  return { gecti: true, hata: null, senkron };
}

const izin = (
  permissions: string[],
  body: unknown,
  isSystemAccount?: boolean,
): Promise<ZincirSonuc | null> =>
  zinciriKostur(featureFlagRouter, "patch", "/", permissions, body, isSystemAccount);

/**
 * Guard'ın audit yazabilmesi için GERÇEK bir aktör id'si gerekir.
 *
 * ⚠️ Uydurma UUID kullanılamaz: `SystemLog.userId` FK'dır ve audit yazımı
 * best-effort olduğu için hata SESSİZCE yutulur — yani supap izinin yazıldığını
 * ölçen kontrol, kendi fixture'ı yüzünden vakumen KIRMIZI kalırdı.
 */
let aktorId = "00000000-0000-4000-8000-000000000001";

function hataKodu(s: ZincirSonuc | null): string {
  const h = s?.hata;
  if (h instanceof AppError) {
    const d = (h as unknown as { details?: { code?: string } }).details;
    return d?.code ?? `(kodsuz ${h.statusCode})`;
  }
  return h ? "(AppError değil)" : "—";
}

const SADECE_ADMIN = ["admin:settings"];
const ADMIN_JOKER = ["admin:*"];
const BELGE_YAZMA = ["document-template:write"];
const YILDIZ = ["*"];

// Fixture kimlikleri — SAHTE, gerçek bir kurulumda kullanılmaz.
const FIXTURE_USERNAME = `bekci.superadmin.${process.pid}`;
const FIXTURE_PAROLA = "bekci-superadmin-2026";
let fixtureId: string | null = null;
/** §L'nin sentetik arşiv satırı — `finally`de silinir (arşiv kolu maskesi ölçümü). */
let arsivSondaId: string | null = null;
/** Bu koşumda sistem hesabını BİZ mi yarattık (FORCE_SYNC ölçümünün ön koşulu)? */
let fixtureTekSistemHesabi = false;

async function main(): Promise<void> {
  // ── Hedef DB kapısı ────────────────────────────────────────────────────────
  const engel = hedefDbEngeli();
  if (engel) {
    console.error(`\n⛔ DURDURULDU — ${engel}\n`);
    fail++;
    return;
  }
  console.log(`Hedef veritabanı: ${hedefDbAdi()}\n`);

  // Guard harness'ı GERÇEK bir aktör id'siyle koşar (audit FK'sı — yukarıdaki not).
  const gercekAktor = await prisma.user.findFirst({
    where: { isSystemAccount: false },
    select: { id: true },
  });
  if (gercekAktor) aktorId = gercekAktor.id;

  // Bayat koşum artıkları (süreç öldürülmüşse `finally` koşmamış olabilir).
  await temizleBayatFixtureler();

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("=== A) Guard zinciri okunabiliyor (körlük zemini) ===");
  // Zincir okunamazsa aşağıdaki HER "red bekleniyordu" kontrolü vakumen yeşil
  // kalırdı — bu yüzden zemin ilk sırada ve ayrı bir kontrol.
  const zeminSonuc = await izin(SADECE_ADMIN, { backupHour: 3 });
  check("PATCH /api/feature-flags zinciri okundu", zeminSonuc !== null);
  if (zeminSonuc === null) {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız, ${atlanan} atlandı ===`);
    return;
  }
  check(
    "modül anahtarı kümesi dolu (körlük zemini)",
    MODULE_FLAG_KEYS.size >= 5,
    `${MODULE_FLAG_KEYS.size} anahtar`,
  );

  // Registry'yi bilinen duruma çek: kilit YÜRÜRLÜKTE (hesap var).
  setSystemAccountExists(true);

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n=== B) Her modül anahtarı için kilit (elle liste YOK) ===");
  // ⚠️ DÖNGÜ `MODULE_FLAG_KEYS` ÜZERİNDE: yeni bir modül anahtarı eklendiğinde
  // bu bekçi onu OTOMATİK kapsar. Elle liste yazılsaydı sekizinci anahtar
  // sessizce kapsam dışında kalırdı — bu repoda ölçülmüş bir sınıf.
  for (const anahtar of MODULE_FLAG_KEYS) {
    const govde = { [anahtar]: true };
    const super_ = await izin(YILDIZ, govde, true);
    check(`${anahtar}: SÜPERADMİN geçer`, super_?.gecti === true, hataKodu(super_));

    const admin = await izin(SADECE_ADMIN, govde, false);
    check(
      `${anahtar}: 'admin:settings' REDDEDİLİR`,
      admin?.gecti === false && hataKodu(admin) === "MODULE_FLAG_SUPERADMIN_ONLY",
      hataKodu(admin),
    );

    const joker = await izin(ADMIN_JOKER, govde, false);
    check(
      `${anahtar}: 'admin:*' REDDEDİLİR (joker satıcı yetkisi DEĞİL)`,
      joker?.gecti === false && hataKodu(joker) === "MODULE_FLAG_SUPERADMIN_ONLY",
      hataKodu(joker),
    );

    const belge = await izin(BELGE_YAZMA, govde, false);
    check(
      `${anahtar}: 'document-template:write' REDDEDİLİR`,
      belge?.gecti === false && hataKodu(belge) === "MODULE_FLAG_SUPERADMIN_ONLY",
      hataKodu(belge),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n=== C) KARMA gövde fail-closed (`.some` ölçümü) ===");
  // ⚠️ BU BEKÇİNİN EN KRİTİK MADDESİ. `.every` yazılsaydı aşağıdaki gövde modül
  // dalına HİÇ GİRMEZ, `admin:settings` taşıyan yönetici ticaret modülünü
  // sessizce açardı. Yani `.some`/`.every` farkı tek bir sözcük ama YÖN farkı.
  const karma = await izin(SADECE_ADMIN, { ticaretEnabled: true, backupHour: 3 }, false);
  check(
    "karma gövde { ticaretEnabled + backupHour } + admin → RED",
    karma?.gecti === false && hataKodu(karma) === "MODULE_FLAG_SUPERADMIN_ONLY",
    hataKodu(karma),
  );
  const karmaSuper = await izin(YILDIZ, { ticaretEnabled: true, backupHour: 3 }, true);
  check("aynı karma gövde + SÜPERADMİN → geçer", karmaSuper?.gecti === true, hataKodu(karmaSuper));
  // Modül + BELGE karışımı da modül dalında kesilir (belge dalı `.every` olduğu
  // için bugün zaten oraya düşmez — ama dal SIRASI değişirse bu kontrol yakalar).
  const belgeKarma = await izin(BELGE_YAZMA, { tezgahEnabled: false, documentsConfig: {} }, false);
  check(
    "karma gövde { modül + belge } + dar izin → RED (dal SIRASI ölçümü)",
    belgeKarma?.gecti === false && hataKodu(belgeKarma) === "MODULE_FLAG_SUPERADMIN_ONLY",
    hataKodu(belgeKarma),
  );

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n=== D) Regresyon — modül DIŞI gövdeler bozulmadı ===");
  check(
    "{ backupHour } + 'admin:settings' → geçer",
    (await izin(SADECE_ADMIN, { backupHour: 2 }, false))?.gecti === true,
  );
  check(
    "{ documentsConfig } + 'document-template:write' → geçer (dar izin korunuyor)",
    (await izin(BELGE_YAZMA, { documentsConfig: {} }, false))?.gecti === true,
  );
  check(
    "BOŞ gövde + 'admin:settings' → geçer (fail-closed dal admin'e düşer)",
    (await izin(SADECE_ADMIN, {}, false))?.gecti === true,
  );
  check(
    "{ backupHour } + 'document-template:write' → RED (yetki GENİŞLEMEDİ)",
    (await izin(BELGE_YAZMA, { backupHour: 2 }, false))?.gecti === false,
  );
  check(
    "belge anahtarı kümesi dolu (körlük zemini)",
    DOCUMENT_DESIGN_FLAG_KEYS.size >= 2,
    `${DOCUMENT_DESIGN_FLAG_KEYS.size}`,
  );

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n=== E) Guard SENKRON (async'e kayarsa kapı sessizce açılır) ===");
  // Guard `req.isSystemAccount`i (istek-taze alan) okur ve registry'yi SENKRON
  // sorar; DB'ye gitmeye başlarsa hem istek başına sorgu doğar hem de boot
  // penceresinde bir bypass açılır. Ölçüm: `next` AYNI TICK'te çağrıldı mı.
  const senk = await izin(YILDIZ, { ticaretEnabled: true }, true);
  check("modül dalı `next`i aynı tick'te çağırıyor", senk?.senkron === true);
  const senkRed = await izin(SADECE_ADMIN, { ticaretEnabled: true }, false);
  check("red yolu da senkron", senkRed?.senkron === true && senkRed?.gecti === false);
  const mwSrc = fs.readFileSync(path.join(SRC, "routes", "feature-flag.routes.ts"), "utf8");
  check(
    "`flagWriteGuard` `async` DEĞİL (kaynak sözleşmesi)",
    /const\s+flagWriteGuard\s*=\s*\(/.test(mwSrc) && !/const\s+flagWriteGuard\s*=\s*async/.test(mwSrc),
  );
  check(
    "modül dalı `.some` ile yazılmış (metin ikizi — yön kaymasının ikinci hattı)",
    /keys\.some\(\s*\(k\)\s*=>\s*MODULE_FLAG_KEYS\.has\(k\)\s*\)/.test(mwSrc),
    "`.every` = karma gövde sessizce geçer",
  );
  // ⚠️ DAL SIRASI — bugün DAVRANIŞSAL bir fark üretmez (belge dalı `.every` ile
  // yazıldığı için karma gövde ona zaten düşmez), o yüzden yalnız KAYNAK
  // sözleşmesi olarak ölçülebilir. Kural şu: modül dalı EN ÖNDE. İleride
  // eklenecek dördüncü bir `.some` dalı öne geçerse karma gövdeyi o yutar ve
  // modül kilidi sessizce devre dışı kalır. Sözleşmeyi yazılı tutan tek şey
  // bu kontroldür — davranışa dayanan bir ölçüm burada YANLIŞ YEŞİL verir.
  const modulIdx = mwSrc.indexOf("MODULE_FLAG_KEYS.has(k)");
  const belgeIdx = mwSrc.indexOf("DOCUMENT_DESIGN_FLAG_KEYS.has(k)");
  check(
    "modül dalı belge dalından ÖNCE (kaynak sırası sözleşmesi)",
    modulIdx > 0 && belgeIdx > 0 && modulIdx < belgeIdx,
    `modül@${modulIdx} < belge@${belgeIdx}`,
  );

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n=== F) EMNİYET SUPABI — sistem hesabı YOKKEN kilit devre dışı ===");
  {
    // ⚠️ FAIL-CLOSED VARSAYILAN: registry hiç ölçülmemişken (boot penceresi)
    // kilit YÜRÜRLÜKTEDİR. Ters yön her restart'ta birkaç saniyelik bypass açardı.
    __resetSystemAccountRegistryForTests();
    check(
      "registry 'bilinmiyor' iken kilit YÜRÜRLÜKTE (fail-closed)",
      systemAccountLockActive() === true,
    );
    // ⚠️ HAM okuma ile PANEL AYNASI ayrı sorulardır (A5 / D2 bulgusu):
    // ham `systemAccountExistsKnown()` "job ölçtü VE var" der (üç durumlu),
    // `/auth/me`nin döndüğü değer ise guard'ın yüklemidir. Bilinmiyor durumunda
    // ham okuma `false`, kapı KİLİTLİ — panel ham okumayı görseydi supabı AÇIK
    // çizer, kullanıcı toggle'ı çevirir ve 403 yerdi.
    check("registry 'bilinmiyor' → HAM okuma 'var' DEMEZ", systemAccountExistsKnown() === false);
    check(
      "registry 'bilinmiyor' → PANEL AYNASI 'var' DER (fail-closed, kapıyla aynı)",
      systemAccountLockActive() === true,
      "`/auth/me systemAccountExists` bu yüklemi döner",
    );
    const bilinmiyor = await izin(SADECE_ADMIN, { ticaretEnabled: true }, false);
    check(
      "boot penceresinde admin modül anahtarı YAZAMAZ",
      bilinmiyor?.gecti === false && hataKodu(bilinmiyor) === "MODULE_FLAG_SUPERADMIN_ONLY",
      hataKodu(bilinmiyor),
    );

    setSystemAccountExists(false);
    check("registry 'hesap yok' → kilit DEVRE DIŞI", systemAccountLockActive() === false);

    // ⚠️ SUPAP DAVRANIŞI ile TEMBEL DOĞRULAMA aynı DB'de ÖLÇÜLEMEZ — ve bu bir
    // eksiklik değil, kuralın kendisidir: supap "DB'de sistem hesabı YOK" demek,
    // tembel doğrulama ise "defter yalan söylüyor, DB'de VAR" demektir. Hangi
    // ölçümün koşacağını DB belirler; ikisi de yazılı, hiçbiri sessizce atlanmaz.
    const dbdeSistemHesabi = await prisma.user.count({ where: { isSystemAccount: true } });

    if (dbdeSistemHesabi === 0) {
      const supap = await izin(SADECE_ADMIN, { ticaretEnabled: true }, false);
      check(
        "supap açıkken 'admin:settings' modül anahtarını YAZAR (bugünkü davranış)",
        supap?.gecti === true,
        hataKodu(supap),
      );
      // Supap açıkken bile izinsiz kullanıcı geçemez (dal `admin:settings`e düşer).
      check(
        "supap açıkken izinsiz kullanıcı yine REDDEDİLİR",
        (await izin(["order:read"], { ticaretEnabled: true }, false))?.gecti === false,
      );

      // Görünürlük: supap kullanıldığında kalıcı iz kalmalı (best-effort audit).
      const oncekiIz = await prisma.systemLog.count({
        where: { action: "SUPERADMIN_ABSENT_MODULE_WRITE" },
      });
      await izin(SADECE_ADMIN, { iplikEnabled: true }, false);
      await new Promise((r) => setTimeout(r, 400)); // best-effort yazım (void)
      const sonrakiIz = await prisma.systemLog.count({
        where: { action: "SUPERADMIN_ABSENT_MODULE_WRITE" },
      });
      check(
        "supap kullanımı audit'e yazılıyor (SUPERADMIN_ABSENT_MODULE_WRITE)",
        sonrakiIz > oncekiIz,
        `${oncekiIz} → ${sonrakiIz}`,
      );
      atla(
        "tembel doğrulama (boot'tan SONRA doğan hesap)",
        "bu DB'de sistem hesabı yok — ölçüm ancak hesap VARKEN kurulabilir",
      );
      atlanan += 2; // `atla` 1'i sayar; o dalda 3 kontrol var
    } else {
      // ── TEMBEL DOĞRULAMA (A3 / D1 bulgusu) ────────────────────────────────
      // Defter yalnız boot'ta yazılıyordu: süreç hesapsız açılır, hesap SONRADAN
      // DB'ye gelir (elle SQL · içe aktarım · yedekten geri yükleme) ve supap bir
      // sonraki restart'a kadar AÇIK kalırdı. Burada tam o durum kurulur: defter
      // "yok" der, DB'de hesap VARDIR → guard kendi kendini düzeltip KİLİTLEMELİ.
      const tembel = await izin(SADECE_ADMIN, { ticaretEnabled: true }, false);
      check(
        "defter 'yok' derken DB'de hesap VAR → guard KİLİTLER (tembel doğrulama)",
        tembel?.gecti === false && hataKodu(tembel) === "MODULE_FLAG_SUPERADMIN_ONLY",
        hataKodu(tembel),
      );
      check(
        "tembel doğrulama defteri KALICI olarak düzeltti (sonraki istek sorgusuz kilitli)",
        systemAccountLockActive() === true && systemAccountExistsKnown() === true,
      );
      check(
        "aynı durumda SÜPERADMİN geçer (kilit kimliğe bakar, körlemesine reddetmez)",
        (await izin(YILDIZ, { ticaretEnabled: true }, true))?.gecti === true,
      );
      atla(
        "supap DAVRANIŞ ölçümü (hesapsız kurulum)",
        `bu DB'de ${dbdeSistemHesabi} sistem hesabı var — supap yolu ölçülemez`,
      );
      atlanan += 2;
    }

    setSystemAccountExists(true);
    check("registry 'hesap var' → kilit yeniden MUTLAK", systemAccountLockActive() === true);
    check(
      "hesap doğduktan sonra admin REDDEDİLİR",
      (await izin(SADECE_ADMIN, { ticaretEnabled: true }, false))?.gecti === false,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n=== H) Katalogda `*` kodu YOK (panelden ATANAMAZ) ===");
  // `["*"]` yalnız KOD üretir. Katalogda satırı olsaydı boot uzlaştırması onu
  // DB'ye getirir ve panelden herhangi bir kullanıcıya verilebilir hale gelirdi.
  // ⚠️ `as string` cast'i ŞART: `PermissionCode` literal bir union ve tsc
  // "bu karşılaştırmanın örtüşmesi yok" (TS2367) ile DÜŞER. Bu aslında ikinci
  // bir güvence (tip düzeyinde de `*` yok) ama kontrolü DERLEME hatasına
  // çevirirdi — runtime yüklemi DB/katalog ayrışmasını da ölçtüğü için kalır.
  check(
    "PERMISSION_CATALOG'da `code: \"*\"` satırı YOK",
    !PERMISSION_CATALOG.some((p) => (p.code as string) === "*"),
  );
  const dbYildiz = await prisma.permission.count({ where: { code: "*" } });
  check("DB'de de `*` izin satırı YOK", dbYildiz === 0, `${dbYildiz} satır`);

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n=== I) Doğum job'u — saf env okuyucusu (DB'siz) ===");
  {
    const gecerliHash = "$2b$10$" + "a".repeat(53);
    const bos = readSuperadminEnv({} as NodeJS.ProcessEnv);
    check("üçlünün HİÇBİRİ yoksa → 'absent' (sessiz no-op)", bos.kind === "absent", bos.kind);

    const eksik = readSuperadminEnv({ SUPERADMIN_USERNAME: "bakim" } as NodeJS.ProcessEnv);
    check(
      "üçlü EKSİKSE → 'invalid' (sessiz DEĞİL: niyet belli, kurulum yarım)",
      eksik.kind === "invalid",
      eksik.kind === "invalid" ? eksik.reasons.join(" · ") : eksik.kind,
    );

    const duzParola = readSuperadminEnv({
      SUPERADMIN_USERNAME: "bakim",
      SUPERADMIN_PASSWORD_HASH: "duz-parola-123",
      SUPERADMIN_PIN: "481902",
    } as NodeJS.ProcessEnv);
    check(
      "DÜZ parola bcrypt sanılmaz → 'invalid'",
      duzParola.kind === "invalid",
      "aksi halde hesap düz metinle doğar ve HİÇBİR ZAMAN giriş yapılamaz",
    );

    const kotuPin = readSuperadminEnv({
      SUPERADMIN_USERNAME: "bakim",
      SUPERADMIN_PASSWORD_HASH: gecerliHash,
      SUPERADMIN_PIN: "1234",
    } as NodeJS.ProcessEnv);
    check("6 hane olmayan PIN → 'invalid'", kotuPin.kind === "invalid");

    const kotuTotp = readSuperadminEnv({
      SUPERADMIN_USERNAME: "bakim",
      SUPERADMIN_PASSWORD_HASH: gecerliHash,
      SUPERADMIN_PIN: "481902",
      SUPERADMIN_TOTP_SECRET: "!!!-base32-degil-!!!",
    } as NodeJS.ProcessEnv);
    check("bozuk base32 TOTP sırrı → 'invalid'", kotuTotp.kind === "invalid");

    const tamam = readSuperadminEnv({
      SUPERADMIN_USERNAME: "bakim",
      SUPERADMIN_PASSWORD_HASH: gecerliHash,
      SUPERADMIN_PIN: "481902",
      SUPERADMIN_FORCE_SYNC: "true",
    } as NodeJS.ProcessEnv);
    check("geçerli üçlü → 'ok'", tamam.kind === "ok");
    check("FORCE_SYNC bayrağı okunuyor", tamam.kind === "ok" && tamam.config.forceSync === true);
    check(
      "TOTP verilmezse null (uzaktan giriş kurulum ister, LAN'dan girilir)",
      tamam.kind === "ok" && tamam.config.totpSecret === null,
    );

    // ⚠️ `process.env` MUTASYONU YASAK (web-hardening deseni). Okuyucunun saf
    // olduğu ölçülür: verilen kayıt dışında hiçbir yere bakmamalı.
    const oncekiEnvAnahtarSayisi = Object.keys(process.env).filter((k) =>
      k.startsWith("SUPERADMIN_"),
    ).length;
    readSuperadminEnv({ SUPERADMIN_USERNAME: "x" } as NodeJS.ProcessEnv);
    check(
      "okuyucu `process.env`i MUTATE ETMİYOR",
      Object.keys(process.env).filter((k) => k.startsWith("SUPERADMIN_")).length ===
        oncekiEnvAnahtarSayisi,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n=== I2) Doğum job'u — SIR HİJYENİ (audit yükü) ===");
  {
    // ⚠️ `AuditService` `payload`ı HAM yazar (maskeleme YALNIZ `changes`
    // kolonuna uygulanır) → temizlik ÇAĞIRANIN sorumluluğudur. Bu kontrol
    // `payload:` nesne literallerinin ANAHTARLARINA bakar.
    const jobYol = path.join(SRC, "jobs", "superadmin.job.ts");
    const jobSrc = fs.readFileSync(jobYol, "utf8");
    const ts = await import("typescript");
    const sf = ts.createSourceFile(jobYol, jobSrc, ts.ScriptTarget.Latest, true);
    const YASAK = ["passwordHash", "quickPin", "pin", "totpSecret", "secret", "password"];
    const ihlaller: string[] = [];
    let olculenPayload = 0;
    const gez = (n: import("typescript").Node): void => {
      if (
        ts.isPropertyAssignment(n) &&
        ts.isIdentifier(n.name) &&
        n.name.text === "payload" &&
        ts.isObjectLiteralExpression(n.initializer)
      ) {
        olculenPayload++;
        for (const p of n.initializer.properties) {
          const ad = p.name && ts.isIdentifier(p.name) ? p.name.text : null;
          if (ad && YASAK.includes(ad)) ihlaller.push(ad);
        }
      }
      ts.forEachChild(n, gez);
    };
    gez(sf);
    check("körlük zemini — job'da en az 2 audit `payload` bulundu", olculenPayload >= 2, `${olculenPayload}`);
    check(
      "audit yükünde hash/PIN/TOTP sırrı YOK",
      ihlaller.length === 0,
      ihlaller.join(", ") || "yalnız username + TOTP durumu ('seeded'/'cleared')",
    );
    // Rotasyon sözleşmesi: eski oturumlar anında düşmeli.
    check(
      "FORCE_SYNC `tokenVersion`ı artırıyor (eski oturumlar düşer)",
      /tokenVersion\s*:\s*\{\s*increment\s*:\s*1\s*\}/.test(jobSrc),
    );
    // Yarış çözümü: şema-DIŞI unique de regex'te olmalı.
    check(
      "P2002 regex'i şema-dışı `users_username_lower_uq`'yu da tanıyor",
      /users_\(username_key\|username_lower_uq\|quickPin_key\)/.test(jobSrc),
      "tanımazsa yarış 'bilinmeyen hata' sayılır ve 5 kez boşuna denenir",
    );
    // ── A4: FORCE_SYNC (rotasyon) yolu SERTLEŞTİ (D2 minor) ─────────────────
    // ⚠️ P2002 dalı BAŞTA yalnız `create`i sarıyordu. `update` yolu da çarpar
    // (env'deki PIN başka bir kullanıcıda) ve o hata yukarı çıkınca
    // `startSuperadminAccount` bunu "DB hazır olmayabilir" sanıp 5×15 sn boyunca
    // YENİDEN DENER — sonunda ham Prisma mesajıyla düşer. Bu bir YAPILANDIRMA
    // hatasıdır: retry'sız, adıyla raporlanmalı.
    const jobKod = yorumlariSok(jobSrc);
    const p2002Sayisi = (jobKod.match(/p2002Mentions\(/g) ?? []).length;
    check(
      "FORCE_SYNC (update) yolu da P2002 ile sarılı — İKİ ayrı `p2002Mentions` dalı",
      p2002Sayisi >= 2,
      `${p2002Sayisi} dal — tek dal varsa yalnız create korunuyordur`,
    );
    check(
      "`prisma.user.update` bir `try` bloğunun İÇİNDE",
      /try\s*\{[\s\S]{0,600}prisma\.user\.update\(/.test(jobKod),
    );
    // ⚠️ KULLANICI ADI SENKRONLANMAZ: ad GİRİŞ KİMLİĞİdir; sessizce değiştirmek
    // satıcıyı bir sonraki girişte dışarıda bırakır. Uyuşmazlık GÜRÜLTÜLÜ olur.
    check(
      "FORCE_SYNC kullanıcı adını DEĞİŞTİRMİYOR (update gövdesinde `username` yok)",
      !/prisma\.user\.update\(\{[\s\S]{0,500}\busername\s*:/.test(jobKod),
      "ad değişirse satıcı yeni adla girmeyi bilmez — 'parola çalışmıyor' sınıfı",
    );
    check(
      "ad uyuşmazlığı ÖLÇÜLÜYOR ve audit yüküne bayrak olarak yazılıyor",
      /existing\.username\s*!==\s*cfg\.username/.test(jobKod) &&
        /usernameMismatch/.test(jobKod),
    );
    // ⚠️ A1: audit yükünde GERÇEK kullanıcı adı da YOK (yalnız sır değil, AD da).
    check(
      "audit yükünde `username` alanı YOK (takma ad audit detayında da korunur)",
      !/payload\s*:\s*\{[^}]*\busername\s*:/.test(jobKod),
      "`recordId` zaten hesabın id'si; ad yazılınca `newData` gerçek adı basıyordu (D1/D2)",
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n=== I3) Doğum job'u — DB davranışı (idempotentlik) ===");
  {
    const gecerliHash = await AuthService.hashPassword(FIXTURE_PAROLA);
    const sahteEnv = {
      SUPERADMIN_USERNAME: FIXTURE_USERNAME,
      SUPERADMIN_PASSWORD_HASH: gecerliHash,
      SUPERADMIN_PIN: rastgeleKullanilmamisPin(),
    } as NodeJS.ProcessEnv;

    const oncekiSayi = await prisma.user.count({ where: { isSystemAccount: true } });

    // (a) env YOKSA satır doğmaz.
    const yokEnv = await ensureSuperadminAccount({} as NodeJS.ProcessEnv);
    check("env yok → 'absent' ve satır doğmaz", yokEnv.action === "absent", yokEnv.action);
    check(
      "env yok → sistem hesabı sayısı DEĞİŞMEDİ",
      (await prisma.user.count({ where: { isSystemAccount: true } })) === oncekiSayi,
    );

    // (b) BOZUK env → satır doğmaz (gürültülü hata ayrı yolda ölçülüyor).
    const bozuk = await ensureSuperadminAccount({
      SUPERADMIN_USERNAME: "x",
      SUPERADMIN_PASSWORD_HASH: "duz",
      SUPERADMIN_PIN: "12",
    } as NodeJS.ProcessEnv);
    check("bozuk env → 'invalid' ve satır doğmaz", bozuk.action === "invalid", bozuk.action);
    check(
      "bozuk env → sistem hesabı sayısı DEĞİŞMEDİ",
      (await prisma.user.count({ where: { isSystemAccount: true } })) === oncekiSayi,
    );

    // (c) İLK koşum: hesap yoksa doğar, varsa DOKUNULMAZ.
    const ilk = await ensureSuperadminAccount(sahteEnv);
    check(
      "ilk koşum: 'created' (hesap yoktu) ya da 'exists' (vardı, DOKUNULMADI)",
      ilk.action === "created" || ilk.action === "exists",
      ilk.action,
    );
    if (ilk.action === "created") {
      fixtureId = ilk.id;
      const satir = await prisma.user.findUnique({
        where: { id: ilk.id },
        select: { username: true, fullName: true, isSystemAccount: true, isActive: true },
      });
      check("doğan hesap `isSystemAccount: true`", satir?.isSystemAccount === true);
      check(
        `doğan hesabın tam adı takma ad ("${SYSTEM_ACCOUNT_FULLNAME}")`,
        satir?.fullName === SYSTEM_ACCOUNT_FULLNAME,
        satir?.fullName ?? "—",
      );
      check("doğan hesap aktif", satir?.isActive === true);
      const grantSayisi = await prisma.userPermission.count({ where: { userId: ilk.id } });
      check(
        "doğan hesabın GRANT satırı YOK (yetki koddan gelir)",
        grantSayisi === 0,
        `${grantSayisi} satır`,
      );
      const digerleri = await prisma.user.count({ where: { isSystemAccount: true } });
      fixtureTekSistemHesabi = digerleri === 1;
    } else {
      // ⚠️ Bu DB'de zaten bir sistem hesabı var → job DOKUNMADI (doğru davranış).
      // Doğum YOLU ölçülemez, ama aşağıdaki §G/§J/§L ölçümleri bir fixture'a
      // ihtiyaç duyar ve o hesabın parolasını BİLMİYORUZ (rotasyonlamak da
      // gerçek bir satıcı hesabını bozardı). Bu yüzden fixture DOĞRUDAN
      // yaratılır — job yolundan bağımsız, `finally`de silinir.
      atla("doğum yolu ölçümü", "bu DB'de zaten bir sistem hesabı var (job DOKUNMADI — doğru davranış)");
      atlanan += 3;
      const dogrudan = await prisma.user.create({
        data: {
          username: FIXTURE_USERNAME,
          fullName: SYSTEM_ACCOUNT_FULLNAME,
          passwordHash: gecerliHash,
          isSystemAccount: true,
          isActive: true,
        },
        select: { id: true },
      });
      fixtureId = dogrudan.id;
      console.log(`   ℹ️  §G/§J/§L için geçici fixture sistem hesabı yaratıldı (${FIXTURE_USERNAME}).`);
    }

    // (d) İKİNCİ koşum İKİNCİ satır YARATMAZ (idempotentlik — asıl ölçüm).
    const sayiIlkSonrasi = await prisma.user.count({ where: { isSystemAccount: true } });
    const ikinci = await ensureSuperadminAccount(sahteEnv);
    check("ikinci koşum → 'exists' (mevcut hesaba DOKUNULMAZ)", ikinci.action === "exists", ikinci.action);
    check(
      "ikinci koşum İKİNCİ satır yaratmadı",
      (await prisma.user.count({ where: { isSystemAccount: true } })) === sayiIlkSonrasi,
      `${sayiIlkSonrasi}`,
    );

    // (e) Job her koşumda kayıt defterini TAZELER (guard'ın supabı buradan besleniyor).
    check("job kayıt defterini tazeledi (hesap var → kilit yürürlükte)", systemAccountLockActive() === true);
    check("`systemAccountExists` panel için 'var' diyor", systemAccountExistsKnown() === true);

    // (e2) ⚠️ ROTASYON REÇETESİNİN KENDİ YOLU — "hesap VAR + .env'de SUPERADMIN_*
    //      YOK → kilit YÜRÜRLÜKTE" (B2 / D2 major #3). Reçete FORCE_SYNC'ten sonra
    //      satırların `.env`den KALDIRILMASINI söyler; kurulumu yapan kişi çoğu
    //      zaman ÜÇÜNÜ birden siler. Defter env'e bakarsa (`parsed.kind !== "absent"
    //      && existing !== null` gibi masum görünen bir yazım) supap o boot'ta
    //      SESSİZCE açılır: fabrika admini modül anahtarını yazar, hata yok, log yok.
    //      Bugünkü kod DOĞRU — defter yalnız DB'ye bakar. Bu kontrol onu kilitler.
    __resetSystemAccountRegistryForTests();
    const envsizAmaHesapli = await ensureSuperadminAccount({} as NodeJS.ProcessEnv);
    check(
      "env YOK + hesap VAR → job yine de 'absent' döner (env kararı ≠ kilit kararı)",
      envsizAmaHesapli.action === "absent",
      envsizAmaHesapli.action,
    );
    check(
      "env YOK + hesap VAR → KİLİT YÜRÜRLÜKTE (supap AÇILMAZ)",
      systemAccountLockActive() === true && systemAccountExistsKnown() === true,
      "defter DB'den beslenir, `.env`den DEĞİL — reçetenin 'satırları kaldırın' adımı kilidi açmamalı",
    );
    check(
      "env YOK + hesap VAR → fabrika admini modül anahtarını YAZAMAZ (uçtan uca)",
      (await izin(SADECE_ADMIN, { ticaretEnabled: true }, false))?.gecti === false,
    );

    // (f0) A4 — FORCE_SYNC + ÇAKIŞAN PIN → 'invalid' (retry YOK, hesap DEĞİŞMEZ).
    //
    // ⚠️ BU ÖLÇÜM YIKICI DEĞİL ve bu bilinçli: `quickPin` sistem genelinde
    // `@unique`, yani BAŞKA bir kullanıcının PIN'i verilirse `prisma.user.update`
    // TEK ifadede P2002 ile düşer ve hesaba HİÇBİR ŞEY yazılmaz. Bu yüzden gerçek
    // bir satıcı hesabı olan DB'de de koşabilir (parola/PIN döndürmez) — oysa
    // (f)'deki tam rotasyon ölçümü yalnız kendi fixture'ımızda yapılabilir.
    const pinliBaskaKullanici = await prisma.user.findFirst({
      where: { isSystemAccount: false, quickPin: { not: null } },
      select: { id: true, quickPin: true },
    });
    if (!pinliBaskaKullanici?.quickPin) {
      atla(
        "FORCE_SYNC çakışan PIN ölçümü",
        "bu DB'de PIN taşıyan normal kullanıcı yok — çakışma kurulamaz",
      );
      atlanan += 1;
    } else {
      const oncekiHash = await prisma.user.findFirst({
        where: { isSystemAccount: true },
        select: { id: true, passwordHash: true, quickPin: true },
      });
      const cakisma = await ensureSuperadminAccount({
        ...sahteEnv,
        SUPERADMIN_PIN: pinliBaskaKullanici.quickPin,
        SUPERADMIN_FORCE_SYNC: "true",
      } as NodeJS.ProcessEnv);
      check(
        "FORCE_SYNC + çakışan PIN → 'invalid' (retry YOK, ham Prisma hatası yukarı çıkmaz)",
        cakisma.action === "invalid",
        cakisma.action === "invalid" ? cakisma.reasons.join(" · ") : cakisma.action,
      );
      const sonrakiHash = await prisma.user.findFirst({
        where: { id: oncekiHash?.id ?? "" },
        select: { passwordHash: true, quickPin: true },
      });
      check(
        "çakışmada sistem hesabına HİÇBİR ŞEY yazılmadı (tek ifade, atomik)",
        sonrakiHash?.passwordHash === oncekiHash?.passwordHash &&
          sonrakiHash?.quickPin === oncekiHash?.quickPin,
      );
    }

    // (f) FORCE_SYNC — YALNIZ kendi fixture'ımız tek sistem hesabıysa.
    if (fixtureId && fixtureTekSistemHesabi) {
      const oncesi = await prisma.user.findUnique({
        where: { id: fixtureId },
        select: { tokenVersion: true },
      });
      const yeniHash = await AuthService.hashPassword(`${FIXTURE_PAROLA}-2`);
      const sync = await ensureSuperadminAccount({
        ...sahteEnv,
        SUPERADMIN_PASSWORD_HASH: yeniHash,
        SUPERADMIN_FORCE_SYNC: "true",
      } as NodeJS.ProcessEnv);
      check("FORCE_SYNC → 'synced'", sync.action === "synced", sync.action);
      const sonrasi = await prisma.user.findUnique({
        where: { id: fixtureId },
        select: { tokenVersion: true, passwordHash: true },
      });
      check(
        "FORCE_SYNC `tokenVersion`ı artırdı (eski oturumlar düştü)",
        (sonrasi?.tokenVersion ?? 0) === (oncesi?.tokenVersion ?? 0) + 1,
        `${oncesi?.tokenVersion} → ${sonrasi?.tokenVersion}`,
      );
      check("FORCE_SYNC parola hash'ini env'e eşitledi", sonrasi?.passwordHash === yeniHash);
      check(
        "FORCE_SYNC İKİNCİ satır yaratmadı",
        (await prisma.user.count({ where: { isSystemAccount: true } })) === sayiIlkSonrasi,
      );
      // A4 — FARKLI AD: 'synced' döner ama ad DEĞİŞMEZ + audit bayrağı doğar.
      const syncMismatch = await ensureSuperadminAccount({
        ...sahteEnv,
        SUPERADMIN_USERNAME: `${FIXTURE_USERNAME}.baska`,
        SUPERADMIN_PASSWORD_HASH: yeniHash,
        SUPERADMIN_FORCE_SYNC: "true",
      } as NodeJS.ProcessEnv);
      check("FORCE_SYNC + FARKLI ad → yine 'synced'", syncMismatch.action === "synced", syncMismatch.action);
      const adSonrasi = await prisma.user.findUnique({
        where: { id: fixtureId },
        select: { username: true },
      });
      check(
        "FORCE_SYNC kullanıcı adını DEĞİŞTİRMEDİ (giriş kimliği korunur)",
        adSonrasi?.username === FIXTURE_USERNAME,
        adSonrasi?.username ?? "—",
      );
      await new Promise((r) => setTimeout(r, 300)); // audit best-effort
      const syncIz = await prisma.systemLog.findFirst({
        where: { action: "SUPERADMIN_CREDENTIALS_SYNCED", recordId: fixtureId },
        orderBy: { createdAt: "desc" },
        select: { newData: true },
      });
      const syncYuk = JSON.stringify(syncIz?.newData ?? {});
      check(
        "ad uyuşmazlığı audit'e `usernameMismatch: true` olarak düştü",
        /"usernameMismatch"\s*:\s*true/.test(syncYuk),
        syncYuk.slice(0, 160),
      );
      check(
        "senkron audit yükünde GERÇEK kullanıcı adı YOK",
        !syncYuk.includes(FIXTURE_USERNAME),
        syncYuk.slice(0, 160),
      );
    } else {
      atla(
        "FORCE_SYNC (rotasyon) ölçümü",
        "bu DB'de bizim fixture'ımız TEK sistem hesabı değil — gerçek bir satıcı hesabının parolasını döndürmemek için ATLANDI",
      );
      atlanan += 8; // `atla` 1'i sayar; o dalda 9 kontrol var (A4 ad-uyuşmazlığı dahil)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n=== G) Tam yetki `[\"*\"]` — grant satırı DOĞMADAN ===");
  {
    const hedef = fixtureId ?? (await prisma.user.findFirst({
      where: { isSystemAccount: true },
      select: { id: true },
    }))?.id ?? null;
    if (!hedef) {
      atla("getEffectivePermissions ölçümü", "DB'de sistem hesabı yok");
      atlanan += 3;
    } else {
      const izinler = await AuthService.getEffectivePermissions(hedef);
      check("süperadmin izinleri tam olarak `[\"*\"]`", izinler.length === 1 && izinler[0] === "*", JSON.stringify(izinler));
      const grant = await prisma.userPermission.count({ where: { userId: hedef } });
      check("`user_permissions` satırı DOĞMADI (rol DEĞİL)", grant === 0, `${grant} satır`);

      // Karşı ölçüm — normal kullanıcı `["*"]` ALMAZ (bypass yalnız işaretli hesapta).
      const normal = await prisma.user.findFirst({
        where: { isSystemAccount: false, isActive: true },
        select: { id: true, username: true },
      });
      if (normal) {
        const nIzin = await AuthService.getEffectivePermissions(normal.id);
        check(
          "normal kullanıcı `[\"*\"]` ALMAZ (karşı ölçüm)",
          !nIzin.includes("*"),
          `${normal.username}: ${nIzin.length} izin`,
        );
      } else {
        atla("normal kullanıcı karşı ölçümü", "DB'de normal kullanıcı yok");
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n=== J) id → PIN zinciri KAPALI (`/users/:id*` → 404) ===");
  {
    // (a) ÖNEK KAPISI kaynak sözleşmesi — route başına eklenirse on sekizinci uç
    //     kapısız doğar (bu repoda "unutulmuş yüzey" sınıfı defalarca ısırdı).
    const adminSrc = fs.readFileSync(path.join(SRC, "routes", "admin.routes.ts"), "utf8");
    const kapiIdx = adminSrc.indexOf("blockSystemAccountTarget");
    const kapiKullanimIdx = adminSrc.indexOf('"/users/:id",\n  verifyToken');
    check("`blockSystemAccountTarget` admin.routes'ta bağlı", kapiIdx > 0);
    check(
      "kapı ÖNEK olarak bağlı (`router.use(\"/users/:id\", …)`)",
      /router\.use\(\s*\n?\s*"\/users\/:id",[\s\S]{0,200}blockSystemAccountTarget/.test(adminSrc),
    );
    // Kapı, `/users/:id` ile başlayan HER uç tanımından ÖNCE gelmeli.
    const ilkUcIdx = adminSrc.search(/router\.(get|post|patch|put|delete)\(\s*\n?\s*"\/users\/:id/);
    const kapiUseIdx = adminSrc.search(/router\.use\(\s*\n?\s*"\/users\/:id"/);
    check(
      "kapı, ilk `/users/:id` ucundan ÖNCE tanımlı",
      kapiUseIdx >= 0 && ilkUcIdx > kapiUseIdx,
      `use@${kapiUseIdx} < uç@${ilkUcIdx}`,
    );
    const ucSayisi = (adminSrc.match(/"\/users\/:id[^"]*"/g) ?? []).length;
    check("körlük zemini — `/users/:id*` uç sayısı ≥ 10", ucSayisi >= 10, `${ucSayisi} yol`);
    void kapiKullanimIdx;

    // (b) MIDDLEWARE davranışı — sistem hesabı hedefinde 404 + audit denemesi.
    const hedef =
      fixtureId ??
      (await prisma.user.findFirst({ where: { isSystemAccount: true }, select: { id: true } }))?.id ??
      null;
    const normal = await prisma.user.findFirst({
      where: { isSystemAccount: false },
      select: { id: true },
    });
    if (!hedef || !normal) {
      atla("404 kapısı davranış ölçümü", "fixture yok");
      atlanan += 4;
    } else {
      const cagir = async (id: string): Promise<unknown> => {
        const req = {
          params: { id },
          user: { userId: normal.id },
          method: "GET",
          originalUrl: `/api/admin/users/${id}/credentials`,
        } as unknown as Request;
        return new Promise((resolve) => {
          void blockSystemAccountTarget(req, {} as Response, ((e?: unknown) => resolve(e)) as NextFunction);
        });
      };

      const oncekiDeneme = await prisma.systemLog.count({
        where: { action: "SYSTEM_ACCOUNT_ACCESS_BLOCKED" },
      });
      const sistemHatasi = await cagir(hedef);
      check(
        "sistem hesabı hedefi → 404 (403 DEĞİL: 403 varlığı doğrular)",
        sistemHatasi instanceof AppError && sistemHatasi.statusCode === 404,
        sistemHatasi instanceof AppError ? `${sistemHatasi.statusCode}` : String(sistemHatasi),
      );
      const sonrakiDeneme = await prisma.systemLog.count({
        where: { action: "SYSTEM_ACCOUNT_ACCESS_BLOCKED" },
      });
      check(
        "deneme audit'e yazıldı (kim satıcının PIN'ini aradı)",
        sonrakiDeneme > oncekiDeneme,
        `${oncekiDeneme} → ${sonrakiDeneme}`,
      );
      const sonIz = await prisma.systemLog.findFirst({
        where: { action: "SYSTEM_ACCOUNT_ACCESS_BLOCKED" },
        orderBy: { createdAt: "desc" },
        select: { newData: true },
      });
      const yuk = JSON.stringify(sonIz?.newData ?? {});
      check(
        "audit izi SIR taşımıyor (yalnız hedef id + method + path)",
        !/\$2[aby]\$/.test(yuk) && !/\bquickPin\b/.test(yuk) && !/passwordHash/.test(yuk),
        yuk.slice(0, 120),
      );

      const normalHatasi = await cagir(normal.id);
      check("normal kullanıcı hedefi DOKUNULMADAN geçer (regresyon)", normalHatasi === undefined);

      const uuidDegil = await cagir("bu-bir-uuid-degil");
      check(
        "UUID olmayan `:id` dokunulmadan geçer (bugünkü hata yolu korunur)",
        uuidDegil === undefined,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n=== K) `/api/auth/me` sözleşmesi (panelin salt-okunur kararı) ===");
  {
    // Panel "Modüller" kategorisini bu İKİ alandan çizer. Ayrışırlarsa panel
    // yazılabilir gösterip 403 yer (ya da tersi: yazabilecekken kilitli görünür).
    const ctrl = fs.readFileSync(path.join(SRC, "controllers", "auth.controller.ts"), "utf8");
    check(
      "`/auth/me` `isSystemAccount` döner (istek-taze kimlikten)",
      /isSystemAccount:\s*req\.isSystemAccount === true/.test(ctrl),
    );
    // ⚠️ AYNA GUARD'IN YÜKLEMİDİR, HAM DEFTER OKUMASI DEĞİL (A5 / D2 bulgusu).
    // `systemAccountExistsKnown()` üç durumlu ham okumadır ve "bilinmiyor"da
    // `false` der; oysa kapı o durumda KİLİTLİDİR (fail-closed). Panel ham
    // okumayı görürse supabı AÇIK çizer → kullanıcı toggle'ı çevirir, sunucu
    // 403 verir, bant da çizilmediği için sebep hiçbir yerde yazmaz. Normalde
    // ~3 sn'lik boot penceresi; job 5 denemede düşerse KALICI.
    // (2026-09-03 V bulgusu) Yüklem artık TEMBEL DOĞRULAMALI ortak sürüm:
    // `resolveSystemAccountLock()` — defter "yok" derken DB'de hesap doğmuşsa
    // panel de kapıyla AYNI istekte kilitlenir (eski `systemAccountLockActive()`
    // aynası o pencerede `false` diyordu; hesapsız açılan sunucuda ölçüldü).
    check(
      "`/auth/me` `systemAccountExists` = guard'ın KENDİ yüklemi (`resolveSystemAccountLock`, tembel doğrulamalı)",
      /systemAccountExists\s*=\s*await\s+resolveSystemAccountLock\(\)/.test(ctrl) &&
        /^\s*systemAccountExists,\s*$/m.test(ctrl),
      "ham `systemAccountExistsKnown()` ya da tembel doğrulamasız `systemAccountLockActive()` yazılırsa panel ile kapı ayrışır",
    );
    // ⚠️ YORUMLAR AYIKLANIR — ölçülmüş kör nokta (SONDA-H3'ün ikizi): bu kuralın
    // GEREKÇESİ tam da yasaklanan çağrının adını anıyor, yani ham metin taraması
    // kendi açıklamasını ihlal sayar (ilk koşumda öyle oldu).
    check(
      "`/auth/me` ham defter okumasını KULLANMIYOR",
      !/systemAccountExistsKnown\(\)/.test(yorumlariSok(ctrl)),
      "üç durumlu ham okuma panele SIZMAMALI",
    );
    const authMw = fs.readFileSync(path.join(SRC, "middlewares", "auth.middleware.ts"), "utf8");
    check(
      "kimlik JWT claim'i DEĞİL, istek başına TAZE DB okuması",
      /select:\s*\{[^}]*isSystemAccount:\s*true/.test(authMw) &&
        /req\.isSystemAccount\s*=\s*fresh\.isSystemAccount === true/.test(authMw),
      "claim olsaydı iptal edilmiş bir satıcı token'ı süresi dolana dek yetkili kalırdı",
    );
    const jwtTip = fs.readFileSync(path.join(SRC, "types", "express-augment.ts"), "utf8");
    check("`req.isSystemAccount` tip beyanı var", /isSystemAccount\?:\s*boolean/.test(jwtTip));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n=== M) Önek kapısı ALT ROTADAN dar olamaz (izin BİRLEŞİMİ) ===");
  {
    // NE KORUYOR (D1 bulgusu): `router.use("/users/:id", …)` öneki her alt rotadan
    // ÖNCE koşar. İzni alt rotalardan DAR olursa, o alt rotanın ilan ettiği izne
    // sahip bir kullanıcı ucu HİÇ göremez ve aldığı 403 rotanın hiç istemediği bir
    // izni suçlar ("kart görür, tıklar, /forbidden" sınıfı). Bugün on yedi uç
    // `admin:users`, biri (`/credentials`) `admin:settings` + `admin:users` ilan
    // ediyor — yani önek İKİSİNİ birden kapsamak zorunda.
    //
    // ⚠️ Bu bir DARALTMA testi DEĞİL: alt rota kendi zincirinde izni yine ister.
    // Ölçülen tek şey "önek, altındakinden dar değil" sözleşmesi.
    const ts2 = await import("typescript");
    const yol = path.join(SRC, "routes", "admin.routes.ts");
    const sf2 = ts2.createSourceFile(yol, fs.readFileSync(yol, "utf8"), ts2.ScriptTarget.Latest, true);

    /** Bir `router.x(...)` çağrısındaki izin kodlarını toplar. */
    const izinleriTopla = (cagri: import("typescript").CallExpression): string[] => {
      const kodlar: string[] = [];
      for (const arg of cagri.arguments) {
        if (!ts2.isCallExpression(arg) || !ts2.isIdentifier(arg.expression)) continue;
        const ad = arg.expression.text;
        if (ad !== "requirePermission" && ad !== "requireAnyPermission") continue;
        for (const a of arg.arguments) {
          if (ts2.isStringLiteral(a)) kodlar.push(a.text);
        }
      }
      return kodlar;
    };

    let onekIzinleri: string[] | null = null;
    const altRotalar: Array<{ yol: string; izinler: string[] }> = [];
    const gez2 = (n: import("typescript").Node): void => {
      if (
        ts2.isCallExpression(n) &&
        ts2.isPropertyAccessExpression(n.expression) &&
        ts2.isIdentifier(n.expression.expression) &&
        n.expression.expression.text === "router"
      ) {
        const yontem = n.expression.name.text;
        const ilk = n.arguments[0];
        if (ilk && ts2.isStringLiteral(ilk) && ilk.text.startsWith("/users/:id")) {
          if (yontem === "use") onekIzinleri = izinleriTopla(n);
          else altRotalar.push({ yol: ilk.text, izinler: izinleriTopla(n) });
        }
      }
      ts2.forEachChild(n, gez2);
    };
    gez2(sf2);

    // Körlük zemini — tarayıcı boşa düşerse "ihlal yok" ile "hiçbir şeye
    // bakmadım" AYNI yeşile çıkar.
    check("önek kapısı AST ile bulundu", onekIzinleri !== null);
    check(
      "körlük zemini — `/users/:id*` alt rotası ≥ 10 bulundu",
      altRotalar.length >= 10,
      `${altRotalar.length} rota`,
    );
    const onekKume = new Set<string>(onekIzinleri ?? []);
    check(
      "önek kapısı en az bir izin ilan ediyor (kimliksiz orakül kapalı)",
      onekKume.size >= 1,
      [...onekKume].join(", "),
    );

    const dar = altRotalar
      .filter((r) => r.izinler.some((k) => !onekKume.has(k)))
      .map((r) => `${r.yol} → ${r.izinler.filter((k) => !onekKume.has(k)).join(", ")}`);
    check(
      "önek kapısının izin kümesi ⊇ HER alt rotanın izin kümesi",
      dar.length === 0,
      dar.join("\n     ") ||
        `önek: {${[...onekKume].join(", ")}} — ${altRotalar.length} alt rota kapsandı`,
    );
    // İKİ YÖNLÜ: önekte alt rotaların HİÇBİRİNDE geçmeyen bir izin varsa o da
    // sözleşme kaymasıdır (kapı gerçekte hiçbir şeyi kapsamıyor demektir).
    const altKume = new Set(altRotalar.flatMap((r) => r.izinler));
    const oluOnekIzni = [...onekKume].filter((k) => !altKume.has(k));
    check(
      "önekteki her izin en az bir alt rotada da ilan edilmiş (ölü izin yok)",
      oluOnekIzni.length === 0,
      oluOnekIzni.join(", "),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n=== L) HTTP turu (sunucu yoksa ATLANIR) ===");
  // ⚠️ `httpTuru()`nun EMİT ETTİĞİ kontrol sayısıyla BİREBİR olmalı: sunucusuz
  // koşumda "atlandı" sayacı buradan beslenir. Eskiden 8 yazılıydı ama ayak 7
  // kontrol basıyordu (D3 bulgusu — muhasebe hatası). B1 ile audit maskesi
  // ölçümleri eklendi → 17.
  const HTTP_KONTROL = 17;
  if (!(await serverUp())) {
    atla("HTTP turu", `${BASE} ayakta değil — ${HTTP_KONTROL} kontrol ölçülmedi`);
    atlanan += HTTP_KONTROL;
  } else if (!fixtureId) {
    atla("HTTP turu", "fixture süperadmin hesabı yaratılamadı (DB'de zaten bir hesap vardı)");
    atlanan += HTTP_KONTROL;
  } else {
    await httpTuru();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  async function httpTuru(): Promise<void> {
    // ⚠️ FORCE_SYNC ölçümü parolayı değiştirmiş olabilir — hangi parolanın
    // geçerli olduğunu ARAMAYIZ, ikisini de deneriz (ölçüm, tahmin değil).
    let token: string | null = null;
    for (const parola of [`${FIXTURE_PAROLA}-2`, FIXTURE_PAROLA]) {
      const r = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: FIXTURE_USERNAME, password: parola, clientType: "electron" }),
      });
      if (r.ok) {
        token = ((await r.json()) as { data: { token: string } }).data.token;
        break;
      }
    }
    if (!token) {
      // `fail++` YOK — bu bir sözleşme ihlali değil, ÖLÇÜM YAPILAMAMASIDIR
      // (giriş kilidi IP başına ve bellek içi; art arda koşumda devreye girer).
      atla("HTTP turu", "fixture süperadmin giriş yapamadı (giriş kilidi olabilir)");
      atlanan += HTTP_KONTROL;
      return;
    }
    const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    // (1) /auth/me — kimlik + supap durumu
    const me = await (await fetch(`${BASE}/api/auth/me`, { headers: auth })).json();
    const meData = (me as { data?: Record<string, unknown> }).data ?? {};
    check("HTTP: /auth/me `isSystemAccount: true`", meData.isSystemAccount === true, JSON.stringify(meData.isSystemAccount));
    check("HTTP: /auth/me `permissions` = ['*']", JSON.stringify(meData.permissions) === '["*"]', JSON.stringify(meData.permissions));
    check("HTTP: /auth/me `systemAccountExists: true`", meData.systemAccountExists === true);

    // (2) Süperadmin kendini LİSTEDE GÖRMEZ (gizlilik uçtan uca)
    const liste = await (await fetch(`${BASE}/api/admin/users`, { headers: auth })).json();
    const satirlar = ((liste as { data?: Array<{ username?: string }> }).data ?? []);
    check(
      "HTTP: kullanıcı listesinde sistem hesabı YOK (kendini bile görmez)",
      satirlar.length > 0 && !satirlar.some((u) => u.username === FIXTURE_USERNAME),
      `${satirlar.length} satır`,
    );

    // (3) id → PIN zinciri: kendi id'siyle bile 404
    const kunye = await fetch(`${BASE}/api/admin/users/${fixtureId}`, { headers: auth });
    check("HTTP: /admin/users/:id (sistem hesabı) → 404", kunye.status === 404, `${kunye.status}`);
    const kimlik = await fetch(`${BASE}/api/admin/users/${fixtureId}/credentials`, { headers: auth });
    check("HTTP: /credentials (sistem hesabı) → 404 (DÜZ PIN sızmaz)", kimlik.status === 404, `${kimlik.status}`);

    // (4) Modül anahtarı: süperadmin YAZAR — gerçek değeri DEĞİŞTİRMEDEN
    //     (mevcut değeri okuyup AYNISINI yazarız; bekçi durum bozmaz).
    const bayraklar = (await (await fetch(`${BASE}/api/feature-flags`, { headers: auth })).json()) as {
      data?: Record<string, unknown>;
    };
    const mevcut = bayraklar.data?.tezgahEnabled;
    const yaz = await fetch(`${BASE}/api/feature-flags`, {
      method: "PATCH",
      headers: auth,
      body: JSON.stringify({ tezgahEnabled: mevcut === true }),
    });
    check("HTTP: süperadmin modül anahtarını YAZAR → 200", yaz.status === 200, `${yaz.status}`);

    // ═════════════════════════════════════════════════════════════════════════
    // (5) AKTÖR MASKESİ — audit LİSTESİ + DETAYI (B1 / D2 major #1 ve #2)
    // ═════════════════════════════════════════════════════════════════════════
    // NE KORUYOR: satıcı hesabının GERÇEK giriş adı bir SIRDIR (helper'ın kendi
    // gerekçesi) ve audit yüzeylerinde takma adla ("sistem" / "Sistem Bakımı")
    // gösterilir. Bu maskenin TEK uygulaması `system-log.service`teki
    // `withMaskedActor`tı ve HİÇBİR BEKÇİ ONU ÖLÇMÜYORDU — sonda ölçüldü:
    // maskeyi silmek 99/0'ı hiç bozmuyordu. Ayrıca maske SATIR düzeyinde eksikti:
    // `AUTH` satırlarının `recordId`'si giriş adıdır ve aynı JSON satırında
    // `{"recordId":"<gerçek ad>","user":{"username":"sistem"}}` yan yana duruyordu.
    //
    // ⚠️ ÖLÇÜM SÜPERADMİNİN KENDİ TOKEN'IYLA YAPILIR. Maske BAKAN KİŞİYE göre
    // değişmez (servis her okuyucuya aynı nesneyi verir), ve fabrika admininin
    // parolası bu DB'de BİLİNMİYOR — "admin/123123" varsayımı seed dışı
    // kurulumlarda düşer ve ölçüm sessizce atlanırdı.
    //
    // Süperadmin yukarıda GİRİŞ YAPTI → `LOGIN_SUCCESS` (tableName=AUTH,
    // recordId=<gerçek ad>) satırı DOĞDU; PATCH de bir DOMAIN satırı doğurdu.
    await new Promise((r) => setTimeout(r, 400)); // audit best-effort
    const logListe = await fetch(
      `${BASE}/api/admin/system-logs?userId=${fixtureId}&limit=50`,
      { headers: auth },
    );
    const logGovde = await logListe.text();
    const logJson = JSON.parse(logGovde) as {
      data?: Array<{ id: string; tableName: string; recordId: string; user?: Record<string, unknown> | null }>;
    };
    const satirlar2 = logJson.data ?? [];
    check(
      "HTTP: süperadminin audit satırları LİSTEDE duruyor (karar #8 — satır süzülmez)",
      satirlar2.length > 0,
      `${satirlar2.length} satır`,
    );
    check(
      "HTTP: audit aktörü takma adla basılıyor (`sistem` / `Sistem Bakımı`)",
      satirlar2.length > 0 &&
        satirlar2.every(
          (r) => r.user?.username === "sistem" && r.user?.fullName === "Sistem Bakımı",
        ),
      JSON.stringify(satirlar2[0]?.user ?? null),
    );
    const authSatirlari = satirlar2.filter((r) => r.tableName === "AUTH");
    check(
      "HTTP: körlük zemini — en az bir `AUTH` satırı var (giriş yapıldı)",
      authSatirlari.length > 0,
      `${authSatirlari.length} AUTH satırı`,
    );
    check(
      "HTTP: `AUTH` satırının `recordId`'si de NÖTRLENMİŞ (giriş adı sızmıyor)",
      authSatirlari.length > 0 && authSatirlari.every((r) => r.recordId === "sistem"),
      authSatirlari.map((r) => r.recordId).join(", "),
    );
    check(
      "HTTP: liste GÖVDESİNDE gerçek kullanıcı adı 0 kez geçiyor",
      !logGovde.includes(FIXTURE_USERNAME),
      "aksi halde takma ad aynı satırda çürütülür",
    );
    check(
      "HTTP: yanıtta `isSystemAccount` anahtarı YOK (maske kendini ilan etmez)",
      !logGovde.includes("isSystemAccount"),
    );

    // Detay yolu (`findById`) AYNI sarmalayıcıdan geçmeli — ayrı yazım ayrışır.
    const detayId = authSatirlari[0]?.id ?? satirlar2[0]?.id ?? null;
    if (!detayId) {
      atla("audit DETAY maskesi", "listede satır yok");
      atlanan += 1;
    } else {
      const detayGovde = await (
        await fetch(`${BASE}/api/admin/system-logs/${detayId}`, { headers: auth })
      ).text();
      const detay = JSON.parse(detayGovde) as {
        data?: { tableName?: string; recordId?: string; user?: Record<string, unknown> | null };
      };
      check(
        "HTTP: audit DETAYI da maskeli (aktör + AUTH `recordId`)",
        detay.data?.user?.username === "sistem" &&
          (detay.data?.tableName !== "AUTH" || detay.data?.recordId === "sistem"),
        JSON.stringify({ recordId: detay.data?.recordId, user: detay.data?.user }),
      );
      check(
        "HTTP: detay GÖVDESİNDE gerçek kullanıcı adı 0 kez geçiyor",
        !detayGovde.includes(FIXTURE_USERNAME),
      );
    }

    // ═════════════════════════════════════════════════════════════════════════
    // (6) ARŞİV KOLU — canlı kolun BİR ADIM GERİSİNDE kalmasın
    // ═════════════════════════════════════════════════════════════════════════
    // Arşiv 6 ayda bir dolar, yani bu yol yıllarca ölçülmeden kalabilir; maskesi
    // canlı koldan ayrışırsa fark ancak eski bir kaydı açan denetçi tarafından
    // görülür. SENTETİK satır yazılır ve `finally`de silinir.
    const arsivId = randomUUID();
    arsivSondaId = arsivId;
    await prisma.systemLogArchive.create({
      data: {
        id: arsivId,
        userId: fixtureId,
        category: "AUTH",
        action: "LOGIN_SUCCESS",
        tableName: "AUTH",
        recordId: FIXTURE_USERNAME,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const arsivListeGovde = await (
      await fetch(`${BASE}/api/admin/system-logs/archive?userId=${fixtureId}&limit=50`, {
        headers: auth,
      })
    ).text();
    const arsivListe = JSON.parse(arsivListeGovde) as {
      data?: Array<{ id: string; recordId: string; user?: Record<string, unknown> | null }>;
    };
    const arsivSatir = (arsivListe.data ?? []).find((r) => r.id === arsivId);
    check(
      "HTTP: ARŞİV listesi maskeli (aktör + `recordId`) ve gerçek ad geçmiyor",
      !!arsivSatir &&
        arsivSatir.user?.username === "sistem" &&
        arsivSatir.recordId === "sistem" &&
        !arsivListeGovde.includes(FIXTURE_USERNAME),
      JSON.stringify(arsivSatir ?? null),
    );
    const arsivDetayGovde = await (
      await fetch(`${BASE}/api/admin/system-logs/archive/${arsivId}`, { headers: auth })
    ).text();
    const arsivDetay = JSON.parse(arsivDetayGovde) as {
      data?: { recordId?: string; user?: Record<string, unknown> | null };
    };
    check(
      "HTTP: ARŞİV detayı maskeli (aktör + `recordId`) ve gerçek ad geçmiyor",
      arsivDetay.data?.user?.username === "sistem" &&
        arsivDetay.data?.recordId === "sistem" &&
        !arsivDetayGovde.includes(FIXTURE_USERNAME),
      JSON.stringify({ recordId: arsivDetay.data?.recordId, user: arsivDetay.data?.user }),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Bayat fixture sistem hesaplarını (ve RESTRICT ile bağlı satırlarını) siler.
 *
 * ⚠️ Hem AÇILIŞTA hem `finally`de koşar: süreç öldürülürse `finally` hiç
 * çalışmaz ve bir sonraki koşum "sistem hesabı ≤ 1" invariantını bozulmuş
 * bulur. Bekçi kendi artığını kendi temizler.
 */
async function temizleBayatFixtureler(): Promise<void> {
  const bayat = await prisma.user.findMany({
    where: { username: { startsWith: "bekci.superadmin." }, isSystemAccount: true },
    select: { id: true },
  });
  for (const b of bayat) {
    await prisma.session.deleteMany({ where: { userId: b.id } });
    await prisma.workSession.deleteMany({ where: { userId: b.id } });
    await prisma.systemLog.deleteMany({ where: { userId: b.id } });
    await prisma.userPermission.deleteMany({ where: { userId: b.id } });
    await prisma.user.delete({ where: { id: b.id } });
  }
  // §L'nin sentetik ARŞİV satırları (FK yok → kullanıcı silinse de kalırlar;
  // `recordId` fixture kullanıcı adıdır, o yüzden desenle bulunur).
  await prisma.systemLogArchive.deleteMany({
    where: { tableName: "AUTH", recordId: { startsWith: "bekci.superadmin." } },
  });
}

/** `quickPin` sistem genelinde `@unique` — çakışmayan bir 6 hane üretir. */
function rastgeleKullanilmamisPin(): string {
  // Fixture PIN'i SAHTEDİR ve `finally`de hesapla birlikte silinir.
  return String(100000 + Math.floor(Math.random() * 899999));
}

async function serverUp(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    fail++;
  })
  .finally(async () => {
    // Temizlik — fixture sistem hesabı SİLİNİR ("sistem hesabı ≤ 1" invariantı).
    try {
      if (fixtureId) {
        // ⚠️ `users`a RESTRICT ile bağlı üç tablo bu koşumda satır doğurur:
        // `sessions` (HTTP girişi) · `system_logs` (giriş + engellenen erişim +
        // bayrak yazımı) · `work_sessions` (bugün doğmuyor, sigorta). Onlar
        // silinmeden `user.delete` P2003 verir ve fixture DB'de KALIR — yani
        // "sistem hesabı ≤ 1" invariantını bekçinin kendisi bozardı.
        await prisma.session.deleteMany({ where: { userId: fixtureId } });
        await prisma.workSession.deleteMany({ where: { userId: fixtureId } });
        await prisma.systemLog.deleteMany({ where: { userId: fixtureId } });
        await prisma.userPermission.deleteMany({ where: { userId: fixtureId } });
        await prisma.user.delete({ where: { id: fixtureId } });
      }
      // §L'nin sentetik arşiv satırı (FK yok — kullanıcı silinmeden de silinebilir,
      // ama sıra korunur ki yarım kalan koşumda artık kalmasın).
      if (arsivSondaId) {
        await prisma.systemLogArchive.deleteMany({ where: { id: arsivSondaId } });
      }
      // Bayat kalmış eski koşum artıkları (süreç öldürülmüşse).
      await temizleBayatFixtureler();
    } catch (e) {
      console.error("⚠️ temizlik başarısız:", e instanceof Error ? e.message : e);
    }
    __resetSystemAccountRegistryForTests();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${atlanan ? `, ${atlanan} atlandı` : ""} ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
