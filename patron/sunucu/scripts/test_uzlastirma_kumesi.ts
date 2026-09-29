// =============================================================================
// UZLAŞTIRMA KÜMESİ BEKÇİSİ (sözleşme §4.4, S44–S46) — bulut, fabrikayla AYNI kuralla sayar (tel sözleşmesi
// `RECONCILE_PARENTS` başlığı); fabrika tarafı burada o kuralla elle hesaplanır, saat ENJEKTE:
//   §1 ⭐ kalem ebeveyn kuralı: vadesi ufuktan eski çekin yeni hareketi · budanan faturanın kalemi — budama öncesi,
//      gün 1 budaması sonrası ve gün 2 (eski çekte etkinlik + fatura yaşlanması) uzlaştırmalarında TAM YOK
//   §2 ⭐ ebeveynli kalemin saklama ufku yanıtta (fatura-kalemi dahil — yoksa fabrika onu hiç süzemez)
//   §3 ⭐ bekleyen: fabrikanın bekleyen listesindeki satır bulut kümesinden dışlanır; listesiz aynı girdi TAM ister;
//      paket toplam tavanı aşılırsa 400
//   §4 ⭐ D4: `ISTEK_ZAMAN` yanıtı `details.sunucuSaati` taşır; o saate göre yeniden imzalanan istek geçer
// NEGATİF SONDA (dosya dışı, cp + shasum ile geri): P1 uzlaştırmanın ebeveyn süzgeci düştü → §1 · P2 ufuk yalnız
//   `retentionFields`li projeksiyona → §2 · P3 bekleyen dışlaması düştü → §3 · P4 `sunucuSaati` eki düştü → §4
// Ölçüm (eski kod): gün 1 budamasından sonra cek-hareketi + fatura-kalemi TAM; TAM'dan sonra gün 2'de yine ikisi.
// Koşum: npx tsx scripts/test_uzlastirma_kumesi.ts
// =============================================================================
import { createHash, randomUUID } from "node:crypto";
import { MAX_RECONCILE_PENDING } from "../src/wire/esitleme";
import { runDaily } from "../src/services/maintenance";
import { girdi, imzali, kontrol, ortamKur, paket, sonuc, temizleTesis, tesisKur, type Ortam, type TestKurulumu } from "./lib/test-ortam";

const GUN = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const ozet = (ids: string[]) => createHash("md5").update([...ids].sort().join(",")).digest("hex");
type Istenen = { istenen?: Array<{ projeksiyon: string }>; ufukTarihi?: Record<string, string> };

class Fabrika {
  private k = 0;
  private readonly zincir = new Map<string, { t: string; k: string }>();
  ufuk: Record<string, string> = {};
  constructor(
    private readonly o: Ortam,
    private readonly t: TestKurulumu,
  ) {}
  async gonder(g: { kayitlar?: Array<[string, Record<string, unknown>[]]>; uzl?: Array<[string, string[], string[]?]>; tur?: string }) {
    const ufuk = new Date(this.o.saat.simdi() - 60_000);
    const kayitlar = (g.kayitlar ?? []).map(([p, yaz]) => {
      const yeni = { t: ufuk.toISOString(), k: String(++this.k).padStart(12, "0") };
      const e = girdi(p, { yaz, yeni, onceki: this.zincir.get(p) ?? null });
      this.zincir.set(p, yeni);
      return e;
    });
    const uzlastirma = (g.uzl ?? []).map(([p, ids, bekleyen]) => ({ projeksiyon: p, adet: ids.length, ozet: ozet(ids), ufukTarihi: this.ufuk[p] ?? null, ...(bekleyen ? { bekleyen } : {}) }));
    const r = await imzali(this.o, this.t, "/v1/esitle", { govde: paket(this.t, { ufuk, kayitlar, uzlastirma, tur: g.tur ?? (kayitlar.length ? "ARTIMLI" : "UZLASTIRMA") }) });
    const j = r.json as unknown as Istenen;
    if (r.status === 200 && j.ufukTarihi) this.ufuk = j.ufukTarihi;
    return { status: r.status, tam: (j.istenen ?? []).map((i) => i.projeksiyon), json: r.json };
  }
}

async function ebeveynBolumu(o: Ortam, t: TestKurulumu): Promise<void> {
  console.log("\n§1–§2 kalem ebeveyn kuralı + saklama ufku");
  const f = new Fabrika(o, t);
  const s = o.saat.simdi();
  const [C, C2, E1, E2, E3, F, F2, K, K2] = Array.from({ length: 9 }, (): string => randomUUID());
  const cek = new Map<string, number>([[C!, s - 150 * GUN], [C2!, s + 30 * GUN]]);
  const olaylar: Array<{ id: string; cek: string; tarih: number }> = [{ id: E1, cek: C, tarih: s - GUN }, { id: E3, cek: C2, tarih: s - GUN }];
  const fatura = new Map<string, number>([[F!, s - 150 * GUN], [F2!, s - 91 * GUN]]);
  const kalemler = [{ id: K, f: F }, { id: K2, f: F2 }];
  // Fabrikanın kuralı (sözleşme): kalem ∈ küme ⇔ kendi tarihi ∧ üst belgenin tarihi ufuk içinde.
  const ic = (ms: number, p: string) => !f.ufuk[p] || ms >= Date.parse(f.ufuk[p]!);
  const kume = () => [
    ["cek-hareketi", olaylar.filter((e) => ic(e.tarih, "cek-hareketi") && ic(cek.get(e.cek)!, "cek-hareketi")).map((e) => e.id)],
    ["fatura-kalemi", kalemler.filter((l) => ic(fatura.get(l.f)!, "fatura-kalemi")).map((l) => l.id)],
  ] as Array<[string, string[]]>;
  const r0 = await f.gonder({
    kayitlar: [
      ["cek-senet", [...cek].map(([id, vade]) => ({ id, vade: iso(vade), olusturulma: iso(s - 160 * GUN) }))],
      ["cek-hareketi", olaylar.map((e) => ({ id: e.id, cekId: e.cek, tarih: iso(e.tarih) }))],
      ["fatura", [...fatura].map(([id, tarih]) => ({ id, tarih: iso(tarih) }))],
      ["fatura-kalemi", kalemler.map((l) => ({ id: l.id, faturaId: l.f }))],
    ],
  });
  const u = Object.keys(f.ufuk);
  kontrol("§2a ⭐ ebeveynli kalemlerin saklama ufku yanıtta (fatura-kalemi · siparis-kalemi · cek-hareketi)", r0.status === 200 && ["fatura-kalemi", "siparis-kalemi", "cek-hareketi"].every((p) => u.includes(p)), u.filter((p) => p.includes("kalem") || p.includes("hareketi")).join(","));
  const turlar: string[][] = [];
  const kalem0 = kume()[1]![1];
  turlar.push((await f.gonder({ uzl: kume() })).tam);
  o.saat.ilerlet(GUN);
  await runDaily(o.ctx, o.saat.simdi());
  turlar.push((await f.gonder({ uzl: kume() })).tam);
  o.saat.ilerlet(GUN);
  olaylar.push({ id: E2, cek: C, tarih: o.saat.simdi() - 60_000 });
  await f.gonder({ kayitlar: [["cek-senet", [{ id: C, vade: iso(cek.get(C)!), olusturulma: iso(s - 160 * GUN) }]], ["cek-hareketi", [{ id: E2, cekId: C, tarih: iso(olaylar[2]!.tarih) }]]] });
  await runDaily(o.ctx, o.saat.simdi());
  turlar.push((await f.gonder({ uzl: kume() })).tam);
  kontrol("§1a ⭐ budama öncesi uzlaştırma eşit", turlar[0]!.length === 0, turlar[0]!.join(",") || "eşit");
  kontrol("§1b ⭐ gün 1 budamasından sonra TAM YOK (üst çek/fatura budandı, kalem iki uçta da dışarıda)", turlar[1]!.length === 0, turlar[1]!.join(",") || "eşit");
  kontrol("§1c ⭐ gün 2: eski çekte yeni hareket + faturanın yaşlanması → yine TAM YOK", turlar[2]!.length === 0, turlar[2]!.join(",") || "eşit");
  kontrol("§1d fikstür: güncel çekin hareketi kümede kaldı; fatura gün 2'de yaşlandı (K2 gün 0'da vardı, gün 2'de yok)", kume()[0]![1].includes(E3) && kalem0.includes(K2) && !kume()[1]![1].includes(K2));
}

async function bekleyenBolumu(o: Ortam, t: TestKurulumu): Promise<void> {
  console.log("\n§3 bekleyen kimlikler");
  const f = new Fabrika(o, t);
  const x = randomUUID();
  await f.gonder({ kayitlar: [["renk", [{ id: x, ad: "Bekleyen renk" }]]] });
  const a = await f.gonder({ uzl: [["renk", [], [x]]] });
  kontrol("§3a ⭐ fabrikanın bekleyen listesindeki satır bulut kümesinden dışlanır → TAM yok", a.status === 200 && a.tam.length === 0, a.tam.join(",") || "eşit");
  const b = await f.gonder({ uzl: [["renk", []]] });
  kontrol("§3b listesiz aynı girdi (eski fabrika) satırı sayar → TAM", b.tam.includes("renk"), b.tam.join(","));
  const yarim = Math.floor(MAX_RECONCILE_PENDING / 2) + 1;
  const cok = (n: number) => Array.from({ length: n }, () => randomUUID());
  const c = await f.gonder({ uzl: [["renk", [], cok(yarim)], ["urun", [], cok(yarim)]] });
  kontrol("§3c paket toplam bekleyen tavanı aşılırsa 400", c.status === 400, String(c.status));
}

async function saatBolumu(o: Ortam, t: TestKurulumu): Promise<void> {
  console.log("\n§4 D4 — bulut saati");
  const govde = paket(t, { ufuk: new Date(o.saat.simdi() - 60_000), tur: "UZLASTIRMA" });
  const duvar = o.saat.simdi() - 2 * 3_600_000;
  const a = await imzali(o, t, "/v1/esitle", { govde, nowMs: duvar });
  const saat = a.json.details?.sunucuSaati;
  kontrol("§4a ⭐ ISTEK_ZAMAN yanıtı bulutun saatini taşır (details.sunucuSaati)", a.status === 401 && a.json.details?.code === "ISTEK_ZAMAN" && saat === iso(o.saat.simdi()), `${a.status} ${a.json.details?.code} ${String(saat)}`);
  const pay = duvar - Date.parse(String(saat));
  const b = await imzali(o, t, "/v1/esitle", { govde, nowMs: duvar - pay });
  kontrol("§4b o saate göre yeniden imzalanan istek geçer", b.status === 200, String(b.status));
}

async function main(): Promise<void> {
  const o = await ortamKur();
  const t = await tesisKur(o, { saklamaAy: 3 });
  const t2 = await tesisKur(o, { saklamaAy: 3 });
  try {
    await ebeveynBolumu(o, t);
    await bekleyenBolumu(o, t2);
    await saatBolumu(o, t2);
  } catch (e) {
    kontrol("beklenmeyen hata", false, e instanceof Error ? `${e.message}\n${e.stack}` : String(e));
  } finally {
    await temizleTesis(o, t.tesisId);
    await temizleTesis(o, t2.tesisId);
    await o.kapat();
  }
  sonuc();
}

void main();
