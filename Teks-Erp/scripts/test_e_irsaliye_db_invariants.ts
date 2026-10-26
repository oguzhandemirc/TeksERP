// =============================================================================
// Test: e-İrsaliye DB sedleri DAVRANIŞTA tutuyor mu (E1-SEMA, plan §3.1)
// Çalıştır: npx tsx scripts/run-all-tests.ts test_e_irsaliye_db_invariants
// `test_db_invariants` nesnelerin VARLIĞINI ölçer; bu bekçi REDDETTİKLERİNİ ölçer:
//   §1 CHECK çift yüklem — numarasız OLUSTURULDU · sentXmlId'siz GONDERILDI · sayaç < 0 RED
//   §2 partial unique — aynı kaynağa ikinci canlı kayıt RED; IPTAL'den sonra yenisi KABUL
//   §3 XML mührü — UPDATE ve doğrudan DELETE RED (pozitif kontrol: TASLAK'a sürüm yazılır)
//   §4 gönderilmiş/iptal kayda yeni XML sürümü RED
//   §5 olay defteri — UPDATE/DELETE RED; doğuş olayı ⇔ fromStatus NULL
//   §6 GİB numara biçimi — 4 karakter ön ek / küçük harf RED
//   §7 temizlik yolu — kaydın silinmesi XML + olayları KASKATLA götürür (mühür derinlik ≥ 2)
// TEMİZLİK: mühürlü tablolar doğrudan silinmez ve `session_replication_role` kullanılmaz;
// fikstür benzersiz önekli (cari + sevkiyat), kayıt silinince XML/olay FK kaskadıyla gider
// (§7 bunu ölçer), sonra sevkiyat (`Restrict` FK'sı artık serbest) ve cari silinir.
// Negatif sondalar (2026-10-24, test DB, geri alındı → migration SQL'i yeniden koşuldu, md5 aynı):
//   ① `e_irsaliyeler_numarali_durum_chk` DROP → §1a ❌ · ② `e_irsaliyeler_kaynak_canli_key` DROP → §2a ❌
// =============================================================================
import { randomUUID } from "node:crypto";
import prisma from "../src/lib/prisma";
import { factoryYmd } from "../src/constants/time";
import { cleanupTestCustomers } from "./fixture-customer-cleanup";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const TS = Date.now().toString(36).toUpperCase();
const P = `TST-EIRS-${TS}`;
// 9 haneli sıra tabanı — koşumlar arası çakışmasın diye zamandan.
const SEQ = Date.now() % 900_000_000;
// GİB numarasındaki yıl fabrika gününün yılıdır (plan §3.6).
const YIL = factoryYmd().slice(0, 4);
const no = (k: number) => `ZZ9${YIL}${String(SEQ + k).padStart(9, "0")}`;

let customerId: string | null = null;
let shipmentId: string | null = null;

/** Çağrı reddedilmeli; mesaj `desen`i içermeli (yanlış sebeple düşmek de kırmızı). */
async function red(fn: () => Promise<unknown>, desen: string): Promise<[boolean, string]> {
  try {
    await fn();
    return [false, "KABUL EDİLDİ"];
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return [m.includes(desen), m.split("\n").filter(Boolean).slice(-1)[0]?.slice(0, 160) ?? m];
  }
}

const kayit = (sourceId: string, ek: Record<string, unknown> = {}) =>
  prisma.eIrsaliye.create({
    data: { sourceType: "SHIPMENT", sourceId, shipmentId, adapter: "disaAktar", ...ek },
    select: { id: true },
  });

const xml = (eIrsaliyeId: string, version: number, ettn: string) =>
  prisma.eIrsaliyeXml.create({
    data: { eIrsaliyeId, version, ettn, xml: `<DespatchAdvice v="${version}"/>`, sha256: "0".repeat(64), validation: { ok: true } },
    select: { id: true },
  });

async function main() {
  customerId = (await prisma.customer.create({ data: { code: `${P}-C`, name: `${P} MUSTERI` }, select: { id: true } })).id;
  shipmentId = (await prisma.shipment.create({
    data: { shipmentNo: `${P}-S`, customerId, status: "DISPATCHED", dispatchedAt: new Date() },
    select: { id: true },
  })).id;
  const kaynak = shipmentId;

  // §1 — CHECK çift yüklemi
  const [r1a, m1a] = await red(() => kayit(randomUUID(), { status: "OLUSTURULDU" }), "e_irsaliyeler_numarali_durum_chk");
  check("§1a numarasız/ETTN'siz/XML'siz OLUSTURULDU reddedilir", r1a, m1a);
  const [r1c, m1c] = await red(() => kayit(randomUUID(), { downloadCount: -1 }), "e_irsaliyeler_download_count_chk");
  check("§1c indirme sayacı < 0 reddedilir", r1c, m1c);

  // §2 — kaynak başına TEK canlı kayıt
  const a = await kayit(kaynak);
  // Ham INSERT: Prisma P2002'si index ADINI taşımaz; PG mesajı sedin kendisini adlandırır.
  const [r2a, m2a] = await red(() => prisma.$executeRaw`
    INSERT INTO "e_irsaliyeler" ("id", "sourceType", "sourceId", "shipmentId", "adapter", "updatedAt")
    VALUES (${randomUUID()}::uuid, 'SHIPMENT', ${kaynak}::uuid, ${kaynak}::uuid, 'disaAktar', now())`, "e_irsaliyeler_kaynak_canli_key");
  check("§2a aynı kaynağa ikinci canlı kayıt reddedilir", r2a, m2a);
  await prisma.eIrsaliye.update({ where: { id: a.id }, data: { status: "IPTAL" } });
  const b = await kayit(kaynak).then((x) => x, () => null);
  check("§2b IPTAL'den sonra aynı kaynağa yeni kayıt kabul", !!b);
  if (!b) return;

  // §3 — XML mührü (pozitif kontrol önce: TASLAK'a sürüm yazılır, OLUSTURULDU'ya geçilir)
  const ettn = randomUUID();
  const x1 = await xml(b.id, 1, ettn);
  const gecti = await prisma.eIrsaliye.update({
    where: { id: b.id },
    data: { status: "OLUSTURULDU", documentNo: no(1), ettn, currentXmlId: x1.id },
  }).then(() => true, (e) => { console.log(String(e)); return false; });
  check("§3a pozitif: TASLAK'a XML v1 + numaralı OLUSTURULDU kabul", gecti);
  const [r3b, m3b] = await red(() => prisma.$executeRaw`UPDATE "e_irsaliye_xmllari" SET "xml" = '<x/>' WHERE "id" = ${x1.id}::uuid`, "değiştirilemez");
  check("§3b XML sürümü UPDATE reddedilir", r3b, m3b);
  const [r3c, m3c] = await red(() => prisma.$executeRaw`DELETE FROM "e_irsaliye_xmllari" WHERE "id" = ${x1.id}::uuid`, "silinemez");
  check("§3c XML sürümü doğrudan DELETE reddedilir", r3c, m3c);
  const x2 = await xml(b.id, 2, ettn).then((x) => x, () => null);
  check("§3d OLUSTURULDU iken yeniden üretim (v2) kabul", !!x2);

  // §1b — gönderilmiş durum, gönderilen sürüm olmadan yazılamaz
  const [r1b, m1b] = await red(() => prisma.eIrsaliye.update({ where: { id: b.id }, data: { status: "GONDERILDI" } }), "e_irsaliyeler_gonderilmis_durum_chk");
  check("§1b sentXmlId/sentAt'siz GONDERILDI reddedilir", r1b, m1b);

  // §4 — gönderilen sürüm mühürlü: yeni sürüm yazılamaz
  await prisma.eIrsaliye.update({ where: { id: b.id }, data: { status: "GONDERILDI", sentXmlId: x2?.id ?? x1.id, sentAt: new Date() } });
  const [r4a, m4a] = await red(() => xml(b.id, 3, ettn), "yeni XML sürümü yazılamaz");
  check("§4a GONDERILDI kayda yeni XML sürümü reddedilir", r4a, m4a);
  const [r4b, m4b] = await red(() => xml(a.id, 1, randomUUID()), "yeni XML sürümü yazılamaz");
  check("§4b IPTAL kayda XML sürümü reddedilir", r4b, m4b);

  // §5 — olay defteri
  const ev = await prisma.eIrsaliyeEvent.create({
    data: { eIrsaliyeId: b.id, type: "HAZIRLANDI", fromStatus: null, toStatus: "TASLAK" },
    select: { id: true },
  });
  const [r5a, m5a] = await red(() => prisma.$executeRaw`UPDATE "e_irsaliye_olaylari" SET "note" = 'x' WHERE "id" = ${ev.id}::uuid`, "değiştirilemez");
  check("§5a olay satırı UPDATE reddedilir", r5a, m5a);
  const [r5b, m5b] = await red(() => prisma.$executeRaw`DELETE FROM "e_irsaliye_olaylari" WHERE "id" = ${ev.id}::uuid`, "silinemez");
  check("§5b olay satırı doğrudan DELETE reddedilir", r5b, m5b);
  const [r5c, m5c] = await red(() => prisma.eIrsaliyeEvent.create({
    data: { eIrsaliyeId: b.id, type: "HAZIRLANDI", fromStatus: "TASLAK", toStatus: "TASLAK" },
  }), "e_irsaliye_olaylari_dogus_chk");
  check("§5c fromStatus'lu doğuş olayı reddedilir", r5c, m5c);
  const [r5d, m5d] = await red(() => prisma.eIrsaliyeEvent.create({
    data: { eIrsaliyeId: b.id, type: "GONDERILDI", fromStatus: null, toStatus: "GONDERILDI" },
  }), "e_irsaliye_olaylari_dogus_chk");
  check("§5d fromStatus'suz doğuş-dışı olay reddedilir", r5d, m5d);

  // §6 — GİB numara biçimi (16 karakter sığar; biçim CHECK'e takılır)
  const [r6a, m6a] = await red(() => prisma.eIrsaliye.update({ where: { id: a.id }, data: { documentNo: `ABCD${YIL}00000001` } }), "e_irsaliyeler_document_no_bicim_chk");
  check("§6a 4 karakter ön ekli numara reddedilir", r6a, m6a);
  const [r6b, m6b] = await red(() => prisma.eIrsaliye.update({ where: { id: a.id }, data: { documentNo: `abc${YIL}000000001` } }), "e_irsaliyeler_document_no_bicim_chk");
  check("§6b küçük harfli seri reddedilir", r6b, m6b);
  const ok6 = await prisma.eIrsaliye.update({ where: { id: a.id }, data: { documentNo: no(2) } }).then(() => true, () => false);
  check("§6c pozitif: GİB biçimli numara kabul", ok6, no(2));
}

async function temizlik(): Promise<void> {
  if (shipmentId) {
    // §7 — kaydın silinmesi mühürlü çocukları KASKATLA götürür (temizliğin kendisi ölçülür).
    const ids = (await prisma.eIrsaliye.findMany({ where: { shipmentId }, select: { id: true } })).map((r) => r.id);
    await prisma.eIrsaliye.deleteMany({ where: { id: { in: ids } } });
    const kalan = ids.length
      ? (await prisma.eIrsaliyeXml.count({ where: { eIrsaliyeId: { in: ids } } }))
        + (await prisma.eIrsaliyeEvent.count({ where: { eIrsaliyeId: { in: ids } } }))
      : 0;
    check("§7 kayıt silinince XML + olaylar kaskatla gitti (mühür doğrudan silmeyi keser, kaskadı değil)", ids.length > 0 && kalan === 0, `${ids.length} kayıt · kalan ${kalan}`);
    await prisma.shipment.deleteMany({ where: { id: shipmentId } });
  }
  await cleanupTestCustomers([customerId]);
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => {
    try { await temizlik(); } catch (e) { console.error("❌ temizlik düştü:", e); fail++; }
    console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
