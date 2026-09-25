// =============================================================================
// BEKÇİ — audit yalnız AYAK İZİDİR: `system_logs` iş kaynağı olarak okunmaz
// Çalıştır: npx tsx scripts/run-all-tests.ts audit_okuma_kaynagi
// =============================================================================
// KURAL (kullanıcı, 2026-09-25): "audit sadece bir ayak izi, programın hiçbir
// yerinde audit'ten join etmemeliyiz; kendi hareket tablolarımızla
// ilişkilendirilmeli." Çalışan programda `SystemLog`/`SystemLogArchive`i yalnız
// ayak izini bir İNSANA gösteren yüzeyler okur (beyan: lib/audit-okuma-beyan.ts).
//
// ÜÇ YÜZEY, İKİ YÖN:
//   backend  — Prisma okuması (find*/count/aggregate/groupBy · `logs` ilişki
//              include'u) ve `FROM/JOIN system_logs|system_log_archives` ham SQL;
//              kimlik `dosya#işlev`, adet EŞİT olmalı (fazlası beyansız okuma,
//              eksiği ölü beyan).
//   istemci  — audit ucu literali taşıyan ya da audit istemci modülünü içe
//              aktaran Electron/mobil dosyası; dosya düzeyi, iki yönlü.
//   borç     — allowlist dışı iş okumaları cırcırda: ARTIŞ her yerde sert,
//              ÇÜRÜME (borç kapandı, taban inmedi) commit kapısında uyarı, CI'da sert.
//
// ⚠️ SINIR (beyanlı): istemci taraması uç adresini LİTERALDEN tanır. Yeni bir
// audit ucu açılırsa backend okuması §2'de kırmızı verir (yeni işlev), ama ucun
// istemci deseni `AUDIT_UCLARI`na eklenmeden o ucu çağıran ekran görünmez.
// ⚠️ `scripts/` TARANMAZ: bekçiler audit yazıldığını doğrulamak için okur ve göç
// script'leri (tarihli, bir kerelik) kuralın beyanlı istisnasıdır.
//
// DB GEREKTİRMEZ: TypeScript AST (yorum ve belge metni sayılmaz).
//
// NEGATİF SONDA ✓K13 (§7, her koşumda): saf yüklem — okuma/yazma ayrımı, ham SQL,
// yorum, dizin adı, ilişki include'u, istemci literali ve panel yolu ayrımı.
// ✓B5 (koşuldu 2026-09-25, izole ağaç, hepsi geri alındı):
//   N1 shipping.service'e yeni metotta `prisma.systemLog.count` → §2 ❌ adıyla
//   N2 beyanlı işleve (getRunRecords) ikinci okuma, ham `FROM "system_logs"` → §2 ❌ "2 > 1"
//   N3 beyansız Electron dosyasına `/api/admin/system-logs` literali → §6b ❌ adıyla
//   P1 bir borç kapatıldı (getRunRecords → importRunLine) → §4b ❌ "gerçek 4 · taban 5";
//      commit kapısı kipinde aynı durum ⏭ uyarı, çıkış 0 (lib/circir-kolu.ts)
//   P2 K-A4 satırı düştü + taban 5→4 → 25/0 yeşil: taban DÜŞEBİLİYOR.
// =============================================================================
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";
import {
  AUDIT_ISTEMCI_MODULLERI,
  AUDIT_OKUMA_BORC_TABANI,
  AUDIT_OKUMA_BORCU,
  AUDIT_UCLARI,
  AYAK_IZI_OKUYUCULARI,
  AUDIT_GOC_ISTISNALARI,
  AYAK_IZI_SINIFLARI,
  ISTEMCI_AYAK_IZI,
} from "./lib/audit-okuma-beyan";
import { atlamaDefteri } from "./lib/atlama";
import { curumeKolu } from "./lib/circir-kolu";
import { walkTs } from "./lib/ts-tarama";

const KOK = join(__dirname, "..");
const DEPO = join(KOK, "..");
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detay ? ` — ${detay}` : ""}`); }
}
const ATLAMA = atlamaDefteri((mesaj) => check(mesaj, false));

const OKUMA_METOTLARI = new Set([
  "findMany", "findFirst", "findFirstOrThrow", "findUnique", "findUniqueOrThrow",
  "count", "aggregate", "groupBy",
]);
const AUDIT_DELEGELERI = new Set(["systemLog", "systemLogArchive"]);
/** Ham SQL okuması: tablo FROM/JOIN ardında (tırnaklı ya da şemalı olabilir). */
const HAM_SQL = /\b(?:FROM|JOIN)\s+(?:"?public"?\.)?"?system_log(?:s|_archives)"?(?![A-Za-z0-9_])/i;
/** `User.logs` — SystemLog[] ilişkisi; include/select içinde okuma sayılır. */
const AUDIT_ILISKILERI = new Set(["logs"]);

export interface OkumaNoktasi { islev: string; tur: "prisma" | "sql" | "iliski"; satir: number }

function adOf(n: ts.PropertyName | ts.BindingName | undefined): string | null {
  if (!n) return null;
  if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isPrivateIdentifier(n)) return n.text;
  return null;
}

/**
 * Düğümü saran işlevin adı: `Sinif.metot` · üst düzey işlev · nesne literalindeki
 * işlev için `DEGISKEN.ozellik` · hiçbiri yoksa `<modül>`. SAF.
 */
export function sarmalayanIslev(node: ts.Node): string {
  let islev: string | null = null;
  let ozellikte = false;
  for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
    if (ts.isClassDeclaration(p)) return `${p.name?.text ?? "<sınıf>"}.${islev ?? "<gövde>"}`;
    if (ts.isSourceFile(p)) break;
    let ad: string | null = null;
    let ozellik = false;
    if (ts.isMethodDeclaration(p) || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p)) ad = adOf(p.name);
    else if (ts.isFunctionDeclaration(p)) ad = p.name?.text ?? null;
    else if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) && p.parent) {
      const q = p.parent;
      if (ts.isVariableDeclaration(q)) ad = adOf(q.name);
      else if (ts.isPropertyAssignment(q) || ts.isPropertyDeclaration(q)) { ad = adOf(q.name); ozellik = ts.isPropertyAssignment(q); }
    } else if (ts.isVariableDeclaration(p) && ozellikte) {
      // Nesne literalindeki işlev (`COUNT_SPECS[i].run`) — değişken adıyla nitelenir.
      return `${adOf(p.name) ?? "<değişken>"}.${islev}`;
    }
    if (ad && islev === null) { islev = ad; ozellikte = ozellik; }
    else if (ad && ozellikte && !ozellik) return `${ad}.${islev}`;
  }
  return islev ?? "<modül>";
}

function literalMetni(n: ts.Node): string | null {
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isTemplateExpression(n)) return n.head.text + n.templateSpans.map((s) => "${}" + s.literal.text).join("");
  return null;
}

/** Backend kaynağındaki audit okuma noktaları. SAF. */
export function okumaNoktalari(kaynak: string, dosyaAdi = "x.ts"): OkumaNoktasi[] {
  const sf = ts.createSourceFile(dosyaAdi, kaynak, ts.ScriptTarget.Latest, true);
  const out: OkumaNoktasi[] = [];
  const satir = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const gez = (n: ts.Node): void => {
    // prisma|tx|db|herhangi.systemLog.findMany(...)
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const metot = n.expression.name.text;
      const alici = n.expression.expression;
      if (OKUMA_METOTLARI.has(metot) && ts.isPropertyAccessExpression(alici) && AUDIT_DELEGELERI.has(alici.name.text)) {
        out.push({ islev: sarmalayanIslev(n), tur: "prisma", satir: satir(n) });
      }
    }
    // Ham SQL: literal (etiketli şablon, $queryRawUnsafe argümanı, Prisma.sql…)
    if (!ts.isTemplateHead(n)) {
      const m = literalMetni(n);
      if (m !== null && HAM_SQL.test(m) && !(n.parent && ts.isTemplateExpression(n.parent))) {
        out.push({ islev: sarmalayanIslev(n), tur: "sql", satir: satir(n) });
      }
    }
    // include/select: { logs: … }
    if (ts.isPropertyAssignment(n) && AUDIT_ILISKILERI.has(adOf(n.name) ?? "")) {
      const obj = n.parent;
      const sahip = obj?.parent;
      if (ts.isObjectLiteralExpression(obj) && sahip && ts.isPropertyAssignment(sahip) && ["include", "select"].includes(adOf(sahip.name) ?? "")) {
        out.push({ islev: sarmalayanIslev(n), tur: "iliski", satir: satir(n) });
      }
    }
    ts.forEachChild(n, gez);
  };
  gez(sf);
  return out;
}

// ── İstemci ──────────────────────────────────────────────────────────────────
function walkIstemci(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, e.name);
    if (e.isDirectory()) {
      if (["node_modules", "__tests__", "dist", "build"].includes(e.name)) continue;
      walkIstemci(abs, out);
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts")) {
      out.push(abs);
    }
  }
  return out;
}

/** Kaynaktaki literallerden herhangi biri bir audit ucu desenine uyuyor mu. SAF. */
export function auditUcuCagirir(kaynak: string, desenler: readonly RegExp[]): boolean {
  const sf = ts.createSourceFile("x.tsx", kaynak, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let bulundu = false;
  const gez = (n: ts.Node): void => {
    if (bulundu) return;
    if (!ts.isTemplateHead(n) && !(n.parent && ts.isTemplateExpression(n.parent))) {
      const m = literalMetni(n);
      if (m !== null && !(n.parent && ts.isImportDeclaration(n.parent)) && desenler.some((d) => d.test(m))) { bulundu = true; return; }
    }
    ts.forEachChild(n, gez);
  };
  gez(sf);
  return bulundu;
}

/** İçe aktarılan modüllerin depo-göreli yolu (uzantısız). SAF değil: yol çözer. */
function iceAktarimlar(abs: string, kaynak: string, projeSrc: string): string[] {
  const out: string[] = [];
  for (const m of kaynak.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
    const s = m[1]!;
    let hedef: string | null = null;
    if (s.startsWith("@/")) hedef = join(projeSrc, s.slice(2));
    else if (s.startsWith(".")) hedef = resolve(dirname(abs), s);
    if (hedef) out.push(relative(DEPO, hedef).replace(/\.(tsx?|js)$/, ""));
  }
  return out;
}

function main(): void {
  console.log("=== AUDIT OKUMA KAYNAĞI ===\n");

  // ── Backend ölçümü ─────────────────────────────────────────────────────────
  const dosyalar = walkTs(join(KOK, "src")).filter((f) => !/\.(test|spec)\.ts$/.test(f));
  const olculen = new Map<string, OkumaNoktasi[]>();
  for (const f of dosyalar) {
    const rel = relative(KOK, f);
    for (const o of okumaNoktalari(readFileSync(f, "utf8"), rel)) {
      const yer = `${rel}#${o.islev}`;
      if (!olculen.has(yer)) olculen.set(yer, []);
      olculen.get(yer)!.push(o);
    }
  }
  const toplamOkuma = [...olculen.values()].reduce((a, v) => a + v.length, 0);
  check("§1 körlük zemini: backend taraması dolu", dosyalar.length > 300 && toplamOkuma >= 10,
    `${dosyalar.length} dosya · ${olculen.size} işlev · ${toplamOkuma} okuma noktası`);

  const beyan = new Map<string, number>();
  for (const b of AYAK_IZI_OKUYUCULARI) beyan.set(b.yer, b.adet);
  const borc = new Map<string, number>();
  for (const b of AUDIT_OKUMA_BORCU) borc.set(b.yer, b.adet);
  const cift = AYAK_IZI_OKUYUCULARI.filter((b) => borc.has(b.yer)).map((b) => b.yer);
  check("§1b bir yer hem allowlist'te hem borçta değil", cift.length === 0, cift.join(" · "));

  // §2 ⭐ ARTIŞ: her okuma noktası beyanlı ve adet beyanı AŞMIYOR.
  const beyansiz: string[] = [];
  for (const [yer, ns] of olculen) {
    const izin = beyan.get(yer) ?? borc.get(yer);
    if (izin === undefined || ns.length > izin) {
      beyansiz.push(`${yer} (${ns.length}${izin === undefined ? ", beyansız" : ` > ${izin}`}; satır ${ns.map((n) => `${n.satir}:${n.tur}`).join(",")})`);
    }
  }
  check("§2 ⭐ beyansız audit okuması YOK (audit iş kaynağı olarak okunmaz)", beyansiz.length === 0,
    beyansiz.length
      ? `YENİ OKUMA — audit yalnız ayak izidir; bilgi iş kararına giriyorsa kendi defterine/kalıcı kolonuna yaz:\n      ${beyansiz.join("\n      ")}`
      : `${olculen.size} işlev beyanlı`);

  // §3 ⭐ ÖLÜ BEYAN: allowlist satırı ölçülenle BİREBİR.
  const oluBeyan = AYAK_IZI_OKUYUCULARI.filter((b) => (olculen.get(b.yer)?.length ?? 0) !== b.adet)
    .map((b) => `${b.yer} (beyan ${b.adet} · ölçülen ${olculen.get(b.yer)?.length ?? 0})`);
  check("§3 ⭐ allowlist'te ÖLÜ ya da şişkin satır yok", oluBeyan.length === 0,
    oluBeyan.length ? oluBeyan.join("\n      ") : `${AYAK_IZI_OKUYUCULARI.length} satır canlı`);

  // §4 ⭐ BORÇ CIRCIRI.
  const borcOlculen = AUDIT_OKUMA_BORCU.reduce((a, b) => a + Math.min(olculen.get(b.yer)?.length ?? 0, b.adet), 0);
  const borcBeyan = AUDIT_OKUMA_BORCU.reduce((a, b) => a + b.adet, 0);
  check("§4 ⭐ borç ARTMADI", borcOlculen <= AUDIT_OKUMA_BORC_TABANI && borcBeyan <= AUDIT_OKUMA_BORC_TABANI,
    `ölçülen ${borcOlculen} · beyan ${borcBeyan} · taban ${AUDIT_OKUMA_BORC_TABANI}`);
  const kapananBorc = AUDIT_OKUMA_BORCU.filter((b) => (olculen.get(b.yer)?.length ?? 0) < b.adet)
    .map((b) => `${b.dilim} ${b.yer} (${olculen.get(b.yer)?.length ?? 0}/${b.adet})`);
  if (kapananBorc.length) console.log(`   ⓘ kapanan borç (satır düşer, taban iner): ${kapananBorc.join(" · ")}`);
  curumeKolu(check, ATLAMA.atla, "§4b ⭐ borç tabanı ÇÜRÜMEDİ (kapanan borç listeden düştü)", borcOlculen, AUDIT_OKUMA_BORC_TABANI);

  // §5 beyan biçimi: sınıf kapalı küme, gerekçe dolu, dilim adlı.
  const kotu = [
    ...AYAK_IZI_OKUYUCULARI, ...ISTEMCI_AYAK_IZI,
  ].filter((b) => !(AYAK_IZI_SINIFLARI as readonly string[]).includes(b.sinif) || b.gerekce.trim().length < 10);
  const kotuBorc = AUDIT_OKUMA_BORCU.filter((b) => !/^K-A\d+$/.test(b.dilim) || b.hedef.trim().length < 10);
  check("§5 beyan biçimi: sınıf kapalı kümeden, gerekçe/hedef dolu", kotu.length === 0 && kotuBorc.length === 0,
    [...kotu.map((b) => b.yer), ...kotuBorc.map((b) => b.yer)].join(" · ") || `${AYAK_IZI_SINIFLARI.length} sınıf`);

  // §5b göç istisnaları: var, GERÇEKTEN audit okuyor, beyanı tam (ölü istisna kırmızı).
  const gocSorunlu = AUDIT_GOC_ISTISNALARI.flatMap((g) => {
    const p = join(KOK, g.dosya);
    if (!existsSync(p)) return [`${g.dosya}: YOK`];
    const okuma = okumaNoktalari(readFileSync(p, "utf8"), g.dosya).length;
    const eksik = !/^\d{4}-\d{2}-\d{2}$/.test(g.tarih) || g.gerekce.trim().length < 20 || !g.hedef.trim();
    return [...(okuma === 0 ? [`${g.dosya}: audit OKUMUYOR (ölü istisna)`] : []), ...(eksik ? [`${g.dosya}: beyan eksik`] : [])];
  });
  check("§5b göç istisnaları canlı ve beyanlı (yeni satır yalnız 1e onayıyla)", gocSorunlu.length === 0,
    gocSorunlu.join(" · ") || AUDIT_GOC_ISTISNALARI.map((g) => `${g.dosya.replace("scripts/", "")}:${g.durum}`).join(" · "));

  // ── İstemci ────────────────────────────────────────────────────────────────
  const istemciKokleri = [
    { src: join(DEPO, "Electron", "src"), ad: "Electron" },
    { src: join(DEPO, "mobil", "src"), ad: "mobil" },
  ];
  const desenler = AUDIT_UCLARI.map((u) => u.desen);
  const moduller = new Set(AUDIT_ISTEMCI_MODULLERI);
  const cagiranlar = new Set<string>();
  let istemciDosya = 0;
  for (const { src } of istemciKokleri) {
    for (const f of walkIstemci(src)) {
      istemciDosya++;
      const rel = relative(DEPO, f);
      const s = readFileSync(f, "utf8");
      if (auditUcuCagirir(s, desenler)) cagiranlar.add(rel);
      else if (iceAktarimlar(f, s, src).some((m) => moduller.has(m))) cagiranlar.add(rel);
    }
  }
  check("§6 körlük zemini: istemci taraması dolu", istemciDosya > 500 && cagiranlar.size >= 5,
    `${istemciDosya} dosya · ${cagiranlar.size} audit okuyucu`);
  const istemciBeyan = new Set(ISTEMCI_AYAK_IZI.map((b) => b.yer));
  const istemciBeyansiz = [...cagiranlar].filter((f) => !istemciBeyan.has(f)).sort();
  check("§6b ⭐ audit ucunu çağıran her istemci dosyası beyanlı", istemciBeyansiz.length === 0,
    istemciBeyansiz.length ? `BEYANSIZ İSTEMCİ: ${istemciBeyansiz.join(" · ")}` : `${cagiranlar.size} dosya beyanlı`);
  const istemciOlu = [...istemciBeyan].filter((f) => !cagiranlar.has(f));
  check("§6c ⭐ istemci allowlist'inde ölü satır yok", istemciOlu.length === 0, istemciOlu.join(" · "));
  const oluModul = AUDIT_ISTEMCI_MODULLERI.filter((m) => !existsSync(join(DEPO, `${m}.ts`)) && !existsSync(join(DEPO, `${m}.tsx`)));
  check("§6d audit istemci modülleri var", oluModul.length === 0, oluModul.join(" · "));
  const oluUc = AUDIT_UCLARI.filter((u) => {
    const p = join(KOK, u.backendDosya);
    return !existsSync(p) || !readFileSync(p, "utf8").includes(u.backendYol);
  });
  check("§6e her audit ucu deseni canlı bir backend yoluna karşılık gelir", oluUc.length === 0,
    oluUc.map((u) => `${u.backendDosya} ${u.backendYol}`).join(" · ") || `${AUDIT_UCLARI.length} uç`);

  // ── Sondalar (saf yüklem) ──────────────────────────────────────────────────
  console.log("\n=== §7 SONDALAR (saf yüklem) ===");
  const bir = (s: string) => okumaNoktalari(s);
  check("§7a ⭐ prisma.systemLog.findMany okuma sayılır",
    bir("class A { async f() { return prisma.systemLog.findMany({}); } }").map((o) => `${o.islev}:${o.tur}`).join() === "A.f:prisma");
  check("§7b ⭐ tx.systemLogArchive.count da okuma", bir("async function g(tx) { await tx.systemLogArchive.count(); }").map((o) => o.islev).join() === "g");
  check("§7c ⭐ systemLog.create okuma DEĞİL", bir("prisma.systemLog.create({ data: {} });").length === 0);
  check("§7d ⭐ ham SQL FROM system_logs sayılır",
    bir("const h = async () => prisma.$queryRaw`SELECT count(*) FROM system_logs WHERE x = ${1}`;").map((o) => `${o.islev}:${o.tur}`).join() === "h:sql");
  check("§7e ⭐ tırnaklı ve JOIN'li arşiv tablosu da sayılır", bir("const q = 'SELECT 1 FROM a JOIN \"system_log_archives\" s ON true';").length === 1);
  check("§7f ⭐ YORUMDAKİ system_logs sayılmaz", bir("// SELECT * FROM system_logs\n/* JOIN system_logs */ const x = 1;").length === 0);
  check("§7g ⭐ include: { logs: true } okuma sayılır", bir("prisma.user.findMany({ include: { logs: true } });").map((o) => o.tur).join() === "iliski");
  check("§7h `logs` alanı include/select dışında sayılmaz", bir("const o = { logs: [] }; f({ data: { logs: 1 } });").length === 0);
  check("§7i system_logs_createdAt_idx gibi dizin adı tablo sayılmaz", bir("const s = 'Index Scan FROM system_logs_createdAt_idx';").length === 0);
  check("§7m nesne literalindeki işlev değişken adıyla nitelenir",
    bir("const SPECS = [{ key: 'a', run: (c) => prisma.systemLog.count({}) }];").map((o) => o.islev).join() === "SPECS.run");
  check("§7j ⭐ istemci: uç literali yakalanır", auditUcuCagirir("api.get(`/api/record-info/${t}/${id}`)", desenler));
  check("§7k ⭐ istemci: rapor anahtarı `audit/…` yakalanır, panel yolu yakalanmaz",
    auditUcuCagirir("reportsClient.get('audit/user-activity', p)", desenler) && !auditUcuCagirir("navigate('/reports/audit/user-activity')", desenler));
  check("§7l ⭐ istemci: şablonlu uç (yedek etki) yakalanır", auditUcuCagirir("api.get(`/api/admin/backups/${n}/restore-impact`)", desenler));

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
