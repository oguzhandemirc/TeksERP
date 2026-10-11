// =============================================================================
// BEKÇİ — SİSTEM HESABI MÜHRÜ (G1): `isSystemAccount` tek başına yetki VERMEZ
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts sistem_hesabi_muhru
//
// Ölçülen: mandallı kurulumda yalnız geçerli mühürlü sistem hesabı `["*"]` alır ve girer (DB'ye
// yazan biri bayrağı kendine koyamaz, süperadminin parola özetini değiştiremez, başka kurulumun
// mührünü taşıyamaz); mandalsız kurulum bugünkü gibi çalışır; meşru kimlik değişimi mührü AYNI
// yazımda yeniler ama bozuk mührü aklamaz; kimlik kolonu yazan her yol yeniden mühürler (AST);
// `systemAccountSeal`in tek yazarı mühür yardımcısıdır. Geçici LICENSE_DIR kullanır, DB fikstürlerini
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
import {
  credentialDigest,
  isSystemAccountAuthorized,
  resetSystemAccountSealCacheForTest,
  SEAL_ROW_SELECT,
  sealStatus,
  sealSummary,
  SYSTEM_ACCOUNT_LATCH_FILE,
  SYSTEM_ACCOUNT_SEAL_INVALID_CODE,
  writeLatch,
  writeSeal,
} from "../src/services/helpers/system-account-seal.helper";
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
const KIMLIK_KOLONLARI = new Set(["passwordHash", "quickPinDigest", "quickPin", "cardTokenDigest", "cardToken"]);
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
    if (!/passwordHash|quickPin|cardToken/.test(metin)) continue;
    const sf = ts.createSourceFile(rel, metin, ts.ScriptTarget.Latest, true);
    const gez = (n: ts.Node): void => {
      if (
        ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === "data" &&
        ts.isObjectLiteralExpression(n.initializer) &&
        n.initializer.properties.some((p) => KIMLIK_KOLONLARI.has(propAdi(p) ?? ""))
      ) {
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

  console.log("\n=== §5) `systemAccountSeal`in tek yazarı mühür yardımcısı ===");
  const my = muhurYazarlari(DOSYALAR);
  check("§5 ⭐ `systemAccountSeal` yalnız yardımcıda yazılır", my.length === 0, my.join(", "));
  check("§5 körlük zemini: yardımcı mühür yazıyor", muhurYazarlari(new Map([["x.ts", DOSYALAR.get(MUHUR_YARDIMCISI) ?? ""]])).length === 1);
  const srcAdi = [...DOSYALAR].filter(([r, t]) => r.startsWith("src/") && r !== MUHUR_YARDIMCISI && /\bsystemAccountSeal\b/.test(t)).map(([r]) => r);
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

    console.log("\n=== §2) MANDALSIZ (geçiş) — mühürsüz hesap bugünkü gibi `[\"*\"]` + bant ===");
    const eski = await kullanici("eski", true);
    check("§2 ⭐ mandalsız: mühürsüz sistem hesabı `[\"*\"]` alır (bugünkü davranış)", await yetkili(eski));
    check("§2 mandalsız: mühürsüz sistem hesabı GİRER", (await girisKodu("eski")) === "200");
    const ozet2 = await sealSummary();
    check("§2 özet MUHURLENMELI (bant `pending`)", ozet2.mandal === "YOK" && ozet2.durum === "MUHURLENMELI", JSON.stringify(ozet2));
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
    await prisma.user.update({ where: { id: sahte }, data: { isSystemAccount: false } });

    const eskiHash = (await satir(sa)).passwordHash;
    await prisma.user.update({ where: { id: sa }, data: { passwordHash: await AuthService.hashPassword("baska-parola-123") } });
    check("§1 ⭐ NEGATİF: mühürlü hesabın parola özeti SQL ile değişti → `[\"*\"]` YOK", !(await yetkili(sa)));
    check("§1 NEGATİF: SQL parolasıyla giriş 403", (await girisKodu("sa", "baska-parola-123")) === `403:${SYSTEM_ACCOUNT_SEAL_INVALID_CODE}`);
    await prisma.user.update({ where: { id: sa }, data: { passwordHash: eskiHash } });
    check("§1 özet geri konunca mühür yine geçerli (aynı kimlik)", await yetkili(sa));

    const iyi = (await satir(sa)).systemAccountSeal!;
    const son = iyi.slice(-2) === "AA" ? "AB" : "AA";
    await prisma.user.update({ where: { id: sa }, data: { systemAccountSeal: `${iyi.slice(0, -2)}${son}` } });
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
    await prisma.user.update({ where: { id: sa }, data: { systemAccountSeal: `${iyi.slice(0, -2)}${son}` } });
    await AuthService.changeOwnPassword(sa, PAROLA, `${PAROLA}-3`);
    resetSystemAccountSealCacheForTest();
    check("§3 ⭐ NEGATİF: bozuk mühürlü hesapta parola değişimi mührü AKLAMAZ", sealStatus(await satir(sa)) !== "GECERLI" && !(await yetkili(sa)),
      sealStatus(await satir(sa)));
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    lisans.temizle();
    fs.rmSync(baska, { recursive: true, force: true });
  }
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
    process.exit(fail > 0 ? 1 : 0);
  });
