// =============================================================================
// ÖLÇÜM — sahadaki gerçek kodlar YENİ sınıflandırıcıdan geçiyor mu? (2026-09-22)
// =============================================================================
// Faz B'nin (barkod sınıflandırması sunucuya) ÖN KOŞUL ölçümüdür, bekçi DEĞİLDİR
// — bu yüzden adı `test_` ile başlamaz: `npm test` her koşumda fabrika kopyası
// aramasın. Tek seferlik, SALT OKUR.
//
// ⛔ SALT OKUMA: bu dosyada INSERT/UPDATE/DELETE/DDL YOKTUR. Tek erişim
//    `$queryRawUnsafe` ile SELECT'tir ve tablo/kolon adları aşağıdaki sabit
//    listeden gelir (dışarıdan parametre alınmaz).
// ⛔ HEDEF: fabrikanın canlı yedeğini taşıyan dev veritabanına karşı KOŞULMAZ
//    (adı `docs/RECETELER.md` § izole çalışma ağacında). Kendi kopyanı al
//    (`pg_restore` → `tekserp_<oturum>_prova`) ve DATABASE_URL'i komut satırında
//    bütün yaz. Aşağıdaki kapı tanınmayan hedefte durur (fail-closed allowlist).
//
// Soru: bugünkü istemci sınıflandırması (panel `barcode-kind.ts` BARCODE_FORMATS
// + PREFIX_RULES, backend `search.service.ts` EXACT_FORMATS ikizi) ile Faz A'nın
// seri tablosundan türeyen `matchesSeries` AYNI kodları mı kabul ediyor?
//   GERİLEME = eski kabul ediyordu, yeni etmiyor  → kabul ölçütü 0
//   GENİŞLEME = eski reddediyordu, yeni ediyor    → beklenen: 5+ haneli kodlar
// =============================================================================
import prisma from "../src/lib/prisma";
import {
  resolveSeriesFormat,
  matchesSeries,
  seriesClassifierTable,
  type NumberSeriesFormat,
} from "../src/services/number-series.service";
import type { NumberSeriesKind } from "../src/constants/number-series-catalog";

// ── HEDEF DB KAPISI — fail-closed allowlist (ad tanınmıyorsa RED) ────────────
// "Blocklist" kurgusu sızdırır: fabrika yedeğini taşıyan dev DB'nin adı `_test` ile BİTMEZ.
const DB_ALLOW = /^tekserp_[a-z0-9]+_(prova|test)$/;
function assertTargetAllowed(): string {
  const url = process.env.DATABASE_URL ?? "";
  const name = url.split("/").pop()?.split("?")[0] ?? "";
  if (!DB_ALLOW.test(name)) {
    console.error(
      `⛔ Hedef DB '${name || "(okunamadı)"}' izinli değil. Bu script yalnız kendi kopyanda koşar ` +
        `(tekserp_<oturum>_prova | _test). Fabrika yedeğine ASLA koşturma.`,
    );
    process.exit(2);
  }
  return name;
}

// ── ESKİ YOL — panel `Electron/src/lib/scanner/barcode-kind.ts` birebir kopyası ─
type BarcodeKind = "ROLL" | "TRAVELER_CARD" | "SWATCH" | "SACK" | "SHIPMENT" | "DISPATCH_DOC" | "UNKNOWN";

const OLD_FORMATS: Partial<Record<BarcodeKind, RegExp>> = {
  ROLL: /^T\d{6}[HF]\d{4}$/,
  TRAVELER_CARD: /^(?:IE|RK)\d{6}\d{4}$/,
  SWATCH: /^KRT\d{6}\d{4}$/,
  SACK: /^CV\d{6}\d{4}$/,
  SHIPMENT: /^SVK\d{6}\d{4}$/,
  // DISPATCH_DOC: bugün TAM-FORMAT regex'i YOK (yalnız prefix kuralı) — "ölçülmedi".
};

const OLD_PREFIX_RULES: Array<{ re: RegExp; kind: BarcodeKind }> = [
  { re: /^KRT/, kind: "SWATCH" },
  { re: /^IE\d/, kind: "TRAVELER_CARD" },
  { re: /^RK/, kind: "TRAVELER_CARD" },
  { re: /^CV/, kind: "SACK" },
  { re: /^SVK/, kind: "SHIPMENT" },
  { re: /^(FS|FK|KS|KK)/, kind: "DISPATCH_DOC" },
  { re: /^T\d/, kind: "ROLL" },
];

function oldClassify(raw: string): BarcodeKind {
  const code = raw.trim().toUpperCase();
  for (const r of OLD_PREFIX_RULES) if (r.re.test(code)) return r.kind;
  return "UNKNOWN";
}

// ── YENİ YOL — Faz A servisinin seri tablosu ────────────────────────────────
const CLASSIFIER = seriesClassifierTable();

function rowFormat(row: (typeof CLASSIFIER)[number]): NumberSeriesFormat {
  return {
    prefix: row.prefixes[0],
    retiredPrefixes: row.prefixes.slice(1),
    dateSegment: row.dateSegment,
    digits: row.digits,
    separator: row.separator,
    // infix ATLANMAZ: atlanırsa ölçüm aracının kendisi her top barkodunu
    // "tanınmadı" sayar ve sahte gerileme raporlar (ilk koşumda oldu).
    ...(row.infix ? { infix: row.infix } : {}),
  };
}

/** Faz B istemcisinin yapacağı iş: kodu seri tablosundan çöz. */
function newClassify(raw: string): { kind: BarcodeKind; key: string | null } {
  const code = raw.trim().toUpperCase();
  for (const row of CLASSIFIER) {
    if (matchesSeries(rowFormat(row), code)) return { kind: row.kind as BarcodeKind, key: row.key };
  }
  return { kind: "UNKNOWN", key: null };
}

// ── TARANAN KOLONLAR ────────────────────────────────────────────────────────
interface Target {
  table: string;
  column: string;
  seriesKey: string;
  kind: BarcodeKind;
}
const TARGETS: Target[] = [
  { table: "rolls", column: "barcode", seriesKey: "roll", kind: "ROLL" },
  { table: "sacks", column: "sackNo", seriesKey: "sack", kind: "SACK" },
  { table: "shipments", column: "shipmentNo", seriesKey: "shipment", kind: "SHIPMENT" },
  { table: "swatches", column: "cardNumber", seriesKey: "swatch", kind: "SWATCH" },
  { table: "swatches", column: "barcode", seriesKey: "swatch", kind: "SWATCH" },
  { table: "traveler_cards", column: "cardNumber", seriesKey: "workOrder", kind: "TRAVELER_CARD" },
  { table: "traveler_cards", column: "barcode", seriesKey: "workOrder", kind: "TRAVELER_CARD" },
  { table: "subcontractor_dispatches", column: "dispatchNo", seriesKey: "subcontractorDispatch", kind: "DISPATCH_DOC" },
  { table: "subcontractor_receipts", column: "receiptNo", seriesKey: "subcontractorReceipt", kind: "DISPATCH_DOC" },
  { table: "kartela_dispatches", column: "dispatchNo", seriesKey: "kartelaDispatch", kind: "DISPATCH_DOC" },
  { table: "kartela_receipts", column: "receiptNo", seriesKey: "kartelaReceipt", kind: "DISPATCH_DOC" },
];

interface Bucket {
  target: Target;
  rows: number;
  codes: number;
  oldFullOk: number;
  newFullOk: number;
  regressionFull: string[];
  expansionFull: string[];
  regressionKind: string[];
  expansionKind: string[];
  bothReject: string[];
}

function sample(xs: string[], n = 6): string {
  return xs.length === 0 ? "—" : xs.slice(0, n).join(", ") + (xs.length > n ? ` … (+${xs.length - n})` : "");
}

async function main(): Promise<void> {
  const dbName = assertTargetAllowed();
  console.log(`# SAHA BARKOD SINIFLANDIRMA ÖLÇÜMÜ — hedef DB: ${dbName} (SALT OKUMA)\n`);

  const buckets: Bucket[] = [];
  for (const t of TARGETS) {
    const b: Bucket = {
      target: t,
      rows: 0,
      codes: 0,
      oldFullOk: 0,
      newFullOk: 0,
      regressionFull: [],
      expansionFull: [],
      regressionKind: [],
      expansionKind: [],
      bothReject: [],
    };
    let rows: Array<{ c: string | null }>;
    try {
      rows = await prisma.$queryRawUnsafe<Array<{ c: string | null }>>(
        `SELECT "${t.column}" AS c FROM "${t.table}"`,
      );
    } catch (e) {
      console.log(`## ${t.table}.${t.column} — OKUNAMADI (${(e as Error).message.split("\n")[0]})\n`);
      continue;
    }
    b.rows = rows.length;
    const fmt = resolveSeriesFormat(t.seriesKey);
    const oldFull = OLD_FORMATS[t.kind];

    for (const r of rows) {
      const code = (r.c ?? "").trim();
      if (code === "") continue;
      b.codes += 1;
      const up = code.toUpperCase();

      const oldOk = oldFull ? oldFull.test(up) : null; // null = eski yolda tam-format YOK
      const newOk = matchesSeries(fmt, up);
      if (oldOk === true) b.oldFullOk += 1;
      if (newOk) b.newFullOk += 1;
      if (oldOk === true && !newOk) b.regressionFull.push(code);
      if (oldOk === false && newOk) b.expansionFull.push(code);
      if (oldOk === false && !newOk) b.bothReject.push(code);

      const oldKind = oldClassify(up);
      const newKind = newClassify(up).kind;
      if (oldKind === t.kind && newKind !== t.kind) b.regressionKind.push(code);
      if (oldKind !== t.kind && newKind === t.kind) b.expansionKind.push(code);
    }
    buckets.push(b);
  }

  // ── 1. KÖRLÜK ZEMİNİ ──────────────────────────────────────────────────────
  console.log("## 1 — KAÇ KOD TARANDI (0 kod = 'ölçülmedi', 'temiz' DEĞİL)\n");
  console.log("| kolon | satır | boş olmayan kod | durum |");
  console.log("|---|---:|---:|---|");
  for (const b of buckets) {
    const d = b.codes === 0 ? "⚠️ ÖLÇÜLMEDİ (veri yok)" : "ölçüldü";
    console.log(`| ${b.target.table}.${b.target.column} | ${b.rows} | ${b.codes} | ${d} |`);
  }
  const total = buckets.reduce((s, b) => s + b.codes, 0);
  console.log(`| **TOPLAM** | | **${total}** | |\n`);

  // ── 2. GERİLEME ───────────────────────────────────────────────────────────
  const regF = buckets.reduce((s, b) => s + b.regressionFull.length, 0);
  const regK = buckets.reduce((s, b) => s + b.regressionKind.length, 0);
  console.log("## 2 — GERİLEME (eski kabul/doğru sınıflandırıyordu, yeni etmiyor) — kabul ölçütü 0\n");
  // ⚠️ KÖRLÜK ZEMİNİ: "0 gerileme" ancak İKİ yol da gerçekten kod KABUL ediyorsa
  // anlamlıdır. İkisi de her şeyi reddederse fark yine 0 çıkar ve ölçüm SUSAR.
  console.log("| kolon | eski kabul | yeni kabul | tam-format gerileme | tür gerilemesi | örnek |");
  console.log("|---|---:|---:|---:|---:|---|");
  for (const b of buckets) {
    if (b.codes === 0) continue;
    const eski = OLD_FORMATS[b.target.kind] ? `${b.oldFullOk}/${b.codes}` : "— (regex yok)";
    console.log(
      `| ${b.target.table}.${b.target.column} | ${eski} | ${b.newFullOk}/${b.codes} | ${b.regressionFull.length} | ${b.regressionKind.length} | ${sample([...b.regressionFull, ...b.regressionKind], 3)} |`,
    );
  }
  console.log(`\n**TOPLAM GERİLEME: tam-format ${regF} · tür ${regK}**\n`);

  // ── 3. GENİŞLEME ──────────────────────────────────────────────────────────
  const expF = buckets.reduce((s, b) => s + b.expansionFull.length, 0);
  console.log("## 3 — GENİŞLEME (eski reddediyordu, yeni kabul ediyor)\n");
  for (const b of buckets) {
    if (b.expansionFull.length === 0 && b.expansionKind.length === 0) continue;
    console.log(`### ${b.target.table}.${b.target.column}`);
    console.log(`- tam-format genişleme: **${b.expansionFull.length}** → ${sample(b.expansionFull, 10)}`);
    if (b.expansionKind.length > 0)
      console.log(`- tür genişlemesi: **${b.expansionKind.length}** → ${sample(b.expansionKind, 10)}`);
  }
  console.log(`\n**TOPLAM GENİŞLEME (tam-format): ${expF}**\n`);

  // ── 4. İKİSİ DE REDDEDİYOR (bugün de okunamayan kodlar) ───────────────────
  console.log("## 4 — İKİSİ DE REDDEDİYOR (bugün de okutulamıyor; Faz B'nin sorunu değil)\n");
  for (const b of buckets) {
    if (b.bothReject.length === 0) continue;
    console.log(`- ${b.target.table}.${b.target.column}: **${b.bothReject.length}** → ${sample(b.bothReject, 8)}`);
  }
  console.log("");

  // ── 5. DISPATCH_DOC — eski yolda tam-format YOK ───────────────────────────
  console.log("## 5 — Eski yolda TAM-FORMAT regex'i olmayan seriler (kıyas yapılamaz, yalnız yeni yol ölçüldü)\n");
  for (const b of buckets) {
    if (OLD_FORMATS[b.target.kind] || b.codes === 0) continue;
    console.log(
      `- ${b.target.table}.${b.target.column}: ${b.codes} kod, yeni yol kabul: **${b.newFullOk}**, red: **${b.codes - b.newFullOk}**`,
    );
  }
  console.log("");

  console.log(`## SONUÇ: ${regF + regK === 0 ? "✅ GERİLEME YOK" : `⛔ GERİLEME VAR (${regF + regK})`}`);
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
