// =============================================================================
// BEKÇİ — LİSANS KİLİT KAÇAKLARI (Bölge 3 güvenlik denetimi B1 · B2 · B4 düzeltmeleri)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts lisans_kilit_kacaklari   (kendi _test DB'si; geçici LICENSE_DIR'ler,
// geçici kullanıcılar teardown'da silinir). Kilit G2 bekçisi gibi süreç içinde açılır (`setActivationLockForTests(true)`
// = korumalı derleme sabiti); kapı kararı gerçek `licenseGate` + gerçek oturumla.
//
// NE ÖLÇER:
//   §1 ⭐ B1 bekleyen taşıma etkin SAYMAZ: elle yazılmış imzasız `tasima.json` (BEKLIYOR ya da ONAYLANDI) kilidi
//      kaldırmaz (ETKINLESMEDI, iş ucu 403); meşru API yolu (`POST /api/license/tasima-talebi`, satıcı BEKLIYOR) da
//      kaldırmaz; bekleyen talebin durumu etkin olmayan kurulumda da yoklanır (TASIMA_ONAYI_BEKLIYOR · RED → dosya düşer)
//
// NEGATİF SONDA (elle, ölçüldü): `isActivated`e bekleyen taşıma dalı geri konunca §1b/§1c/§1f kırmızı;
//   `pollOnce`ta taşıma yoklaması `activated` kapısının ARKASINA alınınca §1g/§1h kırmızı.
// =============================================================================
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPublicKey, randomUUID } from "node:crypto";
import prisma from "../src/lib/prisma";
import { AuditService } from "../src/services/audit.service";
import { AuthService, resetRequestPermissionCacheForTest } from "../src/services/auth.service";
import { AppError } from "../src/utils/app-error";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { licenseGate } from "../src/middlewares/license.middleware";
import { LICENSE_FILES, loadLicenseStoreSync } from "../src/lib/license/store";
import { setLicenseTraceRow } from "../src/lib/license/trace-row";
import { flushLicenseTraceWrites } from "../src/lib/license/accumulation";
import { setEgressTrustForTests } from "../src/lib/http-egress";
import {
  __resetLicenseRuntimeForTests,
  configureLicenseRuntimeForTests,
  getLicenseSnapshot,
  invalidateLicenseSnapshot,
  setActivationLockForTests,
  setLicenseDbFacts,
  setMeasuredFingerprint,
} from "../src/lib/license/runtime";
import { requestTransfer } from "../src/services/license.service";
import { pollLicenseOnce } from "../src/services/license-sync.service";
import { egressTransport } from "../src/services/helpers/license-wire.helper";
import { DAY_MS, ExemptionSchema, TYP, installationKeyId, msToIso, signDocument } from "../src/lib/license/protocol";
import { signStateRecord, verifyStateRecordSignature } from "../src/lib/license/saat";
import { fiksturKur, type Fikstur } from "./lib/lisans-fikstur";
import { sahteSaticiBaslat, type SahteSatici } from "./lib/lisans-sahte-satici";
import { kabulEt, temizleKabuller } from "./lib/lisans-kabul-fikstur";
import { kapidanGecir } from "./lib/lisans-kapi-surucu";
import { lisansKipKur, temizleLisansKipDizini } from "./lib/lisans-kip-fikstur";
import { totpCodeForStep, totpStep, generateTotpSecret } from "../src/services/totp.service";
import {
  isSystemAccountAuthorized,
  resetSystemAccountSealCacheForTest,
  SEAL_ROW_SELECT,
  sealStatus,
  SYSTEM_ACCOUNT_LATCH_FILE,
  writeLatch,
  writeSeal,
  type SealRow,
} from "../src/services/helpers/system-account-seal.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}

const dizinler: string[] = [];
const geciciDizin = (ad: string): string => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `denetim-${ad}-`));
  dizinler.push(d);
  return d;
};
const saticilar: SahteSatici[] = [];
const fiksturler: string[] = [];
const ENV_YEDEK = { LICENSE_DIR: process.env.LICENSE_DIR, BACKUP_DIR: process.env.BACKUP_DIR };

async function kapi(token: string | null, m = "POST", yol = "/api/orders"): Promise<string> {
  const s = await kapidanGecir(licenseGate, { m, desen: yol, ornek: yol }, token);
  if (s.hata === undefined) return "ROTAYA";
  const d = (s.hata as { details?: Record<string, unknown> }).details ?? {};
  return `403:${String(d.code)}/${String(d.sinif ?? "")}`;
}
const kilit = (): string => {
  const s = getLicenseSnapshot();
  return `${s.etkinlestirmeKilidi.sinif}/${s.etkinlestirmeKilidi.neden}`;
};

/** Hiç etkinleşmemiş kurulum: DB izi yok, kimlik/HAK/kira yok, kilit AÇIK (korumalı derleme). */
async function taze(f: Fikstur, dir?: string): Promise<string> {
  // Önceki kurulumun kuyruktaki iz yazımı sıfırlamadan SONRA onaylanıp belleğe geri dönmesin.
  await flushLicenseTraceWrites();
  __resetLicenseRuntimeForTests();
  const d = dir ?? geciciDizin("taze");
  if (dir === undefined) loadLicenseStoreSync({ dir: d });
  configureLicenseRuntimeForTests({ roots: f.kokler, vendorUrl: null });
  setLicenseDbFacts({ installationId: randomUUID(), firstOpenMs: Date.now() - 3 * DAY_MS, ledgerHighWaterMs: null });
  setMeasuredFingerprint({ digest: f.parmakIzi, measured: { f1: true, f2: true, f3: true, f4: true, f5: true }, measuredAt: new Date().toISOString() });
  setLicenseTraceRow(null);
  setActivationLockForTests(true);
  invalidateLicenseSnapshot();
  return d;
}

// ── §1 B1 ──────────────────────────────────────────────────────────────────────────────────────────────────
const tasimaYaz = (dir: string, durum?: "ONAYLANDI"): void => {
  fs.writeFileSync(path.join(dir, LICENSE_FILES.TRANSFER), JSON.stringify({ v: 1, talepId: randomUUID(), istendi: new Date().toISOString(), gerekce: null, ...(durum ? { durum } : {}) }));
  loadLicenseStoreSync({ dir });
  invalidateLicenseSnapshot();
};

async function b1(token: string): Promise<void> {
  console.log("\n§1 — B1 bekleyen taşıma etkin saymaz");
  const f = fiksturKur(Date.now());
  const dir = await taze(f);
  check("§1a zemin: taze kurulum ETKINLESMEDI, iş ucu 403", kilit() === "ETKINLESMEDI/IZ_YOK" && (await kapi(token)).startsWith("403:LICENSE_NOT_ACTIVATED"), `${kilit()} · ${await kapi(token)}`);

  tasimaYaz(dir);
  const s = getLicenseSnapshot();
  const k = await kapi(token);
  check("§1b ⭐ elle yazılmış imzasız tasima.json (BEKLIYOR) → etkin değil, kilit ETKINLESMEDI, iş ucu 403",
    !s.activated && kilit() === "ETKINLESMEDI/IZ_YOK" && k.startsWith("403:LICENSE_NOT_ACTIVATED"), `activated=${s.activated} kilit=${kilit()} kapı=${k}`);
  for (const [m, yol] of [["GET", "/api/rolls"], ["POST", "/api/shipping/shipments"]] as const) {
    check(`§1c ⭐ ${m} ${yol} kilitte 403`, (await kapi(token, m, yol)).startsWith("403:LICENSE_NOT_ACTIVATED"));
  }
  tasimaYaz(dir, "ONAYLANDI");
  check("§1d durum ONAYLANDI yazılırsa da kilit sürer (kod girilmeden etkinlik yok)", kilit() === "ETKINLESMEDI/IZ_YOK", kilit());

  // Meşru API yolu: kilit altında açık `POST /api/license/tasima-talebi` → satıcı BEKLIYOR.
  await flushLicenseTraceWrites();
  __resetLicenseRuntimeForTests();
  const d2 = geciciDizin("tasima-api");
  const key = loadLicenseStoreSync({ dir: d2 }).key;
  if (!key) throw new Error("anahtar yok");
  const f0 = fiksturKur(Date.now());
  const f2: Fikstur = { ...f0, kurulum: { kid: key.kid, x: key.x, privateKey: key.privateKey, acik: createPublicKey(key.privateKey) } };
  const sat = await sahteSaticiBaslat(f2);
  saticilar.push(sat);
  sat.tasimaDurumu = "BEKLIYOR";
  await taze(f2, d2);
  configureLicenseRuntimeForTests({ roots: f2.kokler, vendorUrl: sat.url });
  setEgressTrustForTests(sat.ca);
  try {
    await kabulEt();
    const once = kilit();
    const kapiAcikMi = await kapi(token, "POST", "/api/license/tasima-talebi");
    const r = await requestTransfer(null, null);
    check("§1e zemin: tasima-talebi ucu kilit altında AÇIK; talep BEKLIYOR, lisans yok",
      once === "ETKINLESMEDI/IZ_YOK" && kapiAcikMi === "ROTAYA" && r.durum === "BEKLIYOR" && sat.sayac.tasima === 1 && sat.sayac.etkinlestir === 0, `${once} ${kapiAcikMi} ${r.durum} sayac=${JSON.stringify(sat.sayac)}`);
    check("§1f ⭐ satıcı onayı olmadan (BEKLIYOR) kilit KALKMAZ, iş ucu 403", kilit() === "ETKINLESMEDI/IZ_YOK" && (await kapi(token)).startsWith("403:LICENSE_NOT_ACTIVATED"), `${kilit()} · ${await kapi(token)}`);
    const p = await pollLicenseOnce(egressTransport);
    check("§1g ⭐ etkin olmayan kurulum bekleyen talebin durumunu yoklar (TASIMA_ONAYI_BEKLIYOR)",
      p.outcome === "BASARISIZ" && p.code === "TASIMA_ONAYI_BEKLIYOR" && sat.sayac.tasima === 2, `${p.outcome} ${p.code ?? ""} sayac=${sat.sayac.tasima}`);
    sat.tasimaDurumu = "REDDEDILDI";
    const p2 = await pollLicenseOnce(egressTransport);
    check("§1h satıcı reddedince yoklama talebi düşürür, kilit sürer",
      p2.code === "TASIMA_REDDEDILDI" && loadLicenseStoreSync({ dir: d2 }).transfer === null && kilit() === "ETKINLESMEDI/IZ_YOK", `${p2.code ?? ""} ${kilit()}`);
  } finally {
    setEgressTrustForTests(null);
  }
}

async function main(): Promise<void> {
  console.log("=== Lisans kilit kaçakları (denetim B1 · B2 · B4) ===");
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);
  AuditService.log = async () => undefined;
  AuditService.logEvent = async () => undefined;
  const ad = `TEST-kilit-kacak-${Date.now()}`;
  const u = await prisma.user.create({ data: { username: ad, passwordHash: await AuthService.hashPassword("Deneme-12345"), fullName: "TEST denetim" }, select: { id: true } });
  fiksturler.push(u.id);
  try {
    const { token } = await AuthService.login(ad, "Deneme-12345");
    await b1(token);
  } finally {
    for (const s of saticilar) await s.kapat().catch(() => undefined);
    await temizleKabuller().catch(() => undefined);
    await prisma.session.deleteMany({ where: { userId: { in: fiksturler } } }).catch(() => undefined);
    await prisma.workSession.deleteMany({ where: { userId: { in: fiksturler } } }).catch(() => undefined);
    await prisma.totpEnrollment.deleteMany({ where: { userId: { in: fiksturler } } }).catch(() => undefined);
    await prisma.user.updateMany({ where: { id: { in: fiksturler } }, data: { isSystemAccount: false, systemAccountSeal: null } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: fiksturler } } }).catch(() => undefined);
    setActivationLockForTests(null);
    for (const d of dizinler) fs.rmSync(d, { recursive: true, force: true });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} kaldı ===`);
}

main()
  .catch((e) => {
    console.error(e);
    fail++;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
