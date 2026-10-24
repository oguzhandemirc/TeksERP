// =============================================================================
// ÖLÇÜM — patron bulutu uçtan uca gecikme (W1, 2026-10-24). Bekçi DEĞİL, CI'a bağlı DEĞİL.
// =============================================================================
// Soru: fabrikada sipariş yazıldıktan kaç ms sonra hesabın `GET /api/degisim` uzun yoklaması `siparis` ile döner?
// Düzenek Senaryo P'ninkidir (gerçek fabrika backend'i + gerçek patron bulutu + sahte satıcı); yalnız `_test` DB'leri.
//   cd Teks-Erp && DATABASE_URL='…/<fabrika>_test' node ../scripts/agir-is.mjs -- \
//     npx tsx scripts/olcum-patron-uctan-uca.ts [--tekrar=5] [--json=<dosya>]
// Kira aralığı 5 dk'ya çekilir (üretim varsayılanı; emniyet turu ölçümü kirletmesin). Her tekrarın tetikleyicisi
// (`lastTrigger`) kayda geçer. Bayrak KAPALI kanıtı: tek 25 sn yoklama boş döner, sipariş bulutta yoktur.
// Çıkış: 0 ölçüm tamam · 1 beklenen sinyal gelmedi · 2 düzenek kurulamadı.
// =============================================================================
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { duzenekKur, type Duzenek } from "./lib/senaryo-patron-duzenek";
import { bulutIstek } from "./lib/senaryo-patron-bulut";
import { bulutSayisi, fabrikaSayisi, turlaEsitle } from "./lib/senaryo-patron-adimlar-a";

const arg = (ad: string): string | null => process.argv.find((a) => a.startsWith(`--${ad}=`))?.slice(ad.length + 3) ?? null;
const TEKRAR = Number(arg("tekrar") ?? 5);
const BAYRAK = "patronBulut.olayGudumluEnabled";
/** `TurDurumu` tipi tetiği taşımaz; IPC yükünde `getCloudSyncStatus().lastTrigger` vardır. */
const tetikOf = (s: unknown): string | null => (s as { lastTrigger?: string | null }).lastTrigger ?? null;
const uyu = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Olcum {
  tekrar: number;
  yazimMs: number;
  gecikmeMs: number | null;
  tetik: string | null;
  bulutta: boolean;
  yoklamaSayisi: number;
}

async function bayrak(d: Duzenek, acik: boolean): Promise<void> {
  await d.fdb.query(
    `INSERT INTO system_settings (key, value, "updatedAt") VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = now()`,
    [BAYRAK, JSON.stringify(acik)],
  );
}

async function sayac(d: Duzenek): Promise<number> {
  const r = await bulutIstek(d.patron.url, "GET", "/degisim?since=0&bekle=0", undefined, d.yonetici.belirtec);
  if (r.status !== 200) throw new Error(`degisim ${r.status} ${r.kod ?? ""}`);
  return Number(r.veri.sayac);
}

/** `siparis` adı gelene dek uzun yoklama zinciri; gelince an (ms) — `sure` dolarsa null. */
async function siparisBekle(d: Duzenek, since: number, sure: number): Promise<{ an: number | null; yoklama: number }> {
  const son = Date.now() + sure;
  let cur = since;
  let yoklama = 0;
  while (Date.now() < son) {
    const bekle = Math.max(0, Math.min(25, Math.ceil((son - Date.now()) / 1000)));
    const r = await bulutIstek(d.patron.url, "GET", `/degisim?since=${cur}&bekle=${bekle}`, undefined, d.yonetici.belirtec);
    yoklama++;
    if (r.status !== 200) throw new Error(`degisim ${r.status} ${r.kod ?? ""}`);
    if ((r.veri.degisenler as string[]).includes("siparis")) return { an: Date.now(), yoklama };
    cur = Number(r.veri.sayac);
  }
  return { an: null, yoklama };
}

async function siparisYaz(d: Duzenek, cariId: string, urunId: string): Promise<{ id: string; t0: number; t1: number }> {
  const t0 = Date.now();
  const s = await d.istemci.istek("POST", "/api/orders", { customerId: cariId, currency: "TRY", clientToken: randomUUID(), lines: [{ itemId: urunId, quantity: 11 }] });
  const t1 = Date.now();
  if (s.status !== 201) throw new Error(`sipariş ${s.status} ${s.kod ?? ""}`);
  return { id: String(s.veri.id), t0, t1 };
}

function ozet(xs: number[]): { min: number; medyan: number; maks: number } {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length % 2 ? s[(s.length - 1) / 2]! : Math.round((s[s.length / 2 - 1]! + s[s.length / 2]!) / 2);
  return { min: s[0]!, medyan: m, maks: s[s.length - 1]! };
}

async function main(): Promise<number> {
  let d: Duzenek;
  try {
    d = await duzenekKur();
  } catch (err) {
    console.error(`⛔ Düzenek: ${(err as Error).message}`);
    return 2;
  }
  let kod = 0;
  const rapor: Record<string, unknown> = { tarih: new Date().toISOString() };
  try {
    d.satici.kiraEk = { ...d.satici.kiraEk, esitlemeAraligiDk: 5 };
    const y = await d.istemci.yokla();
    console.log(`kira aralığı 5 dk — yokla ${y.outcome}`);
    const cari = await d.istemci.istek("POST", "/api/customers", { name: `Ölçüm UU ${randomUUID().slice(0, 6)}`, isCustomerRole: true });
    if (cari.status !== 201) throw new Error(`cari ${cari.status}`);
    const cariId = String(cari.veri.id);
    const urunId = (await d.fdb.query<{ id: string }>(`SELECT id FROM items WHERE "isActive" ORDER BY "createdAt" LIMIT 1`)).rows[0]!.id;
    await uyu(2_500);
    const ilk = await turlaEsitle(d, async () => (await bulutSayisi(d, "cari-kart")) === (await fabrikaSayisi(d, "customers")), 12);
    await d.tur();
    console.log(`ilk eşitleme: ${ilk.tur} tur · ${ilk.durum}`);

    await bayrak(d, false);
    await uyu(16_000);
    const k0 = await sayac(d);
    const tk = Date.now();
    const bekleyenK = bulutIstek(d.patron.url, "GET", `/degisim?since=${k0}&bekle=25`, undefined, d.yonetici.belirtec);
    await uyu(300);
    const wk = await siparisYaz(d, cariId, urunId);
    const rk = await bekleyenK;
    const sureK = Date.now() - tk;
    const bulutK = (await bulutSayisi(d, "siparis", wk.id)) === 1;
    await d.tur();
    const sonra = (await bulutSayisi(d, "siparis", wk.id)) === 1;
    rapor.kapali = { yoklamaSureMs: sureK, degisenler: rk.veri.degisenler, sayac: [k0, rk.veri.sayac], buluttaYoklamaSonu: bulutK, emniyetTuruSonrasiBulutta: sonra };
    console.log(`KAPALI: ${JSON.stringify(rapor.kapali)}`);
    if (bulutK || (rk.veri.degisenler as string[]).length > 0 || !sonra) kod = 1;

    await bayrak(d, true);
    await uyu(20_000);
    const olcumler: Olcum[] = [];
    for (let i = 1; i <= TEKRAR; i++) {
      const s0 = await sayac(d);
      const bekleyen = siparisBekle(d, s0, 60_000);
      await uyu(300);
      const w = await siparisYaz(d, cariId, urunId);
      const b = await bekleyen;
      const st = await d.durum();
      const bulutta = (await bulutSayisi(d, "siparis", w.id)) === 1;
      const o: Olcum = { tekrar: i, yazimMs: w.t1 - w.t0, gecikmeMs: b.an === null ? null : b.an - w.t1, tetik: tetikOf(st), bulutta, yoklamaSayisi: b.yoklama };
      olcumler.push(o);
      console.log(`AÇIK #${i}: yazım ${o.yazimMs} ms · gecikme ${o.gecikmeMs ?? "GELMEDİ"} ms · tetik ${o.tetik} · bulutta ${bulutta} · yoklama ${b.yoklama}`);
      if (o.gecikmeMs === null || !bulutta) kod = 1;
      await uyu(20_000);
    }
    const g = olcumler.map((o) => o.gecikmeMs).filter((x): x is number => x !== null);
    rapor.acik = { olcumler, ozet: g.length ? ozet(g) : null };

    // Ardışık yazım: önceki olay turundan ~2 sn sonra — 15 sn aralık kapısının etkisi (tek örnek).
    const s1 = await sayac(d);
    const w1 = await siparisYaz(d, cariId, urunId);
    const b1 = await siparisBekle(d, s1, 60_000);
    const s2 = await sayac(d);
    const bekleyen2 = siparisBekle(d, s2, 60_000);
    await uyu(2_000);
    const w2 = await siparisYaz(d, cariId, urunId);
    const b2 = await bekleyen2;
    rapor.ardisik = { ilkGecikmeMs: b1.an === null ? null : b1.an - w1.t1, ikinciGecikmeMs: b2.an === null ? null : b2.an - w2.t1, ikinciTetik: tetikOf(await d.durum()) };
    console.log(`ARDIŞIK: ilk ${JSON.stringify(rapor.ardisik)}`);
    await uyu(20_000);

  } catch (err) {
    console.error(`⛔ ölçüm: ${(err as Error).stack ?? String(err)}`);
    kod = 1;
  }
  await d.kapat(kod === 0);
  console.log(`\n=== ÖZET ===\n${JSON.stringify(rapor, null, 2)}`);
  const json = arg("json");
  if (json) fs.writeFileSync(json, JSON.stringify(rapor, null, 2));
  return kod;
}

main().then((k) => process.exit(k)).catch((err) => {
  console.error(err);
  process.exit(2);
});
