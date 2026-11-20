// =============================================================================
// ŞİMDİ EŞİTLE BEKÇİSİ (D8) — hesap erken eşitleme ister; bulut fabrikaya bağlanmaz, tesis başına TEK işaret açar:
//   §1 oturumlu POST /api/esitleme/simdi → BEKLIYOR + `rapor` zili · oturumsuz 401
//   §2 60 sn içinde ikinci istek YAKIN_ZAMANDA (işaret/zil yok) · süre dolunca yeniden kabul
//   §3 TAM: 15 dk içinde ikinci TAM YAKIN_ZAMANDA · bekleyen TAM, KISMI istekle küçülmez
//   §4 fabrika `rapor/al` yanıtında `esitlemeIstegi` BİR KEZ (atomik tüketim), ikinci claim'de yok
//   §5 tesis yalıtımı: A'nın işareti/beklemesi B'ye görünmez
// Koşum: npx tsx scripts/test_simdi_esitle.ts
// =============================================================================
import { SYNC_NOW_FULL_GAP_MS, SYNC_NOW_MIN_GAP_MS, type SyncNowResponse } from "../src/wire/api";
import { api, hesapKur, imzali, kontrol, ortamKur, sonuc, temizleTesis, tesisKur } from "./lib/test-ortam";

type Mark = { kapsam?: string; istendi?: string } | undefined;

async function main(): Promise<void> {
  const o = await ortamKur();
  const a = await tesisKur(o);
  const b = await tesisKur(o);
  try {
    const ha = await hesapKur(o, a.tesisId, ["bulut:ozet:oku"]);
    const hb = await hesapKur(o, b.tesisId, ["bulut:ozet:oku"]);
    const iste = async (belirtec: string, kapsam?: "KISMI" | "TAM") => {
      const r = await api(o, "POST", "/api/esitleme/simdi", { belirtec, govde: kapsam ? { kapsam } : {} });
      return { status: r.status, d: r.json.data as SyncNowResponse };
    };
    const claim = async (k: typeof a) => ((await imzali(o, k, "/v1/rapor/al", { govde: { v: 1 } })).json as { esitlemeIstegi?: Mark }).esitlemeIstegi;

    console.log("\n§1 işaret + zil");
    const z0 = o.zil.caldi.length;
    const r1 = await iste(ha.belirtec);
    const yeni = o.zil.caldi.slice(z0);
    kontrol("§1a ilk istek → BEKLIYOR/KISMI ve TEK zil { A, rapor }", r1.status === 200 && r1.d.durum === "BEKLIYOR" && r1.d.kapsam === "KISMI" && yeni.length === 1 && yeni[0]?.konu === "rapor" && yeni[0]?.tesisId === a.tesisId, JSON.stringify({ r1, yeni }));
    const anon = await api(o, "POST", "/api/esitleme/simdi", { govde: {} });
    kontrol("§1b oturumsuz → 401, zil yok", anon.status === 401 && o.zil.caldi.length === z0 + 1, `${anon.status}`);

    console.log("\n§2 60 sn aralığı");
    o.saat.ilerlet(10_000);
    const r2 = await iste(ha.belirtec);
    kontrol("§2a 10 sn sonra → YAKIN_ZAMANDA, zil yok, sonrakiMumkun ≈ 50 sn sonra", r2.d.durum === "YAKIN_ZAMANDA" && o.zil.caldi.length === z0 + 1 && Date.parse(r2.d.sonrakiMumkun) - o.saat.simdi() === SYNC_NOW_MIN_GAP_MS - 10_000, JSON.stringify(r2.d));

    console.log("\n§4 fabrika claim'i (tek tüketim)");
    const m1 = await claim(a);
    const m2 = await claim(a);
    kontrol("§4a ilk rapor/al → esitlemeIstegi { KISMI }, ikinci rapor/al → yok", m1?.kapsam === "KISMI" && typeof m1.istendi === "string" && m2 === undefined, JSON.stringify({ m1, m2 }));
    const mb = await claim(b);
    kontrol("§5a B'nin claim'inde A'nın işareti yok", mb === undefined, JSON.stringify(mb));

    console.log("\n§3 TAM 15 dk + küçülmeme");
    o.saat.ilerlet(SYNC_NOW_MIN_GAP_MS);
    const t1 = await iste(ha.belirtec, "TAM");
    kontrol("§3a süre dolunca TAM → BEKLIYOR/TAM, zil", t1.d.durum === "BEKLIYOR" && t1.d.kapsam === "TAM" && o.zil.caldi.length === z0 + 2, JSON.stringify(t1.d));
    o.saat.ilerlet(SYNC_NOW_MIN_GAP_MS);
    const k1 = await iste(ha.belirtec, "KISMI");
    kontrol("§3b bekleyen TAM üstüne KISMI kabul edilir ama işaret TAM kalır", k1.d.durum === "BEKLIYOR" && k1.d.kapsam === "TAM", JSON.stringify(k1.d));
    o.saat.ilerlet(SYNC_NOW_MIN_GAP_MS);
    const t2 = await iste(ha.belirtec, "TAM");
    kontrol("§3c 15 dk dolmadan ikinci TAM → YAKIN_ZAMANDA", t2.d.durum === "YAKIN_ZAMANDA", JSON.stringify(t2.d));
    const m3 = await claim(a);
    kontrol("§3d claim işareti TAM olarak tüketir", m3?.kapsam === "TAM", JSON.stringify(m3));
    o.saat.ilerlet(SYNC_NOW_FULL_GAP_MS);
    const t3 = await iste(ha.belirtec, "TAM");
    kontrol("§3e 15 dk dolunca TAM yeniden kabul", t3.d.durum === "BEKLIYOR" && t3.d.kapsam === "TAM", JSON.stringify(t3.d));

    console.log("\n§5 tesis yalıtımı");
    const rb = await iste(hb.belirtec);
    kontrol("§5b A'nın beklemesi B'yi etkilemez (B hemen BEKLIYOR, zil B'ye)", rb.d.durum === "BEKLIYOR" && o.zil.caldi.at(-1)?.tesisId === b.tesisId, JSON.stringify(rb.d));
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
