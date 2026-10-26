// =============================================================================
// BEKÇİ — güvenlik denetimi Bölge 4 (GİRDİ / ENJEKSİYON), düzeltme sonrası kalıcı
// =============================================================================
// Kaynak: Teks-Erp-wt/denetim/guvenlik-4-girdi.md (B1–B11 + §3 + doğrulama). Her `check` GÜVENLİ
// davranışı ister; "KARSI-KANIT" kontrolleri tasarımı korur; `OLCU` yalnız sayı basar.
//   §1 (DB'siz) CSV formül öneki (Electron csvCell + backend toCsv; negatif sayı bozulmaz) · ReDoS
//               kayıt kapısı (G4-B2) · belge ayarı kırpma · CHECK adı 409 gövdesinde YOK ·
//               renderer XSS probu · statik karşı-kanıtlar
//   §2 (DB)     LIKE joker kaçışı (`escapeLikeTerm`) Prisma `contains` üstünde
//   §3 (HTTP)   mükerrer CSV ucu · batch-search q=% / '_' · fieldPicks · önizleme başlık tavanı ·
//               yazma kovası fabrika sıfır-fark · 900 KB parola 400
// NEGATİF SONDA (her koşumda): yüklemler bozulmuş kopyalara koşar ve kırmızı vermeleri ölçülür
//   (formül öneki atlanmış csvCell · kısıt adlı CHECK mesajı · kaçışsız LIKE terimi).
// Koşum: DATABASE_URL='…_test' node ../scripts/agir-is.mjs -- npx tsx scripts/bekci-http.ts denetim_girdi
// Giriş kilidi 127.0.0.1'i kilitleyebileceği için §3g (login) EN SONDA koşar.
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import * as ts from "typescript";
import prisma from "../src/lib/prisma";
import { httpBekciKapisi } from "./lib/http-bekci-kapisi";
import { atlamaDefteri } from "./lib/atlama";
import { DuplicateDetectionService, type DuplicateScanResult } from "../src/services/duplicate-detection.service";
import { checkViolationResponse, errorHandler } from "../src/middlewares/error.middleware";
import { escapeLikeTerm } from "../src/utils/like-escape";
import { unsafePatternReason } from "../src/utils/regex-safety";
import { sanitizeDocumentsConfig } from "../src/services/system-setting.service";
import { SAMPLE_PRINTED_DOCS } from "../src/services/document-render/sample-data";
import { printedDocumentService } from "../src/services/printed-document.service";
import { renderFreeDocumentHtml } from "../src/services/document-render/free-document.html";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`OK   ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
}
function olcum(label: string, detail: string): void { console.log(`OLCU ${label} — ${detail}`); }
const ATLAMA = atlamaDefteri(() => { fail++; });
const BASE = process.env.TEST_API_URL ?? "http://localhost:4112";
const HTTP_CHECKS = 15;
const ek = Date.now().toString(36);
const ROOT = join(__dirname, "..", "..");
const SRC = join(__dirname, "..", "src");
const RATE_ON = /^(1|true|yes|on|evet|acik|açık)$/i.test((process.env.RATE_LIMIT_ENABLED ?? "").trim());

interface Cevap { status: number; json: Record<string, unknown>; text: string; ms: number }
async function call(token: string | null, method: string, url: string, body?: unknown, rawBody?: string): Promise<Cevap> {
  const t0 = performance.now();
  const r = await fetch(`${BASE}${url}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await r.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* html/csv */ }
  return { status: r.status, json, text, ms: Math.round(performance.now() - t0) };
}
const ozet = (c: Cevap): string =>
  `${c.status} ${String((c.json.details as { code?: unknown } | undefined)?.code ?? "")} ${String(c.json.message ?? c.text.slice(0, 120))}`.trim().slice(0, 200);
const dataOf = <T>(j: Record<string, unknown>): T => ((j.data ?? j) as T);

// Excel/LibreOffice'in formul saydigi on ekler (OWASP CSV injection).
const FORMUL_ONEKI = /^[=+\-@\t\r]/;

/** `;` ayracli, `"` tirnakli CSV satirini hucrelere boler (RFC 4180 alt kumesi). */
function csvSatir(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ";") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

type CsvFns = { csvCell: (v: string) => string; csvNumberCell: (v: string) => string };
/** Electron `csvCell`/`csvNumberCell`i paket yan etkileri (sonner/exceljs) olmadan GERCEK kaynaktan derler. */
function electronCsv(): CsvFns {
  const file = join(ROOT, "Electron", "src", "lib", "list-export.ts");
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const parts: string[] = [];
  sf.forEachChild((n) => {
    if (ts.isVariableStatement(n) && n.declarationList.declarations.some((d) => d.name.getText(sf) === "CSV_SEP")) parts.push(n.getText(sf));
    if (ts.isVariableStatement(n) && n.declarationList.declarations.some((d) => d.name.getText(sf) === "CSV_FORMULA_LEAD")) parts.push(n.getText(sf));
    if (ts.isFunctionDeclaration(n) && ["csvCell", "csvNumberCell", "csvQuote"].includes(n.name?.text ?? "")) parts.push(n.getText(sf).replace(/^export\s+/, ""));
  });
  if (parts.length !== 5) throw new Error(`csvCell/csvNumberCell/csvQuote/CSV_SEP/CSV_FORMULA_LEAD kaynakta eksik (${parts.length}/5)`);
  const js = ts.transpile(`${parts.join("\n")}\nreturn { csvCell, csvNumberCell };`, { target: ts.ScriptTarget.ES2020 });
  return new Function(js)() as CsvFns;
}

// ── §1a/b CSV formul oneki (birim) ─────────────────────────────────────────────
function s1Csv(): void {
  console.log("\n§1a — Electron csvCell formul oneki (B1, §3-2)");
  const { csvCell, csvNumberCell } = electronCsv();
  for (const girdi of ["=1+1", "+1", "-1", "@A1", "=HYPERLINK(\"http://x\";\"a\")", "\t=1"]) {
    const hucre = csvSatir(csvCell(girdi))[0];
    check(`§1a csvCell(${JSON.stringify(girdi)}) Excel'de formul olarak ACILMAMALI`, !FORMUL_ONEKI.test(hucre), `cikti=${JSON.stringify(csvCell(girdi))}`);
  }
  check("§1a KARSI-KANIT sayi hucresi (csvNumberCell) onek ALMAZ: -12,5 aynen", csvNumberCell("-12,5") === "-12,5", csvNumberCell("-12,5"));
  check("§1a KARSI-KANIT duz metin aynen", csvCell("düz") === "düz");
  // NEGATIF SONDA: oneksiz kopya (eski csvCell) ayni yuklemde KIRMIZI olmali.
  const eskiCell = (v: string) => (/[;"\n\r]/.test(v) || v !== v.trim() ? `"${v.replace(/"/g, '""')}"` : v);
  check("sonda: formul oneksiz csvCell yuklemde kirmizi verir", FORMUL_ONEKI.test(csvSatir(eskiCell("=1+1"))[0]));

  console.log("\n§1b — backend DuplicateDetectionService.toCsv (B1)");
  const kayit = (id: string, name: string) => ({ id, code: null, name, isActive: true, refCount: 0 });
  const sahte = {
    entity: "customer", scannedAt: new Date().toISOString(), fuzzyEnabled: false, thresholdPct: 90,
    totals: { records: 2, pairs: 1, groups: 1, hiddenNotDuplicate: 0 },
    groups: [{
      records: [kayit("a", "=1+2"), kayit("b", "@SUM(A1)")],
      pairs: [{ aId: "a", bId: "b", evidence: [{ rule: "IDENTITY", label: "Kimlik", detail: "" }], review: { decision: "DEFERRED", note: "-2+3" } }],
    }],
    suppressedIdentities: [],
  } as unknown as DuplicateScanResult;
  const satir = csvSatir(DuplicateDetectionService.toCsv(sahte).replace(/^\uFEFF/, "").split(/\r?\n/)[1] ?? "");
  for (const [ad, i] of [["aAd", 5], ["bAd", 10], ["not", 14]] as const) {
    check(`§1b toCsv ${ad} hucresi formul olarak ACILMAMALI`, !FORMUL_ONEKI.test(satir[i] ?? ""), `hucre=${JSON.stringify(satir[i])}`);
  }
  check("§1b KARSI-KANIT sayi hucresi (grup no) onek almaz", satir[0] === "1", `hucre=${JSON.stringify(satir[0])}`);
}

// ── §1c ReDoS sureleri (B2, §3-3) ──────────────────────────────────────────────
function sure(fn: () => void): number { const t = performance.now(); fn(); return performance.now() - t; }
function s1Redos(): void {
  console.log("\n§1c — ReDoS: geri izlemeli motor (Node V8; Hermes de geri izlemeli)");
  const re = /(a+)+$/;
  const olc: string[] = [];
  for (const n of [20, 22, 24, 26]) olc.push(`n=${n}:${Math.round(sure(() => re.test("a".repeat(n) + "!")))}ms`);
  olcum("§1c `(a+)+$` 'a'*n+'!'", `${olc.join(" ")} (her +2 karakter ~x4; n=30 kestirimi ${olc.length ? "dakikalar" : "?"})`);
  for (const pat of ["(a+)+$", "^(.|.|.)*X$", "(a)\\1"]) {
    check(`§1c kayit kapisi \`${pat}\` desenini REDDETMELI`, unsafePatternReason(pat) !== null, unsafePatternReason(pat) ?? "kabul edildi");
  }
  check("§1c KARSI-KANIT sahadaki tartı deseni kabul", unsafePatternReason("ST,GS,([+-]?\\d+\\.\\d+)") === null);
}

// ── §1d belge ayari kirpma (§3-9 kayit yolu) ───────────────────────────────────
function s1DocCfg(): void {
  console.log("\n§1d — sanitizeDocumentsConfig kirpma (kayit + okuma yolu)");
  const uzun = "T".repeat(10_000);
  const out = sanitizeDocumentsConfig({ shipmentDispatch: { titleOverride: uzun, footerNote: uzun } }) as Record<string, { titleOverride?: string; footerNote?: string }>;
  check("§1d KARSI-KANIT kayit/okuma yolunda titleOverride <= 80", (out.shipmentDispatch?.titleOverride?.length ?? 0) <= 80, `uzunluk=${out.shipmentDispatch?.titleOverride?.length}`);
  check("§1d KARSI-KANIT kayit/okuma yolunda footerNote <= 500", (out.shipmentDispatch?.footerNote?.length ?? 0) <= 500, `uzunluk=${out.shipmentDispatch?.footerNote?.length}`);
}

// ── §1e CHECK kisit adi 409 govdesinde (B5, sentetik hata) ─────────────────────
async function s1Check(): Promise<void> {
  console.log("\n§1e — tanimsiz CHECK kisiti 409 govdesi (B5, sentetik 23514)");
  const err = Object.assign(new Error("db"), {
    cause: { code: "23514", originalMessage: 'new row for relation "warp_beams" violates check constraint "warp_beams_origin_party_ck"' },
  });
  let status = 0;
  let body: Record<string, unknown> = {};
  const res = {
    headersSent: false,
    status(s: number) { status = s; return this; },
    json(b: Record<string, unknown>) { body = b; return this; },
    setHeader() { return this; }, set() { return this; }, type() { return this; }, send() { return this; },
  };
  const req = { method: "POST", originalUrl: "/api/x", path: "/api/x", headers: {}, ip: "127.0.0.1", get: () => undefined };
  errorHandler(err as Error, req as never, res as never, () => {});
  await new Promise((r) => setTimeout(r, 50));
  check("§1e 409 govdesi ic kisit adini TASIMAMALI", status === 409 && !String(body.message ?? "").includes("warp_beams_origin_party_ck"), `${status} ${String(body.message ?? "").slice(0, 140)}`);
  const ref = (body.details as { ref?: string } | undefined)?.ref ?? "";
  check("§1e 409 govdesi basvuru kodu tasir (ad log'da, kod govdede)", /^[0-9A-F]{8}$/.test(ref) && String(body.message ?? "").includes(ref), ref);
  check("§1e basvuru kodu kisit adindan belirlenimli (log eslesmesi)", checkViolationResponse("warp_beams_origin_party_ck").ref === ref);
  const eskiMesaj = (ad: string) => `Veri bütünlüğü kuralı engelledi (${ad}) — işlem tamamlanmadı.`;
  check("sonda: kisit adli eski mesaj yuklemde kirmizi verir", eskiMesaj("warp_beams_origin_party_ck").includes("warp_beams_origin_party_ck"));
}

// ── §1f renderer XSS probu (B11, §3-10/§5-1) ───────────────────────────────────
const ISARET = "<b id=pwn>";
function zehirle(v: unknown): unknown {
  if (typeof v === "string") return v + ISARET;
  if (Array.isArray(v)) return v.map(zehirle);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, zehirle(x)]));
  return v;
}
const zehirliAyar = {
  titleOverride: `B${ISARET}`, footerNote: `F${ISARET}`, signatureLabels: [`S${ISARET}`], showSignatures: true,
  stamps: { printedAt: true, printedBy: true, copyLabel: `C${ISARET}`.slice(0, 20) },
  blocks: [{ position: "afterHeader", text: `K${ISARET}` }],
  blankGrid: { enabled: true, title: `G${ISARET}`, rows: 2, columns: 2, headers: [`H${ISARET}`, "x"] },
};
async function s1Xss(): Promise<void> {
  console.log("\n§1f — renderer XSS probu: her ornek belge, butun string yapraklari + ayar zehirli");
  // Builder'lar servis modulu yuklenince kaydolur — kaydeden her modul kaynaktan bulunur.
  const { readdirSync } = await import("node:fs");
  for (const f of readdirSync(join(SRC, "services")).filter((x) => x.endsWith(".ts"))) {
    if (/^registerPrintedDocBuilder\(/m.test(readFileSync(join(SRC, "services", f), "utf8"))) await import(join(SRC, "services", f));
  }
  const ozgun = new Map(Object.entries(SAMPLE_PRINTED_DOCS).map(([k, v]) => [k, v]));
  const sonuc: string[] = [];
  let sizan = 0;
  try {
    for (const [tip, doc] of ozgun) {
      if (!doc || Object.keys(doc).length === 0) continue;
      (SAMPLE_PRINTED_DOCS as Record<string, unknown>)[tip] = zehirle(doc);
      let html = "";
      try { html = await printedDocumentService.renderSampleHtml(tip as never, zehirliAyar as never); }
      catch (e) { sonuc.push(`${tip}:HATA(${(e as Error).message.slice(0, 40)})`); continue; }
      const ham = html.split(ISARET).length - 1;
      const kacis = html.split("&lt;b id=pwn&gt;").length - 1;
      sizan += ham;
      sonuc.push(`${tip}:ham=${ham}/kacisli=${kacis}`);
    }
  } finally {
    for (const [k, v] of ozgun) (SAMPLE_PRINTED_DOCS as Record<string, unknown>)[k] = v;
  }
  olcum("§1f belge tipi basina", sonuc.join(" "));
  check("§1f hicbir belge HTML'inde zehirli isaret KACISSIZ gecmemeli", sizan === 0, `ham toplam=${sizan}`);

  const lh = { addressLine: `A${ISARET}`, phone: `P${ISARET}`, taxInfo: `V${ISARET}`, extraLines: [`E${ISARET}`] };
  const free = renderFreeDocumentHtml({
    company: { name: `N${ISARET}`, letterhead: lh as never },
    config: { ...zehirliAyar, showLetterhead: true } as never,
    doc: { documentNo: `D${ISARET}`, title: `T${ISARET}`, recipient: `R${ISARET}`, body: `Y${ISARET}`, date: "2026-10-12" },
  }, { printedBy: `U${ISARET}`, printNote: `PN${ISARET}`, draft: true });
  const hamF = free.split(ISARET).length - 1;
  check("§1f serbest belge (firma/antet/govde/not zehirli) kacissiz isaret TASIMAMALI", hamF === 0, `ham=${hamF}`);
}

// ── §1g statik: renderer interpolasyon siniflamasi, Zod tavansiz string, sorgu ayristirici, S4 sablonu
function tsDosya(p: string): ts.SourceFile { return ts.createSourceFile(p, readFileSync(p, "utf8"), ts.ScriptTarget.Latest, true); }
function dizinTs(d: string, suz: (f: string) => boolean): string[] {
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  return readdirSync(d).filter(suz).map((f) => join(d, f));
}
function s1Statik(): void {
  console.log("\n§1g — statik olculer");
  const rdir = join(SRC, "services", "document-render");
  const sinif: Record<string, number> = {};
  for (const f of dizinTs(rdir, (x) => x.endsWith(".html.ts"))) {
    const sf = tsDosya(f);
    const gez = (n: ts.Node): void => {
      if (ts.isTemplateSpan(n)) {
        let e: ts.Expression = n.expression;
        while (ts.isParenthesizedExpression(e)) e = e.expression;
        const k = ts.isCallExpression(e) ? (/^(esc|escLabel|escapeHtml)$/.test(e.expression.getText(sf)) ? "esc()" : "cagri")
          : ts.isIdentifier(e) ? "tanimlayici" : (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) ? "uye"
          : ts.isConditionalExpression(e) ? "kosul" : "diger";
        sinif[k] = (sinif[k] ?? 0) + 1;
      }
      ts.forEachChild(n, gez);
    };
    gez(sf);
  }
  olcum("§1g 11 renderer ${} siniflamasi", JSON.stringify(sinif));

  // Zod tavansiz z.string(): zincirde max/length/uuid/regex/email/url/datetime/enum yok.
  const SINIR = /^(max|length|uuid|regex|email|url|datetime|date|cuid|ulid|ip|base64|nonempty_?max)$/;
  let tavansiz = 0;
  const dosyaBasina: Record<string, number> = {};
  for (const d of [join(SRC, "controllers"), join(SRC, "routes"), join(SRC, "routes", "reports")]) {
    for (const f of dizinTs(d, (x) => x.endsWith(".ts"))) {
      const sf = tsDosya(f);
      const gez = (n: ts.Node): void => {
        if (ts.isCallExpression(n) && n.expression.getText(sf) === "z.string") {
          let p: ts.Node = n;
          let sinirli = false;
          while (ts.isPropertyAccessExpression(p.parent) && ts.isCallExpression(p.parent.parent)) {
            if (SINIR.test(p.parent.name.text)) sinirli = true;
            p = p.parent.parent;
          }
          if (!sinirli) { tavansiz++; const b = f.replace(SRC + "/", ""); dosyaBasina[b] = (dosyaBasina[b] ?? 0) + 1; }
        }
        ts.forEachChild(n, gez);
      };
      gez(sf);
    }
  }
  const ilk = Object.entries(dosyaBasina).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}=${v}`).join(" ");
  olcum("§1g tavansiz z.string() (controllers+routes)", `${tavansiz} · en cok: ${ilk}`);
  const sev = ["batch", "kartela", "tambur", "shipping", "subcontractor"].map((k) =>
    `${k}=${Object.entries(dosyaBasina).filter(([f]) => f.includes(k)).reduce((s, [, v]) => s + v, 0)}`).join(" ");
  olcum("§1g §5-5 dosyalari tavansiz z.string()", sev);

  const app = readFileSync(join(SRC, "app.ts"), "utf8");
  check("§1g KARSI-KANIT app.ts 'query parser' ayari YOK (Express 5 basit ayristirici)", !/set\(\s*["']query parser["']/.test(app));
  const envOrnek = readFileSync(join(ROOT, "deploy", ".env.production.example"), "utf8");
  for (const k of ["RATE_LIMIT_ENABLED=true", "TRUST_PROXY=1", "CORS_ORIGINS="]) {
    check(`§1g KARSI-KANIT internete acik kurulum sablonu ${k} satirini tasir`, new RegExp(`^${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m").test(envOrnek));
  }
}

// ── §2 Prisma contains joker semantigi (B3) ────────────────────────────────────
async function s2Like(): Promise<void> {
  console.log("\n§2 — Prisma `contains` % / _ kacisi (B3; sack-search noteText yolu ayni mekanizma)");
  const toplam = await prisma.customer.count();
  const yuzde = await prisma.customer.count({ where: { name: { contains: "%" } } });
  const alt = await prisma.customer.count({ where: { name: { contains: "_" } } });
  const gercek = (await prisma.customer.findMany({ select: { name: true } })).filter((c) => c.name.includes("%")).length;
  olcum("§2 customers", `toplam=${toplam} contains('%')=${yuzde} contains('_')=${alt} adinda gercekten % olan=${gercek}`);
  olcum("§2 (mekanizma) Prisma contains kacis YAPMAZ", `contains('%')=${yuzde}`);
  const kacisli = await prisma.customer.count({ where: { name: { contains: escapeLikeTerm("%") } } });
  const kacisliAlt = await prisma.customer.count({ where: { name: { contains: escapeLikeTerm("_") } } });
  const gercekAlt = (await prisma.customer.findMany({ select: { name: true } })).filter((c) => c.name.includes("_")).length;
  check("§2 escapeLikeTerm('%') ile contains yalniz adinda % olanlari dondurur", kacisli === gercek, `${kacisli} vs ${gercek}`);
  check("§2 escapeLikeTerm('_') ile contains '_' tek-karakter joker sayilmaz", kacisliAlt === gercekAlt, `${kacisliAlt} vs ${gercekAlt}`);
  check("sonda: kacissiz terim yuklemde kirmizi verir (contains('%') tum tablo)", toplam > gercek && yuzde !== gercek, `${yuzde} vs ${gercek}`);
}

// ── §3 HTTP ───────────────────────────────────────────────────────────────────
const ids = { customers: [] as string[], peripherals: [] as string[], batches: [] as string[], workOrders: [] as string[] };

async function h1Csv(admin: string): Promise<void> {
  console.log("\n§3a — mukerrer adaylar CSV ucu (B1, §3-1)");
  const tel = `0532${Date.now().toString().slice(-7)}`;
  // Servis adi BUYUK harfe cevirir — isaret yalniz rakam (katlamadan etkilenmez).
  const im = Date.now().toString().slice(-9);
  const adlar = [`=HYPERLINK("http://127.0.0.1:1/x";"a") ${im}`, `=1+2 TSTGRD ${im}`];
  for (const name of adlar) {
    const c = await call(admin, "POST", "/api/customers", { name, contactPhone: tel });
    const id = dataOf<{ id?: string }>(c.json).id;
    if (c.status !== 201 || !id) { check("§3a on kosul: formul adli musteri yaratilir", false, ozet(c)); return; }
    ids.customers.push(id);
  }
  check("§3a (kayit) ad alani '=' ile baslayan degeri KABUL ediyor", true, "201 x2");
  const r = await call(admin, "GET", "/api/master-data/duplicates/candidates.csv?entity=customer");
  const satirlar = r.text.replace(/^\uFEFF/, "").split(/\r?\n/).map(csvSatir);
  const hedef = satirlar.find((s) => s.some((h) => h.includes(im)));
  const hucreler = (hedef ?? []).filter((h) => h.includes(im));
  olcum("§3a CSV hucreleri", `${r.status} ${JSON.stringify(hucreler)} · ham: ${JSON.stringify((r.text.split("\n").find((l) => l.includes(im)) ?? "").slice(0, 200))}`);
  check("§3a candidates.csv formul onekli hucre YAZMAMALI", hucreler.length > 0 && !hucreler.some((h) => FORMUL_ONEKI.test(h)), `bulunan=${hucreler.length}`);
}

async function h2Peripheral(admin: string): Promise<void> {
  console.log("\n§3b — Peripheral.identifyPattern kapisi (B2, §3-3)");
  const govde = (pat: string, n: number) => ({ code: `TSTGRD${ek}${n}`, name: `TSTGRD cihaz ${ek} ${n}`, kind: "SCALE", connectionType: "BLUETOOTH_SPP", identifyPattern: pat });
  const a = await call(admin, "POST", "/api/peripherals", govde("(a+)+$", 1));
  const aid = dataOf<{ id?: string }>(a.json).id; if (aid) ids.peripherals.push(aid);
  check("§3b `(a+)+$` deseni 400 (ReDoS kapisi)", a.status === 400, ozet(a));
  const uzun = "(?:\\d)".repeat(800).slice(0, 5000);
  const b = await call(admin, "POST", "/api/peripherals", govde(uzun, 2));
  const bid = dataOf<{ id?: string }>(b.json).id; if (bid) ids.peripherals.push(bid);
  check("§3b KARSI-KANIT 5000 karakterlik desen 400 (DB VarChar(255) P2000 seddi)", b.status === 400, `${ozet(b)} uzunluk=${uzun.length}`);
  // B5 yan olcusu: ayni kodla ikinci kayit → P2002 mesajinda kolon adi
  const c = await call(admin, "POST", "/api/peripherals", govde("", 1));
  olcum("§3b (B5) mukerrer kod P2002 govdesi", ozet(c));
}

async function h3BatchSearch(admin: string): Promise<void> {
  console.log("\n§3c — batch-search q=% / q=_ (B3, §3-4) + sorgu ayristirici (§3-11)");
  const wo = await prisma.workOrder.create({ data: { workOrderNumber: `TSTGRD-${ek}` }, select: { id: true } });
  ids.workOrders.push(wo.id);
  for (const no of [`TSTGRD${ek}A1`, `TSTGRD${ek}B1`, `TSTGRD${ek}C1`]) {
    const b = await prisma.batch.create({ data: { batchNumber: no, workOrderId: wo.id }, select: { id: true } });
    ids.batches.push(b.id);
  }
  const toplam = await prisma.batch.count();
  const y = await call(admin, "GET", "/api/reports/production/batch-search?q=%25");
  const n = (dataOf<unknown[]>(y.json) ?? []).length;
  olcum("§3c q=%", `${y.status} satir=${n} (tablo=${toplam}) sure=${y.ms}ms`);
  check("§3c q=% joker olarak TUM partileri DONDURMEMELI", !(y.status === 200 && n >= Math.min(toplam, 20) && n > 0), `satir=${n}`);
  check("§3c KARSI-KANIT batch-search LIMIT 20 tasir (rapor 'LIMIT yok' dedi)", n <= 20, `satir=${n}`);
  const u = await call(admin, "GET", `/api/reports/production/batch-search?q=TSTGRD${ek}_1`);
  const un = (dataOf<Array<{ batchNumber: string }>>(u.json) ?? []).length;
  check("§3c '_' tek-karakter joker sayilMAMALI (TSTGRD.._1 aramasi A1/B1/C1'i bulmamali)", un === 0, `bulunan=${un}`);
  const qs = await call(admin, "GET", "/api/reports/production/batch-search?q[a]=1");
  olcum("§3c q[a]=1", `${ozet(qs)} details=${JSON.stringify(qs.json.details ?? qs.json.errors ?? "").slice(0, 200)}`);
  check("§3c KARSI-KANIT basit ayristirici: 'q[a]' literal anahtar (strict 400 'q[a]' der)", qs.status === 400 && /q\[a\]/.test(JSON.stringify(qs.json)), ozet(qs));
}

async function h4FieldPicks(admin: string): Promise<void> {
  console.log("\n§3d — fieldPicks sahte anahtar (B7 karsi-kanit, §3-8)");
  const mk: string[] = [];
  for (const name of [`TSTGRD birlesim ${ek} A`, `TSTGRD birlesim ${ek} B`]) {
    const c = await call(admin, "POST", "/api/customers", { name });
    const id = dataOf<{ id?: string }>(c.json).id;
    if (!id) { check("§3d on kosul musteri", false, ozet(c)); return; }
    ids.customers.push(id); mk.push(id);
  }
  const r = await call(admin, "POST", "/api/master-data/customer/merge", {
    survivorId: mk[0], sourceIds: [mk[1]], reason: "TSTGRD denetim sondasi gerekce", acknowledgedConflicts: 0,
    fieldPicks: { 'name" = $1; --': mk[1] },
  });
  const kaynak = await prisma.customer.findUnique({ where: { id: mk[1] }, select: { mergedIntoId: true } });
  check("§3d KARSI-KANIT sahte fieldPicks anahtari 400", r.status === 400, ozet(r));
  check("§3d KARSI-KANIT reddedilen birlestirme kaynagi tombstone YAPMADI (tx geri alindi)", kaynak?.mergedIntoId == null, `mergedIntoId=${kaynak?.mergedIntoId}`);
}

async function h5Sample(admin: string): Promise<void> {
  console.log("\n§3e — sample-html titleOverride (§3-9 onizleme yolu)");
  const uzun = "Ü".repeat(10_000) + "<b id=pwn>";
  const r = await call(admin, "POST", "/api/printed-documents/SHIPMENT_DISPATCH/sample-html", { config: { titleOverride: uzun } });
  const enUzun = (r.text.match(/Ü+/g) ?? []).reduce((m, s) => Math.max(m, s.length), 0);
  olcum("§3e onizleme", `${r.status} html=${r.text.length}B baslik Ü kosusu=${enUzun} ham isaret=${r.text.includes("<b id=pwn>")}`);
  check("§3e KARSI-KANIT onizleme titleOverride kacisli", !r.text.includes("<b id=pwn>"));
  check("§3e onizleme titleOverride kayit yoluyla AYNI tavana (80) kirpilmali", r.status === 200 && enUzun <= 80, `kosu=${enUzun}`);
}

async function h6Rate(admin: string): Promise<void> {
  console.log(`\n§3f — hiz siniri (B6, §3-7) · RATE_LIMIT_ENABLED=${RATE_ON ? "acik" : "yok"}`);
  let get429 = 0;
  const t0 = performance.now();
  for (let i = 0; i < 500; i++) { const r = await fetch(`${BASE}/api/health`); await r.arrayBuffer(); if (r.status === 429) get429++; }
  olcum("§3f 500 x GET /api/health", `429=${get429} sure=${Math.round(performance.now() - t0)}ms`);
  check("§3f KARSI-KANIT okumalar her iki durumda da sinirsiz (tasarim)", get429 === 0, `429=${get429}`);
  let yaz429 = 0; let ilk429 = -1;
  for (let i = 0; i < 150; i++) {
    const r = await call(admin, "POST", "/api/peripherals", { code: "" });
    if (r.status === 429) { yaz429++; if (ilk429 < 0) ilk429 = i + 1; }
  }
  olcum("§3f 150 x gecersiz POST /api/peripherals", `429=${yaz429} ilk429=${ilk429}`);
  if (RATE_ON) check("§3f sertlestirme acikken yazma kovasi 120'den sonra 429 verir", yaz429 > 0 && ilk429 <= 121, `ilk429=${ilk429} (onceki yazmalar ayni kovada)`);
  else check("§3f KARSI-KANIT varsayilan kurulumda yazma kovasi SAYILMAZ (fabrika sifir-fark; giris kovasi ortuk acik)", yaz429 === 0, `429=${yaz429}`);
}

async function h7Login(): Promise<void> {
  console.log("\n§3g — 900 KB parola + giris seli (B4, §3-5) — EN SON (giris kilidi)");
  const kucuk = await call(null, "POST", "/api/auth/login", { username: `yok${ek}`, password: "x", clientType: "electron" });
  const buyuk = await call(null, "POST", "/api/auth/login", { username: `yok${ek}`, password: "a".repeat(900_000), clientType: "electron" });
  olcum("§3g kucuk vs 900KB", `${kucuk.status}/${kucuk.ms}ms vs ${buyuk.status}/${buyuk.ms}ms`);
  check("§3g 900 KB parola sema tavaniyla 400/413 ile ERKEN doner", buyuk.status === 400 || buyuk.status === 413, ozet(buyuk));
  check("§3g KARSI-KANIT kisa parola sema kapisini gecer (401, 400 degil)", kucuk.status === 401, ozet(kucuk));
  // Sel ölçüsü (50 × 900 KB) doğrulama turunda koşuldu; kalıcı bekçide YOK — paylaşılan CI sunucusunun
  // 127.0.0.1 giriş kovasını (60/dk) ve giriş kilidini öteki bekçilere taşırmasın.
}

const BASLANGIC = new Date();
async function temizle(): Promise<void> {
  // §3g selinin biraktigi kalici giris kilidi (yalniz bu kosumun satirlari) — sonraki kosum kilitsiz acilsin.
  await prisma.loginLockoutBucket.deleteMany({ where: { updatedAt: { gte: BASLANGIC } } }).catch(() => {});
  await prisma.batch.deleteMany({ where: { id: { in: ids.batches } } }).catch(() => {});
  await prisma.workOrder.deleteMany({ where: { id: { in: ids.workOrders } } }).catch(() => {});
  await prisma.peripheralDevice.deleteMany({ where: { id: { in: ids.peripherals } } }).catch(() => {});
  await prisma.peripheralDevice.deleteMany({ where: { code: { startsWith: `TSTGRD${ek}` } } }).catch(() => {});
}

async function main(): Promise<void> {
  console.log("\n=== Guvenlik denetimi Bolge 4 (GIRDI) — saldiri sondasi ===");
  s1Csv();
  s1Redos();
  s1DocCfg();
  await s1Check();
  await s1Xss();
  s1Statik();
  await s2Like();
  const kapi = await httpBekciKapisi({ base: BASE, kontrolSayisi: HTTP_CHECKS });
  if (kapi.kirmizi) { check("HTTP ayagi olculebildi", false, kapi.kirmizi); return; }
  if (!kapi.token) { ATLAMA.atla("HTTP turu", kapi.atlaSebebi ?? "sunucu yok", HTTP_CHECKS); return; }
  const admin = kapi.token;
  try {
    await h1Csv(admin);
    await h2Peripheral(admin);
    await h3BatchSearch(admin);
    await h4FieldPicks(admin);
    await h5Sample(admin);
    await h6Rate(admin);
    await h7Login();
  } finally {
    await temizle();
  }
}

main()
  .then(() => { console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`); process.exitCode = fail > 0 ? 1 : 0; })
  .catch((e) => { console.error("Beklenmeyen hata:", e); process.exitCode = 1; });
