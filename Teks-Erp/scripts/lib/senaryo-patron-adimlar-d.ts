// SENARYO P — adımlar P13…P16 (RLS fail-closed, sözleşme sürümü, finans silme damgası, rapor zili). `test_` öneki yok.
import { randomUUID } from "node:crypto";
import path from "node:path";
import { SYNC_CONTRACT_VERSION } from "../../src/cloud-sync/wire";
import { bekleKosul, type AdimGrubu } from "./senaryo-patron-adim";
import { bulutSayisi, turlaBekle } from "./senaryo-patron-adimlar-a";
import { PATRON_KOKU, bulutIstek } from "./senaryo-patron-bulut";
import { ESITLE_YOLU, bosPaket, fabrikaAnahtari, kanalPost } from "./senaryo-patron-imza";

/** Uygulama rolüyle tx; `ayar` verilirse ilk ifade set_config. Hata = sonuç (fail-closed da bir cevaptır). */
async function rlsSay(adb: import("pg").Pool, tablo: string, ayar: Record<string, string> | null): Promise<string> {
  const c = await adb.connect();
  try {
    await c.query("BEGIN");
    if (ayar) for (const [k, v] of Object.entries(ayar)) await c.query(`SELECT set_config($1, $2, true)`, [k, v]);
    const r = await c.query<{ n: string }>(`SELECT count(*) AS n FROM "${tablo}"`);
    return r.rows[0]?.n ?? "?";
  } catch (err) {
    return `HATA:${(err as { code?: string }).code ?? (err as Error).message}`;
  } finally {
    await c.query("ROLLBACK").catch(() => undefined);
    c.release();
  }
}

export const adimlarD: AdimGrubu = async (d, adim) => {
  await adim("P13", "RLS: `app.tesis_id` ayarlanmamış bağlantı → 0 satır (fail-closed)", async (a) => {
    for (const tablo of ["projection_rows", "inbox_messages", "report_requests", "package_receipts", "sync_state"]) {
      const goc = Number((await d.bdb.query<{ n: string }>(`SELECT count(*) AS n FROM "${tablo}" WHERE tesis_id = $1`, [d.tesisId])).rows[0]?.n);
      const ayarsiz = await rlsSay(d.adb, tablo, null);
      const bos = await rlsSay(d.adb, tablo, { "app.tesis_id": "", "app.projeksiyonlar": "" });
      const yabanci = await rlsSay(d.adb, tablo, { "app.tesis_id": randomUUID(), "app.projeksiyonlar": "siparis,cari-kart" });
      const sifir = (x: string): boolean => x === "0" || x.startsWith("HATA:");
      a.kontrol(`${tablo}: ayarsız / boş / başka tesis → 0 ya da hata (göç rolü bu tesiste ${goc} görür)`, sifir(ayarsiz) && sifir(bos) && sifir(yabanci), `ayarsız ${ayarsiz} · boş ${bos} · başka ${yabanci}`);
    }
    const kendi = await rlsSay(d.adb, "projection_rows", { "app.tesis_id": d.tesisId, "app.projeksiyonlar": "cari-kart" });
    a.kontrol("kendi tesisi + izinli projeksiyon → satır görünür (kontrol grubu)", Number(kendi) > 0, kendi);
  });

  await adim("P14", "sözleşme sürümü — N kabul · N−1 kabul + 'fabrika sürümü eski' · daha eskisi/yenisi 400", async (a) => {
    const g = { kurulumId: d.lisansId, privateKey: fabrikaAnahtari(d) };
    const n = await kanalPost(d, ESITLE_YOLU, bosPaket(d.lisansId, SYNC_CONTRACT_VERSION), g);
    a.kontrol(`N (v${SYNC_CONTRACT_VERSION}) → 200, uyarı yok`, n.status === 200 && !n.veri.sozlesmeUyarisi, `${n.status} ${n.kod ?? ""} ${JSON.stringify(n.veri.sozlesmeUyarisi ?? null)}`);
    const eski = await kanalPost(d, ESITLE_YOLU, bosPaket(d.lisansId, SYNC_CONTRACT_VERSION - 1), g);
    const yeni = await kanalPost(d, ESITLE_YOLU, bosPaket(d.lisansId, SYNC_CONTRACT_VERSION + 1), g);
    a.kontrol("v0 (desteklenen en eskiden eski) → 400 SOZLESME_ESKI", eski.status === 400 && eski.kod === "SOZLESME_ESKI", `${eski.status} ${eski.kod ?? ""}`);
    a.kontrol("N+1 → 400 SOZLESME_BILINMIYOR", yeni.status === 400 && yeni.kod === "SOZLESME_BILINMIYOR", `${yeni.status} ${yeni.kod ?? ""}`);
    const mod = (await import(path.join(PATRON_KOKU, "src/services/sync.service.ts"))) as { contractVerdict: (v: number, c?: number) => string };
    a.kontrol("bulut karar fonksiyonu: N=2'de v1 → ESKI_UYARI (N−1 kabul + uyarı)", mod.contractVerdict(1, 2) === "ESKI_UYARI" && mod.contractVerdict(0, 2) === "ESKI", `${mod.contractVerdict(1, 2)} / ${mod.contractVerdict(0, 2)}`);
    if (SYNC_CONTRACT_VERSION === 1) a.kismi("sözleşme v1: N−1 (v0) tanım gereği yok — N−1 kabul + 'fabrika sürümü eski' bandı uçtan uca v2 çıkınca ölçülür (karar fonksiyonu ölçüldü)");
  });

  await adim("P15", "finans hard delete → silme damgasıyla ANINDA (uzlaştırma beklenmeden)", async (a) => {
    const f = await d.istemci.istek("POST", "/api/item-prices", { itemId: d.ortak.urunId, customerId: d.ortak.cariId, kind: "SALE", currency: "TRY", price: 12.5 });
    const id = String(f.veri.id ?? "");
    a.kontrol("fabrika: fiyat yazıldı", f.status < 300 && !!id, `${f.status} ${f.kod ?? ""} ${JSON.stringify(f.veri).slice(0, 120)}`);
    const geldi = await turlaBekle(d, async () => (await bulutSayisi(d, "fiyat", id)) === 1);
    a.kontrol("bulut: fiyat satırı geldi", geldi !== null, `${geldi ?? "-"} ms`);
    const sil = await d.istemci.istek("DELETE", `/api/item-prices/${id}`);
    a.kontrol("fabrika: DELETE /api/item-prices/:id → 200", sil.status === 200, `${sil.status} ${sil.kod ?? ""}`);
    const mark = await d.fdb.query<{ kind: string }>(`SELECT kind FROM sync_marks WHERE "tableName" = 'item_prices' AND "rowId" = $1`, [id]);
    a.kontrol("fabrika: silme işareti AYNI anda yazıldı (sync_marks DELETED)", mark.rows.some((m) => m.kind === "DELETED"), JSON.stringify(mark.rows));
    const uzl0 = (await d.durum()).lastReconcileYmd;
    const gitti = await turlaBekle(d, async () => (await bulutSayisi(d, "fiyat", id)) === 0, 20_000);
    const uzl1 = (await d.durum()).lastReconcileYmd;
    a.kontrol("bulut: fiyat bir sonraki ARTIMLI turda düştü (uzlaştırmasız)", gitti !== null && uzl0 === uzl1, `${gitti ?? "-"} ms · uzlaştırma ${uzl0} → ${uzl1}`);
  });

  await adim("P16", "özel aralıklı rapor isteği → zil `rapor` → saniyeler içinde bulutta", async (a) => {
    const z0 = d.ic.ziller.length;
    const rq = await bulutIstek(d.patron.url, "POST", "/raporlar", { clientToken: randomUUID(), raporAnahtari: "sales/order-intake", parametreler: { dateFrom: "2026-01-03T00:00:00.000Z", dateTo: new Date().toISOString() } }, d.yonetici.belirtec);
    const id = String(rq.veri.id ?? "");
    a.kontrol("bulut: istek BEKLIYOR yazıldı", rq.status === 201 && rq.veri.durum === "BEKLIYOR", `${rq.status} ${rq.kod ?? ""} ${String(rq.veri.durum)}`);
    let durum: Record<string, unknown> = {};
    const ms = await bekleKosul(async () => {
      durum = (await bulutIstek(d.patron.url, "GET", `/raporlar/${id}`, undefined, d.yonetici.belirtec)).veri;
      return durum.durum === "HAZIR" || durum.durum === "HATA";
    }, 20_000, 300);
    a.kontrol("zil ile ≤ 10 sn'de HAZIR + sonuç (IPC yok)", durum.durum === "HAZIR" && durum.sonuc !== null && durum.sonuc !== undefined && ms !== null && ms <= 10_000, `${ms ?? "-"} ms ${String(durum.durum)}`);
    a.kontrol("iç API: zil { konu: rapor } bu tesis için iletildi", d.ic.ziller.slice(z0).some((z) => z.konu === "rapor" && z.tesisId === d.tesisId));
  });
};
