// =============================================================================
// BEKÇİ — SİSTEM HESABI MÜHRÜ UÇTAN UCA (G1): gerçek sunucu + aynı DB + aynı LICENSE_DIR
// =============================================================================
// Çalıştırma (sunucuyu koşucu açar; yalnız `_test` DB):
//   LICENSE_DIR=<geçici dizin> DATABASE_URL='postgresql://…/<ad>_test?schema=public' \
//     node ../scripts/agir-is.mjs -- npx tsx scripts/bekci-http.ts sistem_hesabi_muhru_uctan_uca
// Sunucu yoksa beyanla ATLAR (günlük paket). Senaryolar: (a) varsayılan süperadmin mühürlü doğar ve
// girer · (b) SQL ile işaretlenen ikinci kullanıcı yetki/giriş almaz, panelden pasife alınır · (c) mühür
// bozulunca giriş 403 + bant `invalid` · (d) mandalsız eski kurulum kilitlenmez (`pending`), `--muhurle`
// yolu mühürler ve mandalı yazar. Var olan sistem hesaplarını geçici park eder (mühür saklanıp geri
// konur), mandal dosyasını başlangıç hâline döndürür, fikstürleri siler.
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import prisma, { pool } from "../src/lib/prisma";
import { ensureVarsayilanSuperadmin } from "../src/services/helpers/varsayilan-superadmin.helper";
import {
  readLatch,
  resetSystemAccountSealCacheForTest,
  SEAL_ROW_SELECT,
  sealDir,
  sealStatus,
  SYSTEM_ACCOUNT_LATCH_FILE,
  SYSTEM_ACCOUNT_SEAL_INVALID_CODE,
} from "../src/services/helpers/system-account-seal.helper";
import { sealExistingSystemAccount } from "./superadmin-olustur";
import { httpBekciKapisi } from "./lib/http-bekci-kapisi";
import { atlamaDefteri } from "./lib/atlama";
import { hedefDbAdi, hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
const ATLAMA = atlamaDefteri(() => {
  fail++;
});
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

const BASE = process.env.TEST_API_URL ?? `http://127.0.0.1:${process.env.PORT ?? "4000"}`;
const HTTP_KONTROL = 22;
const ONEK = `bekci.e2e.${process.pid}.`;
const SA_AD = `${ONEK}sa`;
const SA_PAROLA = `Bekci-E2E-varsayilan-${process.pid}-uzun-parola`;
const DIGER_PAROLA = `Bekci-E2E-diger-${process.pid}-parola`;
/** Sunucunun mandal önbelleği 5 sn; mandal dosyası değişince bundan uzun beklenir. */
const MANDAL_BEKLE_MS = 5_500;

const fiksturler: string[] = [];
const PARK_SECIMI = { id: true, systemAccountSeal: true, defaultPasswordIssuedAt: true, defaultPasswordChangedAt: true } as const;
/** Sistem hesabından düşürme: CHECK'ler mühür ve varsayılan parola damgalarını yalnız sistem hesabında kabul eder. */
const DUSUR = { isSystemAccount: false, systemAccountSeal: null, defaultPasswordIssuedAt: null, defaultPasswordChangedAt: null } as const;
let parkta: Array<{ id: string; systemAccountSeal: string | null; defaultPasswordIssuedAt: Date | null; defaultPasswordChangedAt: Date | null }> = [];
let mandalIlk: string | null = null;
let mandalYolu: string | null = null;

type Yanit = { status: number; data: Record<string, unknown>; code: string | null };
async function http(method: string, p: string, token: string | null, body?: unknown): Promise<Yanit> {
  const r = await fetch(`${BASE}${p}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const j = (await r.json().catch(() => ({}))) as { data?: Record<string, unknown>; details?: { code?: string } };
  return { status: r.status, data: j.data ?? {}, code: j.details?.code ?? null };
}
const giris = (ad: string, parola: string) => http("POST", "/api/auth/login", null, { username: ad, password: parola, clientType: "electron" });
const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms));
const satir = (id: string) => prisma.user.findUniqueOrThrow({ where: { id }, select: SEAL_ROW_SELECT });

async function senaryolar(adminToken: string): Promise<void> {
  const bant = async (): Promise<unknown> => (await http("GET", "/api/auth/me", adminToken)).data.systemAccountSealStatus;
  // `/api/admin/health` düz gövde döner (`data` zarfı yok).
  const saglik = async (): Promise<Record<string, unknown> | null> => {
    const r = await fetch(`${BASE}/api/admin/health`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const j = (await r.json().catch(() => ({}))) as { sistemHesabiMuhru?: Record<string, unknown> | null };
    return j.sistemHesabiMuhru ?? null;
  };

  console.log("\n=== (a) Varsayılan süperadmin mühürlü doğar ve girer ===");
  const dogus = await ensureVarsayilanSuperadmin({ kullaniciAdi: SA_AD, ozet: await bcrypt.hash(SA_PAROLA, 12) });
  const sa = await prisma.user.findFirst({ where: { username: SA_AD }, select: { id: true } });
  if (sa) fiksturler.push(sa.id);
  check("(a) doğuş: tek sistem hesabı doğdu", dogus.action === "dogdu" && !!sa, dogus.action);
  if (!sa) return;
  resetSystemAccountSealCacheForTest();
  check("(a) ⭐ doğuşta mühür GEÇERLİ + mandal yazıldı", sealStatus(await satir(sa.id)) === "GECERLI" && readLatch() === "VAR",
    `${sealStatus(await satir(sa.id))} / ${readLatch()}`);
  await bekle(MANDAL_BEKLE_MS);
  const g1 = await giris(SA_AD, SA_PAROLA);
  const saToken = String(g1.data.token ?? "");
  const me1 = await http("GET", "/api/auth/me", saToken);
  check("(a) ⭐ sunucu: varsayılan hesap girer, `isSystemAccount` + `[\"*\"]`",
    g1.status === 200 && me1.data.isSystemAccount === true && (me1.data.permissions as string[] | undefined)?.includes("*") === true,
    `${g1.status} ${String(me1.data.isSystemAccount)}`);
  check("(a) bant `ok` (mandal VAR, hesap mühürlü)", (await bant()) === "ok", String(await bant()));

  console.log("\n=== (b) SQL ile işaretlenen ikinci kullanıcı ===");
  const diger = await prisma.user.create({
    data: { username: `${ONEK}diger`, fullName: "TEST E2E diger", passwordHash: await bcrypt.hash(DIGER_PAROLA, 4), isActive: true },
    select: { id: true },
  });
  fiksturler.push(diger.id);
  await prisma.$executeRaw`UPDATE users SET "isSystemAccount" = true WHERE id = ${diger.id}::uuid`;
  const g2 = await giris(`${ONEK}diger`, DIGER_PAROLA);
  check("(b) ⭐ sahte hesabın girişi 403 SYSTEM_ACCOUNT_SEAL_INVALID", g2.status === 403 && g2.code === SYSTEM_ACCOUNT_SEAL_INVALID_CODE, `${g2.status} ${String(g2.code)}`);
  check("(b) bant `invalid` (yönetici görür)", (await bant()) === "invalid", String(await bant()));
  const h2 = await saglik();
  check("(b) health: GECERSIZ_HESAP · mühürsüz 1 · mühürlü 1", h2?.durum === "GECERSIZ_HESAP" && h2?.muhursuzSayisi === 1 && h2?.muhurluSayisi === 1, JSON.stringify(h2));
  const korunan = await http("POST", `/api/admin/users/${sa.id}/deactivate`, adminToken);
  check("(b) gerçek (mühürlü) hesap panelden pasife ALINAMAZ", korunan.status === 403, String(korunan.status));
  const pasif = await http("POST", `/api/admin/users/${diger.id}/deactivate`, adminToken);
  const digerSonra = await prisma.user.findUniqueOrThrow({ where: { id: diger.id }, select: { isActive: true, isSystemAccount: true } });
  check("(b) ⭐ sahte hesap panelden pasife alınır (satır durur)", pasif.status === 200 && !digerSonra.isActive && digerSonra.isSystemAccount,
    `${pasif.status} aktif=${digerSonra.isActive}`);
  check("(b) pasife alınca bant `ok`", (await bant()) === "ok", String(await bant()));

  console.log("\n=== (c) Mühür bozulur ===");
  const iyi = (await satir(sa.id)).systemAccountSeal ?? "";
  const k = iyi.length - 10;
  await prisma.$executeRaw`UPDATE users SET "systemAccountSeal" = ${`${iyi.slice(0, k)}${iyi[k] === "A" ? "B" : "A"}${iyi.slice(k + 1)}`} WHERE id = ${sa.id}::uuid`;
  const g3 = await giris(SA_AD, SA_PAROLA);
  check("(c) ⭐ bozuk mühürle giriş 403 SYSTEM_ACCOUNT_SEAL_INVALID", g3.status === 403 && g3.code === SYSTEM_ACCOUNT_SEAL_INVALID_CODE, `${g3.status} ${String(g3.code)}`);
  const me3 = await http("GET", "/api/auth/me", saToken);
  check("(c) açık oturum yetkisini anında yitirir (`isSystemAccount` false)", me3.data.isSystemAccount !== true, `${me3.status} ${String(me3.data.isSystemAccount)}`);
  check("(c) ⭐ bant `invalid`", (await bant()) === "invalid", String(await bant()));
  const h3 = await saglik();
  check("(c) health: bozuk 1", h3?.durum === "GECERSIZ_HESAP" && h3?.bozukSayisi === 1, JSON.stringify(h3));
  await prisma.$executeRaw`UPDATE users SET "systemAccountSeal" = ${iyi} WHERE id = ${sa.id}::uuid`;
  check("(c) mühür geri konunca giriş 200", (await giris(SA_AD, SA_PAROLA)).status === 200);

  console.log("\n=== (d) Mandalsız eski kurulum güncellenir: kilitlenmez, `--muhurle` sonrası mühürlü ===");
  if (mandalYolu) fs.rmSync(mandalYolu, { force: true });
  await prisma.$executeRaw`UPDATE users SET "systemAccountSeal" = NULL WHERE id = ${sa.id}::uuid`;
  resetSystemAccountSealCacheForTest();
  await bekle(MANDAL_BEKLE_MS);
  const g4 = await giris(SA_AD, SA_PAROLA);
  const me4 = await http("GET", "/api/auth/me", String(g4.data.token ?? ""));
  check("(d) ⭐ mühürsüz + mandalsız: giriş 200, `[\"*\"]` (kilitlenmez)",
    g4.status === 200 && me4.data.isSystemAccount === true && (me4.data.permissions as string[] | undefined)?.includes("*") === true, `${g4.status}`);
  check("(d) ⭐ bant `pending`", (await bant()) === "pending", String(await bant()));
  const yanlis = await sealExistingSystemAccount({ username: SA_AD, password: "yanlis-parola-uzun" });
  check("(d) yanlış parolayla mühür YAZILMAZ", yanlis.kind === "error" && (await satir(sa.id)).systemAccountSeal === null, yanlis.kind);
  const muhur = await sealExistingSystemAccount({ username: SA_AD, password: SA_PAROLA });
  resetSystemAccountSealCacheForTest();
  check("(d) ⭐ `--muhurle` yolu: mühür GEÇERLİ + mandal VAR", muhur.kind !== "error" && sealStatus(await satir(sa.id)) === "GECERLI" && readLatch() === "VAR",
    `${muhur.kind} ${sealStatus(await satir(sa.id))} ${readLatch()}`);
  await bekle(MANDAL_BEKLE_MS);
  check("(d) mühürleme sonrası giriş 200", (await giris(SA_AD, SA_PAROLA)).status === 200);
  check("(d) bant `ok`", (await bant()) === "ok", String(await bant()));
  const h4 = await saglik();
  check("(d) health: mandal VAR · TAMAM (pasif sahte sayılmaz)", h4?.mandal === "VAR" && h4?.durum === "TAMAM", JSON.stringify(h4));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  console.log(`Hedef DB: ${hedefDbAdi()}`);
  if (engel) {
    check("hedef DB", false, engel);
    return;
  }
  const kapi = await httpBekciKapisi({ base: BASE, kontrolSayisi: HTTP_KONTROL });
  if (kapi.kirmizi) { check("HTTP ayağı ölçülebildi", false, kapi.kirmizi); return; }
  if (!kapi.token) { ATLAMA.atla("uçtan uca mühür turu", kapi.atlaSebebi ?? "sunucu yok", HTTP_KONTROL); return; }
  const dir = sealDir();
  if (!dir) { check("lisans dizini çözüldü", false, "sealDir() null"); return; }
  mandalYolu = path.join(dir, SYSTEM_ACCOUNT_LATCH_FILE);
  mandalIlk = fs.existsSync(mandalYolu) ? fs.readFileSync(mandalYolu, "utf8") : null;
  parkta = await prisma.user.findMany({ where: { isSystemAccount: true }, select: PARK_SECIMI });
  for (const p of parkta) await prisma.user.update({ where: { id: p.id }, data: DUSUR });
  fs.rmSync(mandalYolu, { force: true });
  resetSystemAccountSealCacheForTest();
  console.log(`(${parkta.length} sistem hesabı geçici park edildi; mandal başlangıçta ${mandalIlk === null ? "YOK" : "VAR"})`);
  await senaryolar(kapi.token);
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
        await prisma.userPermission.deleteMany({ where: { userId: { in: fiksturler } } });
        await prisma.user.updateMany({ where: { id: { in: fiksturler } }, data: DUSUR });
        await prisma.user.deleteMany({ where: { id: { in: fiksturler } } });
      }
      for (const { id, ...geri } of parkta) await prisma.user.update({ where: { id }, data: { isSystemAccount: true, ...geri } });
      if (mandalYolu) {
        if (mandalIlk === null) fs.rmSync(mandalYolu, { force: true });
        else fs.writeFileSync(mandalYolu, mandalIlk);
      }
    } catch (e) {
      console.error("⚠️ temizlik başarısız:", e instanceof Error ? e.message : e);
      fail++;
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
