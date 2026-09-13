// =============================================================================
// KURULUM PROFİLLERİ + PROFİL JOB'U — SÖZLEŞME BEKÇİSİ (2026-09-03 / P6)
// =============================================================================
// `src/constants/module-profiles.ts` beş kurulum profilinin TEK KAYNAĞIDIR ve
// `src/jobs/module-profile.job.ts` onu TAZE kuruluma bir kez uygular. Bu bekçi
// üç ayrı şeyi sorar:
//   ① SABİT — profiller tam mı, tipleri doğru mu, bağımlılık ihlali var mı,
//      tasarım §10 tablosuyla hizalı mı?
//   ② KOD — job boot'a kayıtlı mı, açıklama metinleri üç yazarda birebir mi?
//   ③ CANLI — "satır varsa DOKUNMA" gerçekten öyle mi (test DB'sinde ölçülür)?
//
// ⚠️ §7 CANLI YAZAR: bir modül anahtarını siler, job'u koşturur, geri yazar.
// `hedefDbEngeli()` üretim adlarını durdurur; `finally` bulunan değere döner.
//
// Koşum: DATABASE_URL=… JWT_SECRET=… npx tsx scripts/test_module_profile.ts
//        (§10'un HTTP ayağı için ayrıca: PORT=4122 … npx tsx src/server.ts &
//         → TEST_API_URL=http://localhost:4122)
//
// NEGATİF SONDALAR — 2026-09-03'te koşuldu (cp + md5 ile birebir geri alındı;
// taban 57/0). Bozma komutları ve ölçülen kırmızılar:
//   SONDA-B1 → çıkış 1 · 1 ❌ · §2a — `basit` profilinden `tezgah.enabled` silindi
//   SONDA-B2 → çıkış 1 · 3 ❌ · §4a + §4b + §7b — `tam` profilinde ticaret KAPALI
//              (bağımlılık ihlali → job da `invalid` döndü, yani kapı ZİNCİRLİ)
//   SONDA-B3 → çıkış 1 · 1 ❌ · §5a — `server.ts`ten `startModuleProfileJob();` silindi
//   SONDA-B4 → çıkış 1 · 2 ❌ · §1c + §6b — `MODULE_DESCRIPTIONS["iplik.enabled"]`
//              servis metninden ayrıştırıldı ("İplik")
//   SONDA-B5 → çıkış 1 · 4 ❌ · §5c + §7b + §7c + §9c — `createMany({skipDuplicates})`
//              → `upsert.update` döngüsü (satır varken EZER)
// ⚠️ SONDA-B5 CANLI VERİYİ DE BOZAR: bozuk job yedi satırın DEĞERİNİ ezer ve bu
//    bekçinin `finally`si yalnız kendi dokunduğu iki satırı geri yazar. Bu sondayı
//    koşan kişi ÖNCE yedi satırı (değer + createdAt/updatedAt) SQL ile yedeklemeli;
//    yoksa `test_module_grandfathering §2d` kapsamı sessizce sıfıra düşer (ölçüldü).
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import prisma, { pool } from "../src/lib/prisma";
import { MODULE_DEPENDENCIES, MODULE_SETTING_KEYS } from "../src/constants/module-flags";
import {
  MODULE_DESCRIPTIONS,
  MODULE_FIELD_BY_SETTING_KEY,
  MODULE_PROFILES,
  MODULE_PROFILE_IDS,
  isModuleProfileId,
} from "../src/constants/module-profiles";
import { PROFILE_STAMP_SETTING_KEY, isReservedSettingKey } from "../src/constants/reserved-settings";
import {
  assertProfileDependencies,
  ensureModuleProfile,
  readProfileEnv,
} from "../src/jobs/module-profile.job";
import { migrationDamgaDegerleri, yorumlariSok } from "./lib/regime-gate-scan";
import { hedefDbAdi, hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { httpBekciKapisi } from "./lib/http-bekci-kapisi";

let pass = 0,
  fail = 0,
  atlanan = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}
function atla(label: string, neden: string): void {
  atlanan++;
  console.log(`⏭️  ${label} — ${neden}`);
}

const KOK = path.resolve(__dirname, "..");
const SRC = path.join(KOK, "src");
const SERVIS = path.join(SRC, "services/system-setting.service.ts");
const SERVER = path.join(SRC, "server.ts");
const JOB = path.join(SRC, "jobs/module-profile.job.ts");
const ADMIN_ROUTES = path.join(SRC, "routes/admin.routes.ts");
const MIGRASYON = path.join(
  KOK,
  "prisma/migrations/20260902230000_modul_anahtarlari_grandfathering/migration.sql",
);
const BASE = process.env.TEST_API_URL ?? "http://localhost:4122";

/** `this.set(SETTING_KEYS.X, input.Y, "AÇIKLAMA", …)` → { camelCase: açıklama }. */
function servisAciklamalari(): Map<string, string> {
  const kod = yorumlariSok(fs.readFileSync(SERVIS, "utf8"));
  const out = new Map<string, string>();
  const re = /this\.set\(\s*SETTING_KEYS\.([A-Z0-9_]+),\s*input\.([A-Za-z0-9_]+),\s*"([^"]+)"/g;
  for (const m of kod.matchAll(re)) out.set(m[2]!, m[3]!);
  return out;
}

/**
 * TASARIM §10 TABLOSU — kod anahtarı olan yedi sütun, ELLE yazıldı.
 *
 * ⚠️ Sabitten TÜRETİLMEZ (o zaman kontrol vakumen yeşil olurdu): bu, belgeden
 * okunan bağımsız bir ikinci beyandır. Sabit değişirse tablo da bilinçli
 * değişmeli — profil kümesini "kazara" genişletmek bir ürün kararıdır.
 */
const TASARIM_S10: Record<string, string[]> = {
  basit: ["production.enabled"],
  standart: ["production.enabled", "finance.enabled", "ticaret.enabled"],
  perde: ["production.enabled", "finance.enabled", "kumasTeknik.enabled"],
  // 2026-09-12 — hedef kitle kararı: DOKUYAN perdeci ayrı satır. Mevcut `perde`
  // (kumaşı hazır alan kurulum) bilinçle DEĞİŞMEDİ; tezgah izleme Faz 4'te açılır.
  // 2026-09-13 — dokuma işi anahtarı: dokuyan perdeci ve dokuma profili AÇAR (1e ürün
  // kararı); `basit` (referans) KAPALI kalır — varsayılan = bugünkü davranış.
  "perde-dokuma": [
    "production.enabled",
    "finance.enabled",
    "ticaret.enabled",
    "iplik.enabled",
    "kumasTeknik.enabled",
    "devere.enabled",
    "dokuma.enabled",
  ],
  dokuma: [
    "production.enabled",
    "finance.enabled",
    "ticaret.enabled",
    "iplik.enabled",
    "kumasTeknik.enabled",
    "tezgah.enabled",
    "devere.enabled",
    "dokuma.enabled",
  ],
  tam: [...MODULE_SETTING_KEYS],
};

async function main(): Promise<void> {
  console.log("=== KURULUM PROFİLLERİ + PROFİL JOB'U ===\n");
  const beklenen = [...MODULE_SETTING_KEYS].sort();

  // ── §1 KÖRLÜK ZEMİNİ ──────────────────────────────────────────────────────
  check(
    "§1a Körlük zemini: profil kataloğu okunabildi",
    MODULE_PROFILE_IDS.length >= 2,
    `${MODULE_PROFILE_IDS.length} profil → ${MODULE_PROFILE_IDS.join(", ")}`,
  );
  // 2026-09-13: dokuz anahtar (dokuma.enabled ekran dilimiyle doğdu).
  check("§1b Körlük zemini: MODULE_SETTING_KEYS dolu", beklenen.length === 9, `n=${beklenen.length}`);
  check(
    "§1c Körlük zemini: açıklama sabiti dokuz anahtarı da taşıyor",
    beklenen.every((k) => (MODULE_DESCRIPTIONS[k] ?? "").length > 5),
    `n=${Object.keys(MODULE_DESCRIPTIONS).length}`,
  );
  check("§1d Körlük zemini: job kaynağı okunabildi", fs.existsSync(JOB) && fs.statSync(JOB).size > 3000);

  // ── §2 ⭐ TAMLIK: her profil YEDİ anahtarı da taşır ────────────────────────
  const eksikli: string[] = [];
  const fazlali: string[] = [];
  for (const id of MODULE_PROFILE_IDS) {
    const m = MODULE_PROFILES[id].moduller;
    const anahtarlar = Object.keys(m).sort();
    const eksik = beklenen.filter((k) => !(k in m));
    const fazla = anahtarlar.filter((k) => !MODULE_SETTING_KEYS.has(k));
    if (eksik.length) eksikli.push(`${id}: ${eksik.join(", ")}`);
    if (fazla.length) fazlali.push(`${id}: ${fazla.join(", ")}`);
  }
  check(
    "§2a ⭐ Her profil YEDİ modül anahtarını da taşıyor (eksik yok)",
    eksikli.length === 0,
    eksikli.length
      ? `EKSİK: ${eksikli.join(" · ")} — eksik anahtar "kod varsayılanına düşsün" demektir ve o ` +
        "varsayılan profil tablosunda GÖRÜNMEZ"
      : `${MODULE_PROFILE_IDS.length} profil × ${beklenen.length} anahtar`,
  );
  check(
    "§2b Profillerde yabancı anahtar yok",
    fazlali.length === 0,
    fazlali.join(" · "),
  );
  check(
    "§2c Davranış bayrağı bloğu BOŞ (iki yazar kuralı — seed zaten yazıyor)",
    MODULE_PROFILE_IDS.every((id) => Object.keys(MODULE_PROFILES[id].bayraklar).length === 0),
    MODULE_PROFILE_IDS.filter((id) => Object.keys(MODULE_PROFILES[id].bayraklar).length > 0).join(", "),
  );

  // ── §3 ⭐ ŞEMA: değerler JS boolean (string "true" KABUL EDİLMEZ) ──────────
  const tipBozuk: string[] = [];
  for (const id of MODULE_PROFILE_IDS) {
    for (const [k, v] of Object.entries(MODULE_PROFILES[id].moduller)) {
      if (typeof v !== "boolean") tipBozuk.push(`${id}.${k}=${JSON.stringify(v)}`);
    }
  }
  check(
    "§3a ⭐ Her profil değeri JS boolean (satır jsonb BOOLEAN doğmalı)",
    tipBozuk.length === 0,
    tipBozuk.join(", "),
  );
  check(
    "§3b Profil kimliği doğrulayıcısı çalışıyor (bilinmeyen değer reddedilir)",
    MODULE_PROFILE_IDS.every((id) => isModuleProfileId(id)) && !isModuleProfileId("yok-boyle"),
  );

  // ── §4 ⭐ BAĞIMLILIK + TASARIM §10 HİZASI ──────────────────────────────────
  for (const id of MODULE_PROFILE_IDS) {
    const ihlaller = assertProfileDependencies(
      MODULE_PROFILES[id].moduller as Record<string, boolean>,
    );
    check(
      `§4a ⭐ "${id}" profili modül bağımlılığını sağlıyor`,
      ihlaller.length === 0,
      ihlaller.length
        ? `${ihlaller.join(" · ")} — tutarsız çift panelde "açık" gösterirken uç 403 verir`
        : "",
    );
  }
  for (const id of MODULE_PROFILE_IDS) {
    const acik = Object.entries(MODULE_PROFILES[id].moduller)
      .filter(([, v]) => v === true)
      .map(([k]) => k)
      .sort();
    const bekle = [...(TASARIM_S10[id] ?? [])].sort();
    check(
      `§4b ⭐ "${id}" profili tasarım §10 satırıyla birebir`,
      JSON.stringify(acik) === JSON.stringify(bekle),
      `açık=[${acik.join(", ")}] beklenen=[${bekle.join(", ")}]`,
    );
  }
  check(
    "§4c Körlük zemini: bağımlılık haritası dolu (yüklem vakumen yeşil değil)",
    Object.keys(MODULE_DEPENDENCIES).length >= 2,
    Object.entries(MODULE_DEPENDENCIES)
      .map(([a, b]) => `${a}→${b}`)
      .join(", "),
  );
  // Yüklemin GERÇEKTEN ölçtüğünü kanıtla: bilerek bozuk bir küme kırmızı vermeli.
  const sahteIhlal = assertProfileDependencies({
    "production.enabled": true,
    "finance.enabled": false,
    "ticaret.enabled": false,
    "iplik.enabled": true,
    "depo.multiEnabled": false,
    "kumasTeknik.enabled": false,
    "tezgah.enabled": false,
  });
  check(
    "§4d ⭐ `assertProfileDependencies` bozuk kümeyi YAKALIYOR (etkisiz sonda değil)",
    sahteIhlal.length === 1 && sahteIhlal[0]!.includes("iplikEnabled"),
    sahteIhlal.join(" · ") || "hiç ihlal görmedi — yüklem kör",
  );
  const eslemeEksik = beklenen.filter((k) => !MODULE_FIELD_BY_SETTING_KEY[k]);
  check(
    "§4e DB anahtarı ↔ alan adı eşlemesi tam (bağımlılık yüklemi bunu okur)",
    eslemeEksik.length === 0,
    eslemeEksik.join(", "),
  );

  // ── §5 ⭐ JOB BOOT'A KAYITLI (metinde) ─────────────────────────────────────
  const serverKod = yorumlariSok(fs.readFileSync(SERVER, "utf8"));
  check(
    "§5a ⭐ `server.ts` `startModuleProfileJob()` çağırıyor",
    /startModuleProfileJob\(\s*\)/.test(serverKod),
    "dinamik/döngüsel kayıt bekçiyi KÖR bırakır (module.middleware'in jenerik-fabrika yasağının ikizi)",
  );
  check(
    "§5b `server.ts` job'u import ediyor",
    /from '\.\/jobs\/module-profile\.job'/.test(serverKod) ||
      /from "\.\/jobs\/module-profile\.job"/.test(serverKod),
  );
  const jobKod = yorumlariSok(fs.readFileSync(JOB, "utf8"));
  check(
    "§5c ⭐ Job `createMany` + `skipDuplicates` kullanıyor (upsert.update DEĞİL)",
    /createMany\(/.test(jobKod) && /skipDuplicates:\s*true/.test(jobKod),
    "modül satırlarına `update` yazmak fabrikanın panelden verdiği kararı her restart'ta geri alır",
  );
  const modulUpsert = /systemSetting\.upsert\(/.test(jobKod);
  check(
    "§5d Job'un tek `upsert`i DAMGA satırı (modül anahtarı upsert'i YOK)",
    modulUpsert && jobKod.includes("PROFILE_STAMP_SETTING_KEY"),
  );
  check(
    "§5e ⭐ Damga anahtarı ham ayar ucundan YAZILAMAZ (K7 sınıfı)",
    isReservedSettingKey(PROFILE_STAMP_SETTING_KEY),
    "yazılabilseydi `admin:settings` taşıyan bir admin Sistem Profili ekranını yanıltabilirdi",
  );

  // ── §6 ⭐ AÇIKLAMA ÜÇLÜSÜ: sabit ↔ servis ↔ migration BİREBİR ──────────────
  const servisAcik = servisAciklamalari();
  check(
    "§6a Körlük zemini: servis açıklamaları ayrıştırıldı",
    servisAcik.size >= 20,
    `n=${servisAcik.size}`,
  );
  const servisSapan: string[] = [];
  for (const dbKey of beklenen) {
    const alan = MODULE_FIELD_BY_SETTING_KEY[dbKey]!;
    const s = servisAcik.get(alan);
    if (s !== MODULE_DESCRIPTIONS[dbKey]) {
      servisSapan.push(`${dbKey}: sabit="${MODULE_DESCRIPTIONS[dbKey]}" servis="${s ?? "—"}"`);
    }
  }
  check(
    "§6b ⭐ MODULE_DESCRIPTIONS ↔ `setFeatureFlags` metinleri BİREBİR",
    servisSapan.length === 0,
    servisSapan.length
      ? `${servisSapan.join(" · ")} — ayrışırsa AYNI satır taze kurulumda bir açıklamayla, ` +
        "panelden ilk düzenlemeden sonra BAŞKASIYLA görünür"
      : `${beklenen.length} anahtar`,
  );
  const sql = fs.readFileSync(MIGRASYON, "utf8");
  const damgalananlar = migrationDamgaDegerleri(sql);
  check(
    "§6c Körlük zemini: migration damgası ayrıştırıldı",
    damgalananlar.size >= 6,
    `${damgalananlar.size} anahtar`,
  );
  const migSapan = beklenen
    .filter((k) => damgalananlar.has(k))
    .filter((k) => !sql.includes(MODULE_DESCRIPTIONS[k]!));
  check(
    "§6d ⭐ MODULE_DESCRIPTIONS ↔ grandfathering migration metinleri BİREBİR",
    migSapan.length === 0,
    migSapan.length
      ? `migration'da bulunamayan açıklama: ${migSapan.join(", ")}`
      : `${beklenen.filter((k) => damgalananlar.has(k)).length} damgalı anahtar`,
  );
  check(
    "§6e Job açıklamayı SABİTTEN okuyor (kendi metnini yazmıyor)",
    /description:\s*MODULE_DESCRIPTIONS\[/.test(jobKod),
    "job kendi literal metnini yazsaydı üçüncü yazar doğardı ve bekçi ancak sapma sahaya çıktıktan sonra görürdü",
  );

  // ── §8 ENV SÖZLEŞMESİ (saf, DB'siz) ───────────────────────────────────────
  check("§8a Boş env → absent", readProfileEnv({}).kind === "absent");
  check(
    "§8b Boşluklu değer → absent (yazım kazası kalıcı profil damgalamaz)",
    readProfileEnv({ TEKSERP_PROFIL: "   " }).kind === "absent",
  );
  const gecersiz = readProfileEnv({ TEKSERP_PROFIL: "yok-boyle" });
  check(
    "§8c ⭐ Tanınmayan profil → invalid (sessiz varsayılana DÜŞMEZ)",
    gecersiz.kind === "invalid" && gecersiz.reasons.length > 0,
    gecersiz.kind === "invalid" ? gecersiz.reasons.join(" · ") : `kind=${gecersiz.kind}`,
  );
  check(
    "§8d Geçerli profiller okunuyor",
    MODULE_PROFILE_IDS.every((id) => {
      const r = readProfileEnv({ TEKSERP_PROFIL: id });
      return r.kind === "ok" && r.profil === id;
    }),
  );
  check(
    "§8e `readProfileEnv` SAF (process.env mutasyonu yok)",
    !/process\.env\s*\[/.test(jobKod) && !/process\.env\.[A-Z_]+\s*=/.test(jobKod),
  );

  // ── §10 `GET /api/admin/module-profile` (statik + opsiyonel HTTP) ──────────
  const rotaKod = yorumlariSok(fs.readFileSync(ADMIN_ROUTES, "utf8"));
  const rotaIdx = rotaKod.indexOf('"/module-profile"');
  check("§10a Uç kayıtlı (`GET /api/admin/module-profile`)", rotaIdx > 0);
  const rotaGovde = rotaIdx > 0 ? rotaKod.slice(rotaIdx, rotaIdx + 3500) : "";
  check(
    "§10b Uç `admin:settings` ile korunuyor",
    /requirePermission\("admin:settings"\)/.test(rotaGovde),
  );
  check(
    "§10c Yanıt üç bölüm taşıyor (profiles · current · diffs)",
    /profiles,/.test(rotaGovde) && /current:/.test(rotaGovde) && /diffs,/.test(rotaGovde),
  );
  check(
    "§10d ⭐ Tam eşleşme yoksa `\"ozel\"` (kısmi benzerliğe profil adı verilmez)",
    /\?\?\s*"ozel"/.test(rotaGovde),
  );
  check(
    "§10e ⭐ Uç yalnız modül + damga anahtarlarını okuyor (`security.` sızmaz)",
    rotaGovde.includes("MODULE_SETTING_KEYS") &&
      rotaGovde.includes("PROFILE_STAMP_SETTING_KEY") &&
      !/systemSettingService\.list\(/.test(rotaGovde),
    "`list()` çağrılsaydı tüm ayar satırları bu uçtan da dökülürdü",
  );

  // ── §7 + §9 CANLI ÖLÇÜM ───────────────────────────────────────────────────
  const engel = hedefDbEngeli();
  if (engel) {
    atla("§7/§9 canlı ölçüm", engel);
  } else {
    await canliOlcum(beklenen);
  }

  await httpTuru();

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${atlanan ? `, ${atlanan} atlandı` : ""} ===`);
}

/**
 * §7 "SATIR VARSA DOKUNMA" + §9 "DAMGA YALNIZ YAZILDIĞINDA" — CANLI.
 *
 * ⚠️ Ölçüm bir satırı gerçekten SİLER ve `finally`de bulunan değere geri yazar
 * (`fixture-module-flags` disiplini). Silinen satır bilerek `tezgah.enabled`:
 * hiçbir route'un kapısı ona bağlı değil (yer tutucu), yani ölçüm penceresinde
 * paralel bir istek etkilenmez.
 */
async function canliOlcum(beklenen: string[]): Promise<void> {
  console.log(`\n   Hedef DB: ${hedefDbAdi()}`);
  // ⚠️ ZAMAN DAMGALARI DA YEDEKLENİR ve GERİ YAZILIR. Prisma `create` yolu
  // `createdAt`/`updatedAt`i TAZELER; o hâliyle geri koymak satırı
  // `test_module_grandfathering §2d` gözünde "damgadan sonra değiştirilmiş"
  // yapar ve o bekçinin KAPSAMINI her koşumda bir satır daha daraltır (aynı
  // etkileşim `test_module_flag_off` için başlığında yazılı). Ham SQL ile geri
  // yazmak "bulunan hâle dön" disiplininin tam karşılığıdır.
  const oncekiler = await prisma.$queryRaw<
    Array<{
      key: string;
      value: unknown;
      description: string | null;
      createdAt: Date;
      updatedAt: Date;
      updatedById: string | null;
    }>
  >`SELECT "key", "value", "description", "createdAt", "updatedAt", "updatedById"
      FROM system_settings
     WHERE "key" = ANY(${[...beklenen, PROFILE_STAMP_SETTING_KEY]}::text[])`;
  const oncekiHarita = new Map(oncekiler.map((r) => [r.key, r]));
  check(
    "§7a Ortamın BULUNAN hâli raporlanıyor (ölçüm buna BAĞLI DEĞİL — ön koşulu bekçi kurar)",
    true,
    `${oncekiler.filter((r) => r.key !== PROFILE_STAMP_SETTING_KEY).length}/${beklenen.length} satır`,
  );
  // ⚠️ ZEMİN "7/7" DEĞİL "EN AZ BİR" — ve eksik satır ATLAMA SEBEBİ DEĞİL.
  //
  // Eski hâli 7/7 arıyor, aksi durumda §7b/§7c'yi sessizce ATLIYORDU. Gerçek
  // fabrika hâli tam da atlanan durumdu (grandfathering ALTI anahtar yazar,
  // `finance.enabled`i bilerek yazmaz) — yani "job satır varken dokunmaz"
  // sözleşmesi FABRİKADA hiç ölçülmüyordu. Dilim 1 kabul provası açığı orada
  // buldu: job 7/7 arayıp eksiği profilden yazıyor ve `tam` profiliyle ön
  // muhasebeyi sessizce açıyordu. Artık kısmi durum da ölçülüyor.
  const eksikSatirlar = beklenen.filter((k) => !oncekiHarita.has(k));
  check(
    "§7a2 ⭐ KISMİ kurulum da ölçülüyor (eksik satır ATLAMA sebebi değil)",
    true,
    eksikSatirlar.length === 0
      ? `${beklenen.length}/${beklenen.length} satır — tam kurulum`
      : `${eksikSatirlar.length} satır bilinçli yok: ${eksikSatirlar.join(", ")}`,
  );

  const HEDEF = "tezgah.enabled";
  // ⚠️ BEKÇİ ÖN KOŞULUNU ORTAMDAN BEKLEMEZ, KENDİ KURAR (2026-09-13).
  //
  // Eski zemin "EN AZ BİR modül satırı var mı" diye soruyordu; gövde ise BELİRLİ
  // BİR satırın (HEDEF) varlığını varsayıyor. Granülarite uyuşmazlığı: yalnız
  // `iplik.enabled` taşıyan bir DB'de zemin YEŞİL geçti ve aşağıdaki silme P2025
  // ile düştü (ölçüldü: `tekserp_d5_a_test`). Zemin DEĞERİ değil VARLIĞI ölçmeliydi
  // — "satır var ve false" ile "satır YOK" aynı değeri okutur ama aynı DURUM değildir.
  //
  // Gerçek ön koşul "≥1 satır" da DEĞİL: §7f, HEDEF silindikten SONRA `exists`
  // bekler, yani en az bir BAŞKA modül satırının ayakta kalmasını ister. İkisi
  // birden kurulur; ikisi de `finally`deki geri yüklemeye dahildir (bulunmayan
  // anahtar orada silinir, yani bekçinin yazdığı satır ortada kalmaz).
  //
  // ⚠️ Eski `atla()` dalı KALKTI: 0 modül satırlı temiz bir CI DB'sinde §7/§9'un
  // TAMAMI sessizce atlanıyordu — yeşil ≠ kapsandı.
  const ESLIK = beklenen.find((k) => k !== HEDEF);
  if (!ESLIK) throw new Error(`MODULE_SETTING_KEYS tek anahtar taşıyor (${beklenen.join(",")})`);
  const bekciKurdu: string[] = [];
  for (const key of [HEDEF, ESLIK]) {
    if (oncekiHarita.has(key)) continue;
    await prisma.systemSetting.create({
      data: { key, value: false, description: "TEST- bekçi ön koşulu (finally kaldırır)" },
    });
    bekciKurdu.push(key);
  }
  check(
    "§7a3 ⭐ Ön koşul KURULDU: HEDEF + en az bir diğer modül satırı ayakta",
    (await prisma.systemSetting.count({ where: { key: { in: [HEDEF, ESLIK] } } })) === 2,
    bekciKurdu.length ? `bekçi yazdı: ${bekciKurdu.join(", ")}` : "ortamda zaten vardı",
  );
  const damgaOnce = oncekiHarita.get(PROFILE_STAMP_SETTING_KEY) ?? null;
  try {
    // (1) SATIRLAR TAM → job DOKUNMAMALI.
    const oncekiDegerler = new Map(
      (
        await prisma.systemSetting.findMany({
          where: { key: { in: beklenen } },
          select: { key: true, value: true },
        })
      ).map((r) => [r.key, JSON.stringify(r.value)]),
    );
    const r1 = await ensureModuleProfile({ TEKSERP_PROFIL: "tam" });
    check(
      "§7b ⭐ Yedi satır varken job DOKUNMUYOR (`exists`)",
      r1.action === "exists",
      `action=${r1.action}`,
    );
    const sonrakiDegerler = new Map(
      (
        await prisma.systemSetting.findMany({
          where: { key: { in: beklenen } },
          select: { key: true, value: true },
        })
      ).map((r) => [r.key, JSON.stringify(r.value)]),
    );
    const degisen = beklenen.filter((k) => oncekiDegerler.get(k) !== sonrakiDegerler.get(k));
    check(
      "§7c ⭐ Hiçbir modül değeri DEĞİŞMEDİ (`tam` profili mevcut kararı EZMEDİ)",
      degisen.length === 0,
      degisen.length ? `değişen: ${degisen.join(", ")}` : `${beklenen.length} satır korundu`,
    );

    // (2) ENV YOK → hiçbir şey yazılmaz (satır silinmiş olsa bile).
    // `deleteMany` + sayaç: silme SAYISI ön koşulun GERÇEKTEN kurulduğunu ölçer.
    // Çıplak `delete` bunu ölçmez, yalnız VARSAYAR ve yoklukta P2025 ile düşer.
    const silinen = await prisma.systemSetting.deleteMany({ where: { key: HEDEF } });
    check(
      "§7d0 ⭐ HEDEF satırı GERÇEKTEN vardı ve silindi (yokluk sessizce 'silindi' sayılmaz)",
      silinen.count === 1,
      `silinen=${silinen.count}`,
    );
    const r0 = await ensureModuleProfile({});
    check(
      "§7d ⭐ ENV YOKKEN eksik satır bile YAZILMIYOR (`absent`)",
      r0.action === "absent" &&
        (await prisma.systemSetting.findUnique({ where: { key: HEDEF } })) === null,
      `action=${r0.action}`,
    );
    // (3) GEÇERSİZ ENV → hiçbir yazma.
    const rInv = await ensureModuleProfile({ TEKSERP_PROFIL: "yok-boyle" });
    check(
      "§7e ⭐ GEÇERSİZ profil → hiçbir yazma (`invalid`)",
      rInv.action === "invalid" &&
        (await prisma.systemSetting.findUnique({ where: { key: HEDEF } })) === null,
      `action=${rInv.action}`,
    );

    // (4) ⭐ EKSİK SATIR + geçerli profil → YİNE DE DOKUNMAZ.
    //
    // ⚠️ BU BÖLÜM 2026-09-03'te TERSİNE ÇEVRİLDİ. Eski sözleşme "eksiği
    //    tamamla" idi ve bekçi onu ölçüyordu; Dilim 1 kabul provası bunun
    //    fabrikada GERÇEK BİR AÇIK olduğunu ölçtü: grandfathering migration'ı
    //    `finance.enabled`i BİLEREK yazmaz (satırın yokluğu dünkü davranıştır),
    //    job onu "eksik" sanıp profilden yazıyordu ve `TEKSERP_PROFIL=tam` ile
    //    mevcut bir fabrikada ÖN MUHASEBE MODÜLÜ SESSİZCE AÇILIYORDU.
    //    Yeni sözleşme: bir modül satırı bile varsa kurulum kararı VERİLMİŞTİR.
    await prisma.systemSetting.delete({ where: { key: PROFILE_STAMP_SETTING_KEY } }).catch(() => undefined);
    const r2 = await ensureModuleProfile({ TEKSERP_PROFIL: "dokuma" });
    const hedefSonrasi = await prisma.systemSetting.findUnique({ where: { key: HEDEF } });
    check(
      "§7f ⭐ KISMİ kurulumda job DOKUNMUYOR (`exists`) — eksik satır BİLİNÇLİ kabul edilir",
      r2.action === "exists",
      `action=${r2.action}`,
    );
    check(
      "§7g ⭐ Silinen satır profilden GERİ YAZILMADI (fabrikadaki `finance.enabled` sınıfı)",
      hedefSonrasi === null,
      hedefSonrasi ? `beklenmedik satır: ${JSON.stringify(hedefSonrasi.value)}` : "satır yok",
    );
    const damga = await prisma.systemSetting.findUnique({
      where: { key: PROFILE_STAMP_SETTING_KEY },
    });
    check(
      "§9a ⭐ Hiç satır yazılmadıysa damga da ATILMIYOR ('profil uygulandı' yalanı doğmasın)",
      damga === null,
      damga ? `beklenmedik damga: ${JSON.stringify(damga.value)}` : "damga yok",
    );

    // (5) ⭐ HİÇ SATIR YOKKEN → taze kurulum yolu: yedisi de yazılır + damga.
    //     Zeminin kendisi: yukarıdaki "dokunma" kontrolleri, job hiç yazamıyor
    //     olsaydı da yeşil kalırdı — bu blok onu ayırt eder.
    await prisma.systemSetting.deleteMany({ where: { key: { in: beklenen } } });
    const r3 = await ensureModuleProfile({ TEKSERP_PROFIL: "basit" });
    const tazeSatirlar = await prisma.systemSetting.findMany({
      where: { key: { in: beklenen } },
      select: { key: true, value: true },
    });
    check(
      "§9b ⭐ HİÇ satır yokken profil UYGULANIR (`applied`, 7/7)",
      r3.action === "applied" && tazeSatirlar.length === beklenen.length,
      `action=${r3.action} satır=${tazeSatirlar.length}/${beklenen.length}`,
    );
    const damga2 = await prisma.systemSetting.findUnique({
      where: { key: PROFILE_STAMP_SETTING_KEY },
    });
    const damgaGovde2 = damga2?.value as { profil?: string; uygulandiAt?: string } | null;
    check(
      "§9c Satır YAZILDIĞINDA `system.profile` damgası doğuyor ve ISO tarih taşıyor",
      damgaGovde2?.profil === "basit" && !Number.isNaN(Date.parse(damgaGovde2?.uygulandiAt ?? "")),
      JSON.stringify(damga2?.value),
    );
    check(
      "§9d `basit` profili tasarım §10 tablosuyla hizalı (yalnız üretim AÇIK)",
      tazeSatirlar.every((r) => (r.key === "production.enabled") === (r.value === true)),
      tazeSatirlar.map((r) => `${r.key}=${JSON.stringify(r.value)}`).join(" · "),
    );
  } finally {
    // Bulunan hâle GERİ DÖN — değer + açıklama + ZAMAN DAMGALARI.
    // ⚠️ TÜM modül anahtarları + damga geri yüklenir: §9b bloğu `deleteMany`
    //    ile hepsini siliyor, yalnız HEDEF'i geri koymak DB'yi bozardı.
    for (const key of [...beklenen, PROFILE_STAMP_SETTING_KEY]) {
      const eski = oncekiHarita.get(key);
      if (!eski) {
        await prisma.systemSetting.delete({ where: { key } }).catch(() => undefined);
        continue;
      }
      await prisma.$executeRaw`DELETE FROM system_settings WHERE "key" = ${key}`;
      await prisma.$executeRaw`
        INSERT INTO system_settings ("key", "value", "description", "createdAt", "updatedAt", "updatedById")
        VALUES (${key}, ${eski.value as never}::jsonb, ${eski.description},
                ${eski.createdAt}::timestamptz, ${eski.updatedAt}::timestamptz,
                ${eski.updatedById}::uuid)`;
    }
    console.log(
      "   ↩︎ canlı ölçüm geri alındı (değer + açıklama + createdAt/updatedAt bulunan hâline döndü)",
    );
  }
}

/**
 * §10 HTTP ayağı — sunucu yoksa ATLANIR (beyanla), sunucu YABANCIYSA KIRMIZI.
 *
 * Kullanıcıyı kapı KENDİ yaratır (`ensureTestAdmin`). Eskiden var olduğu
 * VARSAYILAN `p2test` ile giriş deneniyordu; o kullanıcıyı repoda yaratan tek
 * satır yok, yani taze her DB'de dört kontrol sessizce düşüyordu. Sayaç da
 * yanlıştı: `atla()` bir sayıyor, ölçülmeyen DÖRT kontrol "1 atlandı" görünüyordu.
 */
const HTTP_KONTROL = 4;
async function httpTuru(): Promise<void> {
  const kapi = await httpBekciKapisi({ base: BASE, kontrolSayisi: HTTP_KONTROL });
  if (kapi.kirmizi) {
    check("§10 HTTP ayağı ölçülebildi", false, kapi.kirmizi);
    atlanan += HTTP_KONTROL;
    return;
  }
  if (!kapi.token) {
    atla("§10 HTTP turu", kapi.atlaSebebi ?? "ölçüm yapılamadı");
    atlanan += HTTP_KONTROL - 1; // `atla()` bir tanesini zaten saydı
    return;
  }
  const token = kapi.token;
  const r = await fetch(`${BASE}/api/admin/module-profile`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const govde = (await r.json()) as {
    data?: {
      profiles?: Array<{ id: string; moduller: Record<string, boolean> }>;
      current?: { values?: Record<string, unknown>; closest?: string; appliedProfile?: unknown };
      diffs?: Record<string, Array<{ key: string; from: boolean; to: boolean }>>;
    };
  };
  check("§10f ⭐ HTTP 200 + üç bölüm", r.status === 200 && Boolean(govde.data?.profiles?.length), `status=${r.status}`);
  check(
    "§10g Yanıt beş profili de taşıyor",
    (govde.data?.profiles ?? []).length === MODULE_PROFILE_IDS.length,
    `${govde.data?.profiles?.length ?? 0} profil`,
  );
  const diffs = govde.data?.diffs ?? {};
  const closest = govde.data?.current?.closest;
  const sifirFarkli = Object.entries(diffs)
    .filter(([, v]) => v.length === 0)
    .map(([k]) => k);
  check(
    "§10h ⭐ `closest` fark tablosuyla TUTARLI (fark 0 olan profil ya da 'ozel')",
    closest === "ozel" ? sifirFarkli.length === 0 : sifirFarkli.includes(String(closest)),
    `closest=${closest} · farkı sıfır olanlar=[${sifirFarkli.join(", ")}]`,
  );
  const govdeMetni = JSON.stringify(govde);
  check(
    "§10i ⭐ Yükte `security.` satırı SIZMIYOR",
    !govdeMetni.includes("security."),
  );
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });

