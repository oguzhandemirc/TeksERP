// SENARYO P — adımlar P5…P8 (gelen kutusu sipariş/cari, hard delete uzlaştırması, TEST sınıfı). `test_` öneki yok.
import { randomUUID } from "node:crypto";
import { bekleKosul, type AdimGrubu } from "./senaryo-patron-adim";
import { bulutIstek, type BulutYanit } from "./senaryo-patron-bulut";
import { bulutSayisi } from "./senaryo-patron-adimlar-a";
import type { Duzenek } from "./senaryo-patron-duzenek";
import { ESITLE_YOLU, bosPaket, kanalPost, yeniKurulumAnahtari } from "./senaryo-patron-imza";

type Sonuc = { durum?: string; sonuc?: { varlikId?: string | null; belgeNo?: string | null; kod?: string | null; mesaj?: string | null } | null };
export const TR_HARF = /[çğıöşüÇĞİÖŞÜ]/;

/** Mesaj yazar → kapı zili fabrikayı dürter (IPC yok) → sonuç bulutta; süre ölçülür. */
export async function mesajYazVeBekle(d: Duzenek, tur: "SIPARIS" | "CARI", govde: unknown, ms = 20_000): Promise<{ yaz: BulutYanit; mesajId: string; sonuc: Sonuc; sure: number | null }> {
  const mesajId = randomUUID();
  const yaz = await bulutIstek(d.patron.url, "POST", "/gelen-kutusu", { mesajId, tur, govde }, d.yonetici.belirtec);
  let sonuc: Sonuc = {};
  const sure = await bekleKosul(async () => {
    const g = await bulutIstek(d.patron.url, "GET", `/gelen-kutusu/${mesajId}`, undefined, d.yonetici.belirtec);
    sonuc = g.veri as Sonuc;
    return sonuc.durum === "ISLENDI" || sonuc.durum === "REDDEDILDI";
  }, ms, 300);
  return { yaz, mesajId, sonuc, sure };
}

/** Bulut kaydını BEKLIYOR'a döndürür (göç rolü) — "sonuç bulutta kayboldu, üstlenme süresi doldu" canlandırması. */
export async function bulutKaydiniGeriAl(d: Duzenek, mesajId: string): Promise<number> {
  const r = await d.bdb.query(
    `UPDATE inbox_messages SET status = 'BEKLIYOR', result = NULL, processed_at = NULL, claim_until = NULL, owner_installation_id = NULL, updated_at = now()
      WHERE tesis_id = $1 AND message_id = $2`,
    [d.tesisId, mesajId],
  );
  return r.rowCount ?? 0;
}

/** P5 push kaydı: yöneticinin cihazı (Expo belirteci) + sessiz saati kapalı ayar — gece koşumunda ertelenmesin. */
async function pushHazirla(d: Duzenek): Promise<{ kayit: number; ayar: number; cihazId: string }> {
  const kayit = await bulutIstek(d.patron.url, "POST", "/cihazlar", { platform: "android", belirtec: `ExponentPushToken[senaryoP5${d.tesisId.slice(0, 8)}]`, ad: "Senaryo P cihazı" }, d.yonetici.belirtec);
  const gorunum = await bulutIstek(d.patron.url, "GET", "/bildirim/ayarlar", undefined, d.yonetici.belirtec);
  const etkin = gorunum.veri.etkin as Record<string, unknown> & { sessiz: Record<string, unknown> };
  const ayar = await bulutIstek(d.patron.url, "POST", "/bildirim/ayarlar", { ayarlar: { ...etkin, sessiz: { ...etkin.sessiz, acik: false } } }, d.yonetici.belirtec);
  return { kayit: kayit.status, ayar: ayar.status, cihazId: String(kayit.veri.id ?? "") };
}

export const adimlarB: AdimGrubu = async (d, adim) => {
  const urunId = (await d.fdb.query<{ id: string }>(`SELECT id FROM items WHERE "isActive" ORDER BY "createdAt" LIMIT 1`)).rows[0]?.id ?? "";
  d.ortak.urunId = urunId;

  await adim("P5", "gelen kutusu sipariş → fabrikada normal yoldan kayıt; tekrar aynı sonuç; ISLENDI + push kaydı", async (a) => {
    const cihaz = await pushHazirla(d);
    a.kontrol("bulut: yöneticinin cihazı kayıtlı (Expo belirteci, 201) + sessiz saat kapalı", cihaz.kayit === 201 && cihaz.ayar === 200, `cihaz ${cihaz.kayit} · ayar ${cihaz.ayar}`);
    const govde = { cariKartId: d.ortak.cariId, doviz: "TRY", termin: "2026-10-15", kalemler: [{ urunId, miktar: "125.5", birimFiyat: "10.50" }] };
    const m = await mesajYazVeBekle(d, "SIPARIS", govde);
    a.kontrol("bulut: sipariş mesajı yazıldı (201)", m.yaz.status === 201, `${m.yaz.status} ${m.yaz.kod ?? ""}`);
    a.kontrol("zil ile ≤ 15 sn'de ISLENDI + sipariş no (IPC yok)", m.sonuc.durum === "ISLENDI" && !!m.sonuc.sonuc?.belgeNo && m.sure !== null && m.sure <= 15_000, `${m.sure ?? "-"} ms ${JSON.stringify(m.sonuc)}`);
    const sip = await d.fdb.query<{ id: string; orderNumber: string; createdById: string | null; deadline: Date }>(`SELECT id, "orderNumber", "createdById", deadline FROM orders WHERE "clientToken" = $1`, [m.mesajId]);
    const o = sip.rows[0];
    d.ortak.p5SiparisId = o?.id ?? "";
    const mk = await d.fdb.query<{ entityId: string; cloudAccountName: string; outcome: string }>(`SELECT "entityId", "cloudAccountName", outcome FROM cloud_inbox_receipts WHERE "messageId" = $1`, [m.mesajId]);
    a.kontrol("fabrika: sipariş normal servis yolundan doğdu (clientToken = mesajId, sipariş no bulutla aynı)", sip.rowCount === 1 && o?.orderNumber === m.sonuc.sonuc?.belgeNo, JSON.stringify(o ?? null));
    a.kontrol("fabrika: makbuz aynı varlığa bağlı, yazan bulut hesabı adıyla", mk.rowCount === 1 && mk.rows[0]?.entityId === o?.id && mk.rows[0]?.outcome === "ISLENDI" && mk.rows[0]?.cloudAccountName === "Senaryo P Patron", JSON.stringify(mk.rows[0] ?? null));
    if (o && o.createdById === null) a.not("orders.createdById BOŞ — bilinen boşluk: sipariş doğuş yolu (panel dahil) bu kolonu yazmaz, aktör audit'te (arşiv B3 notu, yönetici kararına)");
    a.kontrol("fabrika: termin fabrika günü başı (2026-10-15 → 2026-10-14T21:00Z)", o?.deadline?.toISOString() === "2026-10-14T21:00:00.000Z", o?.deadline?.toISOString() ?? "-");
    const tekrar = await bulutIstek(d.patron.url, "POST", "/gelen-kutusu", { mesajId: m.mesajId, tur: "SIPARIS", govde }, d.yonetici.belirtec);
    const n = await d.bdb.query<{ n: string }>(`SELECT count(*) AS n FROM inbox_messages WHERE tesis_id = $1 AND message_id = $2`, [d.tesisId, m.mesajId]);
    a.kontrol("bulut: aynı mesaj yeniden yazılınca aynı kayıt (tek satır)", tekrar.status < 300 && Number(n.rows[0]?.n) === 1, `${tekrar.status} satır ${n.rows[0]?.n}`);
    a.kontrol("bulut: sonuç geri alındı (üstlenme süresi dolmuş gibi)", (await bulutKaydiniGeriAl(d, m.mesajId)) === 1);
    const run = await d.gelenKutusu();
    const out = (run.outcomes ?? []).find((x) => x.mesajId === m.mesajId) as { durum?: string; belgeNo?: string } | undefined;
    const say = await d.fdb.query<{ n: string }>(`SELECT count(*) AS n FROM orders WHERE "clientToken" = $1`, [m.mesajId]);
    a.kontrol("fabrika tekrarı: tokenReplay AYNI sipariş no, ikinci sipariş YOK", out?.durum === "ISLENDI" && out.belgeNo === m.sonuc.sonuc?.belgeNo && Number(say.rows[0]?.n) === 1, `${JSON.stringify(out ?? run.hata)} · ${say.rows[0]?.n}`);
    let bildirim: { status: string; deliveries: unknown } | undefined;
    const bSure = await bekleKosul(async () => {
      const r = await d.bdb.query<{ status: string; deliveries: unknown }>(
        `SELECT status::text AS status, deliveries FROM notifications WHERE tesis_id = $1 AND kind = 'gelen-kutusu-sonucu' AND dedup_key = $2`,
        [d.tesisId, `gelen-kutusu:${m.mesajId}:ISLENDI`],
      );
      bildirim = r.rows[0];
      return bildirim?.status === "GONDERILDI";
    }, 30_000, 500);
    const teslim = Array.isArray(bildirim?.deliveries) ? (bildirim.deliveries as { cihazId?: string; sonuc?: string }[]) : [];
    a.kontrol(
      "push kaydı: ISLENDI olayı yöneticinin bildirimi olarak doğdu ve kayıtlı cihaza GONDERILDI (sahte taşıyıcı, tek satır)",
      bSure !== null && teslim.some((t) => t.cihazId === cihaz.cihazId && t.sonuc === "OK"),
      `${bSure ?? "-"} ms ${JSON.stringify(bildirim ?? null)}`,
    );
  });

  await adim("P6", "geçersiz / aynı adlı cari ve geçersiz sipariş → REDDEDILDI, TR mesaj", async (a) => {
    const ad = (await d.fdb.query<{ name: string }>(`SELECT name FROM customers WHERE id = $1`, [d.ortak.cariId])).rows[0]?.name ?? "";
    const ayni = await mesajYazVeBekle(d, "CARI", { ad, roller: { musteri: true, tedarikci: false } });
    const s1 = ayni.sonuc.sonuc;
    a.kontrol("aynı adlı cari → REDDEDILDI + kod + TR mesaj", ayni.sonuc.durum === "REDDEDILDI" && !!s1?.kod && TR_HARF.test(s1.mesaj ?? ""), JSON.stringify(ayni.sonuc));
    const sayi = await d.fdb.query<{ n: string }>(`SELECT count(*) AS n FROM customers WHERE name = $1`, [ad]);
    a.kontrol("fabrika: ikinci kart DOĞMADI", Number(sayi.rows[0]?.n) === 1, `${sayi.rows[0]?.n}`);
    const gecersiz = await mesajYazVeBekle(d, "SIPARIS", { cariKartId: d.ortak.cariId, doviz: "TRY", kalemler: [{ urunId: randomUUID(), miktar: "10" }] });
    const s2 = gecersiz.sonuc.sonuc;
    a.kontrol("olmayan ürünlü sipariş → REDDEDILDI + kod + TR mesaj", gecersiz.sonuc.durum === "REDDEDILDI" && !!s2?.kod && TR_HARF.test(s2.mesaj ?? ""), JSON.stringify(gecersiz.sonuc));
    const bos = await bulutIstek(d.patron.url, "POST", "/gelen-kutusu", { mesajId: randomUUID(), tur: "CARI", govde: { ad: "", roller: { musteri: true, tedarikci: false } } }, d.yonetici.belirtec);
    a.kontrol("sözleşme dışı (boş ad) bulutta yazılırken 400, ileti baştan sona TR (zod İngilizcesi sızmaz)", bos.status === 400 && TR_HARF.test(bos.mesaj) && !/\b(expected|Too small|Invalid|Unrecognized)\b/.test(bos.mesaj), `${bos.status} ${bos.mesaj}`);
  });

  await adim("P7", "hard delete uzlaştırması — tetikten kaçan silme günlük id-kümesi özetiyle düşer", async (a) => {
    const sip = await d.istemci.istek("POST", "/api/orders", { customerId: d.ortak.cariId, currency: "TRY", clientToken: randomUUID(), lines: [{ itemId: urunId, quantity: 5 }, { itemId: urunId, quantity: 7 }] });
    const satirlar = await d.fdb.query<{ id: string }>(`SELECT id FROM order_lines WHERE "orderId" = $1 ORDER BY quantity`, [String(sip.veri.id ?? "")]);
    const silinecek = satirlar.rows[1]?.id ?? "";
    a.kontrol("fabrika: iki kalemli sipariş (201)", sip.status === 201 && satirlar.rowCount === 2, `${sip.status}`);
    await bekleKosul(async () => (await bulutSayisi(d, "siparis-kalemi", silinecek)) === 1 || ((await d.tur()) && false), 60_000, 500);
    a.kontrol("bulut: iki kalem de geldi", (await bulutSayisi(d, "siparis-kalemi", silinecek)) === 1);
    const c = await d.fdb.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL session_replication_role = replica");
      await c.query(`DELETE FROM order_lines WHERE id = $1`, [silinecek]);
      await c.query("COMMIT");
    } finally {
      c.release();
    }
    await d.tur();
    a.kontrol("normal tur: tetikten kaçan silme bulutta HÂLÂ görünür (filigran kör — uzlaştırmanın varlık nedeni)", (await bulutSayisi(d, "siparis-kalemi", silinecek)) === 1);
    await d.fdb.query(`DELETE FROM sync_watermarks WHERE source = 'uzlastirma'`);
    let st = await d.tur({ uzlastirma: true });
    const uzlastirmaDurumu = `${st.lastOutcome?.status}`;
    // Uyuşmazlık `istenen: TAM` döner; tam gönderim SONRAKİ turdadır (§4.4).
    for (let i = 0; i < 3 && (await bulutSayisi(d, "siparis-kalemi", silinecek)) === 1; i++) st = await d.tur();
    const kalan = await bulutSayisi(d, "siparis-kalemi", silinecek);
    const bulutToplam = await bulutSayisi(d, "siparis-kalemi");
    // Küme ebeveyniyle (S45): kalem ancak siparişi saklama içindeyse (13 ay) kümede — önceki koşumların P9'unun
    // 14 ay geri tarihli siparişinin kalemi fabrikada durur ama kümede değildir.
    const fabrikaToplam = Number(
      (await d.fdb.query<{ n: string }>(`SELECT count(*) AS n FROM order_lines l JOIN orders o ON o.id = l."orderId" WHERE o."orderDate" >= now() - interval '13 months'`)).rows[0]?.n,
    );
    const bulutIdleri = new Set((await d.bdb.query<{ id: string }>(`SELECT record_id::text AS id FROM projection_rows WHERE tesis_id = $1 AND projection = 'siparis-kalemi' AND deleted_at IS NULL`, [d.tesisId])).rows.map((r) => r.id));
    const eksik = (
      await d.fdb.query<{ id: string; no: string; durum: string; dogus: Date }>(
        `SELECT l.id, o."orderNumber" AS no, o.status::text AS durum, o."createdAt" AS dogus FROM order_lines l JOIN orders o ON o.id = l."orderId" WHERE o."orderDate" >= now() - interval '13 months'`,
      )
    ).rows.filter((r) => !bulutIdleri.has(r.id));
    a.kontrol(
      "uzlaştırma turu: satır bulutta düştü, küme fabrikanın saklama içi kümesine eşit (kalem ebeveyniyle, S45)",
      kalan === 0 && bulutToplam === fabrikaToplam,
      `uzlaştırma turu ${uzlastirmaDurumu} → kalan ${kalan} · bulut ${bulutToplam} / fabrika ${fabrikaToplam} · ${st.lastOutcome?.status} uzlaştırma ${st.lastReconcileYmd}${eksik.length ? ` · bulutta olmayan: ${eksik.map((e) => `${e.no}/${e.durum}/${e.dogus.toISOString()}`).join(", ")}` : ""}`,
    );
  });

  await adim("P8", "TEST sınıfı gönderemez — fabrika ön koşulu + bulut sınıf kapısı", async (a) => {
    const once = Number((await d.bdb.query<{ n: string }>(`SELECT count(*) AS n FROM package_receipts WHERE tesis_id = $1`, [d.tesisId])).rows[0]?.n);
    // HAK sürümü artar ve kira aynı sürümü taşır (kira ↔ HAK bağı).
    d.satici.hakEk = { sinif: "TEST", moduller: ["production.enabled", "finance.enabled", "patron-bulut"], surum: 2 };
    d.satici.kiraEk = { ...d.satici.kiraEk, hakSurum: 2 };
    const y = await d.istemci.yokla();
    const st = await d.tur();
    const sonra = Number((await d.bdb.query<{ n: string }>(`SELECT count(*) AS n FROM package_receipts WHERE tesis_id = $1`, [d.tesisId])).rows[0]?.n);
    a.kontrol("fabrika: TEST HAK'ı ile ön koşul KAPALI (SINIF_URETIM_DEGIL), buluta paket GİTMEDİ", !st.eligible && st.blockReason === "SINIF_URETIM_DEGIL" && sonra === once, `yokla ${y.outcome}${y.code ? `/${y.code}` : ""} · ${st.blockReason} · paket ${once}→${sonra}`);
    d.satici.hakEk = { sinif: "URETIM", moduller: ["production.enabled", "finance.enabled", "patron-bulut"], surum: 3 };
    d.satici.kiraEk = { ...d.satici.kiraEk, hakSurum: 3 };
    const y2 = await d.istemci.yokla();
    a.not(`URETIM'e dönüş yoklaması: ${y2.outcome}${y2.code ? `/${y2.code}` : ""}`);
    const geri = await d.tur();
    a.kontrol("fabrika: URETIM'e dönünce eşitleme sürer", geri.eligible && geri.lastOutcome?.status === "TAMAM", `${geri.blockReason ?? ""} ${geri.lastOutcome?.status}`);
    const k = yeniKurulumAnahtari();
    const testId = randomUUID();
    d.ic.kurulumlar.set(testId, { ...d.kurulum, kurulumId: testId, acikAnahtar: k.x, sinif: "TEST" });
    const r = await kanalPost(d, ESITLE_YOLU, bosPaket(testId), { kurulumId: testId, privateKey: k.privateKey });
    a.kontrol("bulut: TEST sınıfı kurulumun imzalı paketi REDDEDİLDİ (403)", r.status === 403, `${r.status} ${r.kod ?? ""}`);
  });
};
