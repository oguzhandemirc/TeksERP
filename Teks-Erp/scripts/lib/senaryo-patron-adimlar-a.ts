// SENARYO P — adımlar P1…P4 (eşitleme: ilk tam tur, doğal aralık, zil `ozet`, finans izni). `test_` öneki yok.
import { randomUUID } from "node:crypto";
import { bekleKosul, type AdimGrubu } from "./senaryo-patron-adim";
import { bulutIstek, davetiTamamla } from "./senaryo-patron-bulut";
import type { Duzenek } from "./senaryo-patron-duzenek";

/** Bulutta (göç rolü, kanıt okuması) bir projeksiyonun canlı satır sayısı. */
export async function bulutSayisi(d: Duzenek, projeksiyon: string, kayitId?: string): Promise<number> {
  const r = await d.bdb.query<{ n: string }>(
    `SELECT count(*) AS n FROM projection_rows WHERE tesis_id = $1 AND projection = $2 AND deleted_at IS NULL${kayitId ? " AND record_id = $3" : ""}`,
    kayitId ? [d.tesisId, projeksiyon, kayitId] : [d.tesisId, projeksiyon],
  );
  return Number(r.rows[0]?.n ?? 0);
}

export async function bulutVeri(d: Duzenek, projeksiyon: string, kayitId: string): Promise<Record<string, unknown> | null> {
  const r = await d.bdb.query<{ data: Record<string, unknown> }>(
    `SELECT data FROM projection_rows WHERE tesis_id = $1 AND projection = $2 AND record_id = $3 AND deleted_at IS NULL`,
    [d.tesisId, projeksiyon, kayitId],
  );
  return r.rows[0]?.data ?? null;
}

export async function fabrikaSayisi(d: Duzenek, tablo: string): Promise<number> {
  const r = await d.fdb.query<{ n: string }>(`SELECT count(*) AS n FROM "${tablo}"`);
  return Number(r.rows[0]?.n ?? 0);
}

/** Tavan/devam turları dahil: bulut kümesi fabrikaya eşitlenene dek tur (en çok `n`). */
export async function turlaEsitle(d: Duzenek, kosul: () => Promise<boolean>, n = 8): Promise<{ tur: number; ok: boolean; durum: string }> {
  let durum = "";
  for (let i = 1; i <= n; i++) {
    const st = await d.tur();
    durum = `${st.lastOutcome?.status ?? "-"}${st.lastOutcome?.reason ? `/${st.lastOutcome.reason}` : ""}${st.eligible ? "" : ` ön koşul yok: ${st.blockReason}`}`;
    if (await kosul()) return { tur: i, ok: true, durum };
  }
  return { tur: n, ok: false, durum };
}

/** Yazımdan sonra güvenli ufuk payı (birkaç sn) geçene dek tur + koşul; süre (ms) ya da null. */
export async function turlaBekle(d: Duzenek, kosul: () => Promise<boolean>, ms = 30_000): Promise<number | null> {
  const t0 = Date.now();
  for (;;) {
    await d.tur();
    if (await kosul()) return Date.now() - t0;
    if (Date.now() - t0 > ms) return null;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

export const adimlarA: AdimGrubu = async (d, adim) => {
  const Y = d.yonetici.belirtec;
  const B = d.patron.url;

  await adim("P1", "ilk tam eşitleme — boş bulut, fabrikanın bütün BOYUT/OLGU kökleri gider", async (a) => {
    const esit = async (): Promise<boolean> =>
      (await bulutSayisi(d, "cari-kart")) === (await fabrikaSayisi(d, "customers")) && (await bulutSayisi(d, "urun")) === (await fabrikaSayisi(d, "items"));
    const r = await turlaEsitle(d, esit);
    const st = await d.durum();
    a.kontrol("fabrika: ön koşul açık (URETIM · patron-bulut · abonelik · aralık)", st.eligible, `${st.eligible} ${st.blockReason ?? ""}`);
    a.kontrol("fabrika: tur TAMAM", st.lastOutcome?.status === "TAMAM", r.durum);
    a.kontrol(
      "bulut cari-kart / ürün sayısı = fabrika customers / items",
      r.ok,
      `${await bulutSayisi(d, "cari-kart")}/${await fabrikaSayisi(d, "customers")} · ${await bulutSayisi(d, "urun")}/${await fabrikaSayisi(d, "items")} (${r.tur} tur)`,
    );
    const tam = await d.bdb.query<{ n: string }>(`SELECT count(*) AS n FROM full_sync_runs WHERE tesis_id = $1`, [d.tesisId]);
    a.not(`bulut TAM koşumu kaydı: ${tam.rows[0]?.n ?? 0}`);
    const o = await bulutIstek(B, "GET", "/oturum", undefined, Y);
    const es = (o.veri.esitleme ?? null) as { sonEsitleme?: string; fabrikaSurumu?: string | null; sozlesmeUyarisi?: string | null } | null;
    a.kontrol("bulut /oturum: son eşitleme damgası var, sözleşme uyarısı yok", o.status === 200 && !!es?.sonEsitleme && !es.sozlesmeUyarisi, JSON.stringify(es));
    const liste = await bulutIstek(B, "GET", "/veri/cari-kart?limit=5", undefined, Y);
    const kayitlar = (liste.veri.kayitlar ?? liste.veri.items ?? []) as unknown[];
    a.kontrol("bulut API: /veri/cari-kart listesi dolu", liste.status === 200 && Array.isArray(kayitlar) && kayitlar.length > 0, `${liste.status} ${JSON.stringify(Object.keys(liste.veri))}`);
  });

  const cariAdi = `Senaryo P Cari ${randomUUID().slice(0, 8)}`;
  let cariId = "";
  await adim("P2", "değişiklik ≤ aralık içinde bulutta — tur ZORLANMADAN, zamanlayıcının kendisi", async (a) => {
    const y = await d.istemci.istek("POST", "/api/customers", { name: cariAdi, isCustomerRole: true, finance: { paymentTermDays: 30 } });
    cariId = String(y.veri.id ?? "");
    d.ortak.cariId = cariId;
    a.kontrol("fabrika: POST /api/customers → 201", y.status === 201 && !!cariId, `${y.status} ${y.kod ?? ""}`);
    const ms = await bekleKosul(async () => (await bulutSayisi(d, "cari-kart", cariId)) === 1, 170_000, 1000);
    a.kontrol("bulut: kayıt aralık (1 dk) + bir tık (60 sn) + ufuk payı içinde geldi (≤ 150 sn)", ms !== null && ms <= 150_000, `${ms === null ? "gelmedi" : `${Math.round(ms / 1000)} sn`}`);
    const fad = (await d.fdb.query<{ name: string }>(`SELECT name FROM customers WHERE id = $1`, [cariId])).rows[0]?.name ?? "?";
    const v = await bulutIstek(B, "GET", `/veri/cari-kart/${cariId}`, undefined, Y);
    a.kontrol("bulut API: kart okunuyor, ad fabrikadaki gibi", v.status === 200 && JSON.stringify(v.veri).includes(JSON.stringify(fad)), `${v.status} fabrika adı "${fad}"`);
  });

  await adim("P3", "zil `ozet` anında — hesap tazeler → iç API → satıcı SSE → fabrika anlık turu", async (a) => {
    const bagli = await bekleKosul(async () => (await d.istemci.detay()).yoklama.zil.bagli, 20_000);
    a.kontrol("fabrika: satıcı zil akışına bağlı", bagli !== null, `${bagli ?? "-"} ms`);
    const ozetOku = async (): Promise<string> =>
      JSON.stringify((await d.bdb.query(`SELECT data FROM projection_rows WHERE tesis_id = $1 AND projection = 'ozet.siparis' AND deleted_at IS NULL`, [d.tesisId])).rows);
    const once = await ozetOku();
    const urun = await d.fdb.query<{ id: string }>(`SELECT id FROM items WHERE "isActive" ORDER BY "createdAt" LIMIT 1`);
    const sip = await d.istemci.istek("POST", "/api/orders", { customerId: cariId, currency: "TRY", clientToken: randomUUID(), lines: [{ itemId: urun.rows[0]?.id, quantity: 42 }] });
    a.kontrol("fabrika: POST /api/orders → 201 (özetin değişeceği iş)", sip.status === 201, `${sip.status} ${sip.kod ?? ""}`);
    const zil0 = d.ic.ziller.length;
    const t = await bulutIstek(B, "POST", "/tazele", {}, Y);
    a.kontrol("bulut: POST /api/tazele → zil çaldı", t.status === 200 && t.veri.zil === true, JSON.stringify(t.veri));
    const ms = await bekleKosul(async () => (await ozetOku()) !== once, 20_000, 200);
    a.kontrol("bulut: ozet.siparis ≤ 10 sn'de tazelendi (aralık beklenmeden)", ms !== null && ms <= 10_000, `${ms ?? "gelmedi"} ms`);
    const z = d.ic.ziller.slice(zil0);
    a.kontrol("iç API: zil { tesis, konu: ozet } bu tesis için iletildi", z.some((x) => x.konu === "ozet" && x.tesisId === d.tesisId), JSON.stringify(z));
    const t2 = await bulutIstek(B, "POST", "/tazele", {}, Y);
    a.kontrol("bulut: 30 sn içinde ikinci tazeleme zil ÇALMAZ (yağmur koruması)", t2.status === 200 && t2.veri.zil === false && Number(t2.veri.sonrakiMs) > 0, JSON.stringify(t2.veri));
  });

  await adim("P4", "finans izni olmayan hesap finansı göremez — API 403 + RLS 0 satır", async (a) => {
    const eposta = `satis-${randomUUID().slice(0, 8)}@senaryo-p.test`;
    const h = await bulutIstek(B, "POST", "/hesaplar", { clientToken: randomUUID(), eposta, ad: "Senaryo P Satış", sablon: "SATIS" }, Y);
    a.kontrol("yönetici: SATIS şablonlu hesap açtı (davet)", h.status === 201 && typeof h.veri.davet === "string", `${h.status} ${h.kod ?? ""}`);
    const satis = await davetiTamamla(B, String(h.veri.davet), eposta);
    const finansCari = await bulutSayisi(d, "cari-hesap");
    a.not(`bulutta cari-hesap satırı (göç rolüyle): ${finansCari}`);
    for (const p of ["cari-hesap", "kasa", "fatura", "fiyat"]) {
      const r = await bulutIstek(B, "GET", `/veri/${p}`, undefined, satis.belirtec);
      a.kontrol(`API: satış hesabı /veri/${p} → 403`, r.status === 403, `${r.status} ${r.kod ?? ""}`);
    }
    const ok = await bulutIstek(B, "GET", "/veri/cari-hesap", undefined, Y);
    a.kontrol("API: yönetici (Patron) /veri/cari-hesap → 200", ok.status === 200, `${ok.status} ${ok.kod ?? ""}`);
    const o = await bulutIstek(B, "GET", "/oturum", undefined, satis.belirtec);
    const proj = (o.veri.projeksiyonlar ?? []) as string[];
    d.ortak.satisBelirtec = satis.belirtec;
    d.ortak.satisProj = proj.join(",");
    a.kontrol("oturum: satış hesabının projeksiyonlarında finans YOK", proj.length > 0 && !proj.some((p) => ["cari-hesap", "kasa", "fatura", "fiyat", "siparis.finans"].includes(p)), proj.join(","));
    const c = await d.adb.connect();
    try {
      await c.query("BEGIN");
      await c.query(`SELECT set_config('app.tesis_id', $1, true), set_config('app.projeksiyonlar', $2, true)`, [d.tesisId, proj.join(",")]);
      const r = await c.query<{ n: string }>(`SELECT count(*) AS n FROM projection_rows WHERE projection = 'cari-hesap'`);
      const kart = await c.query<{ n: string }>(`SELECT count(*) AS n FROM projection_rows WHERE projection = 'cari-kart'`);
      a.kontrol("RLS (uygulama rolü, satış izinleri): cari-hesap 0 satır, cari-kart görünür", Number(r.rows[0]?.n) === 0 && Number(kart.rows[0]?.n) > 0, `cari-hesap ${r.rows[0]?.n} (göç ${finansCari}) · cari-kart ${kart.rows[0]?.n}`);
      await c.query("ROLLBACK");
    } finally {
      c.release();
    }
    if (finansCari === 0) a.kismi("bulutta hiç cari-hesap satırı yok — RLS'in finans satırını gizlediği ölçülemedi");
  });
};
