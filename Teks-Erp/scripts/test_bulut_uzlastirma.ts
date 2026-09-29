// =============================================================================
// BEKÇİ — PATRON BULUTU GÜNLÜK UZLAŞTIRMA + KAPSAM İKİZİ + SAKLAMA UFKU + SAAT KAYMASI
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts bulut_uzlastirma   (kendi _test DB'si; ~15 sn)
//
// NEDEN: silme tetikleyicisi birincil yoldur; günlük uzlaştırma tetikleyicinin KURULMADIĞI ya
// da düştüğü hâli (elle restore, bulut restore'u) yakalayan güvenlik ağıdır (tasarım §4.4).
//   §1 ⭐ küme özeti biçimi fabrika (PG) ↔ bulut (JS) BİREBİR: uuid sırası, virgül, md5
//   §2 ⭐ kapsam boğaz-ikizi: Prisma parçası ile SQL ikizi AYNI satırları seçer (fatura: taslak
//      dışarıda · kalem: taslak faturanın kalemi dışarıda) — tx içinde, geri alınır
//   §3 ⭐ eşit küme → TAM istenmez; bulutta HAYALET satır (kaçan silme) → uyuşmazlık → TAM →
//      işaretle-süpür hayaleti temizler → sonraki uzlaştırma eşit (P7 · P22)
//   §4 ⭐ son onaydan SONRA doğan satır uzlaştırmayı bozmaz (`createdBefore` = onaylı ufuk)
//   §5 ⭐ saklama ufku: bulutun `ufukTarihi` fabrikada saklanır, TAM ve uzlaştırma onu uygular
//   §6 ⭐ saati ileri kaymış kurulumun gelecek tarihli satırı (S44): TAM ile buluta gitmiş satır ardışık
//      uzlaştırmalarda TAM DOĞURMAZ — fabrika onu `bekleyen` listesinde taşır, bulut aynı satırı dışlar
//   §7 ⭐ kalem ebeveyn kuralı (S45): vadesi ufuktan eski çekin ufuk içindeki hareketi kümede değil (bulut üst
//      çek budanınca kalemi de düşürür); ebeveyni son onaydan sonra doğan kalem bekleyendir
//   §8 ⭐ D4 bulut ayağı (S46): `ISTEK_ZAMAN` + `sunucuSaati` → BİR KEZ düzeltilmiş imza; yanlış saatte döngü yok
//
// NEGATİF SONDA — dosya DIŞI mutasyon (cp + shasum ile geri alındı; commit mesajında):
//   U1 `membershipDigest` onaylı ufku yok saydı (createdBefore düştü)  → §4 ❌
//   U2 fatura kapsamının SQL ikizi `TRUE` yapıldı                         → §2 ❌
//   U3 `ufukTarihi` saklanmadı                                          → §5 ❌
//   N1 uzlaştırma girdisi `bekleyen: []` gönderdi                      → §6b (2/2 TAM) · §6c ❌
//   N2 `memberWhere` ebeveyn koşulunu düşürdü                          → §7a ❌
//   N3 `cloudPost` düzeltilmiş yeniden imzayı atladı                   → §8a · §8b ❌
//   N4 düzeltilmiş imza iki kez denendi                                → §8b ❌ (401×3)
// Ölçüm (eski kod, bu bekçinin §6'sı): her ardışık uzlaştırmada renk TAM'ı — 2/2.
// =============================================================================
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { AuditService } from "../src/services/audit.service";
import { findRecordProjection } from "../src/cloud-sync/projections";
import { membershipDigest, membershipIds } from "../src/cloud-sync/reconcile";
import { runSyncRound } from "../src/cloud-sync/sync-round";
import { egressCloudTransport } from "../src/cloud-sync/cloud-client";
import { HORIZON_BASE_MARGIN_MS } from "../src/cloud-sync/horizon";
import { FULL_RESEND_MARKER, wmKey } from "../src/cloud-sync/watermarks";
import { bulutLisansKur, kumeOzeti, sahteBulutBaslat, type BulutLisans, type SahteBulut } from "./lib/bulut-fikstur";

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

const TAG = `BLTU${Date.now().toString(36).toUpperCase()}`;
const ufkuGec = (): Promise<void> => new Promise((r) => setTimeout(r, HORIZON_BASE_MARGIN_MS + 600));
const artimli = () => runSyncRound({ kind: "ARTIMLI", cadences: new Set() }, { transport: egressCloudTransport });
const uzlastir = () => runSyncRound({ kind: "UZLASTIRMA", cadences: new Set() }, { transport: egressCloudTransport });

async function temizleEsitlemeDurumu(): Promise<void> {
  await prisma.syncWatermark.deleteMany({});
  await prisma.syncMark.deleteMany({});
}

async function temizleFikstur(): Promise<void> {
  for (const t of temizlenecek) {
    await prisma.$executeRawUnsafe(`DELETE FROM "cheque_events" WHERE "chequeId" = ANY($1::uuid[])`, t.cekler);
    await prisma.$executeRawUnsafe(`DELETE FROM "cheques" WHERE "id" = ANY($1::uuid[])`, t.cekler);
    await prisma.$executeRawUnsafe(`DELETE FROM "cari_accounts" WHERE "id" = $1::uuid`, t.cari);
  }
  await prisma.$executeRawUnsafe(`DELETE FROM "orders" WHERE "orderNumber" LIKE $1`, `${TAG}%`);
  await prisma.$executeRawUnsafe(`DELETE FROM "customers" WHERE "code" LIKE $1`, `${TAG}%`);
  await prisma.$executeRawUnsafe(`DELETE FROM "colors" WHERE "code" LIKE $1`, `${TAG}%`);
}

const RENK = findRecordProjection("renk")!;
const SIPARIS = findRecordProjection("siparis")!;
const FATURA = findRecordProjection("fatura")!;
const KALEM = findRecordProjection("fatura-kalemi")!;
const CEK_HAREKETI = findRecordProjection("cek-hareketi")!;
const temizlenecek: Array<{ cari: string; cekler: string[] }> = [];

async function bicimBolumu(): Promise<void> {
  console.log("\n§1 — küme özeti biçimi");
  await prisma.color.create({ data: { code: `${TAG}B`, name: `${TAG} biçim` } });
  const ids = (await prisma.color.findMany({ select: { id: true } })).map((c) => c.id);
  const pg = await membershipDigest(RENK, { retentionFrom: null, createdBefore: null });
  check("§1a ⭐ PG özeti = bulutun JS özeti (uuid sırası · virgül · md5)", pg.count === ids.length && pg.digest === kumeOzeti(ids), `${pg.count} satır · ${pg.digest.slice(0, 12)}`);
  const bos = await membershipDigest(RENK, { retentionFrom: null, createdBefore: new Date(0) });
  check("§1b boş küme md5('') (iki taraf aynı sabiti üretir)", bos.count === 0 && bos.digest === kumeOzeti([]), bos.digest);
}

class GeriAl extends Error {}

async function kapsamBolumu(): Promise<void> {
  console.log("\n§2 — kapsam boğaz-ikizi (Prisma ↔ SQL)");
  const sonuc: Record<string, number> = {};
  try {
    await prisma.$transaction(async (tx) => {
      const cari = randomUUID();
      await tx.$executeRawUnsafe(
        `INSERT INTO "cari_accounts" ("id", "kind", "customerId", "updatedAt") SELECT $1::uuid, 'CUSTOMER', c."id", now() FROM "customers" c WHERE NOT EXISTS (SELECT 1 FROM "cari_accounts" a WHERE a."customerId" = c."id") LIMIT 1`,
        cari,
      );
      const taslak = randomUUID();
      const onayli = randomUUID();
      await tx.$executeRawUnsafe(
        `INSERT INTO "invoices" ("id", "docNo", "type", "status", "cariId", "issueDate", "confirmedAt", "updatedAt") VALUES ($1::uuid, $3, 'SALES', 'DRAFT', $5::uuid, now(), NULL, now()), ($2::uuid, $4, 'SALES', 'CONFIRMED', $5::uuid, now(), now(), now())`,
        taslak, onayli, `${TAG}T`, `${TAG}O`, cari,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO "invoice_lines" ("id", "invoiceId", "lineNo", "description", "qty", "unitPrice", "lineTotal", "vatAmount") VALUES ($1::uuid, $3::uuid, 1, 'a', 1, 1, 1, 0), ($2::uuid, $4::uuid, 1, 'b', 1, 1, 1, 0)`,
        randomUUID(), randomUUID(), taslak, onayli,
      );
      for (const p of [FATURA, KALEM]) {
        const model = p.root.model.charAt(0).toLowerCase() + p.root.model.slice(1);
        const delegate = (tx as unknown as Record<string, { count: (a: object) => Promise<number> }>)[model]!;
        sonuc[`${p.name}:prisma`] = await delegate.count({ where: p.scope!.prismaWhere });
        const r = await tx.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM "${p.root.table}" t WHERE ${p.scope!.sql}`);
        sonuc[`${p.name}:sql`] = r[0]?.n ?? -1;
        sonuc[`${p.name}:hepsi`] = (await tx.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM "${p.root.table}"`))[0]?.n ?? -1;
      }
      throw new GeriAl();
    });
  } catch (e) {
    if (!(e instanceof GeriAl)) throw e;
  }
  for (const p of [FATURA, KALEM]) {
    const pr = sonuc[`${p.name}:prisma`];
    const sq = sonuc[`${p.name}:sql`];
    const hepsi = sonuc[`${p.name}:hepsi`];
    check(`§2 ⭐ ${p.name}: Prisma kapsamı = SQL ikizi ve taslak DIŞARIDA`, pr === sq && pr !== undefined && hepsi !== undefined && pr < hepsi, `prisma ${pr} · sql ${sq} · tablo ${hepsi}`);
  }
}

async function uzlastirmaBolumu(bulut: SahteBulut): Promise<void> {
  console.log("\n§3 — uzlaştırma döngüsü");
  await ufkuGec();
  const o0 = await artimli();
  check("§3a taban tur TAMAM (ilk TAM)", o0.status === "TAMAM", `${o0.status} ${o0.reason ?? ""}`);
  const u1 = await uzlastir();
  const p1 = bulut.paketler[bulut.paketler.length - 1]!;
  check("§3b ⭐ eşit kümede TAM istenmez; paket UZLASTIRMA, kayıt taşımaz", u1.status === "TAMAM" && u1.fullRequested.length === 0 && p1.tur === "UZLASTIRMA" && p1.kayitlar.length === 0 && p1.uzlastirma.length > 0,
    `${u1.status} · istenen ${u1.fullRequested.join(",") || "yok"} · ${p1.uzlastirma.length} özet`);
  const hayalet = randomUUID();
  bulut.satirlar.get("renk")!.set(hayalet, { veri: { id: hayalet }, surum: "2000-01-01T00:00:00.000Z", silindi: null });
  const u2 = await uzlastir();
  const z = await prisma.syncWatermark.findUnique({ where: { source: wmKey.chain("renk") } });
  check("§3c ⭐ bulutta hayalet satır → uyuşmazlık → renk için TAM istendi ve işaretlendi", u2.fullRequested.includes("renk") && z?.digest === FULL_RESEND_MARKER, `${u2.fullRequested.join(",")} · ${z?.digest}`);
  await artimli();
  check("§3d TAM işaretle-süpür hayaleti temizledi", !bulut.satirlar.get("renk")!.has(hayalet));
  const u3 = await uzlastir();
  check("§3e onarımdan sonra uzlaştırma yine eşit", u3.fullRequested.length === 0, u3.fullRequested.join(",") || "eşit");
}

async function onaySonrasiBolumu(bulut: SahteBulut): Promise<void> {
  console.log("\n§4 — son onaydan sonra doğan satır");
  await prisma.color.create({ data: { code: `${TAG}Y`, name: `${TAG} yeni doğan` } });
  const u = await uzlastir();
  check("§4a ⭐ henüz eşitlenmemiş yeni satır sahte uyuşmazlık DOĞURMAZ (onaylı ufuk sınırı)", u.status === "TAMAM" && !u.fullRequested.includes("renk"), u.fullRequested.join(",") || "eşit");
  void bulut;
}

async function gelecekBolumu(bulut: SahteBulut): Promise<void> {
  console.log("\n§6 — saati ileri kaymış kurulumun gelecek tarihli satırı");
  const id = randomUUID();
  const ileri = new Date(Date.now() + 2 * 86_400_000);
  await prisma.$executeRawUnsafe(`INSERT INTO "colors" ("id", "code", "name", "createdAt", "updatedAt") VALUES ($1::uuid, $2, $3, $4, $4)`, id, `${TAG}G`, `${TAG} gelecek`, ileri);
  bulut.mod.istenenTam.add("renk");
  await artimli();
  await artimli();
  check("§6a fikstür: gelecek tarihli satır TAM ile bulutta", bulut.satirlar.get("renk")?.has(id) === true);
  const u1 = await uzlastir();
  await artimli();
  const u2 = await uzlastir();
  await artimli();
  const tam = [u1, u2].filter((u) => u.fullRequested.includes("renk")).length;
  check("§6b ⭐ gelecek tarihli satır TAM döngüsü doğurmaz (iki ardışık uzlaştırmada renk TAM'ı 0)", tam === 0, `${tam}/2`);
  const son = [...bulut.paketler].reverse().find((p) => p.tur === "UZLASTIRMA")?.uzlastirma.find((u) => u.projeksiyon === "renk");
  check("§6c bekleyen kimlik pakette: bulut aynı satırı kendi kümesinden dışlar (sınırı yalnız fabrika çizer)", son?.bekleyen.includes(id) === true, `${son?.bekleyen.length ?? "yok"}`);
}

async function ebeveynBolumu(): Promise<void> {
  console.log("\n§7 — kalem ebeveyn kuralı (S45)");
  const gun = 86_400_000;
  const simdi = Date.now();
  const [musteri, cari, eskiCek, yeniCek, h1, h2] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  temizlenecek.push({ cari, cekler: [eskiCek, yeniCek] });
  await prisma.$executeRawUnsafe(`INSERT INTO "customers" ("id", "code", "name", "updatedAt") VALUES ($1::uuid, $2, $3, now())`, musteri, `${TAG}C`, `${TAG} çek müşterisi`);
  await prisma.$executeRawUnsafe(`INSERT INTO "cari_accounts" ("id", "kind", "customerId", "updatedAt") VALUES ($1::uuid, 'CUSTOMER', $2::uuid, now())`, cari, musteri);
  const cek = `INSERT INTO "cheques" ("id", "docNo", "kind", "status", "cariId", "amount", "amountTry", "issueDate", "dueDate", "postingDate", "updatedAt") VALUES ($1::uuid, $2, 'RECEIVED', 'PORTFOLIO', $3::uuid, 1, 1, $4, $4, $4, now())`;
  await prisma.$executeRawUnsafe(cek, eskiCek, `${TAG}CE`, cari, new Date(simdi - 200 * gun));
  await prisma.$executeRawUnsafe(cek, yeniCek, `${TAG}CY`, cari, new Date(simdi + 30 * gun));
  const hareket = `INSERT INTO "cheque_events" ("id", "chequeId", "type", "toStatus", "eventDate") VALUES ($1::uuid, $2::uuid, 'COLLECT', 'COLLECTED', $3)`;
  await prisma.$executeRawUnsafe(hareket, h1, eskiCek, new Date(simdi - gun));
  await prisma.$executeRawUnsafe(hareket, h2, yeniCek, new Date(simdi - gun));
  const ufuk = new Date(simdi - 90 * gun);
  const ids = await membershipIds(CEK_HAREKETI, { retentionFrom: ufuk, createdBefore: null });
  check("§7a ⭐ vadesi ufuktan eski çekin ufuk içindeki hareketi kümede DEĞİL; güncel çeğinki kümede (TAM da aynı listeyi gönderir)", !ids.includes(h1) && ids.includes(h2), `eski ${ids.includes(h1)} · yeni ${ids.includes(h2)}`);
  const d = await membershipDigest(CEK_HAREKETI, { retentionFrom: null, createdBefore: new Date(simdi + gun), parentCreatedBefore: new Date(simdi - 60_000) });
  check("§7b ebeveyni son onaydan sonra doğan kalem bekleyendir", d.pending.includes(h1) && d.pending.includes(h2), `${d.pending.length} bekleyen`);
}

async function saatBolumu(bulut: SahteBulut): Promise<void> {
  console.log("\n§8 — bulut saati kayık (D4)");
  const saat = 2 * 3_600_000;
  bulut.mod.saatFarkiMs = saat;
  const n0 = bulut.istekler.length;
  const a = await uzlastir();
  const i0 = bulut.istekler.slice(n0).map((x) => x.durum);
  check("§8a ⭐ ISTEK_ZAMAN + sunucuSaati → BİR KEZ düzeltilmiş damgayla yeniden imza; tur TAMAM", a.status === "TAMAM" && i0.join(",") === "401,200", `${a.status} · ${i0.join(",")}`);
  bulut.mod.bildirilenSaatFarkiMs = 2 * saat;
  const n1 = bulut.istekler.length;
  const b = await uzlastir();
  const i1 = bulut.istekler.slice(n1).map((x) => x.durum);
  check("§8b yanlış bildirilen saatte yalnız bir yeniden deneme (döngü yok), kod korunur", b.status === "HATA" && b.reason === "ISTEK_ZAMAN" && i1.join(",") === "401,401", `${b.status} ${b.reason} · ${i1.join(",")}`);
  bulut.mod.saatFarkiMs = 0;
  bulut.mod.bildirilenSaatFarkiMs = null;
}

async function saklamaBolumu(bulut: SahteBulut): Promise<void> {
  console.log("\n§5 — saklama ufku");
  // Fikstür İŞ ANAHTARIYLA: temiz bir CI DB'sinde de en az bir sipariş olsun.
  const musteri = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO "customers" ("id", "code", "name", "updatedAt") VALUES ($1::uuid, $2, $3, now())`, musteri, `${TAG}M`, `${TAG} müşteri`);
  await prisma.$executeRawUnsafe(`INSERT INTO "orders" ("id", "orderNumber", "customerId", "updatedAt") VALUES ($1::uuid, $2, $3::uuid, now())`, randomUUID(), `${TAG}S`, musteri);
  const siparisSayisi = await prisma.order.count();
  const ileri = new Date(Date.now() + 86_400_000).toISOString();
  bulut.mod.ufukTarihi = { siparis: ileri };
  bulut.mod.istenenTam.add("siparis");
  await artimli();
  bulut.mod.ufukTarihi = {};
  const z = await prisma.syncWatermark.findUnique({ where: { source: wmKey.chain("siparis") } });
  check("§5a ⭐ bulutun saklama ufku fabrikada saklandı", z?.retentionFrom?.toISOString() === ileri, `${z?.retentionFrom?.toISOString()}`);
  const n0 = bulut.paketler.length;
  await artimli();
  const tam = bulut.paketler.slice(n0).flatMap((p) => p.kayitlar).filter((k) => k.projeksiyon === "siparis" && k.tam);
  check("§5b ⭐ TAM gönderim ufuktan eski OLGU satırlarını GÖNDERMEZ (bulut süpürür)", tam.length > 0 && tam.every((k) => k.yaz.length === 0) && siparisSayisi > 0,
    `${siparisSayisi} sipariş DB'de · TAM'da ${tam.reduce((n, k) => n + k.yaz.length, 0)} satır`);
  const d = await membershipDigest(SIPARIS, { retentionFrom: new Date(ileri), createdBefore: null });
  check("§5c uzlaştırma kümesi de ufku uygular", d.count === 0, String(d.count));
  const cariBoyut = await membershipDigest(RENK, { retentionFrom: new Date(ileri), createdBefore: null });
  check("§5d BOYUT'a saklama uygulanmaz", cariBoyut.count > 0, String(cariBoyut.count));
}

async function main(): Promise<void> {
  console.log(`=== PATRON BULUTU UZLAŞTIRMA (${TAG}) ===`);
  let bulut: SahteBulut | null = null;
  let lisans: BulutLisans | null = null;
  try {
    await temizleEsitlemeDurumu();
    await bicimBolumu();
    await kapsamBolumu();
    lisans = await bulutLisansKur();
    bulut = await sahteBulutBaslat(lisans.x);
    await uzlastirmaBolumu(bulut);
    await onaySonrasiBolumu(bulut);
    await gelecekBolumu(bulut);
    await ebeveynBolumu();
    await saatBolumu(bulut);
    await saklamaBolumu(bulut);
  } catch (e) {
    check("beklenmeyen hata", false, e instanceof Error ? `${e.message}\n${e.stack}` : String(e));
  } finally {
    await bulut?.kapat();
    await temizleFikstur().catch(() => undefined);
    await temizleEsitlemeDurumu().catch(() => undefined);
    if (lisans) fs.rmSync(lisans.dizin, { recursive: true, force: true });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end().catch(() => undefined);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
