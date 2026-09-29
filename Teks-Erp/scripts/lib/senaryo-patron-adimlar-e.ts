// SENARYO P — adımlar P17…P20 (ESITLEME §13: ayrılma körlüğü, guard'lı kalıcı silme, birleştirme, sevkiyat
// sipariş kümesi). Toplar fikstürdür (KK1 akışı bu senaryonun konusu değil): kendi `_test` DB'mizde Prisma ile
// depo statüsünde doğar; çuval, çıkarma, sevkiyat ve birleştirme GERÇEK API'den. `test_` öneki yok.
import { randomUUID } from "node:crypto";
import type { AdimGrubu } from "./senaryo-patron-adim";
import { bulutSayisi, bulutVeri, turlaBekle } from "./senaryo-patron-adimlar-a";
import type { Duzenek } from "./senaryo-patron-duzenek";

async function renkId(d: Duzenek): Promise<string> {
  const r = await d.fdb.query<{ id: string }>(`SELECT id FROM colors WHERE "isActive" ORDER BY "createdAt" LIMIT 1`);
  if (r.rows[0]) return r.rows[0].id;
  const y = await d.istemci.istek("POST", "/api/colors", { name: `Senaryo P Rengi ${randomUUID().slice(0, 6)}` });
  return String(y.veri.id);
}

async function topYarat(d: Duzenek, sackId: string, miktar: number): Promise<string> {
  const { default: prisma } = await import("../../src/lib/prisma");
  const { Prisma, RollStatus } = await import("@prisma/client");
  const r = await prisma.roll.create({
    data: {
      barcode: `SENP-${randomUUID().slice(0, 10)}`,
      itemId: d.ortak.urunId,
      colorId: await renkId(d),
      initialQty: new Prisma.Decimal(miktar),
      currentQty: new Prisma.Decimal(miktar),
      width: new Prisma.Decimal(150),
      status: RollStatus.WAREHOUSE,
      warehouseId: (await d.fdb.query<{ id: string }>(`SELECT id FROM warehouses WHERE "isDefault" LIMIT 1`)).rows[0]?.id ?? null,
      sackId,
    },
    select: { id: true },
  });
  return r.id;
}

export const adimlarE: AdimGrubu = async (d, adim) => {
  await adim("P17", "ayrılma körlüğü — top çuvaldan çıkınca ESKİ çuvalın top sayısı/metresi bulutta düşer", async (a) => {
    const tok = randomUUID();
    const ac = await d.istemci.istek("POST", "/api/shipping/sacks", { clientToken: tok, customerId: d.ortak.cariId });
    const sack = (await d.fdb.query<{ id: string }>(`SELECT id FROM sacks WHERE "clientToken" = $1`, [tok])).rows[0]?.id ?? "";
    a.kontrol("fabrika: çuval açıldı (API)", ac.status < 300 && !!sack, `${ac.status} ${ac.kod ?? ""}`);
    d.ortak.sackId = sack;
    const r1 = await topYarat(d, sack, 51);
    const r2 = await topYarat(d, sack, 49);
    const cuval = async (): Promise<{ topSayisi?: unknown; metre?: unknown }> => ((await bulutVeri(d, "cuval", sack)) ?? {}) as { topSayisi?: unknown; metre?: unknown };
    const iki = await turlaBekle(d, async () => Number((await cuval()).topSayisi) === 2);
    a.kontrol("bulut: çuval 2 top / 100 m", iki !== null && Number((await cuval()).metre) === 100, JSON.stringify(await cuval()));
    const cik = await d.istemci.istek("POST", `/api/shipping/rolls/${r2}/remove-from-sack`, {});
    a.kontrol("fabrika: top çuvaldan çıkarıldı (API)", cik.status === 200, `${cik.status} ${cik.kod ?? ""}`);
    const isaret = await d.fdb.query<{ kind: string }>(`SELECT kind FROM sync_marks WHERE "tableName" = 'sacks' AND "rowId" = $1 ORDER BY "createdAt" DESC LIMIT 1`, [sack]);
    a.kontrol("fabrika: eski çuvala KIRLI işareti (DIRTY — rolls_sync_parent_moved)", isaret.rows[0]?.kind === "DIRTY", JSON.stringify(isaret.rows));
    const bir = await turlaBekle(d, async () => Number((await cuval()).topSayisi) === 1);
    a.kontrol("bulut: eski çuval 1 top / 51 m (çuval satırı değişmediği hâlde)", bir !== null && Number((await cuval()).metre) === 51, `${bir ?? "-"} ms ${JSON.stringify(await cuval())}`);
    d.ortak.topId = r1;
  });

  await adim("P18", "guard'lı kalıcı silme (cari · depo) → sync_marks SILINDI → bulutta satır düşer", async (a) => {
    // Finans açıkken her kart cari hesapla doğar ve hesap kartı korur (kalıcı silme 409, birleştirme BLOCK) —
    // kısa pencerede modül kapalıyken hesapsız iki kart: silinecek + P19'un kaynağı (bayrak tx içinde DB'den okunur).
    const bayrak = (v: boolean) => d.fdb.query(`UPDATE system_settings SET value = $1::jsonb, "updatedAt" = now() WHERE key = 'finance.enabled'`, [JSON.stringify(v)]);
    await bayrak(false);
    let c: Awaited<ReturnType<typeof d.istemci.istek>>;
    try {
      c = await d.istemci.istek("POST", "/api/customers", { name: `Senaryo P Silinecek ${randomUUID().slice(0, 6)}`, isCustomerRole: true });
      const k = await d.istemci.istek("POST", "/api/customers", { name: `Senaryo P Kaynak ${randomUUID().slice(0, 6)}`, isCustomerRole: true });
      d.ortak.kaynakCariId = String(k.veri.id ?? "");
    } finally {
      await bayrak(true);
    }
    const hesap = await d.fdb.query<{ n: string }>(`SELECT count(*) AS n FROM cari_accounts WHERE "customerId" = ANY($1::uuid[])`, [[String(c.veri.id ?? ""), d.ortak.kaynakCariId]]);
    a.kontrol("fabrika: iki kart HESAPSIZ doğdu (modül kapalı pencerede)", Number(hesap.rows[0]?.n) === 0, `hesap ${hesap.rows[0]?.n}`);
    const w = await d.istemci.istek("POST", "/api/warehouses", { code: `SP${randomUUID().slice(0, 6).toUpperCase()}`, name: `Senaryo P Depo ${randomUUID().slice(0, 6)}` });
    const hedefler: Array<[string, string, string]> = [
      ["cari-kart", "customers", String(c.veri.id ?? "")],
      ["depo", "warehouses", String(w.veri.id ?? "")],
    ];
    a.kontrol("fabrika: cari + depo yaratıldı", c.status === 201 && w.status === 201, `${c.status} ${w.status} ${w.kod ?? ""}`);
    await turlaBekle(d, async () => (await bulutSayisi(d, "cari-kart", hedefler[0][2])) === 1 && (await bulutSayisi(d, "depo", hedefler[1][2])) === 1);
    for (const [proj, tablo, id] of hedefler) {
      a.kontrol(`bulut: ${proj} geldi`, (await bulutSayisi(d, proj, id)) === 1);
      let sil = await d.istemci.istek("DELETE", `/api/${tablo}/${id}/permanent`);
      if (sil.status >= 400) {
        a.not(`${tablo} kalıcı silme önce pasif ister (${sil.status} ${sil.kod ?? ""}) — pasife alınıp tekrar`);
        await d.istemci.istek("DELETE", `/api/${tablo}/${id}`);
        sil = await d.istemci.istek("DELETE", `/api/${tablo}/${id}/permanent`);
      }
      const yok = Number((await d.fdb.query<{ n: string }>(`SELECT count(*) AS n FROM "${tablo}" WHERE id = $1`, [id])).rows[0]?.n) === 0;
      a.kontrol(`fabrika: ${tablo} kalıcı silindi`, sil.status === 200 && yok, `${sil.status} ${sil.kod ?? ""}`);
      const m = await d.fdb.query<{ kind: string }>(`SELECT kind FROM sync_marks WHERE "tableName" = $1 AND "rowId" = $2`, [tablo, id]);
      a.kontrol(`fabrika: ${tablo} SILINDI işareti`, m.rows.some((x) => x.kind === "DELETED"), JSON.stringify(m.rows));
      const ms = await turlaBekle(d, async () => (await bulutSayisi(d, proj, id)) === 0, 20_000);
      a.kontrol(`bulut: ${proj} satırı düştü (uzlaştırmasız)`, ms !== null, `${ms ?? "-"} ms`);
    }
  });

  await adim("P19", "birleştirme → taşınan sipariş bulutta survivor'a geçer; geri alma → eski hâline döner", async (a) => {
    const hayatta = await d.istemci.istek("POST", "/api/customers", { name: `Senaryo P Hayatta ${randomUUID().slice(0, 6)}`, isCustomerRole: true });
    const A = d.ortak.kaynakCariId ?? "";
    const B = String(hayatta.veri.id ?? "");
    const sip = await d.istemci.istek("POST", "/api/orders", { customerId: A, currency: "TRY", clientToken: randomUUID(), lines: [{ itemId: d.ortak.urunId, quantity: 9 }] });
    const O = String(sip.veri.id ?? "");
    a.kontrol("fabrika: iki kart + kaynağa sipariş", !!A && !!B && sip.status === 201, `${hayatta.status} ${sip.status}`);
    const cari = async (): Promise<unknown> => (await bulutVeri(d, "siparis", O))?.cariKartId;
    a.kontrol("bulut: sipariş kaynak kartta", (await turlaBekle(d, async () => (await cari()) === A)) !== null, String(await cari()));
    const on = await d.istemci.istek("POST", "/api/master-data/customer/merge/preview", { survivorId: B, sourceIds: [A] });
    const cakisma = Number(Object.entries(on.veri).find(([k, v]) => /conflict/i.test(k) && typeof v === "number")?.[1] ?? 0);
    const bir = await d.istemci.istek("POST", "/api/master-data/customer/merge", { survivorId: B, sourceIds: [A], reason: "Senaryo P birleştirme sınaması", acknowledgedConflicts: cakisma });
    a.kontrol("fabrika: birleştirme (önizleme → onay) 200", on.status === 200 && bir.status === 200, `${on.status} ${bir.status} ${bir.kod ?? ""}`);
    const t1 = await turlaBekle(d, async () => (await cari()) === B);
    a.kontrol("bulut: sipariş survivor karta geçti (ham UPDATE → MergeOperation → tam gönderim)", t1 !== null, `${t1 ?? "-"} ms ${String(await cari())}`);
    const mid = (await d.fdb.query<{ id: string }>(`SELECT id FROM merge_operations ORDER BY "createdAt" DESC LIMIT 1`)).rows[0]?.id ?? "";
    const geri = await d.istemci.istek("POST", `/api/master-data/merges/${mid}/revert`, { reason: "Senaryo P geri alma sınaması" });
    a.kontrol("fabrika: birleştirme geri alındı (200)", geri.status === 200, `${geri.status} ${geri.kod ?? ""}`);
    const t2 = await turlaBekle(d, async () => (await cari()) === A);
    a.kontrol("bulut: sipariş kaynak karta döndü", t2 !== null, `${t2 ?? "-"} ms ${String(await cari())}`);
  });

  await adim("P20", "sevkiyat sipariş kümesi yenilenir → bulutta `siparisIdleri` güncellenir", async (a) => {
    const siparisler = (await d.fdb.query<{ id: string }>(`SELECT id FROM orders WHERE "customerId" = $1 ORDER BY "createdAt" LIMIT 2`, [d.ortak.cariId])).rows.map((r) => r.id);
    const tok = randomUUID();
    const s = await d.istemci.istek("POST", "/api/shipping/shipments", { sackIds: [d.ortak.sackId], customerId: d.ortak.cariId, orderIds: [siparisler[0]], destination: "DOMESTIC", destinationChosen: true, clientToken: tok });
    const sid = (await d.fdb.query<{ id: string }>(`SELECT id FROM shipments WHERE "clientToken" = $1`, [tok])).rows[0]?.id ?? "";
    a.kontrol("fabrika: sevkiyat tek siparişle kuruldu", s.status < 300 && !!sid && siparisler.length === 2, `${s.status} ${s.kod ?? ""}`);
    const kume = async (): Promise<string> => JSON.stringify(([...(((await bulutVeri(d, "sevkiyat", sid))?.siparisIdleri as string[] | undefined) ?? [])]).sort());
    await turlaBekle(d, async () => (await kume()) === JSON.stringify([siparisler[0]]));
    a.kontrol("bulut: siparisIdleri = [1. sipariş]", (await kume()) === JSON.stringify([siparisler[0]]), await kume());
    const y = await d.istemci.istek("POST", `/api/shipping/shipments/${sid}/orders`, { orderIds: siparisler });
    a.kontrol("fabrika: küme iki siparişe yenilendi (200)", y.status === 200, `${y.status} ${y.kod ?? ""}`);
    const ms = await turlaBekle(d, async () => (await kume()) === JSON.stringify([...siparisler].sort()));
    a.kontrol("bulut: siparisIdleri iki siparişe güncellendi (sevkiyat satırı değişmeden)", ms !== null, `${ms ?? "-"} ms ${await kume()}`);
  });
};
