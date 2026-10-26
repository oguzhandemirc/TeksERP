// =============================================================================
// BEKÇİ — HIZLI PIN SEÇİLEMEZ, HER ZAMAN RASTGELE (güvenlik denetimi Y-01)
// Çalıştır: npx tsx scripts/test_kimlik_pin_rastgele.ts [--sonda=secilen|--sonda=sema]
// =============================================================================
// NEDEN: salt-PIN girişinde PIN tek başına kimliktir ve sistem genelinde benzersizdir. Yönetici
// PIN'i elle seçebildiğinde "Bu PIN başka bir kullanıcıda tanımlı" (409) cevabı bir KÂHİNDİ:
// 6 haneyi tek tek deneyen biri başkalarının PIN'lerini öğrenip onların yerine girebiliyordu.
// Artık hiçbir uç PIN seçtirmez; eski panelin gönderdiği `pin` Zod'da düşer, rastgele döner.
//
// §1 servis: istenen PIN yok sayılır, dönen 6 hane rastgele; iki kullanıcı farklı PIN; 409 yok
// §2 statik: route şemalarında `pin` alanı yok · `assignQuickPin` tek parametre · kâhin iletisi
//    yok · panel tiplerinde `pin?` yok · QuickPinTab'da elle PIN alanı yok
// SONDA: --sonda=secilen → §1 istenen PIN'i kabul eden eski davranışı taklit eder (KIRMIZI olmalı)
//        --sonda=sema    → §2 bellek-içi şema metnine `pin:` ekler (KIRMIZI olmalı)
// =============================================================================
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import prisma from "../src/lib/prisma";
import { AuthService } from "../src/services/auth.service";

const SONDA = process.argv.find((a) => a.startsWith("--sonda="))?.slice("--sonda=".length) ?? null;
const KOK = resolve(__dirname, "..");
const MONO = resolve(KOK, "..");

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
const oku = (p: string) => readFileSync(p, "utf8");

/** `const <ad> = z.object({ … });` bloğunun metni (yoksa ""). */
export function zodBlok(metin: string, ad: string): string {
  const i = metin.indexOf(`const ${ad} = z.object({`);
  if (i < 0) return "";
  const j = metin.indexOf("\n});", i);
  return j < 0 ? "" : metin.slice(i, j);
}
/** Şema bloğu `pin` alanı tanımlıyor mu (yorum satırları hariç)? */
export function pinAlaniVar(blok: string): boolean {
  return blok.split("\n").some((l) => !l.trim().startsWith("//") && /^\s*pin\s*:/.test(l));
}

function statik() {
  console.log("\n=== §2 statik: hiçbir yüzey PIN seçtirmez ===");
  let adminRoutes = oku(resolve(KOK, "src/routes/admin.routes.ts"));
  if (SONDA === "sema") adminRoutes = adminRoutes.replace("const quickPinSchema = z.object({", "const quickPinSchema = z.object({\n  pin: z.string().optional(),");
  const qp = zodBlok(adminRoutes, "quickPinSchema");
  check("§2a quickPinSchema bulundu ve `pin` alanı YOK", qp !== "" && !pinAlaniVar(qp));
  const ap = zodBlok(oku(resolve(KOK, "src/routes/credential-reset.routes.ts")), "approveSchema");
  check("§2b approveSchema bulundu ve `pin` alanı YOK", ap !== "" && !pinAlaniVar(ap));
  const svc = oku(resolve(KOK, "src/services/short-credential.service.ts"));
  check("§2c assignQuickPin tek parametre (userId)", /static async assignQuickPin\(userId: string\): Promise<string>/.test(svc));
  check("§2d kâhin iletisi yok (\"başka bir kullanıcıda tanımlı\")", !svc.includes("başka bir kullanıcıda tanımlı"));
  const auth = oku(resolve(KOK, "src/services/auth.service.ts"));
  check("§2e setQuickPin girdisi yalnız { clear? }", /input: \{ clear\?: boolean \}/.test(auth) && !/input\.pin/.test(auth));
  const reset = oku(resolve(KOK, "src/services/credential-reset.service.ts"));
  check("§2f onay yükü PIN taşımaz", !/pin\?: string/.test(reset) && !/payload\.pin/.test(reset));
  // Yalnız GİRDİ tipleri ölçülür; sonuç tipindeki `pin?: string | null` (verilen PIN'in gösterimi) meşrudur.
  const adminSvc = oku(resolve(MONO, "Electron/src/services/adminUserService.ts"));
  const resetSvc = oku(resolve(MONO, "Electron/src/services/credentialResetService.ts"));
  check("§2g panel girdi tipleri PIN taşımaz (setQuickPin { clear? } · onay { password? })",
    /input: \{ clear\?: boolean \}/.test(adminSvc) && /payload: \{ password\?: string \}/.test(resetSvc));
  const tab = oku(resolve(MONO, "Electron/src/pages/Access/Users/QuickPinTab.tsx"));
  check("§2h QuickPinTab'da elle PIN alanı yok", !/manualPin|Elle PIN/.test(tab));
  // Sentetik: ölçüm yüklemi kör değil.
  check("§2s sentetik: `pin:` satırlı blok yakalanır, yorumdaki yakalanmaz",
    pinAlaniVar("const x = z.object({\n  pin: z.string(),") && !pinAlaniVar("const x = z.object({\n  // pin: eski"));
}

async function servis() {
  console.log("\n=== §1 servis: istenen PIN yok sayılır, rastgele döner ===");
  const ts = Date.now();
  const mk = async (ek: string) => prisma.user.create({
    data: { username: `test-pinr-${ek}-${ts}`, passwordHash: await AuthService.hashPassword("123456"), fullName: `TEST PIN ${ek}` },
    select: { id: true },
  });
  const kurban = await mk("kurban");
  const saldirgan = await mk("saldirgan");
  const ids = [kurban.id, saldirgan.id];
  try {
    const kurbanPin = (await AuthService.setQuickPin(kurban.id, {})).pin!;
    // Eski panel/saldırgan gövdesi: kurbanın PIN'ini ister. Tip dışı alan bilerek geçirilir.
    let donen: string | null = null;
    let hata: unknown = null;
    try {
      donen = (await AuthService.setQuickPin(saldirgan.id, { pin: kurbanPin } as { clear?: boolean })).pin;
    } catch (e) {
      hata = e;
    }
    if (SONDA === "secilen") { donen = kurbanPin; hata = null; } // eski davranışın taklidi
    check("§1a ⭐ başkasının PIN'i istenince 409 YOK (kâhin kapalı)", hata === null, hata instanceof Error ? hata.message : "");
    check("§1b ⭐ dönen PIN istenen değil, 6 hane", donen !== null && /^\d{6}$/.test(donen) && donen !== kurbanPin, donen ?? "");
    const ikinci = (await AuthService.setQuickPin(saldirgan.id, {})).pin!;
    check("§1c yenileme yine 6 hane ve kurbanınkinden farklı", /^\d{6}$/.test(ikinci) && ikinci !== kurbanPin);
  } finally {
    await prisma.systemLog.deleteMany({ where: { recordId: { in: ids } } }).catch(() => {});
    await prisma.session.deleteMany({ where: { userId: { in: ids } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
}

async function main() {
  statik();
  await servis();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
