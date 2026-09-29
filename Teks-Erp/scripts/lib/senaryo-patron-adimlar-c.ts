// SENARYO P — adımlar P9…P12 (saklama budaması, abonelik bitişi, cari makbuzu, teknik kullanıcı gizliliği). `test_` öneki yok.
import { randomUUID } from "node:crypto";
import { DAY_MS, msToIso } from "../../src/lib/license/protocol";
import { bekleKosul, type AdimGrubu } from "./senaryo-patron-adim";
import { bulutSayisi, turlaBekle } from "./senaryo-patron-adimlar-a";
import { bulutKaydiniGeriAl, mesajYazVeBekle } from "./senaryo-patron-adimlar-b";
import type { Duzenek } from "./senaryo-patron-duzenek";
import { ESITLE_YOLU, bosPaket, fabrikaAnahtari, kanalPost } from "./senaryo-patron-imza";

async function paketSayisi(d: Duzenek): Promise<number> {
  return Number((await d.bdb.query<{ n: string }>(`SELECT count(*) AS n FROM package_receipts WHERE tesis_id = $1`, [d.tesisId])).rows[0]?.n);
}

/** Bulutun kurulum önbelleği tazeliğini yitirmiş gibi (göç rolü): sonraki istek satıcı iç API'sine yeniden sorar. */
async function kurulumOnbelleginiEskit(d: Duzenek): Promise<void> {
  await d.bdb.query(`UPDATE installations SET refreshed_at = now() - interval '1 day' WHERE kurulum_id = $1`, [d.lisansId]);
}

export const adimlarC: AdimGrubu = async (d, adim) => {
  await adim("P9", "saklama budaması — saklama süresinden eski OLGU satırı (+ kalemleri) bulutta budanır", async (a) => {
    const sip = await d.istemci.istek("POST", "/api/orders", { customerId: d.ortak.cariId, currency: "TRY", clientToken: randomUUID(), lines: [{ itemId: d.ortak.urunId, quantity: 3 }] });
    const id = String(sip.veri.id ?? "");
    const kalem = (await d.fdb.query<{ id: string }>(`SELECT id FROM order_lines WHERE "orderId" = $1`, [id])).rows[0]?.id ?? "";
    // Kendi `_test` DB'mizde siparişi 14 ay geriye tarihliyoruz (saklama 13 ay) — geçen zamanın canlandırması.
    await d.fdb.query(`UPDATE orders SET "orderDate" = now() - interval '14 months', "updatedAt" = now() WHERE id = $1`, [id]);
    const eskiTarihli = async (): Promise<boolean> =>
      Number((await d.bdb.query<{ n: string }>(`SELECT count(*) AS n FROM projection_rows WHERE tesis_id = $1 AND projection = 'siparis' AND record_id = $2 AND retention_at < now() - interval '13 months'`, [d.tesisId, id])).rows[0]?.n) === 1 &&
      (await bulutSayisi(d, "siparis-kalemi", kalem)) === 1;
    a.not(`güvenli ufuk payı geçene dek tur: ${await turlaBekle(d, eskiTarihli)} ms`);
    const r = await d.bdb.query<{ retention_at: Date | null }>(`SELECT retention_at FROM projection_rows WHERE tesis_id = $1 AND projection = 'siparis' AND record_id = $2`, [d.tesisId, id]);
    const eski = r.rows[0]?.retention_at;
    a.kontrol("bulut: eski tarihli sipariş geldi, saklama damgası 13 aydan eski", !!eski && eski.getTime() < Date.now() - 395 * DAY_MS, eski?.toISOString() ?? "yok");
    a.kontrol("bulut: kalemi de geldi", (await bulutSayisi(d, "siparis-kalemi", kalem)) === 1);
    const saklamaIci = async (): Promise<number> =>
      Number((await d.bdb.query<{ n: string }>(`SELECT count(*) AS n FROM projection_rows WHERE tesis_id = $1 AND projection = 'siparis' AND deleted_at IS NULL AND (retention_at IS NULL OR retention_at >= now() - interval '13 months')`, [d.tesisId])).rows[0]?.n);
    const digerleri = await saklamaIci();
    await d.patronYenidenBaslat();
    const ms = await bekleKosul(async () => (await bulutSayisi(d, "siparis", id)) === 0, 20_000, 300);
    a.kontrol("bulut: günlük bakım (açılışta) siparişi budadı", ms !== null, `${ms ?? "-"} ms (saklama 13 ay)`);
    a.kontrol("bulut: budanan siparişin kalemi de düştü (kademeli)", (await bulutSayisi(d, "siparis-kalemi", kalem)) === 0);
    const kalanToplam = await bulutSayisi(d, "siparis");
    a.kontrol("bulut: saklama içindeki siparişler DURUYOR, 13 aydan eskisi kalmadı", kalanToplam === digerleri && (await saklamaIci()) === digerleri, `kalan ${kalanToplam} · saklama içi ${digerleri}`);
    const f = await d.fdb.query<{ n: string }>(`SELECT count(*) AS n FROM orders WHERE id = $1`, [id]);
    a.kontrol("fabrika: asıl kayıt yerinde (budama yalnız bulut kopyası)", Number(f.rows[0]?.n) === 1);
  });

  await adim("P10", "abonelik bitişinde eşitleme durur — fabrika göndermez, bulut ikinci kapıda reddeder", async (a) => {
    const once = await paketSayisi(d);
    const bitti = msToIso(Date.now() - 60_000);
    d.satici.kiraEk = { ...d.satici.kiraEk, patronBulutBitis: bitti };
    const y = await d.istemci.yokla();
    const st = await d.tur();
    a.kontrol("fabrika: ön koşul KAPALI (ABONELIK_YOK), paket gitmedi", !st.eligible && st.blockReason === "ABONELIK_YOK" && (await paketSayisi(d)) === once, `yokla ${y.outcome} · ${st.blockReason} · paket ${once}→${await paketSayisi(d)}`);
    const sip = await d.istemci.istek("POST", "/api/customers", { name: `Senaryo P Abonelik ${randomUUID().slice(0, 6)}`, isCustomerRole: true });
    a.kontrol("fabrika: iş sürüyor (abonelik yalnız buluta gönderimi durdurur)", sip.status === 201, `${sip.status}`);
    d.kurulum.patronBulutBitis = bitti;
    await kurulumOnbelleginiEskit(d);
    const r = await kanalPost(d, ESITLE_YOLU, bosPaket(d.lisansId), { kurulumId: d.lisansId, privateKey: fabrikaAnahtari(d) });
    a.kontrol("bulut: süresi dolmuş kurulumun imzalı paketi 403 PATRON_BULUT_KAPALI", r.status === 403 && r.kod === "PATRON_BULUT_KAPALI", `${r.status} ${r.kod ?? ""}`);
    const yeni = msToIso(Date.now() + 30 * DAY_MS);
    d.satici.kiraEk = { ...d.satici.kiraEk, patronBulutBitis: yeni };
    d.kurulum.patronBulutBitis = yeni;
    await kurulumOnbelleginiEskit(d);
    await d.istemci.yokla();
    const ms = await turlaBekle(d, async () => (await bulutSayisi(d, "cari-kart", String(sip.veri.id))) === 1);
    const geri = await d.durum();
    a.kontrol("yenilenince eşitleme sürer, arada doğan kart buluta gelir", geri.eligible && geri.lastOutcome?.status === "TAMAM" && ms !== null, `${geri.blockReason ?? ""} ${geri.lastOutcome?.status} ${ms ?? "gelmedi"} ms`);
  });

  await adim("P11", "cari mesajı tekrarı → makbuzdan aynı sonuç; kart + makbuz TEK tx", async (a) => {
    const ad = `Senaryo P Bulut Cari ${randomUUID().slice(0, 8)}`;
    const m = await mesajYazVeBekle(d, "CARI", { ad, roller: { musteri: true, tedarikci: false }, il: "Bursa" });
    const s = m.sonuc.sonuc;
    a.kontrol("bulut: cari ISLENDI + kart kodu", m.sonuc.durum === "ISLENDI" && !!s?.varlikId && !!s.belgeNo, JSON.stringify(m.sonuc.sonuc));
    a.kontrol("bulut: sonuç geri alındı (üstlenme süresi dolmuş gibi)", (await bulutKaydiniGeriAl(d, m.mesajId)) === 1);
    const run = await d.gelenKutusu();
    const out = (run.outcomes ?? []).find((x) => x.mesajId === m.mesajId) as { durum?: string; varlikId?: string; belgeNo?: string } | undefined;
    a.kontrol("fabrika tekrarı: makbuzdan AYNI kart kimliği + kod", out?.durum === "ISLENDI" && out.varlikId === s?.varlikId && out.belgeNo === s?.belgeNo, JSON.stringify(out ?? run.hata));
    const kart = await d.fdb.query<{ n: string }>(`SELECT count(*) AS n FROM customers WHERE id = $1 OR name ILIKE $2`, [s?.varlikId, ad]);
    const mk = await d.fdb.query<{ n: string }>(`SELECT count(*) AS n FROM cloud_inbox_receipts WHERE "messageId" = $1`, [m.mesajId]);
    a.kontrol("fabrika: tek kart, tek makbuz", Number(kart.rows[0]?.n) === 1 && Number(mk.rows[0]?.n) === 1, `kart ${kart.rows[0]?.n} · makbuz ${mk.rows[0]?.n}`);
    const tx = await d.fdb.query<{ k: string; m: string }>(
      `SELECT (SELECT xmin::text FROM customers WHERE id = $1) AS k, (SELECT xmin::text FROM cloud_inbox_receipts WHERE "messageId" = $2) AS m`,
      [s?.varlikId, m.mesajId],
    );
    const t = tx.rows[0];
    a.kontrol("kart ile makbuz AYNI işlemde yazıldı (satır xmin eşit)", !!t?.k && t.k === t.m, `kart xmin ${t?.k} · makbuz xmin ${t?.m}`);
  });

  await adim("P12", "teknik kullanıcı `login-methods` / `mobile-users` listelerinde görünmez", async (a) => {
    const pb = await d.istemci.istek("GET", "/api/patron-bulut");
    const t = (pb.veri.teknikKullanici ?? {}) as { id?: string; username?: string; fullName?: string };
    a.kontrol("fabrika: teknik kullanıcı etkin", pb.status === 200 && pb.veri.etkin === true && !!t.id, JSON.stringify(t));
    for (const yol of ["/api/auth/login-methods", "/api/auth/mobile-users"]) {
      const r = await d.istemci.anonim("GET", yol);
      const metin = JSON.stringify(r.json);
      const sizan = [t.id, t.username, t.fullName].filter((x): x is string => !!x && metin.includes(x));
      a.kontrol(`kimliksiz ${yol} → 200, teknik kullanıcı YOK`, r.status === 200 && sizan.length === 0, `${r.status}${sizan.length ? ` sızan: ${sizan.join(",")}` : ""} · admin listede: ${metin.includes("admin")}`);
    }
  });
};
