// =============================================================================
// BEKÇİ — EN YETKİLİ HESAP GÖRÜNÜRDÜR (gizleme GERİ GELMESİN)
// =============================================================================
// Çalıştır: npx tsx scripts/test_superadmin_visible.ts
//
// 2026-09-04 KARAR DEĞİŞİKLİĞİ. Satıcı (süperadmin) hesabı sistemin HER
// yüzeyinden gizleniyordu: kullanıcı listelerinden süzülüyor, audit satırlarında
// "Sistem Bakımı"/"sistem" takma adıyla görünüyor, `/api/admin/users/:id` 404
// dönüyordu. Kullanıcı kararı: en yetkili kişi DB'den görevlendirilen GERÇEK bir
// kullanıcıdır ve her yerden görünür olur — gizlilik iz sürmeyi de imkânsız
// kılıyordu ve bir yetkinin kim tarafından kullanıldığı, o yetki EN GENİŞKEN en
// çok gerekir.
//
// Bu bekçi eski `test_superadmin_hidden_single_source.ts`in yerine geçer. Onun
// BEŞ kolundan üçü (Prisma süzgeci · ilişki süzgeci · ham SQL süzgeci) ve maske
// kolu artık YASAKLANAN şeydir; İKİSİ ise gizlilikle değil YETKİYLE ilgiliydi ve
// AYNEN KORUNUR:
//   · `*` körlüğü — düz `includes("admin:*")` yazımı `["*"]` taşıyan hesabı
//     TANIMAZ; tek doğru yüklem `matchesPermission`. Bu kalkarsa en yetkili kişi
//     bazı ekranlarda sessizce YETKİSİZ görünür.
//   · Alan panelden ATANAMAZ — `isSystemAccount` hiçbir Zod şemasına / panel
//     yazma yoluna girmez; hesabın tek doğuş yolu sunucuda elle koşulan script.
//
// ⚠️ GÖRÜNÜRLÜK ≠ KİMLİK BİLGİSİNİ TESLİM ETMEK. Kaldırılan 404 kapısının bir işi
// obscurity DEĞİLDİ: `/users/:id/credentials` hedefin 6 haneli DÜZ PIN'ini döner
// ve `login-quick-pin` PIN'i TEK BAŞINA kimlik sayar. O yüzden dar bir kapı o
// ucun üstünde YENİDEN kuruldu ve §5 onu ölçer.
// =============================================================================

import fs from "fs";
import path from "path";
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
/** Yorum metni ölçüme girmez: tarihçe anlatan yorumlar sahte kırmızı üretir. */
const GOVDE = new Map(FILES.map((f) => [rel(f), yorumlariSok(fs.readFileSync(f, "utf8"))]));

// =============================================================================
console.log("=== §0) Körlük zemini ===");
check("kaynak ağacı tarandı (>200 dosya)", FILES.length > 200, `${FILES.length} dosya`);
check(
  "tek kaynak dosyası duruyor (`system-account.helper.ts`)",
  fs.existsSync(path.join(SRC, "services", "helpers", "system-account.helper.ts")),
);

// =============================================================================
console.log("\n=== §1) GİZLEME SEMBOLLERİ KAYNAKTA YOK ===");
// Her biri gizlemenin bir kolu. Yeniden belirirse hesap sessizce görünmez olur.
const YASAK = [
  "VISIBLE_USER",
  "visibleUserWhere",
  "VISIBLE_ACTOR",
  "VISIBLE_ACTOR_OR_SYSTEM",
  "maskSystemActor",
  "withMaskedActor",
  "SYSTEM_ACTOR_USERNAME",
  "SYSTEM_ACTOR_FULLNAME",
  "SQL_VISIBLE_USER",
  "SQL_ACTOR_USERNAME",
  "SQL_ACTOR_FULLNAME",
  "blockSystemAccountTarget",
];
for (const sembol of YASAK) {
  const gecen = [...GOVDE.entries()]
    .filter(([, src]) => new RegExp(`\\b${sembol}\\b`).test(src))
    .map(([r]) => r);
  check(`\`${sembol}\` kaynakta geçmiyor`, gecen.length === 0, gecen.join(", "));
}

// =============================================================================
console.log("\n=== §2) Helper yalnız aktör SEÇİMİ taşıyor ===");
const helper = GOVDE.get("services/helpers/system-account.helper.ts") ?? "";
check("helper okundu (körlük zemini)", helper.length > 0);
check("`ACTOR_SELECT` duruyor", /export const ACTOR_SELECT/.test(helper));
check(
  "`ACTOR_SELECT` `isSystemAccount` taşıyor (arayüz 'en yetkili' rozetini ondan çizer)",
  /ACTOR_SELECT[\s\S]{0,220}isSystemAccount:\s*true/.test(helper),
);
const ihracSayisi = (helper.match(/^export /gm) ?? []).length;
check("helper'da TEK ihraç kaldı (gizleme sabitleri silindi)", ihracSayisi === 1, `${ihracSayisi} export`);

// =============================================================================
console.log("\n=== §3) `*` körlüğü — düz `includes(\"admin:*\")` YASAK ===");
// KORUNAN KOL. Düz metin yüklemi `["*"]` taşıyan hesabı TANIMAZ; en yetkili kişi
// o ekranda sessizce yetkisiz görünür.
// ⚠️ BUGÜN BOŞ ve bu ÖLÇÜLDÜ: `admin:*` dizesi kaynakta yalnız `rbac.middleware`in
// AÇIKLAMA satırında geçiyor, kodda hiç yok (`matchesPermission` ön eki türetiyor,
// düz literal karşılaştırmıyor). Eski bekçide bu dosya muaf yazılmıştı ve muafiyet
// ölüydü — ölü muaf, gerçek bir ihlali gizleyebilir.
const WILDCARD_MUAF: Record<string, string> = {};
const kullanilanMuaf = new Set<string>();
const ihlal: string[] = [];
for (const [r, src] of GOVDE) {
  if (!/\.(includes|has)\(\s*["']admin:\*["']\s*\)/.test(src)) continue;
  if (WILDCARD_MUAF[r]) {
    kullanilanMuaf.add(r);
    continue;
  }
  ihlal.push(r);
}
check(
  "düz `admin:*` metin yüklemi YOK (tek doğru yüklem `matchesPermission`)",
  ihlal.length === 0,
  ihlal.join(", "),
);
const bayatW = Object.keys(WILDCARD_MUAF).filter((k) => !kullanilanMuaf.has(k));
check("§3 muaf listesi bayat değil (ölü muaf gerçek ihlali gizler)", bayatW.length === 0, bayatW.join(", "));

// =============================================================================
console.log("\n=== §4) `isSystemAccount` PANELDEN ATANAMAZ ===");
// KORUNAN KOL. Alanın tek yazarı sunucuda elle koşulan `scripts/superadmin-olustur.ts`;
// `src/` altında bir YAZICI belirirse hesabın ikinci bir doğuş yolu açılmış demektir
// (`admin:users` taşıyan herkes kendini en yetkili yapabilirdi).
const yaziciDesen = /isSystemAccount\s*:\s*(true|false|[a-zA-Z_$][\w$]*)\s*[,}]/;
const yazicilar: string[] = [];
for (const [r, src] of GOVDE) {
  // `select`/`where` okumaları eşleşmesin diye yalnız `data:` bloklarına bak.
  for (const m of src.matchAll(/data\s*:\s*\{[\s\S]{0,400}?\}/g)) {
    if (yaziciDesen.test(m[0])) yazicilar.push(r);
  }
}
check(
  "`src/` altında `isSystemAccount` YAZAN kod yok (tek yazar `scripts/superadmin-olustur.ts`)",
  yazicilar.length === 0,
  [...new Set(yazicilar)].join(", "),
);
check(
  "yazıcı kaynağı `scripts/` altında duruyor (körlük zemini)",
  fs.existsSync(path.resolve(__dirname, "superadmin-olustur.ts")),
);

// =============================================================================
console.log("\n=== §5) DÜZ PIN korunuyor (görünürlük ≠ kimlik teslimi) ===");
const adminRoutes = GOVDE.get("routes/admin.routes.ts") ?? "";
check("`admin.routes.ts` okundu (körlük zemini)", adminRoutes.length > 0);
const credIdx = adminRoutes.indexOf('"/users/:id/credentials"');
check("`/users/:id/credentials` ucu bulundu", credIdx > 0);
const credBlok = credIdx > 0 ? adminRoutes.slice(credIdx, credIdx + 2600) : "";
// ⚠️ İKİ YAZIM DA KABUL (2026-09-05): hedefin sistem hesabı olup olmadığı eskiden
// route içinde `prisma.user.findUnique` ile okunuyordu; katman kuralı (ESLint
// `no-restricted-imports` — route'ta `lib/prisma` yasak) o sorguyu servise taşıdı
// (`AuthService.isSystemAccountUser`). Kapının KENDİSİ çağıranda kalır, bu yüzden
// bekçi hâlâ ROUTE dosyasında arar. Alternatiflerden biri YETMEZ: her iki dalda da
// istek sahibi karşılaştırması (`req.isSystemAccount !== true`) 240 karakter içinde
// aranır — kapı silinirse iki desen de düşer ve kontrol KIRMIZI olur (negatif
// sondayla doğrulandı: kapı bloğu kaldırılınca ❌ verdi).
check(
  "uç, en yetkili hesabı KORUYOR (hedef `isSystemAccount` + istek sahibi kontrolü)",
  /(isSystemAccount\s*===\s*true|isSystemAccountUser\s*\()[\s\S]{0,240}req\.isSystemAccount\s*!==\s*true/.test(
    credBlok,
  ),
);
check(
  "cevap 403 (hesabın varlığı zaten açık — 404 yanlış bilgi olurdu)",
  /AppError\.forbidden/.test(credBlok),
);

// =============================================================================
// =============================================================================
console.log("\n=== §5b) EN YETKİLİ HESAP YAZMAYA KAPALI (başkası değiştiremez) ===");
// ⚠️ Gizleme kaldırılırken eski 404 kapısı TAMAMEN silinmişti; oysa o kapı
// `/users/:id` altındaki 13 YAZMA ucunu da kapatıyordu ve o iş gizlilikle ilgili
// DEĞİLDİ. Silinince `admin:users` taşıyan biri hesabın parolasını/PIN'ini
// sıfırlayıp KİMLİĞİNE BÜRÜNEBİLİYORDU. Yetki LİSTESİ zaten dokunulmazdı
// (`getEffectivePermissions` grant satırlarını okumadan `["*"]` döner) — ama
// hesabı DEVRALMAK yetkiyi değiştirmekten kötüdür.
const mwSrc = GOVDE.get("middlewares/system-account.middleware.ts") ?? "";
check(
  "`protectSystemAccountTarget` tanımlı",
  /export async function protectSystemAccountTarget/.test(mwSrc),
);
check(
  "OKUMA serbest (GET erken geçer — görünürlük kararı)",
  /req\.method\s*===\s*"GET"[\s\S]{0,80}next\(\)/.test(mwSrc),
);
check(
  "hesabın KENDİSİ muaf (kendi hesabını yönetebilir)",
  /req\.isSystemAccount\s*===\s*true[\s\S]{0,80}next\(\)/.test(mwSrc),
);
check("engel 403 (varlık zaten açık)", /AppError\.forbidden/.test(mwSrc));
check(
  "deneme audit'e yazılıyor (kim devralmaya çalıştı)",
  /SYSTEM_ACCOUNT_WRITE_BLOCKED/.test(mwSrc),
);
check(
  "kapı ÖNEK olarak bağlı (`/users/:id` — on dördüncü uç da kapalı doğar)",
  /router\.use\(\s*\n?\s*"\/users\/:id"[\s\S]{0,420}protectSystemAccountTarget/.test(adminRoutes),
);
// Körlük zemini: gerçekten çok sayıda YAZMA ucu var mı?
const yazanUc = [...adminRoutes.matchAll(/router\.(post|patch|put|delete)\(\s*\n?\s*"(\/users\/:id[^"]*)"/g)];
check("körlük zemini — `/users/:id*` yazma ucu ≥ 10", yazanUc.length >= 10, `${yazanUc.length} uç`);

// =============================================================================
console.log("\n=== §6) YETKİ BOZULMADI (kaldırılan şey gizleme, yetki DEĞİL) ===");
const auth = GOVDE.get("services/auth.service.ts") ?? "";
check(
  "`getEffectivePermissions` süperadmin bypass'ı duruyor (`[\"*\"]`)",
  /isSystemAccount[\s\S]{0,120}return\s*\[\s*["']\*["']\s*\]/.test(auth),
);
const flagGuard = GOVDE.get("routes/feature-flag.routes.ts") ?? "";
check("modül anahtarı guard'ı kimliği hâlâ okuyor", /isSystemAccount/.test(flagGuard));
const ayarSifre = GOVDE.get("middlewares/settings-password.middleware.ts") ?? "";
check("ayar şifresi muafiyeti duruyor", /req\.isSystemAccount\s*===\s*true/.test(ayarSifre));
const mw = GOVDE.get("middlewares/system-account.middleware.ts") ?? "";
check(
  "yetki kapısı duruyor (`requireSystemAccountOr404`) ve artık 403 veriyor",
  /export function requireSystemAccountOr404/.test(mw) && /AppError\.forbidden/.test(mw),
);

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
