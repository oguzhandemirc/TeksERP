// =============================================================================
// SAKLAMA İŞİ BEKÇİSİ (sözleşme §9.5) — tesis başına 3 · 13 · 25 ay · tümü, saat ENJEKTE:
//   §1 OLGU: saklama tarihi süreyi aşan satır düşer; alt satırı (`.finans`) ve kalemi (+ kalemin alt
//      satırı) KÖKLE BİRLİKTE düşer; süre içindeki satır ve BOYUT (tarihsiz) KALIR
//   §2 "tümü" (NULL) tesisinde hiçbir OLGU budanmaz; başka tesisin ayarı bu tesisi ETKİLEMEZ
//   §3 mezar taşı 7 günden sonra düşer, 7 günden gençse kalır
//   §4 telemetri: süresi geçmiş nonce · eski paket makbuzu · kapanmış eski oturum · eski işlem makbuzu ·
//      başarısız giriş denetimi 90 gün / diğer denetim 730 gün · sonuçlanmış eski gelen kutusu
//   §5 yanıt: saklama ufku (`ufukTarihi`) tesisin ayarından; "tümü"nde boş
// Koşum: npx tsx scripts/test_saklama.ts
// =============================================================================
import { randomUUID } from "node:crypto";
import { withTesis } from "../src/lib/tenant";
import { runDaily } from "../src/services/maintenance";
import { girdi, imzali, kontrol, ortamKur, paket, sonuc, temizleTesis, tesisKur, type Ortam, type TestKurulumu } from "./lib/test-ortam";

const GUN = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

async function satirVar(o: Ortam, tesisId: string, projection: string, id: string): Promise<boolean> {
  const r = await withTesis(o.goc, { tesisId, projections: [projection] }, (tx) =>
    tx.projectionRow.findUnique({ where: { tesisId_projection_recordId: { tesisId, projection, recordId: id } } }),
  );
  return r !== null;
}

async function fikstur(o: Ortam, k: TestKurulumu) {
  const simdi = o.saat.simdi();
  const eskiTarih = simdi - 200 * GUN;
  const yeniTarih = simdi - 20 * GUN;
  const ids = { eskiSiparis: randomUUID(), yeniSiparis: randomUUID(), eskiKalem: randomUUID(), urun: randomUUID(), eskiFatura: randomUUID(), eskiFaturaKalem: randomUUID() };
  const ufuk = simdi - 60_000;
  const w = { t: iso(ufuk), k: "000000000001" };
  const kayitlar = [
    girdi("siparis", { yaz: [{ id: ids.eskiSiparis, siparisTarihi: iso(eskiTarih) }, { id: ids.yeniSiparis, siparisTarihi: iso(yeniTarih) }], yeni: w }),
    girdi("siparis.finans", { yaz: [{ id: ids.eskiSiparis, tutar: "1.00" }, { id: ids.yeniSiparis, tutar: "2.00" }], yeni: w }),
    girdi("siparis-kalemi", { yaz: [{ id: ids.eskiKalem, siparisId: ids.eskiSiparis, olusturulma: iso(yeniTarih) }], yeni: w }),
    girdi("siparis-kalemi.finans", { yaz: [{ id: ids.eskiKalem, birimFiyat: "3.00" }], yeni: w }),
    girdi("fatura", { yaz: [{ id: ids.eskiFatura, tarih: iso(eskiTarih) }], yeni: w }),
    girdi("fatura-kalemi", { yaz: [{ id: ids.eskiFaturaKalem, faturaId: ids.eskiFatura }], yeni: w }),
    girdi("urun", { yaz: [{ id: ids.urun, ad: "Eski ürün" }], yeni: w }),
  ];
  const r = await imzali(o, k, "/v1/esitle", { govde: paket(k, { ufuk: new Date(ufuk), kayitlar }) });
  if (r.status !== 200 || (r.json as unknown as { ret: unknown[] }).ret.length > 0) throw new Error(`fikstür: ${JSON.stringify(r.json)}`);
  return { ids, r: r.json as unknown as { ufukTarihi: Record<string, string> } };
}

async function main(): Promise<void> {
  const o = await ortamKur();
  const uc = await tesisKur(o, { saklamaAy: 3 });
  const tumu = await tesisKur(o, { saklamaAy: null });
  try {
    const a = await fikstur(o, uc);
    const b = await fikstur(o, tumu);

    console.log("\n§5 saklama ufku yanıtta");
    kontrol("§5a 3 aylık tesis: siparis ufku ≈ 3 ay önce", Math.abs(Date.parse(a.r.ufukTarihi.siparis ?? "") - (o.saat.simdi() - 92 * GUN)) < 3 * GUN, a.r.ufukTarihi.siparis);
    kontrol("§5b 'tümü' tesisi: ufuk YOK", Object.keys(b.r.ufukTarihi).length === 0);

    // telemetri fikstürü (3 aylık tesis)
    const eski = new Date(o.saat.simdi() - 800 * GUN);
    await withTesis(o.goc, { tesisId: uc.tesisId }, async (tx) => {
      await tx.requestNonce.create({ data: { tesisId: uc.tesisId, installationId: uc.kurulumId, nonce: "bekci-eski-nonce-000000", expiresAt: new Date(o.saat.simdi() - GUN) } });
      await tx.packageReceipt.create({ data: { tesisId: uc.tesisId, packageId: randomUUID(), installationId: uc.kurulumId, bodyDigest: "x".repeat(64), response: {}, createdAt: eski } });
      await tx.accountAudit.create({ data: { tesisId: uc.tesisId, actor: "giris", event: "GIRIS_BASARISIZ", entity: "Account", createdAt: new Date(o.saat.simdi() - 100 * GUN) } });
      await tx.accountAudit.create({ data: { tesisId: uc.tesisId, actor: "hesap:x", event: "HESAP_DAVET", entity: "Account", createdAt: new Date(o.saat.simdi() - 100 * GUN) } });
      await tx.accountAudit.create({ data: { tesisId: uc.tesisId, actor: "hesap:x", event: "HESAP_DAVET", entity: "Account", createdAt: eski } });
      await tx.inboxMessage.create({
        data: { tesisId: uc.tesisId, messageId: randomUUID(), kind: "CARI", body: {}, accountId: randomUUID(), accountName: "Eski", status: "ISLENDI", result: {}, processedAt: eski, createdAt: eski },
      });
      await tx.inboxMessage.create({ data: { tesisId: uc.tesisId, messageId: randomUUID(), kind: "CARI", body: {}, accountId: randomUUID(), accountName: "Bekleyen", createdAt: eski } });
    });
    const tombstoneId = randomUUID();
    const tazeTombstone = randomUUID();
    await withTesis(o.goc, { tesisId: uc.tesisId }, async (tx) => {
      await tx.$executeRaw`INSERT INTO projection_rows (tesis_id, projection, record_id, data, version_at, deleted_at, sort_at)
        VALUES (${uc.tesisId}::uuid, 'renk', ${tombstoneId}::uuid, '{}', now(), ${new Date(o.saat.simdi() - 8 * GUN)}, now()),
               (${uc.tesisId}::uuid, 'renk', ${tazeTombstone}::uuid, '{}', now(), ${new Date(o.saat.simdi() - 2 * GUN)}, now())`;
    });

    const n = await runDaily(o.ctx, o.saat.simdi());
    console.log(`\n(budanan satır: ${n})`);

    console.log("\n§1 OLGU saklaması (3 ay)");
    const x = a.ids;
    kontrol("§1a süreyi aşan sipariş düştü", !(await satirVar(o, uc.tesisId, "siparis", x.eskiSiparis)));
    kontrol("§1b alt satırı (siparis.finans) KÖKLE düştü", !(await satirVar(o, uc.tesisId, "siparis.finans", x.eskiSiparis)));
    kontrol("§1c kalemi (kendi tarihi taze olsa da) KÖKLE düştü", !(await satirVar(o, uc.tesisId, "siparis-kalemi", x.eskiKalem)));
    kontrol("§1d kalemin alt satırı da düştü", !(await satirVar(o, uc.tesisId, "siparis-kalemi.finans", x.eskiKalem)));
    kontrol("§1e tarihsiz fatura kalemi faturayla düştü", !(await satirVar(o, uc.tesisId, "fatura-kalemi", x.eskiFaturaKalem)));
    kontrol("§1f süre içindeki sipariş + alt satırı KALDI", (await satirVar(o, uc.tesisId, "siparis", x.yeniSiparis)) && (await satirVar(o, uc.tesisId, "siparis.finans", x.yeniSiparis)));
    kontrol("§1g BOYUT (ürün) budanmaz", await satirVar(o, uc.tesisId, "urun", x.urun));

    console.log("\n§2 'tümü' tesisi");
    kontrol("§2a 'tümü'nde eski sipariş KALDI (başka tesisin 3 ayı etkilemez)", await satirVar(o, tumu.tesisId, "siparis", b.ids.eskiSiparis));
    kontrol("§2b 'tümü'nde kalem KALDI", await satirVar(o, tumu.tesisId, "siparis-kalemi", b.ids.eskiKalem));

    console.log("\n§3 mezar taşı");
    kontrol("§3a 8 günlük mezar taşı düştü", !(await satirVar(o, uc.tesisId, "renk", tombstoneId)));
    kontrol("§3b 2 günlük mezar taşı KALDI (geç gelen eski paket diriltemesin)", await satirVar(o, uc.tesisId, "renk", tazeTombstone));

    console.log("\n§4 telemetri + ayak izi");
    const sayim = await withTesis(o.goc, { tesisId: uc.tesisId }, async (tx) => ({
      nonce: await tx.requestNonce.count({ where: { tesisId: uc.tesisId, nonce: "bekci-eski-nonce-000000" } }),
      makbuz: await tx.packageReceipt.count({ where: { tesisId: uc.tesisId, createdAt: eski } }),
      basarisiz: await tx.accountAudit.count({ where: { tesisId: uc.tesisId, event: "GIRIS_BASARISIZ" } }),
      davet100: await tx.accountAudit.count({ where: { tesisId: uc.tesisId, event: "HESAP_DAVET", createdAt: { gt: eski } } }),
      davet800: await tx.accountAudit.count({ where: { tesisId: uc.tesisId, event: "HESAP_DAVET", createdAt: eski } }),
      islenmis: await tx.inboxMessage.count({ where: { tesisId: uc.tesisId, accountName: "Eski" } }),
      bekleyen: await tx.inboxMessage.count({ where: { tesisId: uc.tesisId, accountName: "Bekleyen" } }),
    }));
    kontrol("§4a süresi geçmiş nonce düştü", sayim.nonce === 0);
    kontrol("§4b eski paket makbuzu düştü", sayim.makbuz === 0);
    kontrol("§4c 100 günlük başarısız giriş denetimi düştü (90 gün)", sayim.basarisiz === 0);
    kontrol("§4d 100 günlük diğer denetim KALDI (730 gün)", sayim.davet100 >= 1);
    kontrol("§4e 800 günlük diğer denetim düştü", sayim.davet800 === 0);
    kontrol("§4f sonuçlanmış eski gelen kutusu kaydı düştü", sayim.islenmis === 0);
    kontrol("§4g BEKLEYEN eski mesaj budanmaz (fabrika henüz almadı)", sayim.bekleyen === 1);
  } finally {
    await temizleTesis(o, uc.tesisId);
    await temizleTesis(o, tumu.tesisId);
    await o.kapat();
  }
  sonuc();
}

main().catch((err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  process.exit(1);
});
