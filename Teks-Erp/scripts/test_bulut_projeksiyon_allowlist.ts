// =============================================================================
// BEKÇİ — PATRON BULUTU PROJEKSİYON ALLOWLIST'İ (iş/kişisel alan SIZMAZ)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts bulut_projeksiyon_allowlist   (kendi _test DB'si; ~20 sn)
//
// NEDEN: kolon listesi OPT-IN'dir (tasarım §1.2) — katalogda yazmayan kolon gitmez. Bu bekçi
// opt-in'in KENDİSİNİ ölçer: katalog neyi yazıyorsa o gider, fazlası değil; ve katalogdaki bir
// satırın yanlış sınıfla (kişisel alan kök satırda) ya da yasak türde (not, kullanıcı kimliği,
// sır) yazılmasını yakalar.
//   §1 katalog biçimi: 24 KAYIT (7 BOYUT + 17 OLGU) + 6 ANLIK, tel adları tekil, `id` ilk ve İŞLEM
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
//   §9 ⭐ uzak raporlar: audit/* ve kişi adı taşıyan rapor YOK, anahtar katalogda, çıktı sondası temiz
//
// ⭐ KALICI SONDALAR ✓K1–K5 (her koşumda, sentetik katalog kopyasıyla): `notes` kolonu ·
// kök satırda `contactPhone` · `createdById` · kapsanmayan türetilmiş okuma · bilinmeyen izin —
// her biri denetçiyi KIRMIZI yapar (denetçiler kör değil).
// NEGATİF SONDA — dosya DIŞI mutasyon (cp + shasum ile geri alındı; commit mesajında):
//   A1 `cari-kart.yetkili` İŞLEM sınıfına alındı            → §3 + §5 ❌
//   A2 `record-builder` alt satır bölmesini atladı (hepsi kök) → §5 ❌
// =============================================================================
import { randomUUID } from "node:crypto";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { AuditService } from "../src/services/audit.service";
import { REPORT_BY_KEY } from "../src/constants/report-catalog";
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
import { buildRecords } from "../src/cloud-sync/record-builder";
import { buildSnapshots, SNAPSHOT_WIRE_SCHEMAS } from "../src/cloud-sync/snapshots";
import { PackageSchema } from "../src/cloud-sync/wire";
import { REMOTE_REPORTS, computeReportResult } from "../src/cloud-sync/report-requests";

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
  check("§1a 24 KAYIT (7 BOYUT + 17 OLGU) + 6 ANLIK", RECORD_PROJECTIONS.length === 24 && boyut === 7 && olgu === 17 && SNAPSHOT_PROJECTIONS.length === 6,
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

interface Fikstur { musteri: string; cari: string; kasa: string; faturalar: string[]; odeme: string; cek: string }

async function temizleFikstur(f: Partial<Fikstur>): Promise<void> {
  if (f.faturalar?.length) {
    await prisma.$executeRawUnsafe(`DELETE FROM "invoice_lines" WHERE "invoiceId" = ANY($1::uuid[])`, f.faturalar);
    await prisma.$executeRawUnsafe(`DELETE FROM "invoices" WHERE "id" = ANY($1::uuid[])`, f.faturalar);
  }
  if (f.odeme) await prisma.$executeRawUnsafe(`DELETE FROM "payments" WHERE "id" = $1::uuid`, f.odeme);
  if (f.cek) await prisma.$executeRawUnsafe(`DELETE FROM "cheques" WHERE "id" = $1::uuid`, f.cek);
  if (f.kasa) await prisma.$executeRawUnsafe(`DELETE FROM "cash_boxes" WHERE "id" = $1::uuid`, f.kasa);
  if (f.cari) await prisma.$executeRawUnsafe(`DELETE FROM "cari_accounts" WHERE "id" = $1::uuid`, f.cari);
  if (f.musteri) await prisma.$executeRawUnsafe(`DELETE FROM "customers" WHERE "id" = $1::uuid`, f.musteri);
  await prisma.$executeRawUnsafe(`DELETE FROM "sync_marks" WHERE "rowId" = ANY($1::uuid[])`, [f.musteri, f.cari, f.kasa, f.odeme, f.cek, ...(f.faturalar ?? [])].filter(Boolean));
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
  const snaps = await buildSnapshots({ now: new Date(), productionOn: true, financeOn: true, cadences: new Set(["HER_TUR", "SAATLIK", "GUNLUK"]) });
  const uretilen = new Set(snaps.map((s) => s.projection));
  const sema = new Set(Object.keys(SNAPSHOT_WIRE_SCHEMAS));
  const eksik = [...sema].filter((n) => !uretilen.has(n));
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
  check("§9c ⭐ her uzak rapor bu DB'de hesaplanır (HAZIR ya da kapalı modül)", durum.every((d) => d.includes(":HAZIR") || d.endsWith("/MODUL_KAPALI")), durum.join(" · "));
  check("§9d ⭐ rapor çıktısı sondası: kişi/kullanıcı alanı ve panel süzgeç seçenekleri yok", kotu.length === 0, kotu.join(",") || "temiz");
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
  check("§K5 ⭐ bilinmeyen izin kırmızı", izinDenetimi(new Map([["renk", "bulut:yok"]])).length === 1);
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
    await anlikBolumu();
    paketBolumu();
    izinBolumu();
    await raporBolumu();
    kaliciSondalar();
  } catch (e) {
    check("beklenmeyen hata", false, e instanceof Error ? `${e.message}\n${e.stack}` : String(e));
  } finally {
    await temizleFikstur(f).catch((e) => console.error("temizlik:", e));
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end().catch(() => undefined);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
