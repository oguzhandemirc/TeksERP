// =============================================================================
// BEKÇİ — VARSAYILAN SÜPERADMİN (kullanıcı kararı 2026-10-11)
// =============================================================================
// Kurulumda hiç sistem hesabı yoksa boot, pakete gömülü ORTAK malzemeyle (`{kullaniciAdi, ozet}`)
// bir kez hesap doğurur; ilk girişte parola değişimi zorunlu. Beş kol:
//   §1 DOĞUŞ — yalnız hesap yokken · malzemesiz doğmaz · ad başkasındaysa doğmaz (yükseltme yok) ·
//      ikinci çağrı doğurmaz · boot + kurulum aracı YARIŞI tek hesap (8038 tx'in İLK ifadesi).
//   §2 REPO — düz parola / bcrypt özeti (maliyet ≥12) izlenen dosyalarda yok; sır yalnız
//      `secrets.TEKSERP_VARSAYILAN_SA`ten; derleme ↔ src sözleşme regex'leri ikiz.
//   §3 ZORUNLU DEĞİŞİM — değişim bekleyen satıcı token'ıyla ROUTE LİSTESİNDEKİ (rotaEnvanteri)
//      her kimlikli uç 403 PASSWORD_CHANGE_REQUIRED; açık olan TAM üç uç (me/logout/change-password).
//   §4 DEĞİŞİM — yeni parola ≠ ortak varsayılan (400 PASSWORD_IS_DEFAULT); başarıda
//      `defaultPasswordChangedAt` dolar, /auth/me bandı kalkar; yetkisize bant hiç gitmez.
//   §5 SIZINTI — boot/kurulum çıktısında ve audit satırlarında parola, özet, giriş adı yok.
// Her kolun negatif sondası aynı yüklemi bozuk girdiyle besler ve KIRMIZI bekler.
//
// ⚠️ BU BEKÇİ YAZAR (hedef-DB kapısı): mevcut sistem hesabını GEÇİCİ pasifleştirir (imzalı
// takma ad), kendi fikstürünü yaratır, `finally`de geri alır; yarıda kalırsa açılıştaki onarım
// imzadan geri alır. Malzeme test anında `globalThis.__TEKSERP_VARSAYILAN_SA__`e yazılır
// (derlemesiz koşumda sabit tanımsızdır ve `typeof` küresel adı okur).
// Koşum: npx tsx scripts/test_varsayilan_superadmin.ts
// =============================================================================
import prisma, { pool } from "../src/lib/prisma"; // İLK import: dotenv.config()
import { git } from "./lib/git";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import bcrypt from "bcryptjs";
import app from "../src/app";
import { PASSWORD_CHANGE_REQUIRED_CODE } from "../src/services/auth.service";
import {
  ensureVarsayilanSuperadmin,
  varsayilanParolaBekliyor,
  SYSTEM_ACCOUNT_LOCK_NS,
} from "../src/services/helpers/varsayilan-superadmin.helper";
import { VARSAYILAN_AD_RE, DEFAULT_HASH_RE, malzemeCoz, type VarsayilanMalzeme } from "../src/constants/varsayilan-superadmin";
import { SYSTEM_ACCOUNT_FULLNAME } from "../src/constants/system-account";
import { ensureSuperadminAccount } from "../src/jobs/superadmin.job";
import { provisionSuperadmin } from "./superadmin-olustur";
import { __resetSystemAccountRegistryForTests } from "../src/services/helpers/system-account.registry";
import { rotaEnvanteri } from "./lib/rota-envanteri";
import { hedefDbAdi, hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { geciciLisansDizini } from "./lib/sistem-hesabi-muhru-fikstur";
import {
  resetSystemAccountSealCacheForTest,
  SEAL_ROW_SELECT,
  sealStatus,
  SYSTEM_ACCOUNT_LATCH_FILE,
} from "../src/services/helpers/system-account-seal.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const KOK = path.join(__dirname, "..");
const REPO = path.join(KOK, "..");
const SRC = path.join(KOK, "src");
const GECICI_IMZA = `${SYSTEM_ACCOUNT_FULLNAME} [bekci.vsa geçici]`;
const AD_ONEKI = "bekci.vsa.";
const AD = `${AD_ONEKI}${process.pid}`;
const PAROLA = `Bekci-VSA-ortak-${process.pid}-uzun-parola`;
const YENI_PAROLA = `Bekci-VSA-yeni-${process.pid}-uzun-parola`;
const KURULUM_PAROLA = `Bekci-VSA-kur-${process.pid}-uzun-parola`;

type G = typeof globalThis & { __TEKSERP_VARSAYILAN_SA__?: string };
const malzemeYaz = (m: VarsayilanMalzeme | null): void => {
  if (m) (globalThis as G).__TEKSERP_VARSAYILAN_SA__ = JSON.stringify({ v: 1, ...m });
  else delete (globalThis as G).__TEKSERP_VARSAYILAN_SA__;
};

let lisans: { dizin: string; temizle: () => void } | null = null;
let pasiflesenler: Array<{ id: string; fullName: string; systemAccountSeal: string | null }> = [];

async function kullaniciSil(id: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId: id } });
  await prisma.workSession.deleteMany({ where: { userId: id } });
  await prisma.systemLog.deleteMany({ where: { OR: [{ userId: id }, { recordId: id }] } });
  await prisma.userPermission.deleteMany({ where: { userId: id } });
  await prisma.totpEnrollment.deleteMany({ where: { userId: id } });
  await prisma.user.delete({ where: { id } });
}

/** Yarıda kalmış koşumun artıkları: fikstür hesapları + imzalı pasifleştirilmiş gerçek hesap. */
async function onar(): Promise<void> {
  for (const b of await prisma.user.findMany({ where: { username: { startsWith: AD_ONEKI } }, select: { id: true } })) {
    await kullaniciSil(b.id);
  }
  const yarim = await prisma.user.findMany({ where: { fullName: GECICI_IMZA }, select: { id: true } });
  if (yarim.length) {
    await prisma.user.updateMany({
      where: { id: { in: yarim.map((y) => y.id) } },
      data: { isSystemAccount: true, fullName: SYSTEM_ACCOUNT_FULLNAME },
    });
  }
}

/** Sistem hesabı fikstürlerini (bu bekçinin adlarıyla) siler — her alt bölüm temiz başlar. */
async function fiksturleriSil(): Promise<void> {
  // Yalnız bu bekçinin adlarıyla doğanlar — gerçek hesap bu sırada imzalı pasiftir, ama ad öneki ikinci emniyettir.
  for (const b of await prisma.user.findMany({ where: { username: { startsWith: AD_ONEKI } }, select: { id: true } })) {
    await kullaniciSil(b.id);
  }
}

async function ciktiyiYakala<T>(f: () => Promise<T>): Promise<{ sonuc: T; cikti: string }> {
  let biriken = "";
  const yaz = process.stdout.write.bind(process.stdout);
  const yazE = process.stderr.write.bind(process.stderr);
  const asil = { log: console.log, warn: console.warn, error: console.error };
  const topla = (...a: unknown[]): void => void (biriken += a.map(String).join(" ") + "\n");
  process.stdout.write = ((c: string | Uint8Array): boolean => ((biriken += String(c)), true)) as typeof process.stdout.write;
  process.stderr.write = ((c: string | Uint8Array): boolean => ((biriken += String(c)), true)) as typeof process.stderr.write;
  console.log = topla;
  console.warn = topla;
  console.error = topla;
  try {
    return { sonuc: await f(), cikti: biriken };
  } finally {
    process.stdout.write = yaz;
    process.stderr.write = yazE;
    Object.assign(console, asil);
  }
}

// ── SAF YÜKLEMLER (sondalar bunları bozuk girdiyle besler) ─────────────────────────────

/** Metinde sır izi: düz parola, bcrypt özeti ya da (verildiyse) satıcı giriş adı. */
export function sizintiVar(metin: string, sirlar: readonly string[]): string[] {
  return sirlar.filter((s) => s.length > 0 && metin.includes(s));
}

const OZET_GENEL = /\$2[aby]\$1[2-9]\$[./A-Za-z0-9]{53}/;
/** İzlenen dosyalarda maliyet ≥12 bcrypt özeti ya da sırra literal atama. */
export function repoIhlalleri(dosyalar: ReadonlyMap<string, string>, yerelOzet: string | null): string[] {
  const ih: string[] = [];
  for (const [ad, icerik] of dosyalar) {
    if (OZET_GENEL.test(icerik)) ih.push(`bcrypt özeti (maliyet ≥12): ${ad}`);
    if (yerelOzet && icerik.includes(yerelOzet)) ih.push(`yerel sır dosyasının özeti: ${ad}`);
    // Sır yalnız GitHub sırrından ya da dosya yolundan okunur; literal JSON ataması yasak.
    for (const m of icerik.matchAll(/TEKSERP_VARSAYILAN_SA\s*[:=]\s*(['"]?)\s*\{/g)) ih.push(`literal malzeme ataması: ${ad} (${m[0].slice(0, 40)})`);
    for (const m of icerik.matchAll(/__TEKSERP_VARSAYILAN_SA__\s*:\s*['"`]/g)) ih.push(`define'a literal: ${ad} (${m[0]})`);
  }
  return ih;
}

/** Değişim bekleyen token'la bir uca verilen cevap KAPALI mı (handler'a ulaşmadı). */
export function kapali(status: number, kod: string | undefined): boolean {
  return status === 403 && kod === PASSWORD_CHANGE_REQUIRED_CODE;
}

/** `src/routes` metinlerinde `verifyTokenAllowPasswordChange` kullanan route tanımları. */
export function izinliUclar(dosyalar: ReadonlyMap<string, string>): string[] {
  const out: string[] = [];
  for (const [ad, icerik] of dosyalar) {
    for (const m of icerik.matchAll(/router\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]\s*,[^\n]*verifyTokenAllowPasswordChange/g)) {
      out.push(`${m[1]!.toUpperCase()} ${ad}:${m[2]}`);
    }
    if (/router\.use\([^)]*verifyTokenAllowPasswordChange/.test(icerik)) out.push(`USE ${ad}`);
  }
  return out.sort();
}
const BEKLENEN_IZINLI = ["GET auth.routes.ts:/me", "POST auth.routes.ts:/change-password", "POST auth.routes.ts:/logout"].sort();

// =============================================================================

function bolum2Repo(): void {
  console.log("\n=== §2) REPO — düz parola ve özet yok, sır yalnız CI sırrından ===");
  const liste = git(["ls-files", "-z"], { cwd: REPO })
    .split("\0")
    .filter((f) => f && !/\.(png|jpe?g|gif|ico|pdf|woff2?|ttf|otf|zip|gz|tgz|node|exe|dll|jar|keystore|dump|lock)$/i.test(f));
  const dosyalar = new Map<string, string>();
  for (const f of liste) {
    try {
      const st = fs.statSync(path.join(REPO, f));
      if (st.size > 4 << 20) continue;
      dosyalar.set(f, fs.readFileSync(path.join(REPO, f), "utf8"));
    } catch {
      /* silinmiş/izinsiz — atla */
    }
  }
  check("§2 körlük zemini: izlenen dosyalar okundu (≥ 2000)", dosyalar.size >= 2000, `${dosyalar.size} dosya`);
  const yerelYol = path.join(os.homedir(), ".tekserp", "sirlar", "varsayilan-superadmin.json");
  let yerelOzet: string | null = null;
  if (fs.existsSync(yerelYol)) {
    const m = malzemeCoz(fs.readFileSync(yerelYol, "utf8"));
    yerelOzet = m?.ozet ?? null;
    const kip = fs.statSync(yerelYol).mode & 0o777;
    check("§2 yerel sır dosyası 0600 ve sözleşmeye uyar", kip === 0o600 && m !== null, `kip ${kip.toString(8)}`);
  }
  const ih = repoIhlalleri(dosyalar, yerelOzet);
  check("§2a ⭐ izlenen dosyalarda bcrypt özeti (≥12) / literal malzeme YOK", ih.length === 0, ih.slice(0, 5).join(" | ") || `temiz${yerelOzet ? " (yerel özet de arandı)" : ""}`);
  const wf = dosyalar.get(".github/workflows/korumali-paket.yml") ?? "";
  const sirlar = [...wf.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]);
  check("§2b iş akışı yalnız beyanlı sırrı okur (TEKSERP_VARSAYILAN_SA)", sirlar.length >= 2 && sirlar.every((s) => s === "TEKSERP_VARSAYILAN_SA"), sirlar.join(","));
  // İkiz sözleşme: derleme tarafının regex'leri src'ninkine bayt-eşit.
  const derleme = fs.readFileSync(path.join(KOK, "scripts/lib/varsayilan-superadmin-derleme.mjs"), "utf8");
  const ikizMi = (d: string): boolean =>
    d.includes(`DEFAULT_HASH_RE = ${DEFAULT_HASH_RE.toString()};`) &&
    d.includes(`VARSAYILAN_AD_RE = ${VARSAYILAN_AD_RE.toString()};`);
  check("§2c derleme ↔ src sözleşme regex'leri ikiz", ikizMi(derleme));
  check("§2 sonda: derleme maliyet alt sınırı gevşerse → kırmızı", !ikizMi(derleme.replace("\\$1[2-9]\\$", "\\$\\d\\d\\$")));
  // Sondalar
  const sahte = "$2b$13$" + "a".repeat(53);
  check("§2 sonda: dosyaya özet konunca → kırmızı", repoIhlalleri(new Map([["x.ts", `const h = "${sahte}";`]]), null).length > 0);
  check("§2 sonda: literal malzeme ataması → kırmızı", repoIhlalleri(new Map([["ci.yml", `${"TEKSERP_VARSAYILAN"}_SA: '${"{"}"v":1}'`]]), null).length > 0);
  check("§2 sonda: yerel özet metinde → kırmızı", repoIhlalleri(new Map([["y.md", "xx ÖZET yy"]]), "ÖZET").length > 0);
  check("§2 sonda: maliyet 10 fikstür özeti → yeşil (kapsam dışı)", repoIhlalleri(new Map([["t.ts", "$2a$10$" + "b".repeat(53)]]), null).length === 0);
}

function bolum3Statik(): void {
  console.log("\n=== §3s) Statik — değişim bekleyen hesaba açık uç TAM üç ===");
  const dosyalar = new Map<string, string>();
  for (const ad of fs.readdirSync(path.join(SRC, "routes"))) {
    if (ad.endsWith(".ts")) dosyalar.set(ad, fs.readFileSync(path.join(SRC, "routes", ad), "utf8"));
  }
  const izinli = izinliUclar(dosyalar);
  check("§3a ⭐ verifyTokenAllowPasswordChange yalnız me · logout · change-password", JSON.stringify(izinli) === JSON.stringify(BEKLENEN_IZINLI), izinli.join(", "));
  const m = new Map(dosyalar);
  m.set("roll.routes.ts", `${m.get("roll.routes.ts") ?? ""}\nrouter.get("/x", verifyTokenAllowPasswordChange, h);`);
  check("§3 sonda: dördüncü izinli uç → kırmızı", JSON.stringify(izinliUclar(m)) !== JSON.stringify(BEKLENEN_IZINLI));
  check("§3 sonda: kapali() 200'ü açık sayar", !kapali(200, undefined) && !kapali(403, "FORBIDDEN") && kapali(403, PASSWORD_CHANGE_REQUIRED_CODE));
  // Doğuş kilidi tx'in İLK ifadesi (sonra alınan kilit yarışı kapatmaz).
  const h = fs.readFileSync(path.join(SRC, "services/helpers/varsayilan-superadmin.helper.ts"), "utf8");
  const ilkIfade = (src: string): boolean => /\$transaction\(async \(tx\)[^{]*\{\s*await tx\.\$executeRaw`SELECT pg_advisory_xact_lock\(\$\{SYSTEM_ACCOUNT_LOCK_NS\}/.test(src);
  check("§1k doğuşta 8038 kilidi tx'in İLK ifadesi", ilkIfade(h) && SYSTEM_ACCOUNT_LOCK_NS === 8038);
  check("§1k sonda: kilit ikinci ifadeye kayınca → kırmızı", !ilkIfade(h.replace(/(\$transaction\(async \(tx\)[^{]*\{\s*)(await tx\.\$executeRaw`SELECT pg_advisory_xact_lock)/, "$1await tx.user.count();\n    $2")));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  console.log(`Hedef DB: ${hedefDbAdi()}`);
  bolum2Repo();
  bolum3Statik();
  if (engel) {
    console.log(`⛔ ${engel}`);
    fail++;
    return;
  }
  await onar();
  // G1: doğuşun mühür + mandalı bu koşumun geçici lisans dizinine yazılır.
  lisans = geciciLisansDizini("vsa");
  const mevcutlar = await prisma.user.findMany({ where: { isSystemAccount: true }, select: { id: true, fullName: true, systemAccountSeal: true } });
  pasiflesenler = mevcutlar;
  for (const m of mevcutlar) {
    await prisma.user.update({ where: { id: m.id }, data: { isSystemAccount: false, systemAccountSeal: null, fullName: GECICI_IMZA } });
  }
  check("başlangıç: hesapsız kurulum", (await prisma.user.count({ where: { isSystemAccount: true } })) === 0, `${mevcutlar.length} hesap geçici pasif`);

  const malzeme: VarsayilanMalzeme = { kullaniciAdi: AD, ozet: await bcrypt.hash(PAROLA, 12) };
  const SIRLAR = [PAROLA, malzeme.ozet, YENI_PAROLA];

  // ── §1 DOĞUŞ ─────────────────────────────────────────────────────────────────────────
  console.log("\n=== §1) DOĞUŞ — yalnız sistem hesabı yokken, tek hesap ===");
  malzemeYaz(null);
  const yok = await ensureVarsayilanSuperadmin();
  check("§1a malzemesiz derleme: doğmaz", yok.action === "malzeme-yok" && (await prisma.user.count({ where: { isSystemAccount: true } })) === 0);
  const { cikti: yokCikti } = await ciktiyiYakala(() => ensureSuperadminAccount());
  check("§1a2 malzemesiz boot tek satır uyarı basar", (yokCikti.match(/malzemesi yok/g) ?? []).length === 1, yokCikti.trim().split("\n")[0]);

  const engelleyen = await prisma.user.create({
    data: { username: AD, fullName: "TEST VSA görünür", passwordHash: await bcrypt.hash("x-yer-tutucu-parola", 4) },
    select: { id: true },
  });
  const adDolu = await ensureVarsayilanSuperadmin(malzeme);
  const yukseldi = await prisma.user.findUniqueOrThrow({ where: { id: engelleyen.id }, select: { isSystemAccount: true } });
  check("§1b ad başkasındaysa doğmaz, mevcut kullanıcı YÜKSELTİLMEZ", adDolu.action === "ad-dolu" && !yukseldi.isSystemAccount);
  await kullaniciSil(engelleyen.id);

  // Yarış: üç boot + job + kurulum aracı aynı anda → tek sistem hesabı; araç ya doğurur ya devralır.
  malzemeYaz(malzeme);
  const { sonuc: yaris, cikti: yarisCikti } = await ciktiyiYakala(() =>
    Promise.all([
      ensureVarsayilanSuperadmin(malzeme),
      provisionSuperadmin({ username: `${AD_ONEKI}kur`, password: KURULUM_PAROLA, pin: null, rotate: false }),
      ensureVarsayilanSuperadmin(malzeme),
      ensureSuperadminAccount(),
      ensureVarsayilanSuperadmin(malzeme),
    ]),
  );
  const [b1, arac, b2, , b3] = yaris;
  const dogduY = [b1, b2, b3].filter((r) => r.action === "dogdu").length;
  const sistemY = await prisma.user.findMany({ where: { isSystemAccount: true }, select: { username: true, defaultPasswordChangedAt: true } });
  check(
    "§1c ⭐ boot + kurulum aracı yarışında TEK hesap; araç doğurursa boot doğurmaz, boot doğurursa araç devralır",
    sistemY.length === 1 && sistemY[0]!.username === `${AD_ONEKI}kur` &&
      ((arac.kind === "created" && dogduY === 0) || (arac.kind === "taken-over" && dogduY === 1 && sistemY[0]!.defaultPasswordChangedAt !== null)),
    `hesap ${sistemY.length} · araç ${arac.kind} · boot doğdu ${dogduY}`,
  );
  await fiksturleriSil();

  const { sonuc: tekDogus, cikti: dogusCikti0 } = await ciktiyiYakala(() => ensureSuperadminAccount());
  const dogusCikti = `${yarisCikti}\n${dogusCikti0}`;
  const dogdu = tekDogus.action === "exists" ? 1 : 0;
  const sistem = await prisma.user.findMany({
    where: { isSystemAccount: true },
    select: { id: true, username: true, passwordHash: true, mustChangePassword: true, defaultPasswordIssuedAt: true, defaultPasswordChangedAt: true, updatedAt: true, fullName: true },
  });
  check("§1c2 job hesapsız kurulumda hesabı doğurur ve kaydı tazeler", sistem.length === 1 && dogdu === 1, `hesap ${sistem.length}`);
  const s = sistem[0];
  check(
    "§1d hesap ortak malzemeyle, değişim zorunlu, takma adla doğdu",
    !!s && s.username === AD && s.passwordHash === malzeme.ozet && s.mustChangePassword && s.defaultPasswordIssuedAt !== null && s.defaultPasswordChangedAt === null && s.fullName === SYSTEM_ACCOUNT_FULLNAME,
  );
  const ikinci = await ensureVarsayilanSuperadmin(malzeme);
  const sonra = await prisma.user.findMany({ where: { isSystemAccount: true }, select: { id: true, updatedAt: true } });
  check("§1e ikinci boot doğurmaz ve hesaba dokunmaz", ikinci.action === "var" && sonra.length === 1 && sonra[0]!.updatedAt.getTime() === s?.updatedAt.getTime());
  check("§1f bekleyen varsayılan ölçülür", await varsayilanParolaBekliyor());

  // Sonda: kilitsiz doğuş (aynı yüklem, kilit yok) yarışta çift hesap doğurur → bekçinin ölçtüğü şey gerçek.
  {
    await fiksturleriSil();
    const kilitsiz = async (): Promise<void> => {
      await prisma.$transaction(async (tx) => {
        const var_ = await tx.user.findFirst({ where: { isSystemAccount: true }, select: { id: true } });
        if (var_) return;
        await new Promise((r) => setTimeout(r, 50));
        await tx.user.create({
          data: { username: `${AD_ONEKI}s${Math.random().toString(36).slice(2, 8)}`, fullName: SYSTEM_ACCOUNT_FULLNAME, passwordHash: malzeme.ozet, isSystemAccount: true },
        });
      });
    };
    const r = await Promise.allSettled([kilitsiz(), kilitsiz(), kilitsiz()]);
    const n = await prisma.user.count({ where: { isSystemAccount: true } });
    check("§1 sonda: kilitsiz doğuş yarışta >1 hesap (ya da DB seddi) → yük gerçek", n > 1 || r.some((x) => x.status === "rejected"), `hesap ${n}`);
    await fiksturleriSil();
  }

  // ── §3/§4/§5 HTTP ────────────────────────────────────────────────────────────────────
  const dogus2 = await ensureVarsayilanSuperadmin(malzeme);
  const hesapId = dogus2.action === "dogdu" ? dogus2.id : "";
  check("körlük zemini: §3 için hesap yeniden doğdu", hesapId.length > 0);
  check(
    "§G1a ⭐ varsayılan hesap MÜHÜRLÜ doğar + mandal yazılır",
    dogus2.action === "dogdu" && dogus2.muhur === "MUHURLENDI" && !!lisans && fs.existsSync(`${lisans.dizin}/${SYSTEM_ACCOUNT_LATCH_FILE}`),
    dogus2.action === "dogdu" ? dogus2.muhur : dogus2.action,
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  type Yanit = { status: number; body: { data?: Record<string, unknown>; details?: { code?: string } } };
  const call = async (method: string, p: string, token: string | null, body?: unknown): Promise<Yanit> => {
    const r = await fetch(`${base}${p}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    let b: Yanit["body"] = {};
    try {
      b = (await r.json()) as Yanit["body"];
    } catch {
      /* boş */
    }
    return { status: r.status, body: b };
  };
  const yardimci: string[] = [];
  try {
    console.log("\n=== §3) ZORUNLU DEĞİŞİM — route listesindeki BÜTÜN kimlikli uçlar kapalı ===");
    const giris = await call("POST", "/api/auth/login", null, { username: AD, password: PAROLA, clientType: "electron" });
    const token = String(giris.body.data?.token ?? "");
    check("§3b varsayılan parolayla giriş: token + mustChangePassword", giris.status === 200 && giris.body.data?.mustChangePassword === true && token.length > 0, `status ${giris.status}`);
    const env = rotaEnvanteri(app);
    const kimlikli = env.routes.filter((r) => r.hasAuth);
    const acik = new Set(["GET /api/auth/me", "POST /api/auth/logout", "POST /api/auth/change-password"]);
    check("§3 körlük zemini: rota envanteri dolu ve önekler çözüldü", kimlikli.length >= 300 && env.cozulemeyen === 0, `${kimlikli.length} kimlikli · çözülemeyen ${env.cozulemeyen}`);
    const sizan: string[] = [];
    let olculen = 0;
    for (const r of kimlikli) {
      const yol = r.path.replace(/:([A-Za-z_]\w*)\??/g, "00000000-0000-4000-8000-000000000000").replace(/\(\.\*\)|\*\w*/g, "x");
      for (const m of r.methods) {
        if (m === "_ALL" || acik.has(`${m} ${r.path}`)) continue;
        const y = await call(m, yol, token, m === "GET" || m === "DELETE" ? undefined : {});
        olculen++;
        if (!kapali(y.status, y.body.details?.code)) sizan.push(`${m} ${r.path} → ${y.status} ${y.body.details?.code ?? ""}`);
      }
    }
    check("§3c ⭐ değişim bekleyen satıcı token'ı her kimlikli uçta 403 PASSWORD_CHANGE_REQUIRED", sizan.length === 0 && olculen >= 300, `${olculen} uç · sızan ${sizan.length}: ${sizan.slice(0, 6).join(" | ")}`);
    const me = await call("GET", "/api/auth/me", token);
    check("§3d /auth/me açık ve bandı bildirir", me.status === 200 && me.body.data?.defaultSuperadminPasswordPending === true && me.body.data?.isSystemAccount === true);

    console.log("\n=== §4) DEĞİŞİM — yeni parola ≠ ortak varsayılan ===");
    const ayni = await call("POST", "/api/auth/change-password", token, { currentPassword: PAROLA, newPassword: PAROLA });
    check("§4a aynı parola reddedilir", ayni.status === 400, `${ayni.status} ${ayni.body.details?.code ?? ""}`);
    // Ortak parolanın İKİZİ (aynı parola başka özetle duran hesap) — varsayılana dönüş kapısı.
    await prisma.user.update({ where: { id: hesapId }, data: { passwordHash: await bcrypt.hash(YENI_PAROLA, 4) } });
    const donus = await call("POST", "/api/auth/change-password", token, { currentPassword: YENI_PAROLA, newPassword: PAROLA });
    check("§4b ⭐ ortak varsayılana dönüş 400 PASSWORD_IS_DEFAULT", donus.status === 400 && donus.body.details?.code === "PASSWORD_IS_DEFAULT", `${donus.status} ${donus.body.details?.code ?? ""}`);
    malzemeYaz(null);
    const donusMalzemesiz = await call("POST", "/api/auth/change-password", token, { currentPassword: YENI_PAROLA, newPassword: PAROLA });
    check("§4 sonda: malzeme bilinmezse aynı istek geçer (kapıyı malzeme taşıyor)", donusMalzemesiz.status === 200, `${donusMalzemesiz.status}`);
    // Sondanın değiştirdiği hesabı yeniden varsayılan duruma al ve asıl değişimi ölç.
    malzemeYaz(malzeme);
    await prisma.user.update({
      where: { id: hesapId },
      data: { passwordHash: malzeme.ozet, mustChangePassword: true, defaultPasswordChangedAt: null },
    });
    const giris2 = await call("POST", "/api/auth/login", null, { username: AD, password: PAROLA, clientType: "electron" });
    const token2 = String(giris2.body.data?.token ?? "");
    const { sonuc: degisim, cikti: degisimCikti } = await ciktiyiYakala(() =>
      call("POST", "/api/auth/change-password", token2, { currentPassword: PAROLA, newPassword: YENI_PAROLA }),
    );
    const sonDurum = await prisma.user.findUniqueOrThrow({ where: { id: hesapId }, select: { mustChangePassword: true, defaultPasswordChangedAt: true, passwordHash: true } });
    check(
      "§4c başarılı değişim: bayrak iner, ChangedAt dolar, yeni parola tutar, ortak parola tutmaz",
      degisim.status === 200 && !sonDurum.mustChangePassword && sonDurum.defaultPasswordChangedAt !== null &&
        (await bcrypt.compare(YENI_PAROLA, sonDurum.passwordHash)) && !(await bcrypt.compare(PAROLA, sonDurum.passwordHash)),
      `${degisim.status}`,
    );
    check("§4d bekleyen varsayılan kalktı", !(await varsayilanParolaBekliyor()));
    const giris3 = await call("POST", "/api/auth/login", null, { username: AD, password: YENI_PAROLA, clientType: "electron" });
    const me3 = await call("GET", "/api/auth/me", String(giris3.body.data?.token ?? ""));
    check("§4e /auth/me bandı kalktı", me3.status === 200 && me3.body.data?.defaultSuperadminPasswordPending === false);
    resetSystemAccountSealCacheForTest();
    check(
      "§G1b ⭐ zorunlu parola değişimi mührü AYNI yazımda yeniledi → mühür geçerli, `/auth/me` en yetkili hesap",
      sealStatus(await prisma.user.findUniqueOrThrow({ where: { id: hesapId }, select: SEAL_ROW_SELECT })) === "GECERLI" &&
        me3.body.data?.isSystemAccount === true,
      JSON.stringify(me3.body.data?.isSystemAccount),
    );
    const eski = await call("POST", "/api/auth/login", null, { username: AD, password: PAROLA, clientType: "electron" });
    check("§4f ortak parolayla giriş artık 401", eski.status === 401, `${eski.status}`);

    // Yetkisiz kullanıcıya bant bilgisi gitmez (hesap yeniden bekler durumda).
    await prisma.user.update({ where: { id: hesapId }, data: { defaultPasswordChangedAt: null } });
    const rollRead = await prisma.permission.findUnique({ where: { code: "roll:read" }, select: { id: true } });
    const duzParola = `Bekci-VSA-duz-${process.pid}-parola`;
    const duz = await prisma.user.create({
      data: {
        username: `${AD_ONEKI}duz`,
        fullName: "TEST VSA düz",
        passwordHash: await bcrypt.hash(duzParola, 4),
        ...(rollRead ? { permissions: { create: { permissionId: rollRead.id } } } : {}),
      },
      select: { id: true },
    });
    yardimci.push(duz.id);
    const gd = await call("POST", "/api/auth/login", null, { username: `${AD_ONEKI}duz`, password: duzParola, clientType: "electron" });
    const meD = await call("GET", "/api/auth/me", String(gd.body.data?.token ?? ""));
    check("§4g yetkisiz kullanıcıya bant bilgisi gitmez (false)", meD.status === 200 && meD.body.data?.defaultSuperadminPasswordPending === false, `${meD.status}`);
    await prisma.user.update({ where: { id: hesapId }, data: { defaultPasswordChangedAt: new Date() } });

    console.log("\n=== §5) SIZINTI — çıktı ve audit'te parola/özet/giriş adı yok ===");
    const cikti = `${dogusCikti}\n${degisimCikti}`;
    const ciktiSizinti = sizintiVar(cikti, [...SIRLAR, AD]);
    check("§5a ⭐ boot/değişim çıktısında sır ve giriş adı yok", ciktiSizinti.length === 0, ciktiSizinti.length ? `${ciktiSizinti.length} iz` : `${cikti.length} karakter tarandı`);
    const loglar = await prisma.systemLog.findMany({
      where: { OR: [{ recordId: hesapId }, { userId: hesapId }] },
      select: { action: true, tableName: true, newData: true, oldData: true, changes: true },
    });
    const logMetni = loglar.map((l) => JSON.stringify(l)).join("\n");
    const logSizinti = sizintiVar(logMetni, [...SIRLAR, AD]);
    check(
      "§5b ⭐ audit satırlarında parola/özet/giriş adı yok (doğuş + değişim yazıldı)",
      logSizinti.length === 0 && loglar.some((l) => l.action === "SUPERADMIN_DEFAULT_PROVISIONED") && loglar.some((l) => l.tableName === "USER_PASSWORD"),
      `${loglar.length} satır · iz ${logSizinti.length}`,
    );
    check("§5 sonda: özet içeren metin → kırmızı", sizintiVar(`{"x":"${malzeme.ozet}"}`, SIRLAR).length > 0);
    check("§5 sonda: giriş adı içeren audit → kırmızı", sizintiVar(`{"username":"${AD}"}`, [AD]).length > 0);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    for (const id of yardimci) await kullaniciSil(id).catch(() => undefined);
  }
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    fail++;
  })
  .finally(async () => {
    try {
      malzemeYaz(null);
      if (!hedefDbEngeli()) {
        await fiksturleriSil();
        for (const p of pasiflesenler) {
          await prisma.user.update({ where: { id: p.id }, data: { isSystemAccount: true, systemAccountSeal: p.systemAccountSeal, fullName: p.fullName } });
        }
        await onar();
      }
    } catch (e) {
      console.error("⚠️ temizlik başarısız:", e instanceof Error ? e.message : e);
      fail++;
    }
    __resetSystemAccountRegistryForTests();
    lisans?.temizle();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
