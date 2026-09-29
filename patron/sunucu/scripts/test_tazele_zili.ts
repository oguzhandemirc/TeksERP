// =============================================================================
// TAZELE ZİLİ BEKÇİSİ (sözleşme §6.5 · Senaryo P3) — ekran açıkken hesabın tazeleme isteği fabrikaya
// `ozet` zili olarak gider; içerik taşımaz, tesis başına 30 sn'de bir:
//   §1 oturumlu POST /api/tazele → zil { tesis, konu: ozet } · oturumsuz 401
//   §2 30 sn içinde ikinci istek zil ÇALMAZ, kalan süreyi döner · süre dolunca yeniden çalar
//   §3 bekleme tesis başınadır: A'nın beklemesi B'yi etkilemez
//   §4 doğrulama iletisi TR: zod'un varsayılan İngilizcesi hesap API'sinden sızmaz
// Koşum: npx tsx scripts/test_tazele_zili.ts
// =============================================================================
import { randomUUID } from "node:crypto";
import { SNAPSHOT_RING_GAP_MS } from "../src/services/doorbell";
import { api, hesapKur, kontrol, ortamKur, sonuc, temizleTesis, tesisKur } from "./lib/test-ortam";

const INGILIZCE = /\b(expected|Too small|Too big|Invalid|Unrecognized|Required)\b/;
const TR_HARF = /[çğıöşüÇĞİÖŞÜ]/;

async function main(): Promise<void> {
  const o = await ortamKur();
  const a = await tesisKur(o);
  const b = await tesisKur(o);
  try {
    const ha = await hesapKur(o, a.tesisId, ["bulut:ozet:oku", "bulut:siparis:oku", "bulut:cari:yaz"]);
    const hb = await hesapKur(o, b.tesisId, ["bulut:ozet:oku"]);

    console.log("\n§1 zil");
    const z0 = o.zil.caldi.length;
    const r1 = await api(o, "POST", "/api/tazele", { belirtec: ha.belirtec, govde: {} });
    const yeni = o.zil.caldi.slice(z0);
    kontrol("§1a oturumlu tazeleme → 200 {zil:true} ve TEK zil { A, ozet }", r1.status === 200 && (r1.json.data as { zil?: boolean }).zil === true && yeni.length === 1 && yeni[0]?.konu === "ozet" && yeni[0]?.tesisId === a.tesisId, JSON.stringify(yeni));
    const anon = await api(o, "POST", "/api/tazele", { govde: {} });
    kontrol("§1b oturumsuz → 401, zil yok", anon.status === 401 && o.zil.caldi.length === z0 + 1, `${anon.status}`);

    console.log("\n§2 tesis başına 30 sn");
    o.saat.ilerlet(5_000);
    const r2 = await api(o, "POST", "/api/tazele", { belirtec: ha.belirtec, govde: {} });
    const d2 = r2.json.data as { zil?: boolean; sonrakiMs?: number };
    kontrol("§2a 5 sn sonra ikinci istek zil ÇALMAZ, kalan ≈ 25 sn döner", r2.status === 200 && d2.zil === false && d2.sonrakiMs === SNAPSHOT_RING_GAP_MS - 5_000 && o.zil.caldi.length === z0 + 1, JSON.stringify(d2));
    o.saat.ilerlet(SNAPSHOT_RING_GAP_MS);
    const r3 = await api(o, "POST", "/api/tazele", { belirtec: ha.belirtec, govde: {} });
    kontrol("§2b süre dolunca yeniden çalar", (r3.json.data as { zil?: boolean }).zil === true && o.zil.caldi.length === z0 + 2);

    console.log("\n§3 tesis yalıtımı");
    const rb = await api(o, "POST", "/api/tazele", { belirtec: hb.belirtec, govde: {} });
    kontrol("§3a A'nın beklemesi B'yi etkilemez (B hemen çalar)", (rb.json.data as { zil?: boolean }).zil === true && o.zil.caldi.at(-1)?.tesisId === b.tesisId);

    console.log("\n§4 TR doğrulama iletisi");
    const bos = await api(o, "POST", "/api/gelen-kutusu", { belirtec: ha.belirtec, govde: { mesajId: randomUUID(), tur: "CARI", govde: { ad: "", roller: { musteri: true, tedarikci: false } } } });
    const fazla = await api(o, "POST", "/api/raporlar", { belirtec: ha.belirtec, govde: { clientToken: "x", raporAnahtari: "sales/order-intake", parametreler: {}, fazla: 1 } });
    for (const [ad, r] of [["gelen kutusu boş ad", bos], ["rapor isteği biçimsiz gövde", fazla]] as const) {
      const m = r.json.message ?? "";
      kontrol(`§4 ${ad} → 400, ileti TR (İngilizce zod iletisi yok)`, r.status === 400 && TR_HARF.test(m) && !INGILIZCE.test(m), `${r.status} ${m}`);
    }
  } finally {
    await temizleTesis(o, a.tesisId);
    await temizleTesis(o, b.tesisId);
    await o.kapat();
  }
  sonuc();
}

main().catch((err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  process.exit(1);
});
