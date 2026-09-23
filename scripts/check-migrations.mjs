#!/usr/bin/env node
// =============================================================================
// Migration hijyen bekçisi (zero-dep, Node ESM) — yerelde + CI'da koşar.
// =============================================================================
// NEDEN VAR: 2026-07-30'da ÜÇ migration dev DB'sine `prisma db execute` ile
// uygulandı ama GİT'E HİÇ GİRMEDİ (`git log -- <dizin>` boş). `prisma migrate
// deploy` YALNIZ dizindeki dosyaları uygular → production'da `sacks.notes` kolonu
// ve `LabelKind.SACK` enum değeri hiç oluşmaz. Deploy "All migrations applied"
// yazıp BAŞARILI görünür, sonra çuval akışının TAMAMI + HER irsaliye baskısı
// P2022 ile 500 döner (shipping.service `listCustomerPoolSacks` /
// `getShipmentSackContents` / `resolveLiveRowNotes`, sack-search'ün 4 ucu,
// label.service `getSackLabel`).
//
// Aynı oturumda `scripts/test_sack_notes.ts` de untracked'ti — yani CI'daki
// gerçek gate de (boş DB'ye `migrate deploy` + `npm test` → P2022 ile KIRMIZI)
// kör kalmıştı. Kolonu okuyan test commit edilir ama migration edilmezse CI
// yakalar; ikisi birlikte unutulursa hiçbir şey yakalamaz. Bu bekçi tam o
// pencereyi kapatır.
//
//   [GATE 1] prisma/migrations altında UNTRACKED dosya → FAIL.
//   [GATE 2] prisma/migrations altında MODIFIED/DELETED dosya → FAIL.
//            Uygulanmış migration IMMUTABLE'dır. ⚠️ GEREKÇE 2026-09-23'te
//            DÜZELTİLDİ: eski metin "deploy 'migration modified after applied'
//            ile KİLİTLER" diyordu; ÖLÇÜLDÜ ve bu YANLIŞ — `migrate deploy` ve
//            `migrate status` uygulanmış bir migration'ın checksum'ını
//            DOĞRULAMIYOR (yalnız `migrate dev` konuşur, o da bu depoda yasak).
//            Gerçek bedel AYRIŞMADIR: bir ortam eski metni, başka bir ortam yeni
//            metni koşar ve hiçbir yerde bu fark görünmez.
//            BEYANLI ONARIM (tek istisna): `prisma/migration-onarimlari.json`.
//            Bir dosya ancak ORADA, düzeltilmiş hâlinin sha256'sı ÇİVİLENEREK
//            beyan edildiyse değiştirilebilir. Çivi sonraki sessiz düzenlemeyi de
//            yakalar (sha tutmazsa kapı, dosya commit'li olsa bile kırmızı verir).
//            Doğan ihtiyaç: sonra doğan bir tabloya dokunan migration temiz DB'de
//            `42P01` ile düşüyordu ve "dosyayı eski hâline al" ÇARE DEĞİLDİ —
//            eski hâli hiçbir temiz kurulumda koşamıyordu (2026-09-23).
//   [GATE 3] her migration dizini `migration.sql` içeriyor mu (boş/yarım dizin).
//   [GATE 4] scripts/test_*.ts UNTRACKED → FAIL. Test commit edilmezse CI'ın
//            P2022 gate'i kaybolur.
//   [GATE 5] package.json script'lerinin ANDIĞI yerel dosya UNTRACKED/EKSİK → FAIL.
//            2026-08-01 denetiminde tam bu boşluk yakalandı: `tsconfig.scripts.json`
//            ve `mobil/scripts/build-apk.mjs` commit EDİLMİŞ package.json'lardan
//            çağrılıyordu ama kendileri untracked'ti. Yerelde her şey yeşil (dosya
//            diskte var), temiz checkout'ta `npm test` ve `npm run build:apk` ilk
//            satırda ölür. GATE 1/4 ile aynı hata sınıfı, farklı dizin.
//

// Çalıştır: node scripts/check-migrations.mjs      (Teks-Erp: npm run check:migrations)
// Çıkış kodu: ihlal varsa 1, yoksa 0.
//
// ⚠️ Bu bekçinin değeri YERELDEDİR. CI'da checkout temiz olduğu için untracked
// dosya hiç görünmez — orada bilinçli olarak "her zaman yeşil" bir dokümantasyon
// adımıdır. Commit ETMEDEN sevk edemeyeceğini yerelde öğrenmen gerekir.
// =============================================================================

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { STDIN_ARIZA_MESAJI, stdinListesi } from "./hooks/lib/stdin-liste.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = "Teks-Erp/prisma/migrations";
const SCRIPTS_DIR = "Teks-Erp/scripts";

// ⚠️ GERÇEK İNDEKS — bu bekçinin sorduğu her soru ("izleniyor mu", "untracked mı")
// GELİŞTİRİCİNİN AĞACINA aittir, oluşmakta olan commit'e değil.
//
// VAKA (2026-09-13, dört kez): kısmi (pathspec) commit'te — `git commit -- <yol>` —
// git GEÇİCİ bir indeks kurar (`GIT_INDEX_FILE=<gitdir>/next-index-<pid>.lock`) ve
// pathspec dışındaki her şeyi HEAD'e geri sarar. Başkasının SAHNELENMİŞ dosyası o
// indekste YOKTUR, dolayısıyla hook'a `??` görünür ve GATE 1/4 YANLIŞ KİŞİYİ durdurur.
// Ölçüm (sandbox): miras alınan env'de `?? theirs.txt`, gerçek indeks zorlandığında
// `A  theirs.txt`; gerçekten takipsiz dosya iki koşumda da `??` kalır — yani düzeltme
// kapıyı körleştirmez, yalnız doğru ağacı okutur.
//
// `--no-optional-locks`: status gerçek indeksi tazelemek için yazmaya kalkmasın —
// ortak çalışma ağacında altı oturum aynı indekse bakıyor.
const GIT_DIR = (() => {
  try {
    return execFileSync("git", ["rev-parse", "--absolute-git-dir"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
})();
const GIT_ENV = GIT_DIR ? { ...process.env, GIT_INDEX_FILE: join(GIT_DIR, "index") } : process.env;

function git(args) {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", env: GIT_ENV });
}

// `git status --porcelain` satırı: "XY <yol>". Untracked "??", değişmiş " M"/"M ",
// silinmiş " D"/"D ". `--untracked-files=all` dizin özeti yerine tek tek dosya verir
// (yoksa yeni bir migration dizini tek "?? .../dizin/" satırına çöker ve içindeki
// dosyaları göremeyiz).
function statusEntries(pathspec) {
  const out = git(["--no-optional-locks", "status", "--porcelain", "--untracked-files=all", "--", pathspec]);
  return out
    .split("\n")
    .filter(Boolean)
    .map((l) => ({ code: l.slice(0, 2), path: l.slice(3).trim().replace(/^"|"$/g, "") }));
}

// =============================================================================
// COMMIT KAPISI KİPİ (`--commit-kapisi` + staged liste stdin'den)
// =============================================================================
// VAKA (2026-09-13, beş kez): takipsiz kapılar (GATE 1/4) commit'i atanın kendi
// işiyle ilgisi olmayan bir dosya yüzünden kırmızı verdi. `GIT_INDEX_FILE`
// düzeltmesi yalnız SAHNELENMİŞ yabancı dosyayı kurtarır; GERÇEKTEN takipsiz
// yabancı dosya hâlâ yanlış kişiyi durduruyordu.
//
// KARAR (kullanıcı onaylı, 2026-09-13 sabahı): commit `prisma/migrations`a
// **dokunuyorsa** takipsiz kapılar SERT kalır — migration gönderiyorsan temiz bir
// migration durumu görmek ZORUNDASIN. Dokunmuyorsa UYARI + çıkış 0, dosya ADIYLA
// ve SAHİP UYDURMADAN.
//
// ⚠️ KARAR DARALTILDI (kullanıcı onaylı, 2026-09-13 gecesi) — ve ESKİ HÂLİ NEDEN
// BIRAKILDIĞIYLA BİRLİKTE DURUYOR ki altı ay sonra "neden bu kadar dar" diye
// genişletilmesin:
//   ESKİ kapsam : migration commit'i + HERHANGİ bir takipsiz bekçi → SERT
//   YENİ kapsam : migration commit'i + o migration'ın GETİRDİĞİ ADI ANAN
//                 takipsiz bekçi → SERT.  Ötekiler → ADVISORY (çıkış 0).
//   GEREKÇE (ölçüldü): eski kapsam bir günde **4 kez yanlış kişiyi durdurdu**
//     (d5 ×3 kaçışa zorlandı · ea worktree · 01 · sahnelenen dosyaların yabancı
//     commit'e kapılması) ve **0 kez** gerçek bir unutulmuş test yakaladı.
//   ⚠️ SINIRI (kullanıcı bilerek kabul etti, ve kapı bunu kendi ağzından duyurur):
//     adı geçmeyen ama o migration için yazılmış bir testi KAÇIRIR.
//   ⇒ Sahiplik git'ten türetilemez ve uydurulmaz; ama İLİŞKİ türetilebilir:
//     migration SQL'inden adlar çıkarılır, takipsiz testlerde aranır.
//
// ⚠️ KORUMA KAYBOLMUYOR, DOĞRU KİŞİYE TAŞINIYOR: takipsiz bir migration prod'a
// zaten hiç gitmez; asıl risk SAHİBİNİN unutmasıdır ve o kişi kendi commit'inde
// (migrations'a dokunduğu an) sert kapıya çarpar.
//
// ⚠️ BAYRAK HOOK YOLUNA ÖZGÜDÜR. Bayraksız çağrı (CI, `npm run check:migrations`,
// `npm test`in migration geçidi) bugünkü SERT davranışı aynen korur — orada soru
// "ağacım temiz mi", commit kapısında ise "bu commit'i durdurmalı mıyım".
// CI'ın bayrağı KULLANMADIĞI ayrıca ölçülür (test_commit_gate_scope.ts §3).
const KOMIT_KIPI = process.argv.includes("--commit-kapisi");
const KOMIT_KUMESI = KOMIT_KIPI
  ? (() => {
      // ZAMAN AŞIMLI (2026-09-13): açık boru + EOF yok = sonsuz askı; 5 sn'de ARIZA.
      const { kip, liste } = stdinListesi();
      if (kip === "zaman-asimi") {
        console.error(`❌ migration hijyeni: ${STDIN_ARIZA_MESAJI}`);
        process.exit(2);
      }
      return liste ?? []; // TTY/kapalı → küme boş → takipsiz kapılar yumuşak
    })()
  : null;
// Takipsiz kapıların SERTLİĞİ: bayraksız her zaman sert; commit kipinde yalnız
// commit migration'a dokunuyorsa.
const TAKIPSIZ_SERT =
  KOMIT_KUMESI === null || KOMIT_KUMESI.some((f) => f.startsWith(`${MIGRATIONS_DIR}/`));

const problems = [];
const uyarilar = [];

/** Takipsiz kapı bulgusu: kipe göre kırmızı ya da uyarı. */
function takipsizBulgu(kayit) {
  (TAKIPSIZ_SERT ? problems : uyarilar).push(kayit);
}

// --- GATE 1 + 2: migration dizini git durumu -------------------------------
const migEntries = existsSync(join(REPO_ROOT, MIGRATIONS_DIR))
  ? statusEntries(MIGRATIONS_DIR)
  : [];

const untrackedMig = migEntries.filter((e) => e.code === "??");
// "A " = index'e EKLENMİŞ, çalışma kopyası temiz YENİ dosya. Bu, kuralın TAM
// OLARAK istediği ara durumdur (CLAUDE.md: `git add` → `prisma db execute` →
// `migrate resolve --applied` → doğrula → commit) ve GATE 2'ye girmez:
//   • GATE 1 sağlanır — dosya artık izleniyor, `migrate deploy` onu görecek.
//   • GATE 2 kavramsal olarak UYGULANMIŞ (yani commit'li geçmişte var olan) bir
//     dosyanın değiştirilmesini kovalar; henüz commit edilmemiş YENİ bir dosyanın
//     "checksum'ı bozuldu" diye kilitleyeceği bir deploy yok.
// "AM" (eklendikten SONRA düzenlenmiş) ve " M"/" D" hâlâ GATE 2'ye düşer —
// tam da `db execute` sonrası dosyayı kurcalayan tehlikeli hâl budur.
const changedMig = migEntries.filter((e) => e.code !== "??" && e.code !== "A ");

if (untrackedMig.length) {
  takipsizBulgu({
    gate: "GATE 1 — COMMIT EDİLMEMİŞ MIGRATION",
    why:
      "Bu dosyalar git'te YOK. `prisma migrate deploy` yalnız dizindeki dosyaları\n" +
      "  uygular; commit edilmezse production'a HİÇ gitmez ve kod eski şemaya karşı\n" +
      "  koşup P2022 verir (deploy yine 'başarılı' görünür).",
    items: untrackedMig.map((e) => e.path),
    fix: `git add ${MIGRATIONS_DIR}`,
  });
}

// BEYANLI ONARIM DEFTERİ — GATE 2'nin TEK istisnası (2026-09-23).
//
// ⚠️ "Dosyayı eski hâline al" her zaman bir ÇARE DEĞİLDİR: sonra doğan bir tabloya
// dokunan migration'ın ESKİ hâli hiçbir temiz kurulumda koşamıyor (42P01). Böyle bir
// dosya düzeltilmek ZORUNDA. İstisna sessiz kalmasın diye beyan VERİDE durur ve
// düzeltilmiş içeriğin sha256'sını ÇİVİLER — sonraki sessiz bir düzenleme, dosya
// commit'li olsa bile kapıyı kırmızıya düşürür (iki yönlü: ölü beyan da kırmızı).
const ONARIM_DOSYASI = "Teks-Erp/prisma/migration-onarimlari.json";
function onarimDefteri() {
  const yol = join(REPO_ROOT, ONARIM_DOSYASI);
  if (!existsSync(yol)) return [];
  try {
    const d = JSON.parse(readFileSync(yol, "utf8"));
    return Array.isArray(d) ? d : [];
  } catch (e) {
    problems.push({
      gate: "GATE 2 — ONARIM DEFTERİ OKUNAMADI",
      why: "Defter bozuksa istisna ÖLÇÜLEMEZ; ölçülemeyen istisna sessiz bir kapı deliğidir.",
      items: [`${ONARIM_DOSYASI}: ${e.message}`],
      fix: "JSON'u düzelt",
    });
    return null;
  }
}
const onarimlar = onarimDefteri() ?? [];
const sha256 = (mutlakYol) =>
  existsSync(mutlakYol) ? createHash("sha256").update(readFileSync(mutlakYol)).digest("hex") : null;

// Beyanın KENDİSİ ölçülür: dizin var mı, çivi tutuyor mu, taşındığı migration
// gerçekten SONRA mı geliyor. (Üçüncüsü olmadan defter, sırayı düzeltmeyen bir
// düzenlemeyi de aklardı.)
const olcumsuzBeyan = [];
for (const o of onarimlar) {
  const dizin = join(REPO_ROOT, MIGRATIONS_DIR, String(o.migration ?? ""));
  const sqlYolu = join(dizin, "migration.sql");
  if (!existsSync(sqlYolu)) {
    olcumsuzBeyan.push(`${o.migration}: beyan var ama migration.sql YOK (ölü beyan)`);
    continue;
  }
  if (sha256(sqlYolu) !== o.sha256) {
    olcumsuzBeyan.push(
      `${o.migration}: beyandaki sha256 dosyayla TUTMUYOR — dosya beyandan SONRA da düzenlenmiş ` +
        `(dosya ${String(sha256(sqlYolu)).slice(0, 12)}…, beyan ${String(o.sha256).slice(0, 12)}…)`,
    );
  }
  if (o.tasindigiMigration) {
    const hedef = join(REPO_ROOT, MIGRATIONS_DIR, String(o.tasindigiMigration), "migration.sql");
    if (!existsSync(hedef)) {
      olcumsuzBeyan.push(`${o.migration}: taşındığı migration (${o.tasindigiMigration}) YOK`);
    } else if (String(o.tasindigiMigration) <= String(o.migration)) {
      olcumsuzBeyan.push(
        `${o.migration}: taşındığı migration (${o.tasindigiMigration}) SONRA gelmiyor — sıra düzelmemiş`,
      );
    }
  }
  if (!o.gerekce || String(o.gerekce).length < 40) {
    olcumsuzBeyan.push(`${o.migration}: gerekçe yok ya da bir cümle bile değil`);
  }
}
if (olcumsuzBeyan.length) {
  problems.push({
    gate: "GATE 2 — ONARIM BEYANI ÖLÇÜLEMEDİ",
    why:
      "Beyanlı onarım, GATE 2'nin tek istisnasıdır; beyanın kendisi ölçülemiyorsa\n" +
      "  istisna bir kapı deliğine dönüşür (çivi tutmuyorsa dosya beyandan sonra\n" +
      "  yeniden düzenlenmiş demektir).",
    items: olcumsuzBeyan,
    fix: `${ONARIM_DOSYASI} içindeki sha256'yı ve taşındığı migration'ı güncelle`,
  });
}

const beyanliOnarim = new Set(
  onarimlar
    .filter((o) => sha256(join(REPO_ROOT, MIGRATIONS_DIR, String(o.migration ?? ""), "migration.sql")) === o.sha256)
    .map((o) => `${MIGRATIONS_DIR}/${o.migration}/migration.sql`),
);
const beyansizDegisim = changedMig.filter((e) => !beyanliOnarim.has(normalize(e.path)));
const beyanliDegisim = changedMig.filter((e) => beyanliOnarim.has(normalize(e.path)));

for (const e of beyanliDegisim) {
  // SESSİZ GEÇMEZ: istisna her koşumda tek satırla duyurulur.
  console.log(`   📌 BEYANLI ONARIM (GATE 2 istisnası): ${e.path} — ${ONARIM_DOSYASI}`);
}

if (beyansizDegisim.length) {
  problems.push({
    gate: "GATE 2 — UYGULANMIŞ MIGRATION DEĞİŞTİRİLMİŞ",
    why:
      "Migration dosyaları IMMUTABLE'dır. Bedel deploy'un kilitlenmesi DEĞİL (ölçüldü:\n" +
      "  `migrate deploy`/`status` checksum'a bakmaz), ORTAMLARIN SESSİZCE AYRIŞMASIDIR:\n" +
      "  bir veritabanı eski metni, ötekisi yeniyi koşar ve fark hiçbir yerde görünmez.\n" +
      "  Değişiklik gerekiyorsa YENİ migration yaz. Dosyanın ESKİ HÂLİ hiçbir temiz\n" +
      "  kurulumda koşamıyorsa (ör. sonra doğan tabloya dokunuyorsa) düzeltmeyi\n" +
      `  ${ONARIM_DOSYASI} defterine BEYAN ET (sha256 çivisiyle).`,
    items: beyansizDegisim.map((e) => `${e.code.trim()} ${e.path}`),
    fix: "Dosyayı eski hâline al (git checkout --) ve düzeltmeyi YENİ bir migration'a yaz",
  });
}

// --- GATE 3: her migration dizini migration.sql içeriyor mu ----------------
const migRoot = join(REPO_ROOT, MIGRATIONS_DIR);
if (existsSync(migRoot)) {
  const emptyDirs = readdirSync(migRoot)
    .filter((d) => statSync(join(migRoot, d)).isDirectory())
    .filter((d) => !existsSync(join(migRoot, d, "migration.sql")));
  if (emptyDirs.length) {
    problems.push({
      gate: "GATE 3 — migration.sql EKSİK",
      why: "Prisma bu dizini pending sayar ama uygulayacak SQL bulamaz.",
      items: emptyDirs,
      fix: "Dizine migration.sql ekle ya da dizini sil",
    });
  }
}

// --- GATE 4: untracked test dosyaları --------------------------------------
const untrackedTests = existsSync(join(REPO_ROOT, SCRIPTS_DIR))
  ? statusEntries(SCRIPTS_DIR).filter(
      (e) => e.code === "??" && /(^|\/)test_[^/]*\.ts$/.test(e.path)
    )
  : [];

// =============================================================================
// ⚠️ İLGİLİ ↔ İLGİSİZ AYRIMI — SERTLİK DEĞİŞMEZ, YALNIZ MESAJ ZENGİNLEŞİR
// =============================================================================
// Bu kapı 2026-09-13'te DÖRT kez yanlış kişiyi durdurdu (d5 ×3 kaçışa zorlandı ·
// ea worktree · 01 · sahnelenen dosyaların yabancı commit'e kapılması) ve aynı
// gün SIFIR kez gerçek bir unutulmuş test yakaladı. Dördünde de duran kişi
// **neden** durduğunu göremedi: liste "takipsiz bekçi var" diyordu, kimin işi
// olduğunu söylemiyordu.
//
// ⚠️ SAHİPLİK GİT'TEN TÜRETİLEMEZ — ve uydurulmaz. Ama İLİŞKİ TÜRETİLEBİLİR:
// commit'in migration SQL'i hangi adları getiriyorsa (`"kolon"` · tablo adı),
// takipsiz testlerde o adlar aranır. Ölçülen bir şey, tahmin edilen değil.
//   ilişkili  = bu migration'ın getirdiği adı ANIYOR → kapının beyan ettiği risk
//   ilişkisiz = hiçbirini anmıyor                    → muhtemelen komşunun işi
//
// ⚠️ SERTLİK KULLANICININ KARARIDIR ve burada DEĞİŞMİYOR (başlık § COMMIT KAPISI
// KİPİ). Bu blok tamamen EKLEMELİ: aynı commit'ler durur, aynı commit'ler geçer;
// yalnız duran kişi ne olduğunu görür. Sertliğin İLİŞKİLİ kümeye daraltılması
// ayrı bir karardır ve KULLANICIYA taşınmıştır.
function migrationAdlari() {
  const yollar = (KOMIT_KUMESI ?? []).filter((f) => f.startsWith(`${MIGRATIONS_DIR}/`));
  const adlar = new Set();
  for (const y of yollar) {
    let sql = "";
    try {
      sql = readFileSync(join(REPO_ROOT, y), "utf8");
    } catch {
      continue; // dosya okunamadı → o migration'dan ad çıkarılamaz, SESSİZ GEÇME:
    } //          aşağıdaki "ad çıkarılamadı" beyanı bunu görünür kılar.
    for (const m of sql.matchAll(/"([A-Za-z_][A-Za-z0-9_]{3,})"/g)) adlar.add(m[1]);
  }
  return adlar;
}

if (untrackedTests.length) {
  const adlar = migrationAdlari();
  const ilgili = [];
  const ilgisiz = [];
  for (const e of untrackedTests) {
    let govde = "";
    try {
      govde = readFileSync(join(REPO_ROOT, e.path), "utf8");
    } catch {
      /* okunamayan dosya İLGİSİZ sayılmaz — aşağıda ayrıca beyan edilir */
    }
    (govde && [...adlar].some((a) => govde.includes(a)) ? ilgili : ilgisiz).push(e.path);
  }
  const ayrim =
    adlar.size === 0
      ? "\n  ⓘ Bu commit'in migration'ından ad ÇIKARILAMADI (SQL okunamadı ya da\n" +
        "    tırnaklı tanımlayıcı yok) ⇒ ilgili/ilgisiz ayrımı YAPILAMADI."
      : `\n  ⓘ Bu migration ${adlar.size} ad getiriyor. Takipsiz bekçilerin ayrımı:\n` +
        `    İLGİLİ  (o adlardan birini ANIYOR — kapının beyan ettiği GERÇEK risk): ` +
        `${ilgili.length ? ilgili.join(", ") : "YOK"}\n` +
        `    İLGİSİZ (hiçbirini anmıyor — muhtemelen KOMŞUNUN işi): ` +
        `${ilgisiz.length ? ilgisiz.join(", ") : "yok"}` +
        (ilgili.length === 0
          ? "\n    ⚠️ Bu commit'in migration'ıyla İLİŞKİLİ takipsiz test YOK ⇒ bu kapı" +
            " seni DURDURMUYOR (kullanıcı kararı 2026-09-13: sertlik İLGİLİ kümesine daraltıldı)."
          : "") +
        "\n    ⚠️ SINIR: bu kapı, migration'ın getirdiği adı ANMAYAN ama yine de o migration" +
        "\n       için yazılmış bir testi KAÇIRIR. Kullanıcı bu riski bilerek kabul etti;" +
        "\n       gerekçe: eski kapsam 4 kez yanlış kişiyi durdurdu, 0 kez gerçek unutulmuş" +
        "\n       test yakaladı (ölçüldü 2026-09-13).";
  // ⚠️ SERTLİK ARTIK İLGİLİ KÜMESİNE BAĞLI (kullanıcı kararı, 2026-09-13 gecesi).
  // `takipsizBulgu` genel sertliği uygular; GATE 4 ondan AYRILIR ve yalnız
  // migration'ın getirdiği adı ANAN takipsiz bekçi varsa sert olur.
  const gate4Sert = TAKIPSIZ_SERT && ilgili.length > 0;
  (gate4Sert ? problems : uyarilar).push({
    gate: "GATE 4 — COMMIT EDİLMEMİŞ TEST",
    ayrim,
    why:
      "Testler CI'ın gerçek şema gate'idir: boş DB'ye `migrate deploy` + `npm test`\n" +
      "  koşuluyor, yeni kolonu okuyan bir test migration'sız kalırsa CI KIRMIZI olur.\n" +
      "  Test de commit edilmezse o gate kaybolur ve hata production'da bulunur.\n" +
      "  ⚠️ Kapı UNTRACKED arar, COMMIT'Lİ değil: `git add` YETER — testi bu commit'e\n" +
      "  sokmak ZORUNDA DEĞİLSİN, bir sonraki commit'e bırakabilirsin (ölçüldü: 'A '\n" +
      "  durumundaki dosya GATE 4'e hiç girmez, pathspec commit'te de girmez).",
    items: untrackedTests.map((e) => e.path),
    fix: `git add ${SCRIPTS_DIR}/test_*.ts   (commit etmek şart değil, sahnelemek yeter)`,
  });
}

// --- GATE 5: package.json script'lerinin andığı yerel dosyalar --------------
// NEDEN: `npm test` → `tsx scripts/run-all-tests.ts` → `tsc -p tsconfig.scripts.json`
// zinciri commit'li package.json'dan başlar. Zincirdeki BİR dosya untracked'se
// zincir yalnız bu makinede çalışır; CI/temiz klon/production'da kopar. Migration
// untracked'liğiyle aynı sessiz başarısızlık: "bende çalışıyordu".
const PKG_JSONS = ["package.json", "Teks-Erp/package.json", "mobil/package.json", "Electron/package.json"];
// Yalnız yerel dosya gibi görünen token'lar: bilinen uzantı + glob YOK.
// (`eslint src`, `expo start`, `2>&1` gibi token'lar elenir.)
const FILE_TOKEN = /^[.\w/-]+\.(?:ts|tsx|js|mjs|cjs|json)$/;

/** git index'te izleniyor mu? (staged-ama-commit'siz dosyalar da izleniyor SAYILIR) */
function isTracked(repoRelPath) {
  return git(["ls-files", "--", repoRelPath]).trim().length > 0;
}

/**
 * `.gitignore` bu yolu dışlıyor mu?
 *
 * ⚠️ 2026-09-05'te bu ayrım eklendi: DERLEME ÇIKTISI meşruen izlenmez. Backend
 * sunucu araçlarını `dist/tools/*.cjs`e derler (`npm run build`) ve package.json
 * onları oradan çağırır (`superadmin:kur`). Kapı bunu "commit edilmemiş dosya"
 * sanıp kırmızı veriyordu — kuralın konusu ise "bu makinede var, temiz klonda
 * yok" sınıfıdır ve derleme çıktısı o sınıfa GİRMEZ: temiz klonda `npm run build`
 * onu üretir.
 *
 * Ama muafiyet KOŞULLUDUR: yok sayılan bir yola atıf, ancak aynı package.json
 * onu ÜRETEN bir `build*` script'i taşıyorsa meşrudur. Yoksa dosya ne izlenir ne
 * üretilir — tam da kapının aradığı sessiz kopukluk.
 */
function isIgnored(repoRelPath) {
  try {
    // GIT_ENV: `check-ignore` indekse de bakar (izlenen dosya yok sayılmaz).
    execFileSync("git", ["check-ignore", "-q", "--", repoRelPath], { cwd: REPO_ROOT, env: GIT_ENV });
    return true;
  } catch {
    return false; // çıkış kodu 1 = yok sayılmıyor
  }
}

const scriptRefProblems = [];
for (const pkgRel of PKG_JSONS) {
  const pkgAbs = join(REPO_ROOT, pkgRel);
  if (!existsSync(pkgAbs)) continue;
  const pkgDir = dirname(pkgRel); // "." | "Teks-Erp" | ...
  let scripts;
  try {
    scripts = JSON.parse(readFileSync(pkgAbs, "utf8")).scripts ?? {};
  } catch {
    continue; // bozuk package.json bu bekçinin işi değil
  }
  for (const [name, cmd] of Object.entries(scripts)) {
    for (const raw of String(cmd).split(/\s+/)) {
      const token = raw.replace(/^["']|["']$/g, "");
      if (!FILE_TOKEN.test(token) || /[*?]/.test(token)) continue;
      // package.json'ın KENDİ dizinine göre çöz, sonra repo köküne indir.
      const repoRel = normalize(join(pkgDir, token)).replace(/\\/g, "/");
      if (repoRel.startsWith("..")) continue; // repo dışına çıkan referans (yok ama güvenli)
      const abs = join(REPO_ROOT, repoRel);
      // Derleme çıktısı: yok sayılan yol + aynı package.json'da onu üreten bir
      // `build*` script'i varsa muaf (yukarıdaki isIgnored notu).
      if (isIgnored(repoRel)) {
        const uretiliyor = Object.keys(scripts).some((s) => /^build/i.test(s));
        if (!uretiliyor) {
          scriptRefProblems.push(
            `${repoRel}  (YOK SAYILIYOR ama ÜRETEN build script'i YOK — ${pkgRel} → "${name}")`,
          );
        }
        continue;
      }
      if (!existsSync(abs)) {
        scriptRefProblems.push(`${repoRel}  (EKSİK — ${pkgRel} → "${name}")`);
      } else if (!isTracked(repoRel)) {
        scriptRefProblems.push(`${repoRel}  (UNTRACKED — ${pkgRel} → "${name}")`);
      }
    }
  }
}

if (scriptRefProblems.length) {
  problems.push({
    gate: "GATE 5 — package.json'un ANDIĞI DOSYA COMMIT EDİLMEMİŞ/EKSİK",
    why:
      "package.json commit'li ama çağırdığı dosya git'te YOK. Bu makinede çalışır,\n" +
      "  temiz klonda / CI'da / production'da komut ilk satırda ölür (`npm test`,\n" +
      "  `npm run build:apk` gibi). Migration untracked'liğiyle aynı hata sınıfı.",
    items: [...new Set(scriptRefProblems)],
    fix: "git add <dosya>  (ya da package.json'daki referansı kaldır)",
  });
}

// --- [ADVISORY] RESTRICT FK → o ebeveyni silen bekçiler ----------------------
// KIRMIZI VERMEZ. Kaybolan şey bilgi, karar değil.
//
// VAKA (2026-09-12, aynı gün İKİ kez): yeni bir defter tablosu `RESTRICT` ilişkisiyle
// doğdu, var olan bir bekçinin temizliği ebeveyni ÖNCE siliyordu → P2003. Migration'ı
// yazan kişi yeni tabloyu düşünüyor, ESKİ temizlikleri düşünmüyor; o listeyi kimse
// göstermiyordu.
//
// ⚠️ NEDEN MIGRATION-TETİKLİ: statik kurgu (şemadaki her RESTRICT ebeveyni × onu silen
// her bekçi) ölçüldü ve **1621 satır** veriyordu — okunmayan doğru, kapının üçüncü ölüm
// biçimi. Değişim ölçen kurgu `ImportRun` için **3 ad** basıyor. Fark kapsamda: biri
// DURUMU, öbürü DEĞİŞİMİ ölçer.
//
// (Bu bölüm `merge-base` ve dosya okumaya dayanır, `status`a değil; kısmi commit'in
// geçici indeksinden etkilenmez — yine de `git()` artık gerçek indeksi zorluyor.)
const YENI_MIGRATION_TABAN = (() => {
  try {
    return git(["merge-base", "HEAD", "origin/main"]).trim();
  } catch {
    return "";
  }
})();

if (YENI_MIGRATION_TABAN) {
  let eskiDizinler = new Set();
  try {
    eskiDizinler = new Set(
      git(["ls-tree", "--name-only", `${YENI_MIGRATION_TABAN}:${MIGRATIONS_DIR}`])
        .split("\n")
        .map((x) => x.replace(/\/$/, ""))
        .filter(Boolean)
    );
  } catch {
    eskiDizinler = new Set();
  }

  const yeniDizinler = existsSync(join(REPO_ROOT, MIGRATIONS_DIR))
    ? readdirSync(join(REPO_ROOT, MIGRATIONS_DIR)).filter(
        (d) =>
          statSync(join(REPO_ROOT, MIGRATIONS_DIR, d)).isDirectory() && !eskiDizinler.has(d)
      )
    : [];

  // Yeni migration'larda eklenen RESTRICT/NO ACTION FK'larının EBEVEYN tablosu
  const ebeveynler = new Set();
  for (const d of yeniDizinler) {
    const sqlYol = join(REPO_ROOT, MIGRATIONS_DIR, d, "migration.sql");
    if (!existsSync(sqlYol)) continue;
    const sql = readFileSync(sqlYol, "utf8");
    for (const m of sql.matchAll(
      /REFERENCES\s+"?(\w+)"?\s*\([^)]*\)\s*ON DELETE (RESTRICT|NO ACTION)/gi
    )) {
      ebeveynler.add(m[1]);
    }
  }

  if (ebeveynler.size > 0) {
    const bekciler = existsSync(join(REPO_ROOT, SCRIPTS_DIR))
      ? readdirSync(join(REPO_ROOT, SCRIPTS_DIR)).filter(
          (f) => f.startsWith("test_") && f.endsWith(".ts")
        )
      : [];
    const uyarilar = [];
    for (const tablo of [...ebeveynler].sort()) {
      // `import_run_lines` → `importRun` (Prisma delegate adı)
      const tekil = tablo.replace(/s$/, "");
      const delegate = tekil.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      const desen = new RegExp(`(?:prisma|tx)\\.${delegate}\\.deleteMany`);
      const eslesen = bekciler.filter((f) =>
        desen.test(readFileSync(join(REPO_ROOT, SCRIPTS_DIR, f), "utf8"))
      );
      if (eslesen.length > 0) uyarilar.push({ tablo, delegate, eslesen });
    }

    if (uyarilar.length > 0) {
      console.log("\n⚠️  [ADVISORY] yeni RESTRICT FK'sı — bu ebeveyni SİLEN bekçiler:");
      for (const u of uyarilar) {
        if (u.eslesen.length > 10) {
          // Uzunluğun kendisi bir bulgudur: bu kadar bekçiyi ilgilendiren bir FK
          // muhtemelen `Cascade` olmalıydı.
          console.log(
            `   ${u.tablo} (${u.delegate}) — ${u.eslesen.length} bekçi. GENİŞ ETKİLİ, ` +
              `onDelete kararını gözden geçir. İlk beşi:`
          );
          for (const f of u.eslesen.slice(0, 5)) console.log(`     · ${f}`);
        } else {
          console.log(`   ${u.tablo} (${u.delegate}):`);
          for (const f of u.eslesen) console.log(`     · ${f}`);
        }
      }
      console.log(
        "   → Bu bekçilerin temizliği ÇOCUĞU önce silmeli, yoksa P2003. Tavsiyedir, kırmızı değil.\n"
      );
    }
  }
}

// --- Rapor ------------------------------------------------------------------
// Uyarılar GÜRÜLTÜ OLMAMALI: yalnız gerçekten bekleyen dosya varsa basılır, dosya
// ADIYLA söylenir ve sahibi hakkında TAHMİN YÜRÜTÜLMEZ ("başka bir oturumun açık
// işi" gibi bir cümle ölçülmemiş bir iddiadır).
if (uyarilar.length > 0) {
  console.log(
    "\n⚠️  Ağaçta commit edilmemiş dosya var ama BU COMMIT migration'a dokunmuyor — kapı geçti.",
  );
  for (const u of uyarilar) {
    console.log(`   [${u.gate}]`);
    for (const it of u.items) console.log(`     • ${it}`);
    if (u.ayrim) console.log(u.ayrim);
  }
  console.log(
    "   Senin dosyansa: `git add` yeter (commit etmek şart değil). Bir sonraki\n" +
      "   migration commit'inde bu kapı SERT davranır.\n",
  );
}

if (problems.length === 0) {
  const count = existsSync(migRoot)
    ? readdirSync(migRoot).filter((d) => statSync(join(migRoot, d)).isDirectory()).length
    : 0;
  console.log(
    `✅ Migration bekçisi: ${count} migration izleniyor, commit edilmemiş/değiştirilmiş dosya yok.`
  );
  process.exit(0);
}

console.error("❌ Migration bekçisi ihlal buldu:\n");
for (const p of problems) {
  console.error(`  [${p.gate}]`);
  console.error(`  ${p.why}`);
  for (const it of p.items) console.error(`    • ${it}`);
  // İLGİLİ ↔ İLGİSİZ ayrımı (yalnız GATE 4 taşır) — duran kişi KİMİN işi
  // yüzünden durduğunu görsün. Sertliği DEĞİŞTİRMEZ, yalnız görünür kılar.
  if (p.ayrim) console.error(p.ayrim);
  console.error(`  → Düzelt: ${p.fix}\n`);
}
console.error(
  "KURAL: elle yazılan migration `git add` EDİLMEDEN `prisma db execute` KOŞULMAZ\n" +
    "(Teks-Erp/CLAUDE.md). Dosya DB'ye uygulanmadan önce izlenir olmalı."
);
process.exit(1);
