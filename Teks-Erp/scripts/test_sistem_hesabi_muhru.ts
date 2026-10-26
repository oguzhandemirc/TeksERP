// =============================================================================
// BEKÇİ — SİSTEM HESABI MÜHRÜ (G1): `isSystemAccount` tek başına yetki VERMEZ
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts sistem_hesabi_muhru
//
// Ölçülen: mandallı kurulumda yalnız geçerli mühürlü sistem hesabı `["*"]` alır ve girer (DB'ye
// yazan biri bayrağı kendine koyamaz, süperadminin parola özetini değiştiremez, başka kurulumun
// mührünü taşıyamaz); mandalsız kurulum bugünkü gibi çalışır; meşru kimlik değişimi mührü AYNI
// yazımda yeniler ama bozuk mührü aklamaz; kimlik kolonu yazan her yol yeniden mühürler (AST);
// `systemAccountSeal`in tek yazarı mühür yardımcısıdır; TOTP (açık sır, açılış, kanıt, kurtarma kodları) mühre
// girer ve DB'den kurcalanması mührü bozar, özet saklama biçiminden bağımsızdır (§8); v1→v2 geçişi bir kez,
// işaretten sonra v1 mühür geri konamaz (§9); hedef koruması (panelden düzenleme) yetkiyle aynı
// yüklemi okur — sahte işaretli hesap korunmaz, pasife alınabilir (§6); health + `/auth/me` bandı (§7). Geçici LICENSE_DIR kullanır, DB fikstürlerini
// `finally`de siler.
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { AddressInfo } from "node:net";
import app from "../src/app";
import prisma, { pool } from "../src/lib/prisma";
import { AuthService } from "../src/services/auth.service";
import { AppError } from "../src/utils/app-error";
import { loadLicenseStoreSync } from "../src/lib/license/store";
import { getLicenseCore } from "../src/lib/license/native";
import { formatSeal, parseSeal } from "../src/lib/license/system-seal";
import {
  assertSealAllowsLogin,
  credentialDigest,
  credentialDigestV1,
  isSystemAccountAuthorized,
  migrateSealsToV2,
  resetSystemAccountSealCacheForTest,
  SEAL_ROW_SELECT,
  sealBandStatus,
  sealStatus,
  sealSummary,
  SYSTEM_ACCOUNT_LATCH_FILE,
  SYSTEM_ACCOUNT_SEAL_INVALID_CODE,
  SYSTEM_SEAL_V2_MARKER_FILE,
  writeLatch,
  writeSeal,
} from "../src/services/helpers/system-account-seal.helper";
import { buildRichHealth } from "../src/lib/health-snapshot";
import { TotpAccountService } from "../src/services/totp-account.service";
import { totpCodeForStep, totpStep } from "../src/services/totp.service";
import { setTotpSecretOpenerForTest } from "../src/services/helpers/totp-state.helper";
import { getShortCredentialKeyRing } from "../src/lib/short-credential/keyring";
import { isSealedTotpSecret, openTotpSecret } from "../src/lib/short-credential/totp-crypto";
import { resolveSystemAccountLock, __resetSystemAccountRegistryForTests } from "../src/services/helpers/system-account.registry";
import { resetRequestPermissionCacheForTest } from "../src/services/auth.service";
import { geciciLisansDizini } from "./lib/sistem-hesabi-muhru-fikstur";
import { hedefDbAdi, hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const KOK = path.join(__dirname, "..");
const ONEK = `bekci.g1.${process.pid}.`;
const PAROLA = `Bekci-G1-${process.pid}-parola`;
const fiksturler: string[] = [];

// ─────────────────────────────────────────────────────────────────────────────
// §4/§5 — STATİK (AST) — DB'siz; sondalar bellek içi dosya kümesine yazar
// ─────────────────────────────────────────────────────────────────────────────
const KIMLIK_KOLONLARI = new Set(["passwordHash", "quickPinDigest", "quickPin", "cardTokenDigest", "cardToken", "totpSecret", "totpEnabledAt"]);
/** Kurtarma kodu KÜMESİNİ değiştiren çağrılar (`usedAt` damgası kümeyi değiştirmez, mühre girmez). */
const KOD_KUMESI_YAZAN = new Set(["create", "createMany", "delete", "deleteMany", "upsert"]);
const YENIDEN_MUHUR = /\b(credentialReseal|writeSeal)\s*\(/;
const MUHUR_YARDIMCISI = "src/services/helpers/system-account-seal.helper.ts";

/**
 * Kimlik kolonu yazıp yeniden mühürlemeyen BEYANLI yollar. Anahtar `dosya::işlev`. Her satır
 * gerekçesiyle; ölü satır kırmızıdır.
 */
const MUAF: Readonly<Record<string, string>> = {
  "src/services/permission-management.service.ts::createUser":
    "panelden açılan hesap sıradan kullanıcı doğar (bayrak yazılmaz) — mühürlenecek sistem kimliği yok",
  "src/services/permission-management.service.ts::createFactoryAdmin":
    "fabrika yöneticisi sıradan kullanıcı doğar (isSystemAccount:false) — mühürlenecek sistem kimliği yok",
  "src/jobs/totp-secret.job.ts::wrapPlainTotpSecrets":
    "düz TOTP sırrını sarar; açık sır ve özet DEĞİŞMEZ (mühür açık sırdan doğar) — yeniden mühürlenecek kimlik değişimi yok",
  "src/services/permission-management.service.ts::deleteUser":
    "silinen hesabın kimliği boşaltılır; sistem hesabı panelden silinemez ve silinmişin mührünün bozulması istenen sonuçtur",
};

/** Üretimde koşan kaynaklar: `src/` + pakete giren araçlar (`build-araclar.mjs` listesi). */
function uretimDosyalari(): Map<string, string> {
  const m = new Map<string, string>();
  const gez = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) gez(p);
      else if (/\.ts$/.test(e.name) && !/\.d\.ts$/.test(e.name)) m.set(path.relative(KOK, p), fs.readFileSync(p, "utf8"));
    }
  };
  gez(path.join(KOK, "src"));
  const araclar = fs.readFileSync(path.join(KOK, "scripts", "build-araclar.mjs"), "utf8");
  for (const a of araclar.matchAll(/giris:\s*"(scripts\/[^"]+\.ts)"/g)) {
    m.set(a[1]!, fs.readFileSync(path.join(KOK, a[1]!), "utf8"));
  }
  return m;
}

function propAdi(p: ts.ObjectLiteralElementLike): string | null {
  if ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) {
    return p.name.text;
  }
  return null;
}

function islevAdi(n: ts.Node): string | null {
  if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name && ts.isIdentifier(n.name)) return n.name.text;
  if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && ts.isVariableDeclaration(n.parent) && ts.isIdentifier(n.parent.name)) {
    return n.parent.name.text;
  }
  return null;
}

/** `data: { …kimlik kolonu… }` nesneleri: [dosya::işlev, yeniden mühürlüyor mu]. */
function kimlikYazarlari(dosyalar: ReadonlyMap<string, string>): Array<{ anahtar: string; muhurlu: boolean }> {
  const out: Array<{ anahtar: string; muhurlu: boolean }> = [];
  for (const [rel, metin] of dosyalar) {
    if (!/passwordHash|quickPin|cardToken|totpSecret|totpEnabledAt|userRecoveryCode/.test(metin)) continue;
    const sf = ts.createSourceFile(rel, metin, ts.ScriptTarget.Latest, true);
    const gez = (n: ts.Node): void => {
      const kimlikVerisi =
        ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === "data" &&
        ts.isObjectLiteralExpression(n.initializer) &&
        n.initializer.properties.some((p) => KIMLIK_KOLONLARI.has(propAdi(p) ?? ""));
      const kodKumesi =
        ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) &&
        KOD_KUMESI_YAZAN.has(n.expression.name.text) &&
        ts.isPropertyAccessExpression(n.expression.expression) && n.expression.expression.name.text === "userRecoveryCode";
      if (kimlikVerisi || kodKumesi) {
        let ad: string | null = null;
        let muhurlu = false;
        for (let a: ts.Node | undefined = n.parent; a; a = a.parent) {
          if (ts.isFunctionLike(a)) {
            ad ??= islevAdi(a);
            if (YENIDEN_MUHUR.test(a.getText(sf))) muhurlu = true;
          }
        }
        out.push({ anahtar: `${rel}::${ad ?? "?"}`, muhurlu });
      }
      ts.forEachChild(n, gez);
    };
    gez(sf);
  }
  return out;
}

function kimlikIhlalleri(dosyalar: ReadonlyMap<string, string>): string[] {
  return [...new Set(kimlikYazarlari(dosyalar).filter((y) => !y.muhurlu && !(y.anahtar in MUAF)).map((y) => y.anahtar))];
}

/** `systemAccountSeal`i bir `data:` nesnesinde YAZAN dosyalar (yardımcı dışında yasak). */
function muhurYazarlari(dosyalar: ReadonlyMap<string, string>): string[] {
  const out = new Set<string>();
  for (const [rel, metin] of dosyalar) {
    if (!metin.includes("systemAccountSeal")) continue;
    const sf = ts.createSourceFile(rel, metin, ts.ScriptTarget.Latest, true);
    const gez = (n: ts.Node): void => {
      if (
        ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === "data" &&
        ts.isObjectLiteralExpression(n.initializer) &&
        n.initializer.properties.some((p) => propAdi(p) === "systemAccountSeal")
      ) {
        out.add(rel);
      }
      ts.forEachChild(n, gez);
    };
    gez(sf);
  }
  return [...out].filter((r) => r !== MUHUR_YARDIMCISI);
}

function statik(): void {
  const DOSYALAR = uretimDosyalari();
  console.log("\n=== §4) Kimlik kolonu yazan her yol AYNI yazımda yeniden mühürler (AST) ===");
  const yazarlar = kimlikYazarlari(DOSYALAR);
  check("§4 körlük zemini: kimlik yazarları bulundu (≥8) ve araç kaynağı tarandı",
    yazarlar.length >= 8 && DOSYALAR.has("scripts/superadmin-olustur.ts"), `${yazarlar.length} yazar`);
  const ih = kimlikIhlalleri(DOSYALAR);
  check("§4 ⭐ yeniden mühürlemeyen beyansız kimlik yazarı YOK", ih.length === 0, ih.join(", "));
  const anahtarlar = new Set(yazarlar.map((y) => y.anahtar));
  const olu = Object.keys(MUAF).filter((k) => !anahtarlar.has(k));
  check("§4 muafiyet listesinde ölü satır yok", olu.length === 0, olu.join(", "));
  const ihlalli = new Map(DOSYALAR);
  const sondaYol = "src/services/sonda-g1.service.ts";
  ihlalli.set(sondaYol, "export async function setX(id: string) { await prisma.user.update({ where: { id }, data: { passwordHash: 'x' } }); }");
  check("§4 sonda ①: yeniden mühürlemeyen yeni yazar → KIRMIZI", kimlikIhlalleri(ihlalli).includes(`${sondaYol}::setX`));
  const duzeltilmis = new Map(DOSYALAR);
  duzeltilmis.set(sondaYol, "export async function setX(id: string) { const r = await credentialReseal(prisma, id, {}); await prisma.user.update({ where: { id, ...r.where }, data: { passwordHash: 'x', ...r.data } }); }");
  check("§4 sonda ②: aynı yazar `credentialReseal` ile → YEŞİL", kimlikIhlalleri(duzeltilmis).length === 0);
  const totpSonda = new Map(DOSYALAR);
  totpSonda.set(sondaYol, "export async function setT(id: string) { await prisma.user.update({ where: { id }, data: { totpSecret: 'X' } }); }\n" +
    "export async function kodEkle(id: string) { await tx.userRecoveryCode.createMany({ data: [{ userId: id, codeHash: 'h' }] }); }\n" +
    "export async function kodHarca(id: string) { await prisma.userRecoveryCode.updateMany({ where: { userId: id }, data: { usedAt: new Date() } }); }");
  const totpIh = kimlikIhlalleri(totpSonda);
  check("§4 sonda ③: yeniden mühürlemeyen TOTP sırrı / kurtarma kodu kümesi yazarı → KIRMIZI; `usedAt` damgası serbest",
    totpIh.includes(`${sondaYol}::setT`) && totpIh.includes(`${sondaYol}::kodEkle`) && !totpIh.includes(`${sondaYol}::kodHarca`), totpIh.join(", "));
  check("§4 ⭐ TOTP yazarları tarandı (kurulum tüketimi + sıfırlama + konsol rotasyonu)",
    ["src/services/totp-account.service.ts::consumeWindow", "src/services/totp-account.service.ts::reset"].every((k) => yazarlar.some((y) => y.anahtar === k && y.muhurlu)),
    yazarlar.filter((y) => y.anahtar.includes("totp")).map((y) => y.anahtar).join(", "));

  console.log("\n=== §5) `systemAccountSeal`in tek yazarı mühür yardımcısı ===");
  const my = muhurYazarlari(DOSYALAR);
  check("§5 ⭐ `systemAccountSeal` yalnız yardımcıda yazılır", my.length === 0, my.join(", "));
  check("§5 körlük zemini: yardımcı mühür yazıyor", muhurYazarlari(new Map([["x.ts", DOSYALAR.get(MUHUR_YARDIMCISI) ?? ""]])).length === 1);
  // Beyanlı muafiyet: G5 okuma rolünün GİZLEME listesi adı yalnız kolon adı olarak taşır (okumaz/yazmaz);
  // muafiyet yalnız o tek satırdadır — dosyanın başka yerinde ad geçerse yine kırmızı.
  const adiMetni = (r: string, t: string) => (r === "src/lib/okuma-rolu.ts" ? t.replace(/^\s*users: \[[^\]\n]*\],$/m, "") : t);
  const srcAdi = [...DOSYALAR].filter(([r, t]) => r.startsWith("src/") && r !== MUHUR_YARDIMCISI && /\bsystemAccountSeal\b/.test(adiMetni(r, t))).map(([r]) => r);
  check("§5 ⭐ `src/` altında `systemAccountSeal` adı yalnız yardımcıda geçer (Zod/route/seçim yok)", srcAdi.length === 0, srcAdi.join(", "));
  const sonda = new Map(DOSYALAR);
  sonda.set("src/routes/sonda.routes.ts", "prisma.user.update({ where: { id }, data: { systemAccountSeal: body.seal } })");
  check("§5 sonda: route'ta mühür yazan → KIRMIZI", muhurYazarlari(sonda).includes("src/routes/sonda.routes.ts"));
}

// ─────────────────────────────────────────────────────────────────────────────
// §1–§3 — DB'li çalışma zamanı
// ─────────────────────────────────────────────────────────────────────────────
async function kullanici(ek: string, sistem: boolean): Promise<string> {
  const u = await prisma.user.create({
    data: {
      username: `${ONEK}${ek}`,
      fullName: `TEST G1 ${ek}`,
      passwordHash: await AuthService.hashPassword(PAROLA),
      isSystemAccount: sistem,
      isActive: true,
    },
    select: { id: true },
  });
  fiksturler.push(u.id);
  return u.id;
}
const satir = (id: string) => prisma.user.findUniqueOrThrow({ where: { id }, select: SEAL_ROW_SELECT });
const yetkili = async (id: string): Promise<boolean> => {
  resetSystemAccountSealCacheForTest();
  resetRequestPermissionCacheForTest();
  return (await AuthService.getEffectivePermissions(id)).includes("*");
};
async function girisKodu(ad: string, parola = PAROLA): Promise<string> {
  try {
    await AuthService.login(`${ONEK}${ad}`, parola, { clientType: "electron" } as never);
    return "200";
  } catch (e) {
    if (e instanceof AppError) return `${e.statusCode}:${String((e.details as { code?: string } | undefined)?.code ?? "")}`;
    throw e;
  }
}

async function calismaZamani(): Promise<void> {
  const lisans = geciciLisansDizini("g1");
  const baska = fs.mkdtempSync(path.join(path.dirname(lisans.dizin), "tekserp-g1-baska-"));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const http = async (method: string, p: string, token: string | null, body?: unknown): Promise<{ status: number; data: Record<string, unknown> }> => {
    const r = await fetch(`${base}${p}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const j = (await r.json().catch(() => ({}))) as { data?: Record<string, unknown> };
    return { status: r.status, data: j.data ?? {} };
  };
  try {
    // Kayıtta hesap varsa supap ölçümü anlamlı (tembel doğrulama).
    __resetSystemAccountRegistryForTests();
    const sa = await kullanici("sa", true);
    const yaz = await writeSeal(prisma, sa);
    check("§1 körlük zemini: fikstür hesabı mühürlendi", yaz.durum === "MUHURLENDI", yaz.durum);
    if (yaz.durum !== "MUHURLENDI") return;
    const mandal = path.join(lisans.dizin, SYSTEM_ACCOUNT_LATCH_FILE);
    // §6 aktörü: `admin:users` taşıyan sıradan yönetici (hedef koruması onun isteğinde ölçülür).
    const yon = await kullanici("yon", false);
    const izin = await prisma.permission.findUnique({ where: { code: "admin:users" }, select: { id: true } });
    if (izin) await prisma.userPermission.create({ data: { userId: yon, permissionId: izin.id } });
    const yonGiris = await http("POST", "/api/auth/login", null, { username: `${ONEK}yon`, password: PAROLA, clientType: "electron" });
    const yonToken = String(yonGiris.data.token ?? "");
    check("§6 körlük zemini: `admin:users` yöneticisi oturum açtı", !!izin && yonGiris.status === 200 && yonToken.length > 0, String(yonGiris.status));
    const pasifeAl = (hedef: string) => http("POST", `/api/admin/users/${hedef}/deactivate`, yonToken);
    // Panel girişi web izni ister; `admin:*` dışı bir izin bant kitlesine sokmaz.
    const duz = await kullanici("duz", false);
    const webIzin = await prisma.permission.findFirst({
      where: { category: "web", NOT: { code: { startsWith: "admin:" } } },
      select: { id: true },
    });
    if (webIzin) await prisma.userPermission.create({ data: { userId: duz, permissionId: webIzin.id } });
    const duzGiris = await http("POST", "/api/auth/login", null, { username: `${ONEK}duz`, password: PAROLA, clientType: "electron" });
    const duzToken = String(duzGiris.data.token ?? "");
    const bant = async (token: string): Promise<unknown> => (await http("GET", "/api/auth/me", token)).data.systemAccountSealStatus;

    console.log("\n=== §2) MANDALSIZ (geçiş) — mühürsüz hesap bugünkü gibi `[\"*\"]` + bant ===");
    const eski = await kullanici("eski", true);
    check("§2 ⭐ mandalsız: mühürsüz sistem hesabı `[\"*\"]` alır (bugünkü davranış)", await yetkili(eski));
    check("§2 mandalsız: mühürsüz sistem hesabı GİRER", (await girisKodu("eski")) === "200");
    const ozet2 = await sealSummary();
    check("§2 özet MUHURLENMELI (bant `pending`)", ozet2.mandal === "YOK" && ozet2.durum === "MUHURLENMELI", JSON.stringify(ozet2));
    check("§7 ⭐ /auth/me (yönetici): mandalsız + mühürsüz hesap → bant `pending`", (await bant(yonToken)) === "pending", String(await bant(yonToken)));
    const eskiKorunur = await pasifeAl(eski);
    check("§6 mandalsız: mühürsüz (yetkili) sistem hesabı başkasınca pasife ALINAMAZ — bugünkü davranış", eskiKorunur.status === 403, String(eskiKorunur.status));
    await prisma.user.update({ where: { id: eski }, data: { isSystemAccount: false } });

    console.log("\n=== §1) MANDALLI — yalnız geçerli mühür yetki verir ===");
    writeLatch(yaz.kid);
    resetSystemAccountSealCacheForTest();
    check("§1 mandal yazıldı", fs.existsSync(mandal));
    check("§1 ⭐ mühürlü sistem hesabı `[\"*\"]`", await yetkili(sa));
    check("§1 mühürlü sistem hesabı girer", (await girisKodu("sa")) === "200");
    const giris = await http("POST", "/api/auth/login", null, { username: `${ONEK}sa`, password: PAROLA, clientType: "electron" });
    const token = String(giris.data.token ?? "");
    const me1 = await http("GET", "/api/auth/me", token);
    check("§1 HTTP: mühürlü hesap `/auth/me` isSystemAccount:true (istek kapısı yüklemi)", me1.status === 200 && me1.data.isSystemAccount === true,
      `${giris.status}/${me1.status} ${JSON.stringify(me1.data.isSystemAccount)}`);

    const sahte = await kullanici("sahte", false);
    await prisma.$executeRaw`UPDATE users SET "isSystemAccount" = true WHERE id = ${sahte}::uuid`;
    check("§1 ⭐ NEGATİF: SQL ile `isSystemAccount=true` yapılan kullanıcı `[\"*\"]` ALMAZ", !(await yetkili(sahte)));
    check("§1 NEGATİF: yüklem false (`req.isSystemAccount` bunu okur)", !isSystemAccountAuthorized(await satir(sahte)));
    check("§1 ⭐ NEGATİF: sahte hesabın girişi 403 SYSTEM_ACCOUNT_SEAL_INVALID",
      (await girisKodu("sahte")) === `403:${SYSTEM_ACCOUNT_SEAL_INVALID_CODE}`, await girisKodu("sahte"));
    const ozet1 = await sealSummary();
    check("§1 özet GECERSIZ_HESAP (bant `invalid`)", ozet1.durum === "GECERSIZ_HESAP" && ozet1.gecersizSayisi >= 1, JSON.stringify(ozet1));
    __resetSystemAccountRegistryForTests();
    check("§1 supap: mühürsüz satır da 'hesap VAR' sayılır (supap açılmaz)", await resolveSystemAccountLock());

    console.log("\n=== §7) Görünürlük: /api/admin/health + /auth/me bandı (sır yok) ===");
    check("§7 ⭐ /auth/me (yönetici): mandallı + sahte hesap → bant `invalid`", (await bant(yonToken)) === "invalid", String(await bant(yonToken)));
    check("§7 /auth/me (yetkisiz kullanıcı): bant bilgisi gitmez → `ok`", duzGiris.status === 200 && (await bant(duzToken)) === "ok", `${duzGiris.status} ${String(await bant(duzToken))}`);
    const saglik = await buildRichHealth();
    const hm = saglik.sistemHesabiMuhru as Record<string, unknown> | null;
    check("§7 ⭐ health `sistemHesabiMuhru`: mandal VAR · GECERSIZ_HESAP · mühürsüz ≥1 · mühürlü ≥1",
      hm?.mandal === "VAR" && hm?.durum === "GECERSIZ_HESAP" && Number(hm?.muhursuzSayisi) >= 1 && Number(hm?.muhurluSayisi) >= 1 &&
        Number(hm?.gecersizSayisi) === Number(hm?.muhursuzSayisi) + Number(hm?.bozukSayisi), JSON.stringify(hm));
    const saMuhur = (await satir(sa)).systemAccountSeal ?? "";
    const govde = JSON.stringify(saglik);
    check("§7 ⭐ health SIR taşımaz (mühür · kimlik özeti · kullanıcı adı yok)",
      saMuhur.length > 20 && !govde.includes(saMuhur) && !govde.includes(credentialDigest(await satir(sa))) && !govde.includes(`${ONEK}sa`));

    console.log("\n=== §6) Hedef koruması yetkiyle AYNI yüklemi okur: sahte sistem hesabı korunmaz ===");
    const saKorunur = await pasifeAl(sa);
    check("§6 körlük zemini: mühürlü sistem hesabı başkasınca pasife ALINAMAZ (403)", saKorunur.status === 403, String(saKorunur.status));
    check("§6 ⭐ PIN/kart okuma kapısının yüklemi (`isSystemAccountUser`): sahte false, mühürlü true",
      !(await AuthService.isSystemAccountUser(sahte)) && (await AuthService.isSystemAccountUser(sa)));
    const sahtePasif = await pasifeAl(sahte);
    const sahteSonra = await prisma.user.findUniqueOrThrow({ where: { id: sahte }, select: { isActive: true, isSystemAccount: true } });
    check("§6 ⭐ sahte (mühürsüz) sistem hesabını yetkili yönetici pasife ALIR — durum geçişi, satır durur",
      sahtePasif.status === 200 && !sahteSonra.isActive && sahteSonra.isSystemAccount, `${sahtePasif.status} aktif=${sahteSonra.isActive}`);
    let iz = 0;
    for (let i = 0; i < 20 && iz === 0; i++) {
      iz = await prisma.systemLog.count({ where: { recordId: sahte, userId: yon, action: "UPDATE" } });
      if (iz === 0) await new Promise((r) => setTimeout(r, 100));
    }
    check("§6 pasife alma audit'e yazıldı (aktör yönetici)", iz >= 1, `${iz} satır`);
    const ozet6 = await sealSummary();
    check("§6 pasif sahte hesap bant özetinden düşer", ozet6.gecersizSayisi === ozet1.gecersizSayisi - 1, `${ozet1.gecersizSayisi} → ${ozet6.gecersizSayisi}`);
    check("§7 pasife almadan sonra /auth/me bandı özetle aynı", (await bant(yonToken)) === sealBandStatus(ozet6), `${String(await bant(yonToken))} / ${ozet6.durum}`);
    await prisma.user.update({ where: { id: sahte }, data: { isSystemAccount: false } });

    const eskiHash = (await satir(sa)).passwordHash;
    await prisma.user.update({ where: { id: sa }, data: { passwordHash: await AuthService.hashPassword("baska-parola-123") } });
    check("§1 ⭐ NEGATİF: mühürlü hesabın parola özeti SQL ile değişti → `[\"*\"]` YOK", !(await yetkili(sa)));
    check("§1 NEGATİF: SQL parolasıyla giriş 403", (await girisKodu("sa", "baska-parola-123")) === `403:${SYSTEM_ACCOUNT_SEAL_INVALID_CODE}`);
    await prisma.user.update({ where: { id: sa }, data: { passwordHash: eskiHash } });
    check("§1 özet geri konunca mühür yine geçerli (aynı kimlik)", await yetkili(sa));

    const iyi = (await satir(sa)).systemAccountSeal!;
    // Metin değil BAYT bozulur: çözülmüş imzanın bir baytı XOR'lanıp yeniden kodlanır — biçim her
    // koşumda geçerli kalır (BICIMSIZ değil), imza her koşumda geçersizdir (BOZUK).
    const parca = parseSeal(iyi)!;
    const bozukImza = Buffer.from(parca.signature);
    bozukImza[10] ^= 0x01;
    const bozuk = formatSeal(parca.kid, bozukImza);
    check("§1 bozma sondası biçimi korur (BICIMSIZ'e kaymaz)", parseSeal(bozuk) !== null && bozuk !== iyi);
    await prisma.user.update({ where: { id: sa }, data: { systemAccountSeal: bozuk } });
    resetSystemAccountSealCacheForTest();
    check("§1 ⭐ NEGATİF: mühür baytı bozuk → BOZUK, yetki YOK", sealStatus(await satir(sa)) === "BOZUK" && !(await yetkili(sa)), sealStatus(await satir(sa)));
    resetSystemAccountSealCacheForTest();
    resetRequestPermissionCacheForTest();
    const me2 = await http("GET", "/api/auth/me", token);
    check("§1 ⭐ NEGATİF HTTP: açık oturumda mühür bozulunca `/auth/me` isSystemAccount:false (istek başına taze)",
      me2.status === 200 && me2.data.isSystemAccount === false && !(me2.data.permissions as string[] | undefined)?.includes("*"),
      `${me2.status} ${JSON.stringify(me2.data.isSystemAccount)}`);

    loadLicenseStoreSync({ dir: baska });
    const r = await satir(sa);
    const yabanci = getLicenseCore().sealSystemAccount(baska, { id: r.id, ad: r.username, kimlik: credentialDigest(r) });
    loadLicenseStoreSync({ dir: lisans.dizin });
    if (yabanci.durum === "MUHURLENDI") {
      await prisma.user.update({ where: { id: sa }, data: { systemAccountSeal: yabanci.muhur } });
      resetSystemAccountSealCacheForTest();
      check("§1 ⭐ NEGATİF: başka kurulumun mührü (döküm taşındı) → BASKA_KURULUM, yetki YOK",
        sealStatus(await satir(sa)) === "BASKA_KURULUM" && !(await yetkili(sa)), sealStatus(await satir(sa)));
    } else check("§1 başka kurulum mührü üretilemedi", false, yabanci.durum);
    await prisma.user.update({ where: { id: sa }, data: { systemAccountSeal: iyi } });

    console.log("\n=== §3) Meşru kimlik değişimi mührü AYNI yazımda yeniler; bozuğu aklamaz ===");
    await AuthService.changeOwnPassword(sa, PAROLA, `${PAROLA}-2`);
    check("§3 ⭐ kendi parola değişimi sonrası mühür GECERLI", await yetkili(sa));
    await AuthService.changeOwnPassword(sa, `${PAROLA}-2`, PAROLA);
    let pinOlcuruldu = false;
    try {
      await AuthService.setQuickPin(sa, {});
      pinOlcuruldu = true;
      check("§3 PIN ataması sonrası mühür GECERLI", await yetkili(sa));
      await AuthService.setQuickPin(sa, { clear: true });
      check("§3 PIN temizliği sonrası mühür GECERLI", await yetkili(sa));
      await AuthService.rotateCardToken(sa);
      check("§3 kart yenileme sonrası mühür GECERLI", await yetkili(sa));
    } catch (e) {
      console.log(`   ⏭  ATLANDI: kısa kimlik anahtarı yok (${e instanceof Error ? e.message : e}) — PIN/kart kolları ölçülmedi`);
    }
    if (!pinOlcuruldu) check("§3 PIN/kart kolu ölçülemedi (kısa kimlik halkası yok)", true);
    await prisma.user.update({ where: { id: sa }, data: { systemAccountSeal: bozuk } });
    await AuthService.changeOwnPassword(sa, PAROLA, `${PAROLA}-3`);
    resetSystemAccountSealCacheForTest();
    check("§3 ⭐ NEGATİF: bozuk mühürlü hesapta parola değişimi mührü AKLAMAZ", sealStatus(await satir(sa)) !== "GECERLI" && !(await yetkili(sa)),
      sealStatus(await satir(sa)));

    await gecisV2(lisans.dizin);
    await totpMuhru(sa);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    lisans.temizle();
    fs.rmSync(baska, { recursive: true, force: true });
  }
}

const girisKapisi = async (id: string): Promise<string> => {
  resetSystemAccountSealCacheForTest();
  try {
    await assertSealAllowsLogin(id);
    return "200";
  } catch (e) {
    if (e instanceof AppError) return `${e.statusCode}:${String((e.details as { code?: string } | undefined)?.code ?? "")}`;
    throw e;
  }
};
const durum = async (id: string): Promise<string> => {
  resetSystemAccountSealCacheForTest();
  return sealStatus(await satir(id));
};

/** §9 — v1 (TOTP'suz) mühür işaret yokken kabul; açılış işi v2'ye yeniler + işaret; sonra v1 asla. */
async function gecisV2(dizin: string): Promise<void> {
  console.log("\n=== §9) Mühür v1 → v2 geçişi (bir kez, işaretle) ===");
  const isaret = path.join(dizin, SYSTEM_SEAL_V2_MARKER_FILE);
  const g = await kullanici("gecis", true);
  const r = await satir(g);
  const v1 = getLicenseCore().sealSystemAccount(dizin, { id: r.id, ad: r.username, kimlik: credentialDigestV1(r) });
  if (v1.durum !== "MUHURLENDI") { check("§9 körlük zemini: v1 mühür üretildi", false, v1.durum); return; }
  await prisma.user.update({ where: { id: g }, data: { systemAccountSeal: v1.muhur } });
  check("§9 körlük zemini: işaret YOK, v1 özet ≠ v2 özet", !fs.existsSync(isaret) && credentialDigestV1(r) !== credentialDigest(r));
  check("§9 ⭐ işaret yokken v1 mühür GEÇERLİ (güncellemeyle hiçbir hesap kilitlenmez) + giriş kapısı 200",
    (await durum(g)) === "GECERLI" && (await girisKodu("gecis")) === "200", await durum(g));
  const sonuc = await migrateSealsToV2();
  const yeni = (await satir(g)).systemAccountSeal;
  check("§9 ⭐ açılış işi: v1 mühür v2'ye yenilendi + işaret yazıldı",
    sonuc.durum === "TAMAM" && sonuc.yenilenen >= 1 && yeni !== v1.muhur && fs.existsSync(isaret) && (await durum(g)) === "GECERLI",
    JSON.stringify(sonuc));
  check("§9 ikinci çağrı iş yapmaz (ISARET_VAR)", (await migrateSealsToV2()).durum === "ISARET_VAR");
  await prisma.user.update({ where: { id: g }, data: { systemAccountSeal: v1.muhur } });
  check("§9 ⭐ NEGATİF: işaret varken DB'ye geri konan v1 mühür BOZUK, giriş 403",
    (await durum(g)) === "BOZUK" && (await girisKapisi(g)) === `403:${SYSTEM_ACCOUNT_SEAL_INVALID_CODE}`, await durum(g));
  await prisma.user.update({ where: { id: g }, data: { isSystemAccount: false, systemAccountSeal: null } });
}

/** §8 — TOTP mühre girer (denetim B4): meşru yollar yeniden mühürler, DB kurcalaması bozar. */
async function totpMuhru(acan: string): Promise<void> {
  console.log("\n=== §8) TOTP mühre girer (B4) ===");
  const t = await kullanici("totp", true);
  const yaz = await writeSeal(prisma, t);
  check("§8 körlük zemini: mühürlü, işaret VAR (v1 kabulü kapalı)", yaz.durum === "MUHURLENDI" && (await durum(t)) === "GECERLI");
  const kur = async (): Promise<{ secret: string; kodlar: string[] }> => {
    const w = await TotpAccountService.openWindow({ userId: t, openedById: acan });
    const { recoveryCodes } = await TotpAccountService.consumeWindow(w.token, totpCodeForStep(w.secret, totpStep()));
    return { secret: w.secret, kodlar: recoveryCodes };
  };
  const ilk = await kur();
  check("§8 ⭐ meşru TOTP kurulumu (sır + kod seti) aynı tx'te yeniden mühürler", (await durum(t)) === "GECERLI" && (await yetkili(t)), await durum(t));

  const kurcala = async (ad: string, boz: () => Promise<unknown>, onar: () => Promise<unknown>): Promise<void> => {
    await boz();
    const st = await durum(t);
    const giris = await girisKapisi(t);
    const yet = await yetkili(t);
    await onar();
    check(`§8 ⭐ NEGATİF: DB'den ${ad} → mühür BOZUK, yetki yok, giriş 403`,
      st === "BOZUK" && !yet && giris === `403:${SYSTEM_ACCOUNT_SEAL_INVALID_CODE}`, `${st} ${giris}`);
  };
  const once = await prisma.user.findUniqueOrThrow({ where: { id: t }, select: { totpSecret: true, totpEnabledAt: true } });
  await kurcala("totpEnabledAt=null (2FA sessizce kapatma)",
    () => prisma.user.update({ where: { id: t }, data: { totpEnabledAt: null } }),
    () => prisma.user.update({ where: { id: t }, data: { totpEnabledAt: once.totpEnabledAt } }));
  await kurcala("TOTP sırrı değişimi",
    () => prisma.user.update({ where: { id: t }, data: { totpSecret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP" } }),
    () => prisma.user.update({ where: { id: t }, data: { totpSecret: once.totpSecret } }));
  const kanit = await prisma.totpEnrollment.findFirstOrThrow({ where: { userId: t, consumedAt: { not: null } }, select: { id: true, consumedAt: true } });
  await kurcala("kurulum kanıtının düşürülmesi (tüketilmiş pencere)",
    () => prisma.totpEnrollment.update({ where: { id: kanit.id }, data: { consumedAt: null } }),
    () => prisma.totpEnrollment.update({ where: { id: kanit.id }, data: { consumedAt: kanit.consumedAt } }));
  // Kod satırı silinmez (append-only defter); özeti değiştirilip geri konur.
  const kod = await prisma.userRecoveryCode.findFirstOrThrow({ where: { userId: t }, select: { id: true, codeHash: true } });
  await kurcala("kurtarma kodunun saldırganın koduyla değiştirilmesi",
    () => prisma.userRecoveryCode.update({ where: { id: kod.id }, data: { codeHash: "$2a$10$sahtesahtesahtesahtesahtesahtesahtesahtesahtesahtesa" } }),
    () => prisma.userRecoveryCode.update({ where: { id: kod.id }, data: { codeHash: kod.codeHash } }));
  check("§8 onarım sonrası mühür yine GEÇERLİ (ölçüm kendi kurcalamasını geri aldı)", (await durum(t)) === "GECERLI");

  const harcandi = await TotpAccountService.verifySecondFactor(t, ilk.kodlar[0]!);
  check("§8 kurtarma kodu harcamak (`usedAt`) mührü BOZMAZ", harcandi && (await durum(t)) === "GECERLI", `${harcandi} ${await durum(t)}`);

  // Saklama biçimi değişse de (halkanın `enc1:` sarmalı üstüne ikinci bir katman) özet AÇIK sırdan doğar.
  const ozetDuz = credentialDigest(await satir(t));
  const halka = getShortCredentialKeyRing();
  if (!halka.ok) throw new Error("anahtar halkası yok");
  const sar = (v: string): string => `enc:${Buffer.from(v, "utf8").toString("base64")}`;
  const ac = (v: string): string | null => {
    const ic = v.startsWith("enc:") ? Buffer.from(v.slice(4), "base64").toString("utf8") : v;
    return isSealedTotpSecret(ic) ? openTotpSecret(halka.ring, ic) : ic;
  };
  const kanitSir = await prisma.totpEnrollment.findUniqueOrThrow({ where: { id: kanit.id }, select: { secret: true } });
  await prisma.user.update({ where: { id: t }, data: { totpSecret: sar(once.totpSecret!) } });
  await prisma.totpEnrollment.update({ where: { id: kanit.id }, data: { secret: sar(kanitSir.secret) } });
  const ozetHam = credentialDigest(await satir(t));
  setTotpSecretOpenerForTest(ac);
  let ozetSarili = "";
  let sariliDurum = "";
  try {
    ozetSarili = credentialDigest(await satir(t));
    sariliDurum = await durum(t);
  } finally {
    setTotpSecretOpenerForTest(null);
    await prisma.user.update({ where: { id: t }, data: { totpSecret: once.totpSecret } });
    await prisma.totpEnrollment.update({ where: { id: kanit.id }, data: { secret: kanitSir.secret } });
  }
  check("§8 ⭐ sır sarılı saklansa da (tek okuyucu açar) özet AYNI, mühür GEÇERLİ", ozetSarili === ozetDuz && sariliDurum === "GECERLI", sariliDurum);
  check("§8 sonda: açıcı olmadan sarılı değer farklı özet verir (ölçüm saklanan değere kör değil)", ozetHam !== ozetDuz);

  await kur();
  check("§8 ⭐ TOTP yeniden kurulumu (eski kodlar silinir, yeni set) mührü yeniler", (await durum(t)) === "GECERLI", await durum(t));
  await TotpAccountService.reset({ userId: t, byId: acan });
  const sonra = await prisma.user.findUniqueOrThrow({ where: { id: t }, select: { totpSecret: true } });
  check("§8 ⭐ yönetici sıfırlaması mührü yeniler", sonra.totpSecret === null && (await durum(t)) === "GECERLI", await durum(t));
  await prisma.user.update({ where: { id: t }, data: { systemAccountSeal: (await satir(acan)).systemAccountSeal } });
  await TotpAccountService.reset({ userId: t, byId: acan });
  check("§8 NEGATİF: bozuk mühürlü hesapta TOTP sıfırlaması mührü AKLAMAZ", (await durum(t)) !== "GECERLI", await durum(t));
  await prisma.user.update({ where: { id: t }, data: { isSystemAccount: false, systemAccountSeal: null } });
}

async function main(): Promise<void> {
  statik();
  const engel = hedefDbEngeli();
  console.log(`\nHedef DB: ${hedefDbAdi()}`);
  if (engel) {
    console.log(`⛔ ${engel}`);
    fail++;
    return;
  }
  await calismaZamani();
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    fail++;
  })
  .finally(async () => {
    try {
      if (fiksturler.length) {
        await prisma.session.deleteMany({ where: { userId: { in: fiksturler } } });
        await prisma.workSession.deleteMany({ where: { userId: { in: fiksturler } } });
        await prisma.totpEnrollment.deleteMany({ where: { OR: [{ userId: { in: fiksturler } }, { openedById: { in: fiksturler } }] } });
        await prisma.systemLog.deleteMany({ where: { OR: [{ userId: { in: fiksturler } }, { recordId: { in: fiksturler } }] } });
        await prisma.user.updateMany({ where: { id: { in: fiksturler } }, data: { isSystemAccount: false, systemAccountSeal: null } });
        await prisma.user.deleteMany({ where: { id: { in: fiksturler } } });
      }
    } catch (e) {
      console.error("⚠️ temizlik başarısız:", e instanceof Error ? e.message : e);
      fail++;
    }
    __resetSystemAccountRegistryForTests();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
