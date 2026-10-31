// =============================================================================
// BEKÇİ — PATRON BULUTU PROJEKSİYON ALLOWLIST'İ (iş/kişisel alan SIZMAZ)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts bulut_projeksiyon_allowlist   (kendi _test DB'si; ~20 sn)
//
// NEDEN: kolon listesi OPT-IN'dir (tasarım §1.2) — katalogda yazmayan kolon gitmez. Bu bekçi
// opt-in'in KENDİSİNİ ölçer: katalog neyi yazıyorsa o gider, fazlası değil; ve katalogdaki bir
// satırın yanlış sınıfla (kişisel alan kök satırda) ya da yasak türde (not, kullanıcı kimliği,
// sır) yazılmasını yakalar.
//   §1 katalog biçimi: 27 KAYIT (7 BOYUT + 20 OLGU) + 10 ANLIK (D4-H2 ozet-masraf, D4-G4 karlilik-ozet), tel adları tekil, `id` ilk ve İŞLEM
//   §2 ⭐ her opt-in kolon ŞEMADA var (information_schema)
//   §3 ⭐ SIZINTI: not/katlama/sır/kullanıcı kimliği kolonu HİÇBİR projeksiyonda yok; iletişim ·
//      keşideci · vergi/adres gibi kişisel kolon KİŞİSEL sınıfta (kök satırla gitmez)
//   §4 ⭐ türetilmiş alan: tel adları türeticiyle BİREBİR; okuduğu her tablo kökte, değişiklik
//      kaynağında, tetikleyici işaretinde ya da gerekçeli kapsama listesinde (§4.3d); ⏱ alanın
//      geçiş kaynağı var
//   §5 ⭐ CANLI KURULUM: her projeksiyonun gerçek satırı katalogdaki tel adlarından FAZLASINI
//      taşımaz; FINANS/KISISEL alan kök satırda YOK, alt satır yalnız kendi sınıfını taşır
//   §6 ⭐ anlık kayıtlar katı tel şemasından geçer; şema kümesi ↔ üretilen küme iki yönlü
//   §7 ⭐ paket şeması KATI: tanınmayan anahtar ve uuid olmayan satır kimliği RED
//   §8 ⭐ her tel projeksiyon adı (alt satır · bölüm dahil) bulut izin kataloğuna eşlenir (fail-closed)
//   §10 ⭐ (2026-10-25, R1-BULUT bulgusu) eski 8 rapor uygulamanın fabrika günü (`YYYY-MM-DD`) aralığını kabul eder;
//      sınır `constants/time`tan, ISO aynen geçer, taşan gün/bilinmeyen anahtar red; uçtan uca HAZIR (PARAMETRE_GECERSIZ değil).
//      NEGATİF SONDA: `sales/order-intake` `acceptFactoryDays` sarmalı söküldü → §10a + §10f ❌; `isFactoryDay`
//      gidiş-dönüşü kaldırıldı → §10c + §10d ❌; geri alındı → ✅.
//   §9 ⭐ uzak raporlar: audit/* ve kişi adı taşıyan rapor YOK, anahtar katalogda, çıktı sondası temiz;
//      §9e–§9g v2 (R1-BULUT): `kisiAdi` yazan temel rapor listede yok (kaynak taraması) · kişi adlı sunum
//      sonuçtan düşer · her v2 uzak raporun sonucu `RaporSunumu` (anahtar = rapor, ana sayı var, kisiAdi yok).
//      ✓S1 (R1-BULUT 2026-10-25): `production/uretim-akisi` REMOTE_REPORTS'e eklendi → §9e ❌ 1; md5 ile geri alındı.
//   §5e ⭐ görünen ad (sipariş/sevkiyat `musteriAdi`, kalem `urunAdi`/`renkAdi`) = BOYUT `ad`ı, kök
//      satırda; cari/ürün/renk değişikliği bağlı kökü kirletir (ad değişimi yeniden gönderilir)
//
// ⭐ KALICI SONDALAR ✓K1–K6 (her koşumda, sentetik katalog kopyasıyla): `notes` kolonu ·
// kök satırda `contactPhone` · `createdById` · kapsanmayan türetilmiş okuma · bilinmeyen izin · cari kilidi `reasonText` —
// her biri denetçiyi KIRMIZI yapar (denetçiler kör değil).
// NEGATİF SONDA — dosya DIŞI mutasyon (cp + shasum ile geri alındı; commit mesajında):
//   A1 `cari-kart.yetkili` İŞLEM sınıfına alındı            → §3 + §5 ❌
//   A2 `record-builder` alt satır bölmesini atladı (hepsi kök) → §5 ❌
//   A3 `siparis` kaynağından `customers` lookup'ı silindi       → §4a + §5f ❌
// =============================================================================
import { randomUUID } from "node:crypto";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { AuditService } from "../src/services/audit.service";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { REPORT_BY_KEY, isReportSurfaced } from "../src/constants/report-catalog";
import { collectAgingRows } from "../src/services/reports/finance-aging.report";
import {
  CLOUD_READ_PERMISSIONS,
  READ_COVERAGE,
  RECORD_PROJECTIONS,
  SNAPSHOT_PROJECTIONS,
  projectionPermissions,
  subRowName,
  type DataClass,
  type RecordProjection,
} from "../src/cloud-sync/projections";
import { DERIVERS } from "../src/cloud-sync/derived";
import { getFactoryTimezone, resolveRangeEnd, resolveRangeStart } from "../src/constants/time";
import { buildRecords } from "../src/cloud-sync/record-builder";
import { mapToRoots } from "../src/cloud-sync/change-scan";
import { buildSnapshots, SNAPSHOT_WIRE_SCHEMAS } from "../src/cloud-sync/snapshots";
import { computeProfitability } from "../src/services/helpers/profitability.helper";
import { PackageSchema } from "../src/cloud-sync/wire";
import { REMOTE_REPORTS, carriesPersonName, computeReportResult } from "../src/cloud-sync/report-requests";

const engel = hedefDbEngeli();
if (engel) {
  console.error(`⛔ DURDURULDU — ${engel}`);
  process.exit(1);
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}

AuditService.logEvent = async () => undefined;
AuditService.log = async () => undefined;

const TAG = `BLTA${Date.now().toString(36).toUpperCase()}`;

// ── Saf denetçiler (kalıcı sondalar bunları sentetik kopyaya uygular) ───────────
/** Hiçbir projeksiyonda olamayacak kolonlar: serbest not, katlama ikizi, sır, fabrika kullanıcı kimliği. */
const YASAK_KOLON: ReadonlyArray<[RegExp, string]> = [
  [/^notes?$/i, "serbest not"],
  [/^reason(Text)?$|Reason(Text)?$/i, "serbest sebep metni (yalnız sebep KODU gider)"],
  [/Fold$/, "arama katlama ikizi"],
  [/password|passcode|pin$|totp|secret|token|salt|hash$/i, "sır"],
  [/ById$|^userId$|^createdBy|^updatedBy|operator/i, "fabrika kullanıcı kimliği"],
];
/** Gidebilir ama YALNIZ KİŞİSEL alt satırda (bulut `bulut:cari:oku` ister). */
const KISISEL_KOLON = /contact|phone|email|drawer|^address|taxNumber|taxOffice|iban|nationalId|tckn/i;

export function sizintiDenetimi(projs: readonly RecordProjection[]): string[] {
  const out: string[] = [];
  for (const p of projs) {
    for (const c of p.columns) {
      for (const [re, neden] of YASAK_KOLON) if (re.test(c.source)) out.push(`${p.name}.${c.source} (${neden})`);
      if (KISISEL_KOLON.test(c.source) && c.dataClass !== "KISISEL") out.push(`${p.name}.${c.source} KİŞİSEL değil (${c.dataClass})`);
    }
  }
  return out;
}

export function turetilmisKapsamDenetimi(projs: readonly RecordProjection[]): string[] {
  const out: string[] = [];
  for (const p of projs) {
    const gorunen = new Set<string>([p.root.table, ...p.sources.map((s) => s.table), ...(p.markedBy ?? []).map((m) => m.table), ...Object.keys(READ_COVERAGE)]);
    for (const d of p.derived) {
      for (const t of d.reads) if (!gorunen.has(t)) out.push(`${p.name}.${d.wire} ${t}'yi okuyor ama değişikliği görülmüyor`);
      if (d.timeBound && !(p.crossings && p.crossings.length > 0)) out.push(`${p.name}.${d.wire} zamana bağlı ama geçiş kaynağı yok`);
    }
  }
  return out;
}

export function izinDenetimi(map: ReadonlyMap<string, string>): string[] {
  const bilinen = new Set<string>(CLOUD_READ_PERMISSIONS);
  return [...map].filter(([, izin]) => !bilinen.has(izin)).map(([ad, izin]) => `${ad} → ${izin}`);
}

function bicimBolumu(): void {
  console.log("\n§1 — katalog biçimi");
  const boyut = RECORD_PROJECTIONS.filter((p) => p.role === "BOYUT").length;
  const olgu = RECORD_PROJECTIONS.filter((p) => p.role === "OLGU").length;
  check("§1a 27 KAYIT (7 BOYUT + 20 OLGU) + 10 ANLIK", RECORD_PROJECTIONS.length === 27 && boyut === 7 && olgu === 20 && SNAPSHOT_PROJECTIONS.length === 10,
    `${RECORD_PROJECTIONS.length} (${boyut}+${olgu}) + ${SNAPSHOT_PROJECTIONS.length}`);
  const adlar = [...RECORD_PROJECTIONS, ...SNAPSHOT_PROJECTIONS].map((p) => p.name);
  check("§1b projeksiyon adları tekil ve tel biçiminde", new Set(adlar).size === adlar.length && adlar.every((a) => /^[a-z][a-z0-9-]*$/.test(a)));
  const kotu: string[] = [];
  for (const p of RECORD_PROJECTIONS) {
    const tel = [...p.columns.map((c) => c.wire), ...p.derived.map((d) => d.wire)];
    if (new Set(tel).size !== tel.length) kotu.push(`${p.name}: tel adı tekrar`);
    if (p.columns[0]?.wire !== "id" || p.columns[0]?.source !== "id" || p.columns[0]?.dataClass !== "ISLEM") kotu.push(`${p.name}: ilk kolon id/İŞLEM değil`);
    if (!tel.every((t) => /^[a-z][A-Za-z0-9]*$/.test(t))) kotu.push(`${p.name}: tel adı biçimsiz`);
  }
  check("§1c tel adları tekil, `id` ilk ve İŞLEM, biçim camelCase Türkçe", kotu.length === 0, kotu.join(" · "));
}

async function semaBolumu(): Promise<void> {
  console.log("\n§2 — opt-in kolonlar şemada");
  const rows = await prisma.$queryRawUnsafe<Array<{ t: string; c: string }>>(
    `SELECT table_name::text AS t, column_name::text AS c FROM information_schema.columns WHERE table_schema = 'public'`,
  );
  const sema = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!sema.has(r.t)) sema.set(r.t, new Set());
    sema.get(r.t)!.add(r.c);
  }
  const eksik: string[] = [];
  for (const p of RECORD_PROJECTIONS) for (const c of p.columns) if (!sema.get(p.root.table)?.has(c.source)) eksik.push(`${p.root.table}.${c.source}`);
  check("§2 ⭐ her opt-in kolon kök tabloda VAR", eksik.length === 0, eksik.join(", ") || `${RECORD_PROJECTIONS.reduce((n, p) => n + p.columns.length, 0)} kolon`);
}

function sizintiBolumu(): void {
  console.log("\n§3 — sızıntı");
  const s = sizintiDenetimi(RECORD_PROJECTIONS);
  check("§3 ⭐ yasak kolon yok, kişisel kolon KİŞİSEL sınıfta", s.length === 0, s.join(" · ") || "temiz");
}

async function turetilmisBolumu(): Promise<void> {
  console.log("\n§4 — türetilmiş alanlar");
  const t = turetilmisKapsamDenetimi(RECORD_PROJECTIONS);
  check("§4a ⭐ türetilmiş alanın okuduğu her tablonun değişikliği görülüyor; ⏱ alanın geçişi var", t.length === 0, t.join(" · ") || "tam");
  const turetilen = RECORD_PROJECTIONS.filter((p) => p.derived.length > 0).map((p) => p.name).sort();
  const turetici = Object.keys(DERIVERS).sort();
  check("§4b türetici kümesi ↔ türetilmiş alanı olan projeksiyonlar birebir", JSON.stringify(turetilen) === JSON.stringify(turetici), `${turetilen.join(",")} ↔ ${turetici.join(",")}`);
}

interface Fikstur { musteri: string; cari: string; kasa: string; faturalar: string[]; odeme: string; cek: string; urun: string; renk: string; siparis: string; kalemler: string[]; sevk: string }

async function temizleFikstur(f: Partial<Fikstur>): Promise<void> {
  if (f.kalemler?.length) await prisma.$executeRawUnsafe(`DELETE FROM "order_lines" WHERE "id" = ANY($1::uuid[])`, f.kalemler);
  if (f.siparis) await prisma.$executeRawUnsafe(`DELETE FROM "orders" WHERE "id" = $1::uuid`, f.siparis);
  if (f.sevk) await prisma.$executeRawUnsafe(`DELETE FROM "shipments" WHERE "id" = $1::uuid`, f.sevk);
  if (f.urun) await prisma.$executeRawUnsafe(`DELETE FROM "items" WHERE "id" = $1::uuid`, f.urun);
  if (f.renk) await prisma.$executeRawUnsafe(`DELETE FROM "colors" WHERE "id" = $1::uuid`, f.renk);
  if (f.faturalar?.length) {
    await prisma.$executeRawUnsafe(`DELETE FROM "invoice_lines" WHERE "invoiceId" = ANY($1::uuid[])`, f.faturalar);
    await prisma.$executeRawUnsafe(`DELETE FROM "invoices" WHERE "id" = ANY($1::uuid[])`, f.faturalar);
  }
  if (f.odeme) await prisma.$executeRawUnsafe(`DELETE FROM "payments" WHERE "id" = $1::uuid`, f.odeme);
  if (f.cek) await prisma.$executeRawUnsafe(`DELETE FROM "cheques" WHERE "id" = $1::uuid`, f.cek);
  if (f.kasa) await prisma.$executeRawUnsafe(`DELETE FROM "cash_boxes" WHERE "id" = $1::uuid`, f.kasa);
  if (f.cari) await prisma.$executeRawUnsafe(`DELETE FROM "cari_accounts" WHERE "id" = $1::uuid`, f.cari);
  if (f.musteri) await prisma.$executeRawUnsafe(`DELETE FROM "customers" WHERE "id" = $1::uuid`, f.musteri);
  await prisma.$executeRawUnsafe(`DELETE FROM "sync_marks" WHERE "rowId" = ANY($1::uuid[])`,
    [f.musteri, f.cari, f.kasa, f.odeme, f.cek, ...(f.faturalar ?? []), f.urun, f.renk, f.siparis, f.sevk, ...(f.kalemler ?? [])].filter(Boolean));
}

/** Finans tabloları bu DB'de boştur — türeticileri gerçek satırla koşturmak için küçük fikstür (sonda silinir). */
async function finansFikstur(f: Partial<Fikstur>): Promise<void> {
  // Fikstür İŞ ANAHTARIYLA kurulur — temiz bir CI DB'sinde de satır vardır.
  f.musteri = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "customers" ("id", "code", "name", "contactName", "contactPhone", "updatedAt") VALUES ($1::uuid, $2, $3, 'Yetkili Kişi', '05550000000', now())`,
    f.musteri, `${TAG}M`, `${TAG} müşteri`,
  );
  f.cari = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "cari_accounts" ("id", "kind", "customerId", "paymentTermDays", "updatedAt") VALUES ($1::uuid, 'CUSTOMER', $2::uuid, 30, now())`,
    f.cari, f.musteri,
  );
  f.kasa = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO "cash_boxes" ("id", "code", "name", "updatedAt") VALUES ($1::uuid, $2, $3, now())`, f.kasa, `${TAG}K`, `${TAG} kasa`);
  f.faturalar = [randomUUID(), randomUUID()];
  await prisma.$executeRawUnsafe(
    `INSERT INTO "invoices" ("id", "docNo", "type", "status", "cariId", "issueDate", "dueDate", "confirmedAt", "grandTotal", "paidTotal", "updatedAt")
     VALUES ($1::uuid, $3, 'SALES', 'CONFIRMED', $5::uuid, now() - interval '40 days', now() - interval '5 days', now(), 100, 40, now()),
            ($2::uuid, $4, 'SALES', 'DRAFT', $5::uuid, now(), NULL, NULL, 0, 0, now())`,
    f.faturalar[0], f.faturalar[1], `${TAG}F1`, `${TAG}F2`, f.cari,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "invoice_lines" ("id", "invoiceId", "lineNo", "description", "qty", "unitPrice", "lineTotal", "vatAmount") VALUES ($1::uuid, $2::uuid, 1, 'kalem', 1, 100, 100, 0)`,
    randomUUID(), f.faturalar[0],
  );
  f.odeme = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "payments" ("id", "docNo", "direction", "method", "cariId", "amount", "amountTry", "allocatedTotal", "cashBoxId", "paymentDate", "updatedAt") VALUES ($1::uuid, $2, 'IN', 'CASH', $3::uuid, 50, 50, 10, $4::uuid, now(), now())`,
    f.odeme, `${TAG}P`, f.cari, f.kasa,
  );
  f.cek = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "cheques" ("id", "docNo", "kind", "status", "cariId", "amount", "amountTry", "issueDate", "dueDate", "postingDate", "drawerName", "updatedAt") VALUES ($1::uuid, $2, 'RECEIVED', 'PORTFOLIO', $3::uuid, 30, 30, now(), now() + interval '20 days', now(), 'Keşideci Kişi', now())`,
    f.cek, `${TAG}C`, f.cari,
  );
  // Görünen ad fikstürü (§5e): sipariş + iki kalem (biri renksiz) + sevkiyat aynı cariye.
  f.urun = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO "items" ("id", "code", "name", "itemType", "updatedAt") VALUES ($1::uuid, $2, $3, 'FABRIC', now())`, f.urun, `${TAG}U`, `${TAG} ürün`);
  f.renk = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO "colors" ("id", "code", "name", "updatedAt") VALUES ($1::uuid, $2, $3, now())`, f.renk, `${TAG}R`, `${TAG} renk`);
  f.siparis = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO "orders" ("id", "orderNumber", "customerId", "updatedAt") VALUES ($1::uuid, $2, $3::uuid, now())`, f.siparis, `${TAG}S`, f.musteri);
  f.kalemler = [randomUUID(), randomUUID()];
  await prisma.$executeRawUnsafe(
    `INSERT INTO "order_lines" ("id", "orderId", "itemId", "colorId", "quantity", "updatedAt") VALUES ($1::uuid, $3::uuid, $4::uuid, $5::uuid, 10, now()), ($2::uuid, $3::uuid, $4::uuid, NULL, 5, now())`,
    f.kalemler[0], f.kalemler[1], f.siparis, f.urun, f.renk,
  );
  f.sevk = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO "shipments" ("id", "shipmentNo", "customerId", "updatedAt") VALUES ($1::uuid, $2, $3::uuid, now())`, f.sevk, `${TAG}V`, f.musteri);
}

/** §5e — görünen ad: değer BOYUT `ad`ıyla aynı, kök satırda; kaynağın kök eşlemesi ad değişimini bağlı köke taşır. */
async function gorunenAdBolumu(f: Partial<Fikstur>): Promise<void> {
  const proj = (ad: string): RecordProjection => RECORD_PROJECTIONS.find((p) => p.name === ad)!;
  const sip = (await buildRecords(proj("siparis"), [f.siparis!], Date.now())).rows.get("siparis") ?? [];
  const sev = (await buildRecords(proj("sevkiyat"), [f.sevk!], Date.now())).rows.get("sevkiyat") ?? [];
  const kal = new Map(((await buildRecords(proj("siparis-kalemi"), f.kalemler!, Date.now())).rows.get("siparis-kalemi") ?? []).map((r) => [r.id, r]));
  const k0 = kal.get(f.kalemler![0]!);
  const k1 = kal.get(f.kalemler![1]!);
  check("§5e ⭐ görünen ad kök satırda ve BOYUT `ad`ıyla aynı (renksiz kalemde null)",
    sip[0]?.musteriAdi === `${TAG} müşteri` && sev[0]?.musteriAdi === `${TAG} müşteri` &&
      k0?.urunAdi === `${TAG} ürün` && k0?.renkAdi === `${TAG} renk` && k1?.urunAdi === `${TAG} ürün` && k1?.renkAdi === null,
    `sipariş ${String(sip[0]?.musteriAdi)} · sevk ${String(sev[0]?.musteriAdi)} · kalem ${String(k0?.urunAdi)}/${String(k0?.renkAdi)} · renksiz ${String(k1?.renkAdi)}`);
  const kirlenen = async (ad: string, tablo: string, anahtar: string): Promise<string[]> => {
    const s = proj(ad).sources.find((x) => x.table === tablo);
    return s ? mapToRoots(s.root, [anahtar]) : [];
  };
  const sipK = await kirlenen("siparis", "customers", f.musteri!);
  const sevK = await kirlenen("sevkiyat", "customers", f.musteri!);
  const urnK = await kirlenen("siparis-kalemi", "items", f.urun!);
  const rnkK = await kirlenen("siparis-kalemi", "colors", f.renk!);
  check("§5f ⭐ cari/ürün/renk değişikliği bağlı kökü kirletir (ad değişimi yeniden gönderilir)",
    sipK.includes(f.siparis!) && sevK.includes(f.sevk!) && f.kalemler!.every((k) => urnK.includes(k)) && rnkK.length === 1 && rnkK[0] === f.kalemler![0],
    `sipariş ${sipK.length} · sevk ${sevK.length} · ürün→kalem ${urnK.length} · renk→kalem ${rnkK.length}`);
}

async function canliBolumu(): Promise<void> {
  console.log("\n§5 — canlı kurulum (gerçek satırlar)");
  const ihlal: string[] = [];
  let satir = 0;
  const bos: string[] = [];
  for (const p of RECORD_PROJECTIONS) {
    const ids = (await prisma.$queryRawUnsafe<Array<{ id: string }>>(`SELECT "id"::text AS id FROM "${p.root.table}" ORDER BY "createdAt" DESC LIMIT 5`)).map((r) => r.id);
    if (ids.length === 0) bos.push(p.name);
    // Boş tabloda da seçim DB'ye gider: yanlış alan adı burada patlar.
    const built = await buildRecords(p, ids.length > 0 ? ids : [randomUUID()], Date.now());
    const izinli = new Map<string, Set<string>>();
    const sinifi = (cls: DataClass): Set<string> => {
      const ad = subRowName(p, cls);
      if (!izinli.has(ad)) izinli.set(ad, new Set(["id"]));
      return izinli.get(ad)!;
    };
    sinifi("ISLEM");
    for (const c of p.columns) sinifi(c.dataClass).add(c.wire);
    for (const d of p.derived) sinifi(d.dataClass).add(d.wire);
    for (const [ad, rows] of built.rows) {
      const izin = izinli.get(ad);
      if (!izin) {
        ihlal.push(`${ad}: katalogda olmayan alt satır`);
        continue;
      }
      for (const r of rows) {
        satir++;
        const fazla = Object.keys(r).filter((k) => !izin.has(k));
        const eksik = [...izin].filter((k) => !(k in r));
        if (fazla.length) ihlal.push(`${ad}#${r.id.slice(0, 8)} fazla: ${fazla.join(",")}`);
        if (eksik.length) ihlal.push(`${ad}#${r.id.slice(0, 8)} eksik: ${eksik.join(",")}`);
      }
    }
  }
  check("§5a ⭐ her satır TAM OLARAK kendi alt satırının tel adlarını taşır (fazlası yok, FINANS/KİŞİSEL kökte yok)", ihlal.length === 0 && satir > 0,
    ihlal.slice(0, 6).join(" · ") || `${satir} satır · veri yok: ${bos.join(",") || "—"}`);
  const cari = await buildRecords(RECORD_PROJECTIONS.find((p) => p.name === "cari-kart")!, (await prisma.customer.findMany({ where: { code: { startsWith: TAG } }, select: { id: true } })).map((c) => c.id), Date.now());
  const kok = cari.rows.get("cari-kart") ?? [];
  const kisisel = cari.rows.get("cari-kart.kisisel") ?? [];
  check("§5b ⭐ cari kart: yetkili/telefon kök satırda YOK, kişisel alt satırda VAR", kok.length === 1 && kok.every((r) => !("yetkili" in r) && !("telefon" in r)) && kisisel.length === 1 && kisisel[0]!.yetkili === "Yetkili Kişi" && Object.keys(kisisel[0]!).length === 3);
  const f = RECORD_PROJECTIONS.find((p) => p.name === "fatura")!;
  const fb = await buildRecords(f, (await prisma.invoice.findMany({ where: { docNo: { startsWith: TAG } }, select: { id: true } })).map((i) => i.id), Date.now());
  const fk = fb.rows.get("fatura") ?? [];
  const ff = fb.rows.get("fatura.finans") ?? [];
  check("§5c ⭐ fatura: tutarlar kök satırda YOK, finans alt satırında; taslak KAPSAM_DISI döner", fk.length === 1 && fk.every((r) => !("genelToplam" in r) && !("acikTutar" in r) && r.vadesiGecti === true) && ff.length === 1 && ff[0]!.acikTutar === "60" && fb.removed.some((x) => x.neden === "KAPSAM_DISI"),
    `${fk.length} kök · ${ff.length} finans · açık ${String(ff[0]?.acikTutar)} · vadesi geçti ${String(fk[0]?.vadesiGecti)}`);
  const ch = RECORD_PROJECTIONS.find((p) => p.name === "cari-hesap")!;
  const cb = await buildRecords(ch, (await prisma.cariAccount.findMany({ where: { invoices: { some: { docNo: { startsWith: TAG } } } }, select: { id: true } })).map((c) => c.id), Date.now());
  const chf = cb.rows.get("cari-hesap.finans") ?? [];
  const cekirdek = (await collectAgingRows({ asOf: new Date(), cariIds: chf.map((r) => r.id) })).filter((a) => a.overdueTotal !== "0.00").map((a) => ({ doviz: a.currency, tutar: a.overdueTotal }));
  check("§5d ⭐ cari hesap gecikmişi = cari listesinin yaşlandırma çekirdeği (sanal FIFO mahsup dahil, tek kaynak)", chf.length === 1 && cekirdek.length > 0 && JSON.stringify(chf[0]!.gecikmis) === JSON.stringify(cekirdek),
    `${JSON.stringify(chf[0]?.gecikmis)} ↔ ${JSON.stringify(cekirdek)}`);
}

async function anlikBolumu(): Promise<void> {
  console.log("\n§6 — anlık kayıtlar");
  const snaps = await buildSnapshots({ now: new Date(), productionOn: true, financeOn: true, maliyetOn: true, cadences: new Set(["HER_TUR", "SAATLIK", "GUNLUK"]) });
  const uretilen = new Set(snaps.map((s) => s.projection));
  const sema = new Set(Object.keys(SNAPSHOT_WIRE_SCHEMAS));
  // D4-G4: `karlilik-ozet` DB'deki maliyet ∧ ön muhasebe ayarına bağlı (hesap null → anlık yok); kapalıysa beklenmez.
  const karlilikAcik = (await computeProfitability({ fromMonth: "2026-01", toMonth: "2026-01" })) !== null;
  const eksik = [...sema].filter((n) => !uretilen.has(n) && (n !== "karlilik-ozet" || karlilikAcik));
  const fazla = [...uretilen].filter((n) => !sema.has(n));
  check("§6a ⭐ üretilen anlık kümesi ↔ tel şeması kümesi birebir (ölü şema da, şemasız çıktı da yok)", eksik.length === 0 && fazla.length === 0,
    [eksik.length ? `üretilmeyen: ${eksik.join(",")}` : "", fazla.length ? `şemasız: ${fazla.join(",")}` : ""].filter(Boolean).join(" · ") || `${uretilen.size} kayıt`);
  const anahtarlar = (v: unknown, yol = ""): string[] => {
    if (Array.isArray(v)) return v.flatMap((x) => anahtarlar(x, yol));
    if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => [`${yol}${k}`, ...anahtarlar(x, `${yol}${k}.`)]);
    return [];
  };
  const kotu = snaps.flatMap((s) => anahtarlar(s.data).filter((k) => /operator|kullanici|user|barkod|barcode|rollId/i.test(k)).map((k) => `${s.projection}:${k}`));
  check("§6b ⭐ anlık çıktılarda operatör/kullanıcı/top düzeyi alan yok (P25)", kotu.length === 0, kotu.join(",") || "temiz");
  const uretim = snaps.find((s) => s.projection === "uretim-akisi");
  check("§6c uretim-akisi yalnız kolon toplamı + istasyon sayaçları taşır", !!uretim && JSON.stringify(Object.keys(uretim.data as object)) === JSON.stringify(["kolonlar", "istasyonlar"]));
  const saglik = snaps.find((s) => s.projection === "saglik");
  check("§6d saglik yalnız yedek hükmü + zamanı + yaşı taşır (dosya adı/yol GİTMEZ)", !!saglik && JSON.stringify(anahtarlar(saglik.data)) === JSON.stringify(["yedek", "yedek.hukum", "yedek.sonGeceYedegi", "yedek.yasSaat"]),
    saglik ? anahtarlar(saglik.data).join(",") : "üretilmedi");
  const tesis = snaps.find((s) => s.projection === "tesis");
  const TESIS_IZINLI = ["donemler", "donemler.gecerliBaslangic", "donemler.saatDilimi", "saatDilimi", "tabanDilim"];
  const tesisAnahtar = tesis ? [...new Set(anahtarlar(tesis.data))].sort() : [];
  check("§6e tesis yalnız saat dilimi DÖNEMLERİNİ taşır (şimdiki dilim + taban + dönemler)", !!tesis &&
    tesisAnahtar.every((k) => TESIS_IZINLI.includes(k)) && ["donemler", "saatDilimi", "tabanDilim"].every((k) => tesisAnahtar.includes(k)) &&
    (tesis.data as { saatDilimi?: unknown }).saatDilimi === getFactoryTimezone(), tesis ? JSON.stringify(tesis.data) : "üretilmedi");
}

function paketBolumu(): void {
  console.log("\n§7 — paket şeması KATI");
  const temel = {
    v: 1, sozlesme: 1, paketId: randomUUID(), kurulumId: randomUUID(), tur: "ARTIMLI", ufuk: new Date().toISOString(),
    uretimBilgisi: { uygulamaSurum: "2.12.0", katalogSurum: 1 }, kayitlar: [], anliklar: [], uzlastirma: [],
  };
  const kayit = (ek: Record<string, unknown> = {}, satir: Record<string, unknown> = { id: randomUUID(), ad: "x" }) => ({
    ...temel,
    kayitlar: [{ projeksiyon: "renk", katalogSurum: 1, yaz: [satir], sil: [], filigran: { onceki: null, yeni: { t: new Date().toISOString(), k: "000000000001" } }, tam: null, ...ek }],
  });
  check("§7a geçerli paket geçer", PackageSchema.safeParse(kayit()).success);
  check("§7b ⭐ zarfta tanınmayan anahtar RED", !PackageSchema.safeParse({ ...temel, ekAlan: 1 }).success);
  check("§7c ⭐ kayıtta tanınmayan anahtar RED", !PackageSchema.safeParse(kayit({ gizli: true })).success);
  check("§7d ⭐ uuid olmayan satır kimliği RED", !PackageSchema.safeParse(kayit({}, { id: "1", ad: "x" })).success);
  check("§7e sayaç 12 hane değilse RED (metin sırası = sayı sırası)", !PackageSchema.safeParse({ ...kayit(), kayitlar: [{ ...kayit().kayitlar[0]!, filigran: { onceki: null, yeni: { t: new Date().toISOString(), k: "1" } } }] }).success);
}

function izinBolumu(): void {
  console.log("\n§8 — izin eşlemesi");
  const map = projectionPermissions();
  const i = izinDenetimi(map);
  const beklenen = [
    ...RECORD_PROJECTIONS.map((p) => p.name),
    ...SNAPSHOT_PROJECTIONS.flatMap((s) => (s.sections ? s.sections.map((x) => x.name) : [s.name])),
  ];
  const eslenmeyen = beklenen.filter((n) => !map.has(n));
  check("§8a ⭐ her tel adı bilinen bir bulut iznine eşlenir", i.length === 0 && eslenmeyen.length === 0, [...i, ...eslenmeyen].join(" · ") || `${map.size} ad`);
  check("§8b finans DIŞI projeksiyonun .finans alt satırı bulut:fiyat:oku, kişisel alt satır bulut:cari:oku", map.get("siparis.finans") === "bulut:fiyat:oku" && map.get("cari-kart.kisisel") === "bulut:cari:oku" && map.get("cek-senet.kisisel") === "bulut:cari:oku" && map.get("fatura.finans") === "bulut:fatura:oku");
}

async function raporBolumu(): Promise<void> {
  console.log("\n§9 — uzak raporlar");
  const anahtarlar = REMOTE_REPORTS.map((r) => r.key);
  check("§9a ⭐ audit/* ve operatör performansı (kişi adı) buluttan istenemez", anahtarlar.every((k) => !k.startsWith("audit/") && k !== "production/operator-performance"));
  check("§9b her uzak rapor katalogda", anahtarlar.every((k) => REPORT_BY_KEY.has(k as never)), anahtarlar.filter((k) => !REPORT_BY_KEY.has(k as never)).join(",") || `${anahtarlar.length} rapor`);
  const kotu: string[] = [];
  const durum: string[] = [];
  for (const r of REMOTE_REPORTS) {
    const sonuc = await computeReportResult({ istekId: null, key: r.key, params: {}, donem: null, nowMs: Date.now() });
    durum.push(`${r.key}:${sonuc.durum}${sonuc.hataKodu ? `/${sonuc.hataKodu}` : ""}`);
    const tara = (v: unknown, yol: string): void => {
      if (Array.isArray(v)) v.forEach((x) => tara(x, yol));
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) {
        if (/ById$|operator|userName|fullName|contact|phone|email/i.test(k)) kotu.push(`${r.key}:${yol}${k}`);
        tara(x, `${yol}${k}.`);
      }
    };
    tara(sonuc.veri, "");
    if ("secenekler" in ((sonuc.veri as object | null) ?? {})) kotu.push(`${r.key}: secenekler`);
  }
  // Yüzeye çıkmamış v2 satırı (`hazir:false`) buluta da kapalıdır → RAPOR_KAPALI beklenir.
  const yuzeyde = (k: string): boolean => { const e = REPORT_BY_KEY.get(k as never); return e !== undefined && isReportSurfaced(e); };
  check("§9c ⭐ her uzak rapor bu DB'de hesaplanır (HAZIR · kapalı modül · yüzeyde değilse RAPOR_KAPALI)",
    durum.every((d) => d.includes(":HAZIR") || d.endsWith("/MODUL_KAPALI") || (d.endsWith("/RAPOR_KAPALI") && !yuzeyde(d.split(":")[0]!))), durum.join(" · "));
  check("§9d ⭐ rapor çıktısı sondası: kişi/kullanıcı alanı ve panel süzgeç seçenekleri yok", kotu.length === 0, kotu.join(",") || "temiz");

  // §9e: `kisiAdi` yazan temel rapor dosyası → `catalogHeader("<anahtar>")` ile hangi rapor; o anahtar listede OLMAZ.
  const temelDizin = path.join(__dirname, "..", "src", "services", "reports", "temel");
  const kisiAdli: string[] = [];
  for (const ad of readdirSync(temelDizin).filter((n) => n.endsWith(".temel.ts"))) {
    const kaynak = readFileSync(path.join(temelDizin, ad), "utf8");
    if (!/\bkisiAdi\b/.test(kaynak)) continue;
    for (const m of kaynak.matchAll(/catalogHeader\(\s*"([^"]+)"/g)) kisiAdli.push(m[1]!);
  }
  const sizan = kisiAdli.filter((k) => anahtarlar.includes(k));
  check("§9e ⭐ kişi adı (`kisiAdi`) yazan temel rapor buluta gitmez (K-KISI)", kisiAdli.length >= 1 && sizan.length === 0,
    sizan.length > 0 ? `listede: ${sizan.join(",")}` : `taranan kişi adlı: ${kisiAdli.join(",") || "YOK — tarama ölçülemedi"}`);
  check("§9f ⭐ kişi adlı sunum sonuçtan düşer (savunma) · adsız sunum geçer",
    carriesPersonName({ anahtar: "x", kisiAdi: true }) && !carriesPersonName({ anahtar: "x" }) && !carriesPersonName(null));

  // §9g: v2 satırı yüzeye çıkmamış olsa da (hazir:false) servis yolu ölçülür — sonuç fabrikada kurulmuş sunum.
  const sunumKotu: string[] = [];
  let v2Sayi = 0;
  for (const r of REMOTE_REPORTS) {
    if (REPORT_BY_KEY.get(r.key)?.nesil !== "v2") continue;
    v2Sayi++;
    let v: unknown;
    try {
      v = await r.reportRunner(r.params.parse({}));
    } catch (e) {
      // Kapalı modül (dokuma/devere/finans) bu DB'de 403 verir; kapı `availability`de ölçülür.
      if (e instanceof Error && /MODULE_DISABLED|kapalı/i.test(e.message)) continue;
      sunumKotu.push(`${r.key}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    const s = v as { anahtar?: unknown; anaSayi?: { olcu?: unknown } | null; anlati?: unknown; kisiAdi?: unknown };
    if (s?.anahtar !== r.key || typeof s.anaSayi?.olcu !== "string" || !Array.isArray(s.anlati) || s.kisiAdi !== undefined) sunumKotu.push(`${r.key}: sunum değil`);
    // §9d'nin anahtar sondası yüzeye çıkmamış v2 sunumuna da (RAPOR_KAPALI dönen) uygulanır.
    const tara = (x: unknown, yol: string): void => {
      if (Array.isArray(x)) x.forEach((y) => tara(y, yol));
      else if (x && typeof x === "object") for (const [k, y] of Object.entries(x)) {
        if (/ById$|operator|userName|fullName|contact|phone|email/i.test(k)) sunumKotu.push(`${r.key}:${yol}${k}`);
        tara(y, `${yol}${k}.`);
      }
    };
    tara(v, "");
  }
  check("§9g ⭐ her v2 uzak rapor `RaporSunumu` döner (anahtar · ana sayı · anlatı; kisiAdi yok)", v2Sayi >= 9 && sunumKotu.length === 0, sunumKotu.join(" · ") || `${v2Sayi} v2 rapor`);
}

function kaliciSondalar(): void {
  console.log("\n§K — kalıcı sondalar (sentetik katalog)");
  const kopya = (fn: (p: RecordProjection) => RecordProjection): RecordProjection[] => RECORD_PROJECTIONS.map((p) => (p.name === "cari-kart" ? fn(p) : p));
  const not = kopya((p) => ({ ...p, columns: [...p.columns, { wire: "not", source: "notes", dataClass: "ISLEM" }] }));
  check("§K1 ⭐ `notes` kolonu eklenince sızıntı denetçisi kırmızı", sizintiDenetimi(not).some((x) => x.includes("notes")));
  const tel = kopya((p) => ({ ...p, columns: p.columns.map((c) => (c.source === "contactPhone" ? { ...c, dataClass: "ISLEM" as const } : c)) }));
  check("§K2 ⭐ telefon kök satıra alınınca kırmızı", sizintiDenetimi(tel).some((x) => x.includes("contactPhone")));
  const kim = kopya((p) => ({ ...p, columns: [...p.columns, { wire: "olusturan", source: "createdById", dataClass: "ISLEM" }] }));
  check("§K3 ⭐ kullanıcı kimliği kolonu eklenince kırmızı", sizintiDenetimi(kim).some((x) => x.includes("createdById")));
  const oku = kopya((p) => ({ ...p, derived: [{ wire: "x", helper: "sonda", reads: ["rolls"], timeBound: false, dataClass: "ISLEM" }] }));
  check("§K4 ⭐ değişikliği görülmeyen tabloyu okuyan türetilmiş alan kırmızı", turetilmisKapsamDenetimi(oku).some((x) => x.includes("rolls")));
  const sebep = RECORD_PROJECTIONS.map((p) => (p.name === "cari-hesap" ? { ...p, columns: [...p.columns, { wire: "kilitSebebi", source: "reasonText", dataClass: "ISLEM" as const }] } : p));
  check("§K6 ⭐ cari kilidinin serbest `reasonText`i projeksiyona eklenince kırmızı (D4-I6)", sizintiDenetimi(sebep).some((x) => x.includes("reasonText")));
  check("§K5 ⭐ bilinmeyen izin kırmızı", izinDenetimi(new Map([["renk", "bulut:yok"]])).length === 1);
}

/** §10 — eski 8 rapor fabrika günü aralığını kabul eder (patron uygulaması `YYYY-MM-DD` yollar). */
async function eskiRaporGunBolumu(): Promise<void> {
  console.log("\n§10 — eski 8 rapor: fabrika günü aralığı (R1-BULUT)");
  const ARALIKLI = ["sales/order-intake", "sales/shipment-scorecard", "customer/scorecard", "quality/scorecard", "subcontract/scorecard", "finance/cheque-due"];
  const uzak = (k: string) => REMOTE_REPORTS.find((r) => r.key === k);
  const gun = { dateFrom: "2026-09-01", dateTo: "2026-09-30" };
  const iso = { dateFrom: resolveRangeStart("2026-09-01").toISOString(), dateTo: resolveRangeEnd("2026-09-30").toISOString() };
  const yanlis = ARALIKLI.filter((k) => {
    const r = uzak(k)?.params.safeParse(gun);
    return !r?.success || r.data.dateFrom !== iso.dateFrom || r.data.dateTo !== iso.dateTo;
  });
  check("§10a ⭐ 6 aralıklı eski rapor `YYYY-MM-DD` kabul eder → fabrika günü sınırı (constants/time)", yanlis.length === 0, yanlis.join(",") || `${iso.dateFrom}…${iso.dateTo}`);
  const isoRed = ARALIKLI.filter((k) => !uzak(k)?.params.safeParse(iso).success);
  check("§10b geri uyum: ISO gövde aynen geçer", isoRed.length === 0, isoRed.join(","));
  const gevsek = ARALIKLI.filter((k) => uzak(k)?.params.safeParse({ dateFrom: "2026-13-45" }).success || uzak(k)?.params.safeParse({ ...gun, zzz: "1" }).success);
  check("§10c taşan gün ve bilinmeyen anahtar yine RED (sessiz taşma yok, strict korunur)", gevsek.length === 0, gevsek.join(","));
  const yas = uzak("finance/aging")!.params;
  const y = yas.safeParse({ asOf: "2026-09-30" });
  check("§10d finance/aging: `asOf` fabrika günü → günün SONU; ISO geçer; taşan gün red",
    y.success && y.data.asOf === iso.dateTo && yas.safeParse({ asOf: iso.dateTo }).success && !yas.safeParse({ asOf: "2026-02-30" }).success,
    y.success ? String(y.data.asOf) : "red");
  const stok = uzak("inventory/scorecard")!.params;
  check("§10e inventory/scorecard (kesit; uygulama aralık sormaz): {} geçer, tarih anahtarı red (strict)", stok.safeParse({}).success && !stok.safeParse(gun).success);
  const durum: string[] = [];
  for (const k of [...ARALIKLI, "finance/aging", "inventory/scorecard"]) {
    const params = k === "finance/aging" ? { asOf: "2026-09-30" } : k === "inventory/scorecard" ? {} : gun;
    const sonuc = await computeReportResult({ istekId: null, key: k, params, donem: null, nowMs: Date.now() });
    if (sonuc.hataKodu === "PARAMETRE_GECERSIZ") durum.push(k);
  }
  check("§10f ⭐ uçtan uca: 8 rapor × fabrika günü → PARAMETRE_GECERSIZ YOK", durum.length === 0, durum.join(",") || "8 rapor");
}

async function main(): Promise<void> {
  console.log(`=== PATRON BULUTU PROJEKSİYON ALLOWLIST (${TAG}) ===`);
  const f: Partial<Fikstur> = {};
  try {
    bicimBolumu();
    await semaBolumu();
    sizintiBolumu();
    await turetilmisBolumu();
    await finansFikstur(f);
    await canliBolumu();
    await gorunenAdBolumu(f);
    await anlikBolumu();
    paketBolumu();
    izinBolumu();
    await raporBolumu();
    await eskiRaporGunBolumu();
    kaliciSondalar();
  } catch (e) {
    check("beklenmeyen hata", false, e instanceof Error ? `${e.message}\n${e.stack}` : String(e));
  } finally {
    await temizleFikstur(f).catch((e) => console.error("temizlik:", e));
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end().catch(() => undefined);
  process.exitCode = fail > 0 ? 1 : 0;
}

void main();
