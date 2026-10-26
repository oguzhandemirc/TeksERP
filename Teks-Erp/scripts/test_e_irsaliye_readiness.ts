// =============================================================================
// Test: e-İrsaliye HAZIRLIK KAPISI (E3-AYAR, plan §0.3 P1 / §3.5)
// =============================================================================
// Modül anahtarı yok; özellik künye + seri + bağdaştırıcı + yürürlük tarihiyle HAZIR olur.
// §1 varsayılan → YAPILANDIRILMAMIS · §2 tam yapılandırma → HAZIR · §3 tek tek bozulan koşul
// eksik listesine düşer (bozuk VKN, vergi dairesi boş, `yok`, tarih yok, seri GİB dışı, seri yok,
// TCKN'li göndericide kişi adı) · §4 okuma çöp değeri `yok`a düşer · §5 yazma fail-closed (Zod +
// servis) · §6 eksik cümleleri Türkçe ve yol tarifli · §7 AST: `src/` altında ikinci hazırlık
// yüklemi yok (desen: `EIRSALIYE_ACTIVE_ADAPTERS.has(` ve `readEIrsaliyeConfig(` yalnız helper'da).
// DB'ye YAZMAZ: hazırlık sahte istemciyle sorulur; §8 gerçek DB'de yalnız okur.
//
// NEGATİF SONDALAR (2026-10-24, cp+md5 ile geri alındı):
//   ① helper'da VKN sağlaması `k.kimlikNo.length === 10` ile değiştirildi → §3a ❌ (bozuk VKN HAZIR çıktı).
//   ② `src/services/shipping.service.ts`e `EIRSALIYE_ACTIVE_ADAPTERS.has(` satırı eklendi → §7 ❌.
//
// Çalıştır: npx tsx scripts/test_e_irsaliye_readiness.ts
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import prisma from "../src/lib/prisma";
import { SETTING_KEYS, systemSettingService } from "../src/services/system-setting.service";
import { resolveEIrsaliyeReadiness } from "../src/services/e-irsaliye/e-irsaliye-readiness.helper";
import {
  validateEIrsaliyeConfigInput,
  DEFAULT_COMPANY_LEGAL_IDENTITY,
  readEIrsaliyeConfigValue,
  sanitizeCompanyLegalIdentity,
} from "../src/services/e-irsaliye/e-irsaliye-settings";
import { updateSchema } from "../src/routes/feature-flag.routes";
import { git } from "./lib/git";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

// Sağlaması tutan örnekler (tax-id.ts altın örnekleriyle aynı algoritma; gerçek kişi/firma değil).
const VKN_OK = "1234567890".slice(0, 9) + vknCheck("123456789");
const TCKN_OK = "10000000146";

function vknCheck(nine: string): string {
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const t = (Number(nine[i]) + 9 - i) % 10;
    sum += t === 9 ? 9 : (t * 2 ** (9 - i)) % 9;
  }
  return String((10 - (sum % 10)) % 10);
}

type Row = { prefix: string; dateSegment: string; digits: number; separator: string; separator2: string | null };
const GIB_SERIES: Row = { prefix: "EIR", dateSegment: "YYYY", digits: 9, separator: "", separator2: null };

/** Sahte istemci: ayar ve seri satırını bellekten verir — gerçek DB'ye dokunmaz. */
function fakeDb(settings: Record<string, unknown>, series: Row | null) {
  return {
    systemSetting: {
      findUnique: async ({ where }: { where: { key: string } }) =>
        where.key in settings ? { value: settings[where.key] } : null,
    },
    numberSeries: { findUnique: async () => series },
  } as unknown as Parameters<typeof resolveEIrsaliyeReadiness>[0];
}

const FULL_ID = { ...DEFAULT_COMPANY_LEGAL_IDENTITY, kimlikNo: VKN_OK, unvan: "Örnek Tekstil A.Ş.", vergiDairesi: "Bursa", il: "Bursa", ilce: "Osmangazi" };
const FULL_CFG = { adapter: "disaAktar", yururlukTarihi: "2026-11-01" };
const full = (id: object = FULL_ID, cfg: object = FULL_CFG, series: Row | null = GIB_SERIES) =>
  resolveEIrsaliyeReadiness(fakeDb({ [SETTING_KEYS.COMPANY_LEGAL_IDENTITY]: id, [SETTING_KEYS.EIRSALIYE_CONFIG]: cfg }, series));

async function main() {
  console.log("\n§1 varsayılan (ayar satırı yok) → YAPILANDIRILMAMIS");
  const d = await resolveEIrsaliyeReadiness(fakeDb({}, GIB_SERIES));
  check("§1a durum YAPILANDIRILMAMIS", d.durum === "YAPILANDIRILMAMIS");
  check("§1b üç eksik: künye · gönderim yöntemi · yürürlük tarihi", d.eksikler.length === 3, d.eksikler.join(" | "));
  const d0 = await resolveEIrsaliyeReadiness(fakeDb({}, null));
  check("§1c seri satırı da yoksa dört eksik", d0.eksikler.length === 4);

  console.log("\n§2 tam yapılandırma → HAZIR");
  const h = await full();
  check("§2a HAZIR, eksik yok", h.durum === "HAZIR" && h.eksikler.length === 0, h.eksikler.join(" | "));
  const ht = await full({ ...FULL_ID, kimlikTuru: "TCKN", kimlikNo: TCKN_OK, kisiAd: "Ayşe", kisiSoyad: "Yılmaz" }, { adapter: "simulasyon", yururlukTarihi: "2026-11-01" });
  check("§2b TCKN'li gönderici + simülasyon → HAZIR", ht.durum === "HAZIR", ht.eksikler.join(" | "));

  console.log("\n§3 tek bozuk koşul → eksik");
  const only = async (label: string, r: Promise<{ durum: string; eksikler: string[] }>, needle: string) => {
    const x = await r;
    check(label, x.durum === "YAPILANDIRILMAMIS" && x.eksikler.length === 1 && x.eksikler[0]!.includes(needle), x.eksikler.join(" | "));
  };
  const badVkn = VKN_OK.slice(0, 9) + String((Number(VKN_OK[9]) + 1) % 10);
  await only("§3a sağlaması tutmayan VKN", full({ ...FULL_ID, kimlikNo: badVkn }), "VKN geçersiz");
  await only("§3b vergi dairesi boş", full({ ...FULL_ID, vergiDairesi: "" }), "vergi dairesi");
  await only("§3c bağdaştırıcı `yok`", full(FULL_ID, { adapter: "yok", yururlukTarihi: "2026-11-01" }), "gönderim yöntemi");
  await only("§3d yürürlük tarihi yok", full(FULL_ID, { adapter: "disaAktar", yururlukTarihi: null }), "yürürlük tarihi");
  await only("§3e seri ön eki GİB dışı (DB'de elle bozulmuş: 4 karakter)", full(FULL_ID, FULL_CFG, { ...GIB_SERIES, prefix: "EIRS" }), "GİB biçiminde değil");
  await only("§3f seri hanesi GİB dışı (6 hane)", full(FULL_ID, FULL_CFG, { ...GIB_SERIES, digits: 6 }), "GİB biçiminde değil");
  await only("§3g seri satırı yok", full(FULL_ID, FULL_CFG, null), "tanımlı değil");
  await only("§3h TCKN'li göndericide kişi adı yok", full({ ...FULL_ID, kimlikTuru: "TCKN", kimlikNo: TCKN_OK }), "kişi adı");
  await only("§3i il/ilçe boş", full({ ...FULL_ID, il: "", ilce: "" }), "il, ilçe");
  await only("§3j VKN türünde 11 haneli numara", full({ ...FULL_ID, kimlikNo: TCKN_OK }), "VKN geçersiz");

  console.log("\n§4 okuma: çöp değer varsayılana düşer");
  check("§4a tanınmayan adapter → `yok`", readEIrsaliyeConfigValue({ adapter: "logo", yururlukTarihi: "2026-11-01" }).adapter === "yok");
  check("§4b 31 Şubat → null", readEIrsaliyeConfigValue({ adapter: "disaAktar", yururlukTarihi: "2026-02-31" }).yururlukTarihi === null);
  check("§4c dizi/metin değer → varsayılan", readEIrsaliyeConfigValue("x").adapter === "yok" && readEIrsaliyeConfigValue([1]).adapter === "yok");
  const junk = await full(FULL_ID, { adapter: "logo", yururlukTarihi: "2026-11-01" });
  check("§4d çöp adapter hazırlıkta eksik", junk.durum === "YAPILANDIRILMAMIS");
  const s = sanitizeCompanyLegalIdentity({ kimlikNo: " 123 456 7890 ", ulke: "tr", fazla: "x", unvan: 5 });
  check("§4e künye temizliği: rakam süzme, ülke büyük harf, bilinmeyen alan atılır, tip dışı boş", s.kimlikNo === "1234567890" && s.ulke === "TR" && !("fazla" in s) && s.unvan === "");

  console.log("\n§5 yazma fail-closed");
  const z1 = updateSchema.safeParse({ eIrsaliyeConfig: { adapter: "logo", yururlukTarihi: null } });
  check("§5a Zod: tanınmayan bağdaştırıcı 400 + Türkçe", !z1.success && JSON.stringify(z1.error.issues).includes("Bağdaştırıcı tanınmıyor"));
  const z2 = updateSchema.safeParse({ eIrsaliyeConfig: { adapter: "disaAktar", yururlukTarihi: "2026-13-01" } });
  check("§5b Zod: bozuk tarih 400", !z2.success);
  const z3 = updateSchema.safeParse({ companyLegalIdentity: { kimlikTuru: "VKN", gizli: "x" } });
  check("§5c Zod: künyede tanınmayan alan 400", !z3.success && JSON.stringify(z3.error.issues).includes("tanınmayan alan"));
  const z4 = updateSchema.safeParse({ companyLegalIdentity: { kimlikTuru: "VKN", kimlikNo: VKN_OK } });
  check("§5d Zod: kısmi künye kabul, eksik alan boş metin", z4.success && z4.data.companyLegalIdentity?.unvan === "");
  const v = validateEIrsaliyeConfigInput({ adapter: "logo", yururlukTarihi: null });
  check("§5e servis doğrulayıcısı Zod'u atlayan çağrıda da reddeder (`yok`a düşürmez)", !v.ok && v.message.includes("Bağdaştırıcı tanınmıyor"));
  const svc = readFileSync(path.resolve(__dirname, "../src/services/system-setting.service.ts"), "utf8");
  const branch = svc.slice(svc.indexOf('hasOwnProperty.call(input, "eIrsaliyeConfig")'), svc.indexOf("SETTING_KEYS.EIRSALIYE_CONFIG,"));
  check("§5f servisin yazma dalı doğrulayıcıyı çağırıp 400 atar", branch.includes("validateEIrsaliyeConfigInput(") && branch.includes("AppError.badRequest"));

  console.log("\n§6 eksik cümleleri: Türkçe, yol tarifli, teknik ad yok");
  const all = [...d0.eksikler, ...(await full({ ...FULL_ID, kimlikNo: "" })).eksikler];
  check("§6a her cümle menü yolu taşır", all.every((m) => m.includes("Sistem →")), all.join(" | "));
  check("§6b teknik ad sızmıyor", all.every((m) => !/eIrsaliye\.|legalIdentity|adapter|disaAktar|numberSeries|_/.test(m)));

  console.log("\n§7 AST: ikinci hazırlık yüklemi yok");
  const repo = path.resolve(__dirname, "../..");
  const grep = (pat: string) => {
    try {
      return git(["grep", "--untracked", "-l", "-E", pat, "--", "Teks-Erp/src"], { cwd: repo, stdio: "yut" }).trim().split("\n").filter(Boolean);
    } catch {
      return []; // git grep eşleşme yoksa 1 ile çıkar; §7c tarayıcının boşa düşmediğini ayrıca ölçer

    }
  };
  const HELPER = "Teks-Erp/src/services/e-irsaliye/e-irsaliye-readiness.helper.ts";
  const adapterSet = grep("EIRSALIYE_ACTIVE_ADAPTERS\\.has\\(");
  check("§7a bağdaştırıcı tanıma yalnız helper'da", adapterSet.length === 1 && adapterSet[0] === HELPER, adapterSet.join(", "));
  // Ayarın ham okuyucusu yalnız yük (getFeatureFlags) ve helper'da; başka yer okursa kendi hazırlık cevabını kuruyordur.
  const SERVICE = "Teks-Erp/src/services/system-setting.service.ts";
  const readers = grep("readEIrsaliyeConfig\\(").filter((f) => f !== SERVICE);
  check("§7b e-İrsaliye ayarının ham okuyucusu helper dışında çağrılmıyor", readers.length === 1 && readers[0] === HELPER, readers.join(", "));
  check("§7c tarayıcı boşa düşmedi (helper bulundu)", adapterSet.includes(HELPER));

  console.log("\n§8 gerçek DB (salt okuma)");
  const real = await resolveEIrsaliyeReadiness();
  check("§8a gerçek okuyucularla cevap üretiliyor", real.durum === "HAZIR" || real.durum === "YAPILANDIRILMAMIS", real.durum);
  const flags = (await systemSettingService.getFeatureFlags()).data!;
  check("§8b feature-flag yükü iki yeni alanı taşır", typeof flags.companyLegalIdentity === "object" && typeof flags.eIrsaliyeConfig?.adapter === "string");
}

main()
  .catch((e) => { fail++; console.error(e); })
  .finally(async () => {
    await prisma.$disconnect();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
