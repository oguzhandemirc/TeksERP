// =============================================================================
// BEKÇİ — FABRİKANIN İNDİRME BELİRTECİ UCU (`GET /api/license/indirme-belirteci`, 3bc)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts indirme_belirteci_ucu   (DB'siz; saf + statik)
//
// NE ÖLÇER:
//   §1 `decideDownloadToken` (saf): K1 → donuk (belirteç yok) · önekte saklı belirteç yok → verilmez +
//      dürt · süresi dolmuş / süresi okunamayan → verilmez + dürt · dolmaya < 15 dk → verilir + dürt ·
//      taze → verilir, dürtme yok · başka ürünün öneki verilmez
//   §2 dürtme kısıtı: kayıtlı iş yoksa dürtmez; 5 dk içinde ikinci istek dürtmez, sonra dürter
//   §4 yanıtın `iptal` alanı: depo boş → null · benimsenmiş belge → AYNEN JWS metni · kök tutmazsa null · uç alanı taşır
//   §3 bağlantı (statik): uç `decideDownloadToken` + `requestDownloadTokenRefresh`i çağırır, K1'de 403
//      LICENSE_UPDATES_FROZEN (TR ileti); yoklama işi başlangıçta `onDownloadTokenStale`i kaydeder; uç
//      onaylı cihaz ya da oturum ister ve kimliksiz uç envanterinde (`PUBLIC_ROUTES`) + swagger'da
// NEGATİF SONDA (elle, geri alındı; commit mesajında): süresi dolmuş belirteç verilir → §1d ❌ ·
//   dürtme kısıtı kalkar → §2c ❌ · iş kaydı sökülür → §3c ❌
// =============================================================================
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { PackageRevocationSchema, TYP, msToIso, signDocument, signDownloadToken } from "../src/lib/license/protocol";
import { loadLicenseStoreSync } from "../src/lib/license/store";
import { adoptPackageRevocation, loadPackageRevocationToken } from "../src/lib/license/package-revocation-store";
import { __resetLicenseSignalsForTests, onDownloadTokenStale, requestDownloadTokenRefresh, DOWNLOAD_TOKEN_NUDGE_GAP_MS } from "../src/lib/license/license-signals";
import { DOWNLOAD_TOKEN_REFRESH_MARGIN_MS, decideDownloadToken } from "../src/services/license-view.service";
import { PUBLIC_ROUTES } from "../src/constants/license-routes";
import { anahtarUret, fiksturKur } from "./lib/lisans-fikstur";

const KOK = path.resolve(__dirname, "..");
const DK = 60 * 1000;
const SIMDI = Date.parse("2026-09-30T10:00:00.000Z");
const KANAL = "deneme-kanal";
const ONEK = `/${KANAL}/electron/`;

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}

const anahtar = anahtarUret("ind-bekci-1");
function belirtec(yolOneki: string, expMs: number): { yolOneki: string; belirtec: string } {
  return {
    yolOneki,
    belirtec: signDownloadToken({
      payload: { v: 1, kanal: KANAL, yolOneki, kurulumId: "3f0c2b1e-5a5d-4c1e-9d36-6f0c2b1e5a5d", exp: msToIso(expMs) },
      key: { kid: anahtar.kid, privateKey: anahtar.privateKey },
      nowMs: Math.min(expMs, SIMDI),
    }),
  };
}

function kararlar(): void {
  console.log("\n§1 decideDownloadToken (saf)");
  const taze = belirtec(ONEK, SIMDI + 60 * DK);
  const k = (tokens: { yolOneki: string; belirtec: string }[], updatesAllowed = true, prefix: string | null = ONEK) =>
    decideDownloadToken({ updatesAllowed, prefix, tokens, nowMs: SIMDI });
  check("§1a K1 (güncelleme donuk) → frozen, saklı belirteç olsa da", k([taze], false).kind === "frozen");
  const yok = k([]);
  check("§1b önekte belirteç yok → none + dürt", yok.kind === "none" && yok.nudge === true);
  const ok = k([taze]);
  check("§1c ✓K taze (60 dk) → verilir, dürtme yok, geçerlilik sonu belgeden", ok.kind === "ok" && !ok.nudge && ok.token.belirtec === taze.belirtec && ok.token.gecerlilikSonu === msToIso(SIMDI + 60 * DK));
  const dolmus = k([belirtec(ONEK, SIMDI - DK)]);
  check("§1d süresi dolmuş → verilmez + dürt", dolmus.kind === "none" && dolmus.nudge);
  const yakin = k([belirtec(ONEK, SIMDI + DOWNLOAD_TOKEN_REFRESH_MARGIN_MS - DK)]);
  check("§1e dolmaya 15 dk'dan az → verilir + dürt", yakin.kind === "ok" && yakin.nudge);
  const bozuk = k([{ yolOneki: ONEK, belirtec: "a.b.c" }]);
  check("§1f süresi okunamayan belirteç → verilmez", bozuk.kind === "none");
  check("§1g başka ürünün öneki (mobil) electron isteğine verilmez · önek yok (kanal bilinmiyor) → none",
    k([belirtec(`/${KANAL}/mobil/`, SIMDI + 60 * DK)]).kind === "none" && k([taze], true, null).kind === "none");
}

function durtme(): void {
  console.log("\n§2 dürtme kısıtı");
  __resetLicenseSignalsForTests();
  check("§2a kayıtlı iş yoksa dürtmez", requestDownloadTokenRefresh(SIMDI) === false);
  let sayac = 0;
  onDownloadTokenStale(() => sayac++);
  const a = requestDownloadTokenRefresh(SIMDI);
  const b = requestDownloadTokenRefresh(SIMDI + DOWNLOAD_TOKEN_NUDGE_GAP_MS - 1);
  check("§2b ✓K ilk istek dürter", a && sayac === 1);
  check("§2c 5 dk içinde ikinci istek dürtmez (satıcı istemci sayısıyla dövülmez)", !b && sayac === 1);
  check("§2d aralık dolunca yine dürter", requestDownloadTokenRefresh(SIMDI + DOWNLOAD_TOKEN_NUDGE_GAP_MS) && sayac === 2);
  __resetLicenseSignalsForTests();
}

function baglanti(): void {
  console.log("\n§3 bağlantı (statik)");
  const oku = (rel: string) => readFileSync(path.join(KOK, rel), "utf8");
  const svc = oku("src/services/license-view.service.ts");
  const govde = /export function getDownloadToken\([\s\S]*?\n\}\n/.exec(svc)?.[0] ?? "";
  check("§3a uç saf kararı çağırır ve dürter", govde.includes("decideDownloadToken(") && govde.includes("requestDownloadTokenRefresh()"));
  check("§3b K1 → 403 LICENSE_UPDATES_FROZEN, Türkçe ileti", /licenseError\(403, "LICENSE_UPDATES_FROZEN", "Bu kurulum için güncelleme dondurulmuş\."\)/.test(govde));
  const is = oku("src/jobs/license-poll.job.ts");
  check("§3c yoklama işi başlangıçta dürtme kancasını kaydeder", /onDownloadTokenStale\(requestImmediateLicensePoll\)/.test(is));
  const rota = oku("src/routes/license.routes.ts");
  check("§3d uç onaylı cihaz ya da oturum ister, swagger'da", /router\.get\("\/indirme-belirteci", requireApprovedDeviceOrSession,/.test(rota) && rota.includes(" * /api/license/indirme-belirteci:"));
  check("§3e kimliksiz uç envanterinde (lisans kapısı listesi)", PUBLIC_ROUTES.some((r) => r.method === "GET" && r.path === "/api/license/indirme-belirteci"));
}

function iptalAlani(): void {
  console.log("\n§4 yanıtta güncel paket iptal belgesi (I6a)");
  const f = fiksturKur(SIMDI);
  const dir = mkdtempSync(path.join(os.tmpdir(), "ind-iptal-"));
  try {
    mkdirSync(dir, { recursive: true });
    loadLicenseStoreSync({ dir });
    check("§4a kayıtlı iptal yok → iptal null", loadPackageRevocationToken(f.kokler) === null);
    const tarih = msToIso(SIMDI - DK);
    const belge = signDocument({
      typ: TYP.PAKET_IPTAL, schema: PackageRevocationSchema, key: f.kok,
      payload: { v: 1, iptalId: randomUUID(), sira: 1, verilis: tarih, iptaller: [{ kid: "ist-2026-1", sertifikaId: randomUUID(), tarih, neden: "sızıntı" }] },
    });
    check("§4b iptal benimsenir", adoptPackageRevocation(belge, f.kokler));
    check("§4c kayıtlı iptal → AYNEN o belge (JWS metni)", loadPackageRevocationToken(f.kokler) === belge);
    check("§4d kökle doğrulanmayan depodaki belge verilmez", loadPackageRevocationToken([f.kokler[1]!]) === null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const svc = readFileSync(path.join(KOK, "src/services/license-view.service.ts"), "utf8");
  const govde = /export function getDownloadToken\([\s\S]*?\n\}\n/.exec(svc)?.[0] ?? "";
  check("§4e uç yanıtı iptal alanını depodan taşır", /iptal: loadPackageRevocationToken\(\)/.test(govde));
}

function main(): void {
  console.log("=== İNDİRME BELİRTECİ UCU ===");
  kararlar();
  durtme();
  baglanti();
  iptalAlani();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
