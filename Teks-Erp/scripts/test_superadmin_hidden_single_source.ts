// =============================================================================
// BEKÇİ — GİZLİ HESAP SÜZGECİ "TEK KAYNAK" (satıcı/süperadmin görünmezliği)
// =============================================================================
// NE KORUYOR: `User.isSystemAccount` bir SATICI hesabını işaretler. Hesap DB'de
// gerçek bir satırdır (audit ve FK sanal kullanıcı kabul etmez) ama fabrikanın
// kullanıcı / oturum / aktör yüzeylerinde GÖRÜNMEMELİDİR. Kural
// `services/helpers/system-account.helper.ts`te yaşar ve ONBİR ayrı yüzeye
// dağılır.
//
// NEDEN MEKANİK BEKÇİ: bu, unutulunca PATLAMAYAN bir kuraldır — süzgeci atlayan
// yeni bir yüzey hata vermez, log basmaz; yalnız satıcı hesabı fabrikanın
// listesinde görünür ve bunu FARK EDECEK tek kişi onu görmemesi gereken kişidir.
// Aynı sınıfın iki emsali: `test_order_line_scope_single_source` (iptal edilmiş
// kalem) ve `test_fason_open_dispatch_single_source` (açık fason sevki).
//
// BEŞ KOL, BEŞİ DE AYRI BİR SESSİZ BOZULMA YOLU:
//   §1 Prisma kolu   — `prisma.user.findMany/findFirst/count/groupBy` süzgeçsiz.
//   §2 İlişki kolu   — aktör üzerinden listeleyen model sorguları (WorkSession /
//                      SystemLog). ⚠️ NULLABLE tuzağı: `SystemLog.userId` NULL
//                      olabilir ve düz `{ user: … }` yazımı `userId IS NULL`
//                      olan SİSTEM olaylarını da düşürür (2 Eyl fabrika dump'ının
//                      TAZE restore'unda 16241 audit satırının 641'i — %3.9;
//                      spec'teki 18509/1952 test artığı biriken çalışma DB'sinden
//                      alınmıştı, D1/D3 ölçtü).
//   §3 Ham SQL kolu  — Prisma where'i `$queryRaw` sorgularını KAPSAMAZ.
//   §4 `*` körlüğü   — düz `includes("admin:*")` yazımı `["*"]` taşıyan satıcıyı
//                      TANIMAZ; tek doğru yüklem `matchesPermission`.
//   §7 Maske kolu   — audit satırı SÜZÜLMEZ, aktörü NÖTRLENİR (karar #8); maskenin
//                      TEK uygulaması `system-log.service`in dört okuma yoludur ve
//                      2026-09-03'e dek HİÇBİR bekçi onu ölçmüyordu.
// Ek: §5 helper boşalmadı (körlük zemini) · §6 `isSystemAccount` YAZMA allowlist'i
// (alan hiçbir Zod şemasına / panel yoluna girmez — hesap panelden ATANAMAZ).
//
// ⚠️ Bu dosyayı gevşetmeden önce: kuralı ihlal eden yer bulunca doğru tepki
// MUAFA EKLEMEK DEĞİL, süzgeci koymaktır. Muaflar İKİ YÖNLÜ denetlenir — ölü
// bir muaf gerçek bir ihlali sessizce kapsam dışında tutar.
//
// Salt-okunur: DB'ye dokunmaz, HTTP atmaz — boş CI veritabanında da tam koşar.
// Koşum: npx tsx scripts/test_superadmin_hidden_single_source.ts
//
// NEGATİF SONDALAR — 2026-09-03'te ÖLÇÜLDÜ (taban: **40 geçti / 0 başarısız**,
// çıkış 0; her sondadan sonra `cp` + `md5 -q` ile birebir geri alındı):
//   SONDA-H1  → çıkış 1 · 1 ❌ · §5 — helper'dan süzgeç silindi
//               (`VISIBLE_USER = { isSystemAccount: false }` → `= {}`)
//   SONDA-H2  → çıkış 1 · 1 ❌ · §1 — Prisma kolunda helper çağrısı silindi
//               (permission-management `visibleUserWhere({ deletedAt: null })`
//                → `{ deletedAt: null }`; kırmızı satır numarasıyla geldi)
//   SONDA-H2b → çıkış 1 · 1 ❌ · §2 — İLİŞKİ kolunda helper çağrısı silindi
//               (work-session `history()` ortak where'inden `...VISIBLE_ACTOR`)
//   SONDA-H3  → çıkış 1 · 1 ❌ · §2 — NULLABLE modelde `userId: { not: null }`
//               koruması düştü (system-log `listActiveUsers`)
//               ⚠️ İLK KOŞUMDA ETKİSİZ SONDAYDI: kontrol fonksiyon gövdesini HAM
//               okuyordu ve süzgecin yanındaki AÇIKLAMA SATIRI aynı ifadeyi metin
//               olarak taşıyordu → koruma silinmişken YEŞİL kaldı. `yorumlariSok`
//               eklendi (aynı ders `regime-gate-scan.ts` başlığında: reports.routes
//               yalnız bir yorumda "kapılı" görünüyordu). Bekçinin kör noktası
//               hatanın kendisiyle aynı yerdeydi.
//   SONDA-H4  → çıkış 1 · 1 ❌ · §3 — ham SQL'den filtre silindi
//               (production.report `AND ${SQL_VISIBLE_USER}` satırı)
//   SONDA-H5  → çıkış 1 · 1 ❌ · §4 — `matchesPermission` düz
//               `includes("admin:*")`e çevrildi (demo.service)
//   SONDA-H6  → çıkış 1 · 2 ❌ · §6 — `isSystemAccount` bir Zod şemasına eklendi
//   SONDA-H7  → çıkış 1 · 1 ❌ · §3 — audit raporunun takma-ad CASE'i düz
//               `u.username`/`u."fullName"` ile değiştirildi
//   ── §7 (2026-09-03 düzeltme turu) ─────────────────────────────────────────
//   SONDA-F1  → 39/1 · `list()` dönüşünden `withMaskedActor` kaldırıldı
//   SONDA-F2  → 39/1 · `findById()` dönüşünden maske kaldırıldı
//   SONDA-F3  → 39/1 · `withMaskedActor`ın `recordId` nötrlemesi kaldırıldı
//   SONDA-F4  → 39/1 · `listArchive` elle `maskSystemActor`a döndürüldü
//   SONDA-X3  → (V bulgusu) `findArchiveById` elle maskeye döndürüldü → eski §7
//               KÖRDÜ (40/0); döngüye alınınca kırmızı (ölçüm aşağıda, başlıkta)
//   SONDA-F5  → 39/1 · `device.service` cihaz detayı düz
//               `{ id, username, fullName }` select'ine döndürüldü
// =============================================================================

import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";
import { yorumlariSok } from "./lib/regime-gate-scan";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

const SRC = path.resolve(__dirname, "..", "src");
const HELPER_REL = path.join("services", "helpers", "system-account.helper.ts");
const HELPER_ABS = path.join(SRC, HELPER_REL);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && p.endsWith(".ts")) out.push(p);
  }
  return out;
}
const FILES = walk(SRC).sort();
const rel = (f: string): string => path.relative(SRC, f).split(path.sep).join("/");

function oku(f: string): ts.SourceFile {
  return ts.createSourceFile(f, fs.readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true);
}
function satirNo(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

// -----------------------------------------------------------------------------
// GEREKÇELİ MUAFLAR — hepsi İKİ YÖNLÜ denetlenir (ölü muaf = kırmızı)
// -----------------------------------------------------------------------------

/**
 * §1 — `prisma.user.*` çoklu/arama sorgusu ama SÜZÜLMEZ.
 *
 * İki meşru sınıf var ve ikisi de burada:
 *   (a) KİMLİK ÇÖZÜMÜ — `where: { id: { in: [...] } }`: id zaten elde, liste
 *       üretmiyor. Süzmek "kullanıcı bulunamadı"ya çevirirdi.
 *   (b) SÜZÜLÜRSE YANLIŞ CEVAP ÜRETEN yüklemler — giriş, kullanıcı adı
 *       tekilliği, "son admin kim" sayımı.
 */
// ⚠️ KAPSAM: yalnız ÇOKLU/ARAMA yöntemleri taranır (`findMany`/`findFirst`/
// `count`/`groupBy`/`aggregate`). `findUnique` bilinçli olarak DIŞARIDA: o
// zaten elde olan bir id'yi çözer, liste üretmez ve süzülürse (404 kapısı ·
// `getEffectivePermissions` bypass'ı) tam da işini yapamaz hale gelir.
const PRISMA_MUAF: Record<string, string> = {
  "jobs/superadmin.job.ts":
    "hesabı YARATAN/ROTASYONLAYAN job — süzgeç kendi işini görünmez kılardı",
  "services/auth.service.ts:143":
    "kart ile GİRİŞ — süzülürse satıcı sisteme hiç giremez (hesabın varlık sebebi)",
  "services/auth.service.ts:173":
    "hızlı PIN ile GİRİŞ — aynı gerekçe",
  "services/permission-management.service.ts:506":
    "kullanıcı adı TEKİLLİĞİ — süzülürse satıcının adı ikinci kez yaratılabilir hale gelir",
  "services/permission-management.service.ts:711":
    "'son admin:users sahibi' sayımı — grant tabanlı; satıcının grant satırı YOKTUR (izin koddan gelir), yani no-op",
  "services/permission-management.service.ts:740":
    "aynı sayımın pasifleştirme ikizi — aynı gerekçe",
  "services/record-info.service.ts:235":
    "id ile AD ÇÖZÜMÜ (künye) — liste değil; ayrıca takma ad zaten fullName'de doğar",
  "services/stock-count.service.ts:1125":
    "id ile AD ÇÖZÜMÜ (sayım belgesi) — liste değil",
  "services/system-log.service.ts:303":
    "id ile AKTÖR ÇÖZÜMÜ — `maskSystemActor` ile nötrlenir (karar #8: satır kalır, kimlik gizlenir)",
};

/** §3 — `FROM/JOIN users` geçen ama ham SQL süzgeci taşımayan yerler. */
const SQL_MUAF: Record<string, string> = {
  "services/helpers/system-account.helper.ts":
    "kuralın kendi dosyası (başlık yorumunda tablo adı geçiyor)",
  "services/duplicate-rolls.service.ts":
    "top satırlarını listeler, kullanıcı satırını DEĞİL; users yalnız `fullName` için LEFT JOIN'lenir ve o zaten takma addır",
};

/** §4 — `admin:*` düz metin yükleminin TEK meşru yeri. */
const WILDCARD_MUAF: Record<string, string> = {
  "middlewares/rbac.middleware.ts": "joker çözümünün KENDİSİ burada tanımlı",
};

/**
 * §6 — `isSystemAccount` adının geçebileceği dosyalar (YAZMA allowlist'i).
 *
 * Alan panelden ATANAMAZ: hiçbir Zod şemasında, hiçbir `update`/`create`
 * gövdesinde geçmez. Tek yazar boot job'ıdır.
 */
const ALAN_ALLOWLIST: Record<string, string> = {
  "services/helpers/system-account.helper.ts": "kuralın tek kaynağı",
  "jobs/superadmin.job.ts": "TEK YAZAR (boot job)",
  "middlewares/system-account.middleware.ts": "404 kapısı — hedefi okur",
  "middlewares/auth.middleware.ts": "istek başına taze kimlik okuması (`req.isSystemAccount`)",
  "types/express-augment.ts": "`req.isSystemAccount` tip beyanı",
  "controllers/auth.controller.ts": "`/auth/me` yanıtı (panel salt-okunur kararı)",
  "routes/feature-flag.routes.ts": "modül anahtarı guard'ı — kimliği OKUR",
  "services/auth.service.ts": "`getEffectivePermissions` süperadmin bypass'ı",
  "services/system-log.service.ts": "aktör select'i + maskeleme tipi",
  "services/helpers/system-account.registry.ts":
    "kilit defterinin TEMBEL DOĞRULAMASI — `findFirst({ where: { isSystemAccount: true } })` ile DB'den okur (yazmaz)",
};

// =============================================================================
console.log("=== 0) Körlük zemini ===");
// Tarayıcı boşa düşerse "ihlal yok" ile "hiçbir şeye bakmadım" AYNI yeşile çıkar.
check("kaynak ağacı tarandı (>200 dosya)", FILES.length > 200, `${FILES.length} dosya`);
check("tek kaynak dosyası duruyor", fs.existsSync(HELPER_ABS));

const HELPER_SRC = fs.existsSync(HELPER_ABS) ? fs.readFileSync(HELPER_ABS, "utf8") : "";
const importerlar = FILES.filter(
  (f) => f !== HELPER_ABS && /from "[^"]*system-account\.helper"/.test(fs.readFileSync(f, "utf8")),
);
check(
  "yardımcı GERÇEKTEN kullanılıyor (≥6 dosya)",
  importerlar.length >= 6,
  `${importerlar.length} — düşerse kural yazılı ama uygulanmıyor demektir`,
);

// =============================================================================
console.log("\n=== 1) Prisma kolu — `prisma.user.*` liste/arama sorguları ===");
{
  const ihlaller: string[] = [];
  const kullanilanMuaf = new Set<string>();
  let olculen = 0;

  for (const f of FILES) {
    if (f === HELPER_ABS) continue;
    const r = rel(f);
    const src = fs.readFileSync(f, "utf8");
    if (!/\.user\.(findMany|findFirst|count|groupBy|aggregate)\b/.test(src)) continue;
    const sf = oku(f);

    const gez = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
        const yontem = n.expression.name.text;
        const kap = n.expression.expression;
        if (
          ["findMany", "findFirst", "count", "groupBy", "aggregate"].includes(yontem) &&
          ts.isPropertyAccessExpression(kap) &&
          kap.name.text === "user" &&
          ts.isIdentifier(kap.expression) &&
          ["prisma", "tx", "db", "client"].includes(kap.expression.text)
        ) {
          olculen++;
          const ln = satirNo(sf, n);
          // Muaf iki biçimde verilebilir: dosya geneli ya da `dosya:satır`.
          const anahtarDosya = r;
          const anahtarSatir = `${r}:${ln}`;
          if (PRISMA_MUAF[anahtarSatir]) {
            kullanilanMuaf.add(anahtarSatir);
            return;
          }
          if (PRISMA_MUAF[anahtarDosya]) {
            kullanilanMuaf.add(anahtarDosya);
            return;
          }
          // Süzgeç ARGÜMANIN İÇİNDE bir helper sembolü olarak geçmeli.
          const metin = n.getText(sf);
          const helperli =
            /\bvisibleUserWhere\s*\(/.test(metin) ||
            /\bVISIBLE_USER\b/.test(metin) ||
            /\bisSystemAccount\b/.test(metin);
          if (!helperli) {
            ihlaller.push(`${r}:${ln}  ${metin.split("\n")[0]!.slice(0, 70)}`);
          }
        }
      }
      ts.forEachChild(n, gez);
    };
    gez(sf);
  }

  check("körlük zemini — en az 10 `prisma.user.*` sorgusu ölçüldü", olculen >= 10, `${olculen}`);
  check(
    "süzgeçsiz `prisma.user.*` liste/arama sorgusu YOK",
    ihlaller.length === 0,
    ihlaller.join("\n     "),
  );
  const bayat = Object.keys(PRISMA_MUAF).filter((k) => !kullanilanMuaf.has(k));
  check("§1 muaf listesi bayat değil (ölü muaf gerçek ihlali gizler)", bayat.length === 0, bayat.join(", "));
}

// =============================================================================
console.log("\n=== 2) İlişki kolu — aktör üzerinden listeleyen sorgular ===");
// Bu koldaki sorgular `prisma.user.*` DEĞİL: WorkSession / SystemLog üzerinden
// listeler ve satıcının izini AKTÖR ilişkisiyle taşırlar.
{
  /** [dosya, fonksiyon adı, aktör ilişkisi NULLABLE mı] */
  const AKTOR_YUZEYLERI: Array<{ dosya: string; fn: string; nullable: boolean; not: string }> = [
    {
      dosya: "services/work-session.service.ts",
      fn: "listActive",
      nullable: false,
      not: "canlı oturum paneli — WorkSession.userId ZORUNLU",
    },
    {
      dosya: "services/work-session.service.ts",
      fn: "history",
      nullable: false,
      not: "ayak izi geçmişi — count+findMany ORTAK where",
    },
    {
      dosya: "services/system-log.service.ts",
      fn: "listActiveUsers",
      nullable: true,
      not: "audit aktör DROPDOWN'ı — SystemLog.userId NULLABLE",
    },
  ];

  for (const y of AKTOR_YUZEYLERI) {
    const f = path.join(SRC, y.dosya);
    const sf = oku(f);
    let govde: string | null = null;
    const gez = (n: ts.Node): void => {
      if (
        (ts.isMethodDeclaration(n) || ts.isFunctionDeclaration(n)) &&
        n.name &&
        ts.isIdentifier(n.name) &&
        n.name.text === y.fn
      ) {
        govde = n.getText(sf);
      }
      ts.forEachChild(n, gez);
    };
    gez(sf);
    // ⚠️ YORUMLAR AYIKLANIR — bu, ölçülmüş bir kör noktadır (SONDA-H3'ün İLK
    // koşumu): süzgecin yanındaki açıklama satırı `userId: { not: null }`
    // ifadesini METİN olarak taşıyor ve koruma koddan silinse bile kontrol
    // YEŞİL kalıyordu. `regime-gate-scan.ts` başlığındaki aynı ders
    // (`reports.routes.ts` yalnız bir yorumda "kapılı" görünüyordu).
    const g: string = govde ? yorumlariSok(govde) : "";
    check(`${y.dosya} → ${y.fn}() bulundu (körlük zemini)`, g.length > 0, y.not);
    if (!g) continue;

    const helperli = /\bVISIBLE_ACTOR(_OR_SYSTEM)?\b/.test(g);
    check(`${y.fn}(): aktör süzgeci helper'dan geliyor`, helperli, y.not);

    if (y.nullable && /\bVISIBLE_ACTOR\b/.test(g) && !/\bVISIBLE_ACTOR_OR_SYSTEM\b/.test(g)) {
      // ⚠️ NULLABLE TUZAĞI: düz `{ user: … }` yazımı `userId IS NULL` olan sistem
      // olaylarını da düşürür. İki doğru yazım var — ya `VISIBLE_ACTOR_OR_SYSTEM`,
      // ya da AYNI where'de açıkça `userId: { not: null }` (yani sorgu zaten
      // yalnız aktörlü satırlarla ilgileniyor).
      check(
        `${y.fn}(): NULLABLE aktörde düz yazım korumalı ('userId: not null' var)`,
        /userId\s*:\s*\{\s*not\s*:\s*null\s*\}/.test(g),
        "yoksa doğru yazım VISIBLE_ACTOR_OR_SYSTEM'dir — 641 sistem olayı sessizce düşer",
      );
    }
  }
}

// =============================================================================
console.log("\n=== 3) Ham SQL kolu — `FROM/JOIN users` ===");
{
  const ihlaller: string[] = [];
  const kullanilanMuaf = new Set<string>();
  let olculen = 0;

  for (const f of FILES) {
    const r = rel(f);
    const src = fs.readFileSync(f, "utf8");
    const satirlar = src.split("\n");
    satirlar.forEach((line, i) => {
      if (!/\b(FROM|JOIN)\s+"?users"?\b/i.test(line)) return;
      olculen++;
      if (SQL_MUAF[r]) {
        kullanilanMuaf.add(r);
        return;
      }
      // Sorgunun tamamına bak (JOIN satırı ile WHERE arasında mesafe olabilir).
      // İki meşru yol var ve ikisi de KABUL EDİLİR:
      //   ① SÜZ    → `SQL_VISIBLE_USER` (üretim raporu: satıcı satır AÇMAZ)
      //   ② NÖTRLE → `SQL_ACTOR_USERNAME`/`SQL_ACTOR_FULLNAME` (denetim raporu:
      //              satır KALIR, kimlik gizlenir — karar #8)
      const pencere = satirlar.slice(Math.max(0, i - 25), i + 25).join("\n");
      const korumali =
        /\bSQL_VISIBLE_USER\b/.test(pencere) ||
        (/\bSQL_ACTOR_USERNAME\b/.test(pencere) && /\bSQL_ACTOR_FULLNAME\b/.test(pencere));
      if (!korumali) ihlaller.push(`${r}:${i + 1}  ${line.trim().slice(0, 80)}`);
    });
  }

  check("körlük zemini — en az 3 ham SQL `users` erişimi ölçüldü", olculen >= 3, `${olculen}`);
  check(
    "ham SQL'deki her `users` erişimi ya SÜZÜYOR ya NÖTRLÜYOR",
    ihlaller.length === 0,
    ihlaller.join("\n     "),
  );
  const bayat = Object.keys(SQL_MUAF).filter((k) => !kullanilanMuaf.has(k));
  check("§3 muaf listesi bayat değil", bayat.length === 0, bayat.join(", "));

  // Takma ad SÖZLEŞMESİ: helper'ın SQL parçaları `u.` ile yazılmıştır.
  check(
    "helper'ın SQL parçaları `u` takma adını kullanıyor (sözleşme)",
    /u\."isSystemAccount"/.test(HELPER_SRC),
    "takma ad değişirse tüketici sorgu 'column u does not exist' ile düşer",
  );
}

// =============================================================================
console.log("\n=== 4) `*` körlüğü — düz `includes(\"admin:*\")` YASAK ===");
{
  const ihlaller: string[] = [];
  const kullanilanMuaf = new Set<string>();
  for (const f of FILES) {
    const r = rel(f);
    const src = fs.readFileSync(f, "utf8");
    src.split("\n").forEach((line, i) => {
      const kod = line.split("//")[0] ?? "";
      // `.includes("admin:*")` / `.has("admin:*")` — satıcının `["*"]`ını TANIMAZ.
      if (!/\.(includes|has)\(\s*["']admin:\*["']\s*\)/.test(kod)) return;
      if (WILDCARD_MUAF[r]) {
        kullanilanMuaf.add(r);
        return;
      }
      ihlaller.push(`${r}:${i + 1}  ${line.trim().slice(0, 80)}`);
    });
  }
  check(
    "düz `admin:*` metin yüklemi YOK (tek doğru yüklem `matchesPermission`)",
    ihlaller.length === 0,
    ihlaller.join("\n     ") ||
      "satıcı `[\"*\"]` taşır — düz includes onu tanımaz ve satıcı KENDİ kapısında 403 yer",
  );
  // ⚠️ Muaf burada TEK YÖNLÜ denetlenir: `rbac.middleware` joker çözümünü bugün
  // `startsWith` ile yapıyor olabilir; muafın kullanılmaması bir ihlal değildir.
  check(
    "muaf dosya duruyor (joker çözümü hâlâ tek yerde)",
    fs.existsSync(path.join(SRC, "middlewares/rbac.middleware.ts")),
    kullanilanMuaf.size ? "muaf kullanıldı" : "muaf kullanılmadı (rbac joker'i metin yüklemi kullanmıyor)",
  );
}

// =============================================================================
console.log("\n=== 5) Tek kaynak boşalmadı ===");
{
  check(
    "`VISIBLE_USER` gerçek bir süzgeç taşıyor (`isSystemAccount: false`)",
    /VISIBLE_USER[^=]*=\s*\{\s*isSystemAccount\s*:\s*false\s*\}/.test(HELPER_SRC),
    "boşaltılırsa TÜM yüzeyler helper'ı çağırmaya devam eder ve HİÇBİRİ süzmez",
  );
  check(
    "`visibleUserWhere` süzgeci SONDA spread ediyor (çağıran ezemez)",
    /return\s*\{\s*\.\.\.\(?extra[^}]*\}\s*\)?\s*,\s*\.\.\.VISIBLE_USER\s*\}/.test(
      HELPER_SRC.replace(/\s+/g, " "),
    ) || /\.\.\.\s*VISIBLE_USER\s*\}\s*;/.test(HELPER_SRC),
    "ters sırada `visibleUserWhere({ isSystemAccount: true })` hesabı AÇARDI",
  );
  check(
    "`VISIBLE_ACTOR_OR_SYSTEM` nullable yazımını gerçekten koruyor (`userId: null` dalı)",
    /VISIBLE_ACTOR_OR_SYSTEM[\s\S]{0,160}userId\s*:\s*null/.test(HELPER_SRC),
  );
  check(
    "`maskSystemActor` `isSystemAccount` alanını yanıttan DÜŞÜRÜYOR",
    /const\s*\{\s*isSystemAccount\s*,\s*\.\.\.rest\s*\}\s*=\s*user/.test(HELPER_SRC),
    "sızarsa takma ad anlamsızlaşır: 'bu aktör satıcıdır' bilgisi aynen ilan edilir",
  );
  check(
    "`ACTOR_SELECT` `isSystemAccount` taşıyor (maskeleme girdisi)",
    /ACTOR_SELECT[\s\S]{0,220}isSystemAccount\s*:\s*true/.test(HELPER_SRC),
    "taşımazsa `maskSystemActor` sessizce no-op'a düşer (undefined → 'normal kullanıcı')",
  );
}

// =============================================================================
console.log("\n=== 6) `isSystemAccount` YAZMA allowlist'i (panelden ATANAMAZ) ===");
{
  const disaridakiler: string[] = [];
  const kullanilan = new Set<string>();
  for (const f of FILES) {
    const r = rel(f);
    const src = fs.readFileSync(f, "utf8");
    if (!/\bisSystemAccount\b/.test(src)) continue;
    if (ALAN_ALLOWLIST[r]) {
      kullanilan.add(r);
      continue;
    }
    disaridakiler.push(r);
  }
  check(
    "`isSystemAccount` yalnız allowlist dosyalarında geçiyor",
    disaridakiler.length === 0,
    disaridakiler.join(", ") ||
      "hesap panelden atanamaz — alan hiçbir yazma gövdesine/şemasına girmez",
  );
  const bayat = Object.keys(ALAN_ALLOWLIST).filter((k) => !kullanilan.has(k));
  check("§6 allowlist bayat değil", bayat.length === 0, bayat.join(", "));

  // İkinci yüklem — ADI allowlist'te olan bir dosyaya bile Zod şeması eklenemez.
  const zodIhlal: string[] = [];
  for (const f of FILES) {
    const src = fs.readFileSync(f, "utf8");
    src.split("\n").forEach((line, i) => {
      const kod = line.split("//")[0] ?? "";
      if (/isSystemAccount\s*:\s*z\./.test(kod)) zodIhlal.push(`${rel(f)}:${i + 1}`);
    });
  }
  check(
    "hiçbir Zod şemasında `isSystemAccount` alanı YOK",
    zodIhlal.length === 0,
    zodIhlal.join(", ") || "istemci bu alanı GÖNDEREMEZ",
  );

  // Üçüncü yüklem — TEK YAZAR: `isSystemAccount: true` yazan bir Prisma
  // create/update gövdesi yalnız job'da olabilir.
  const yazanlar: string[] = [];
  for (const f of FILES) {
    const r = rel(f);
    if (r === "jobs/superadmin.job.ts") continue;
    const src = fs.readFileSync(f, "utf8");
    src.split("\n").forEach((line, i) => {
      const kod = line.split("//")[0] ?? "";
      // `where:` içindeki `isSystemAccount: true` OKUMA'dır (job + middleware);
      // yazma bir `data:` gövdesinde olur. Yüklemi dar tutmak için hem satırı
      // hem önceki 3 satırı `data:` açısından yokla.
      if (!/isSystemAccount\s*:\s*true/.test(kod)) return;
      const onceki = src.split("\n").slice(Math.max(0, i - 4), i + 1).join("\n");
      if (/\bdata\s*:\s*\{/.test(onceki)) yazanlar.push(`${r}:${i + 1}`);
    });
  }
  check(
    "`isSystemAccount: true` yazan TEK yer boot job'ı",
    yazanlar.length === 0,
    yazanlar.join(", ") || "başka yazar yok",
  );
}

// =============================================================================
console.log("\n=== 7) Audit MASKESİ tek sarmalayıcıdan geçiyor ===");
// BEŞİNCİ KOL (2026-09-03, D2 major #2 — ÖLÇÜLMÜŞ KÖR NOKTA).
// Karar #8 audit satırını SÜZMEZ, aktörünü NÖTRLER. Yani `system-log.service`in
// dört okuma yolu (list · findById · listArchive · findArchiveById) maskenin TEK
// uygulamasıdır — ve sonda ölçüldü: `withMaskedActor(` çağrısını silmek hiçbir
// bekçiyi kırmıyordu (test_superadmin 99/0, bu dosya 28/0). Bir refactor maskeyi
// SESSİZCE düşürebilirdi.
//
// ⚠️ NEDEN AST, NEDEN "dönüşte": maske `return` ifadesinde uygulanır; dosyanın
// herhangi bir yerinde `maskSystemActor` adının GEÇMESİ yetmez (bir yorumda ya da
// import satırında da geçebilir — `yorumlariSok` dersinin ikizi). Bu yüzden
// kontrol her yöntemin GÖVDESİNDE, yorumlar ayıklanmış hâlde arar.
{
  const f = path.join(SRC, "services", "system-log.service.ts");
  const sf = oku(f);
  const YOLLAR = [
    { fn: "list", not: "genel audit listesi — en çok bakılan yüzey" },
    { fn: "findById", not: "tek kayıt detayı (oldData/newData ile)" },
    { fn: "listArchive", not: "arşiv listesi — 6 ayda bir dolar, yıllarca ölçülmeden kalabilir" },
    { fn: "findArchiveById", not: "arşiv detayı" },
  ];
  const govdeler = new Map<string, string>();
  const gez = (n: ts.Node): void => {
    if (
      (ts.isMethodDeclaration(n) || ts.isFunctionDeclaration(n)) &&
      n.name &&
      ts.isIdentifier(n.name)
    ) {
      govdeler.set(n.name.text, n.getText(sf));
    }
    ts.forEachChild(n, gez);
  };
  gez(sf);

  for (const y of YOLLAR) {
    const ham = govdeler.get(y.fn);
    check(`system-log.service → ${y.fn}() bulundu (körlük zemini)`, !!ham, y.not);
    if (!ham) continue;
    const g = yorumlariSok(ham);
    check(
      `${y.fn}(): dönüşü withMaskedActor / maskSystemActor'tan geçiyor`,
      /\b(withMaskedActor|maskSystemActor)\b/.test(g),
      y.not,
    );
    // ⚠️ DÖRT yolda da ELLE `maskSystemActor(` YASAK — yalnız sarmalayıcı
    // (`withMaskedActor`) serbest. Elle çağrı `recordId` nötrlemesini atlar ve
    // ölçüldü (V sonda X3): kural yalnız `listArchive` için yazılıyken aynı
    // bozulma `findArchiveById`de iki bekçiyi de yeşil bırakıyordu (kör nokta).
    check(
      `${y.fn}(): elle maskSystemActor( DEĞİL, withMaskedActor sarmalayıcısı`,
      /\bwithMaskedActor\b/.test(g) && !/\bmaskSystemActor\s*\(/.test(g),
      "elle çağrı `recordId` nötrlemesini ATLAR — yol canlıdan ayrışır",
    );
  }

  // Maskenin KENDİSİ boşalmasın: `AUTH` satırının `recordId`'si de nötrlenmeli.
  // (Aktör nesnesi maskeliyken aynı satırın `recordId`'si gerçek giriş adını
  // basıyordu — takma ad AYNI SATIRDA çürüyordu; D1/D2'de ölçüldü.)
  const servisSrc = yorumlariSok(fs.readFileSync(f, "utf8"));
  check(
    "`withMaskedActor` `AUTH` satırında `recordId`'yi de nötrlüyor",
    /tableName\s*===\s*"AUTH"/.test(servisSrc) && /SYSTEM_ACTOR_USERNAME/.test(servisSrc),
    "yoksa `{\"recordId\":\"<gerçek ad>\",\"user\":{\"username\":\"sistem\"}}` yan yana basılır",
  );
  // ── AYNI KURALIN İKİNCİ YÜZEYİ: cihaz detayı ("son oturum") ───────────────
  // Bu yüzey SÜZÜLEMEZ (satır düşerse cihaz hiç kullanılmamış görünür) ama düz
  // `username: true` select'i de yanlıştı ve ÖLÇÜLDÜ (D1): satıcı tablete PIN'le
  // girince — tasarımın KENDİ akışı — oturum o cihaza yazılıyor ve `admin:settings`
  // taşıyan her yönetici Cihazlar ekranında gerçek giriş adını görüyordu.
  {
    const df = path.join(SRC, "services", "device.service.ts");
    const dsf = oku(df);
    let detayGovde: string | null = null;
    const gezD = (n: ts.Node): void => {
      if (
        (ts.isMethodDeclaration(n) || ts.isFunctionDeclaration(n)) &&
        n.name &&
        ts.isIdentifier(n.name) &&
        (n.name.text === "getById" || n.name.text === "detail")
      ) {
        detayGovde = n.getText(dsf);
      }
      ts.forEachChild(n, gezD);
    };
    gezD(dsf);
    const dg: string = detayGovde ? yorumlariSok(detayGovde) : "";
    check("device.service → cihaz detayı bulundu (körlük zemini)", dg.length > 0);
    if (dg) {
      check(
        "cihaz detayı `lastSession` aktörünü `ACTOR_SELECT` + `maskSystemActor` ile veriyor",
        /\bACTOR_SELECT\b/.test(dg) && /\bmaskSystemActor\b/.test(dg),
        "düz `username: true` select'i satıcının giriş adını Cihazlar ekranına basar",
      );
    }
  }

  // (Eski tek-yol `listArchive` kontrolü yukarıdaki döngüye genelleştirildi —
  // V sonda X3: `findArchiveById` aynı bozulmada kördü.)
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
