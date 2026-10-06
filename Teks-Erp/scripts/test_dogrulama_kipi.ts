// =============================================================================
// BEKÇİ — DOĞRULAMA KİPİ + YEREL SAĞLIK (Dağıtım v2 — docs/design/GUNCELLEYICI.md §4.3 · §8.6 · §8.7)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts dogrulama_kipi   (DB'siz; saf + statik)
//
// Güncelleyici yeni sürümü göçten sonra `--dogrulama` ile başlatır (konak: `HOST=127.0.0.1` +
// `TEKSERP_DOGRULAMA_KIPI=1`) ve `GET http://127.0.0.1:<PORT>/health/yerel`in `lisans`ının işlem öncesinden
// KÖTÜ olmadığını ölçer. Sağlık düşerse DB yedekten geri yüklenir — bu yüzden bu kipte istemci yazısı ve dışarı
// konuşan/zamanlanan iş OLMAMALI.
//
// NE ÖLÇER:
//   §1 kip anahtarı: yalnız "1" (boş · "0" · "true" kip değil — normal açılış bugünkü gibi)
//   §2 ⭐ `server.ts` açılışı: her `start*` çağrısı İKİ listeden BİRİNDE (iki yönlü) · atlananlar `if (!VERIFYING)`
//      ardında · koşanlar koşulsuz · HOST doğrulamada 127.0.0.1 (`.env` genişletemez)
//   §3 ⭐ lisans motoru: doğrulamada yerel ölçüm (bütünlük dahil) BİTER, yoklama zamanlanmaz; lisans durumu yalnız
//      OKUNUR — kip dalı açılış yazımından önce, kapanış yazımı · iptal onarımı · parmak izi önbelleği kipte koşmaz
//      (davranış: `test_lisans_motoru` §34 dizin + DB izi bayt-eşit)
//   §4 ⭐ yerel sağlık adres kapısı: döngü adresi ✓ · LAN ✗ · vekil başlığı (döngüden gelse de) ✗
//   §5 bağlantı: `/health/yerel` önce adres kapısı; public `/health` donmuş kümesine lisans GİRMEZ
// NEGATİF SONDA (elle, geri alındı; commit mesajında).
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import { VERIFICATION_KEPT_JOBS, VERIFICATION_MODE_ENV, VERIFICATION_SKIPPED_JOBS, isVerificationMode } from "../src/lib/dogrulama-kipi";
import { isDirectLoopback } from "../src/lib/yerel-saglik";

const KOK = path.resolve(__dirname, "..");
const oku = (rel: string) => fs.readFileSync(path.join(KOK, rel), "utf8");

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}

function kipAnahtari(): void {
  console.log("\n§1 kip anahtarı");
  check("§1a \"1\" → doğrulama kipi", isVerificationMode({ [VERIFICATION_MODE_ENV]: "1" }));
  check("§1b yok · boş · \"0\" · \"true\" · \" 1\" → kip DEĞİL", [undefined, "", "0", "true", " 1"].every((v) => !isVerificationMode(v === undefined ? {} : { [VERIFICATION_MODE_ENV]: v })));
}

/** `startLanListener`in dinleyici geri çağrısı (`app.listen(` sonrası) — açılış işleri burada. */
function dinleyiciGovdesi(src: string): string {
  const bas = src.indexOf("app.listen(", src.indexOf("function startLanListener"));
  const son = src.indexOf("\n}\n", bas);
  return bas < 0 || son < 0 ? "" : src.slice(bas, son);
}

function acilis(): void {
  console.log("\n§2 server.ts açılış işleri");
  const src = oku("src/server.ts");
  const govde = dinleyiciGovdesi(src);
  check("§2a dinleyici gövdesi çözülebildi (körlük zemini)", govde.length > 500);
  const cagrilar = [...govde.matchAll(/\b(start[A-Z]\w*)\(/g)].map((m) => m[1]!);
  const bilinen = new Set<string>([...VERIFICATION_SKIPPED_JOBS, ...VERIFICATION_KEPT_JOBS]);
  const beyansiz = [...new Set(cagrilar)].filter((c) => !bilinen.has(c));
  check("§2b ⭐ her start* çağrısı beyanlı (atlanan ∨ koşan) — yeni iş sınıfsız giremez", beyansiz.length === 0, beyansiz.join(", ") || `${new Set(cagrilar).size} iş`);
  const olu = [...bilinen].filter((c) => !cagrilar.includes(c));
  check("§2c listede olup çağrılmayan iş yok (iki yönlü)", olu.length === 0, olu.join(", ") || "temiz");
  const korumasiz = VERIFICATION_SKIPPED_JOBS.filter((c) => !new RegExp(`if \\(!VERIFYING\\) (?:void )?${c}\\(`).test(govde));
  check("§2d ⭐ atlanan işler `if (!VERIFYING)` ardında", korumasiz.length === 0, korumasiz.join(", ") || `${VERIFICATION_SKIPPED_JOBS.length} iş`);
  const kosulsuzDegil = VERIFICATION_KEPT_JOBS.filter((c) => new RegExp(`if \\([^)]*VERIFYING[^)]*\\)[^\\n]*${c}\\(`).test(govde));
  check("§2e koşan işler koşulsuz (uzlaştırma doğrulamada da ölçülür)", kosulsuzDegil.length === 0, kosulsuzDegil.join(", ") || "temiz");
  check("§2f ⭐ HOST doğrulamada 127.0.0.1 (`.env` genişletemez)", /const LAN_HOST = VERIFYING \? "127\.0\.0\.1" : process\.env\.HOST \|\| "0\.0\.0\.0";/.test(src) && /const HOST = LAN_TLS\.httpHost;/.test(src));
  check("§2g kip tek kaynaktan (`isVerificationMode`)", /const VERIFYING = isVerificationMode\(\);/.test(src));
}

function lisansMotoru(): void {
  console.log("\n§3 lisans motoru");
  const src = oku("src/jobs/license-poll.job.ts");
  const bas = src.indexOf("async function bootstrap");
  const govde = src.slice(bas, src.indexOf("\n}\n", bas));
  const butunluk = govde.indexOf("await refreshIntegrityQuietly();");
  const kip = govde.indexOf("if (isVerificationMode())");
  const zamanla = govde.indexOf("schedule(withJitter(");
  const aralik = govde.indexOf("setInterval(");
  check("§3a gövde çözülebildi", bas > 0 && butunluk > 0 && zamanla > 0 && aralik > 0);
  check("§3b ⭐ doğrulama dalı bütünlük ölçümünden SONRA (sağlık sondasının `lisans`ı ölçülmüş olsun)", kip > butunluk);
  check("§3c ⭐ doğrulama dalı yoklama zamanlamasından ve tazeleme zamanlayıcılarından ÖNCE döner",
    kip > 0 && kip < zamanla && kip < aralik && /if \(isVerificationMode\(\)\) \{[\s\S]{0,400}?return;\s*\}/.test(govde));
  check("§3d motor CALISIYOR'a çıkar (yerel sağlık `lisans`ı bu durumu bekler)", /setLicenseEngineStatus\("CALISIYOR", "DOGRULAMA_KIPI"\)/.test(govde));
  const yazim = govde.indexOf("await licenseHousekeeping();");
  check("§3e ⭐ doğrulama dalı açılış yazımından (durum kaydı + DB izi) ÖNCE döner — lisans durumu yalnız okunur", kip > 0 && yazim > 0 && kip < yazim, `kip@${kip} yazım@${yazim}`);
  const durBas = src.indexOf("export function stopLicensePoll");
  const dur = durBas < 0 ? "" : src.slice(durBas, src.indexOf("\n}\n", durBas));
  const durCagri = [...dur.matchAll(/licenseHousekeeping\(/g)].length;
  check("§3f ⭐ kapanış yazımı doğrulama kipinde koşmaz", durCagri === 1 && /if \(!isVerificationMode\(\)\) void licenseHousekeeping\(/.test(dur), `${durCagri} çağrı`);
  const cagiranlar = srcDosyalari("src").filter((f) => !f.endsWith("license-trail.service.ts") && /\blicenseHousekeeping\(/.test(oku(f)));
  check("§3g yazımı çağıran tek dosya lisans yoklama işi (yeni çağıran kip dalını atlayamaz)", cagiranlar.length === 1 && cagiranlar[0] === "src/jobs/license-poll.job.ts", cagiranlar.join(", "));
  const iptal = oku("src/services/license-revocation.service.ts");
  const iBas = iptal.indexOf("export async function refreshLicenseRevocation");
  const iGovde = iBas < 0 ? "" : iptal.slice(iBas, iptal.indexOf("\n}\n", iBas));
  check("§3h ⭐ iptal kopyası onarımı doğrulama kipinde koşmaz (okuma kalır)", /if \(isVerificationMode\(\)\) return;\s*repairRevocationCopies\(/.test(iGovde) && iGovde.indexOf("setRevocationRow(") > 0);
  const esitleme = oku("src/services/license-sync.service.ts");
  const fBas = esitleme.indexOf("export async function refreshLicenseFingerprint");
  const fGovde = fBas < 0 ? "" : esitleme.slice(fBas, esitleme.indexOf("\n}\n", fBas));
  check("§3i ⭐ parmak izi önbelleği doğrulama kipinde yazılmaz (ölçüm ve okuma kalır)",
    /persistCache: !isVerificationMode\(\)/.test(fGovde) && /if \(dir && d\.changed && options\.persistCache !== false\)/.test(oku("src/lib/license/fingerprint.ts")));
}

/** `src` altındaki .ts dosyaları (KOK'a göreli). */
function srcDosyalari(rel: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(KOK, rel), { withFileTypes: true })) {
    const r = `${rel}/${e.name}`;
    if (e.isDirectory()) out.push(...srcDosyalari(r));
    else if (e.name.endsWith(".ts")) out.push(r);
  }
  return out;
}

function adresKapisi(): void {
  console.log("\n§4 yerel sağlık adres kapısı");
  const bos = {} as NodeJS.ProcessEnv;
  for (const a of ["127.0.0.1", "127.8.9.10", "::1", "::ffff:127.0.0.1"]) check(`§4a döngü adresi ${a} → yerel`, isDirectLoopback(a, {}, bos));
  for (const a of ["192.168.1.5", "10.0.0.1", "::ffff:10.0.0.1", "0.0.0.0", "", undefined, "127.0.0.1.evil"]) {
    check(`§4b ⭐ ${a === undefined ? "(yok)" : a || "(boş)"} → yerel DEĞİL`, !isDirectLoopback(a, {}, bos));
  }
  for (const h of ["x-forwarded-for", "forwarded", "x-real-ip", "via", "x-forwarded-host"]) {
    check(`§4c ⭐ döngüden gelse de '${h}' başlığı → yerel DEĞİL (vekil)`, !isDirectLoopback("127.0.0.1", { [h]: "1.2.3.4" }, bos));
  }
  check("§4d kurulumun beyan ettiği CLIENT_IP_HEADER da vekil sayılır", !isDirectLoopback("127.0.0.1", { "x-istemci-ip": "1.2.3.4" }, { CLIENT_IP_HEADER: "X-Istemci-Ip" } as NodeJS.ProcessEnv));
  check("§4e ilgisiz başlık kapıyı kapatmaz", isDirectLoopback("127.0.0.1", { "x-istemci-ip": "1.2.3.4", "user-agent": "tekserp-guncelleyici" }, bos));
}

function baglanti(): void {
  console.log("\n§5 bağlantı (statik)");
  const src = oku("src/app.ts");
  const bas = src.indexOf('app.get("/health/yerel"');
  const govde = bas < 0 ? "" : src.slice(bas, src.indexOf("\n});", bas));
  check("§5a /health/yerel var ve ilk iş adres kapısı (DB'ye bile dokunmadan önce)",
    govde.length > 0 && govde.indexOf("isDirectLoopback(req.socket.remoteAddress, req.headers)") > 0 && govde.indexOf("isDirectLoopback") < govde.indexOf("prisma."));
  check("§5b dışarıya 404 (uç varlığı söylenmez)", /if \(!isDirectLoopback[\s\S]{0,120}res\.status\(404\)/.test(govde));
  const pub = src.indexOf('app.get("/health"');
  const pubGovde = src.slice(pub, src.indexOf("});", src.indexOf("res.status(200).json({", pub)));
  check("§5c ⭐ public /health donmuş kümesine lisans GİRMEZ", pub > 0 && pub < bas && !pubGovde.includes("lisans") && !pubGovde.includes("localLicenseHealth"));
  check("§5d yerel sağlık /health'ten SONRA tanımlı (donmuş küme bekçilerinin çıpası ilk eşleşmeyi okur)", pub < bas);
}

function main(): void {
  console.log("=== DOĞRULAMA KİPİ + YEREL SAĞLIK ===");
  kipAnahtari();
  acilis();
  lisansMotoru();
  adresKapisi();
  baglanti();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
