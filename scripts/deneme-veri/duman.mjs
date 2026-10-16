#!/usr/bin/env node
// =============================================================================
// deneme-veri/duman — doldurulan kurulumda her modülden birkaç kaydı panel API'siyle GÜNCELLER ve 200 bekler
// (anonimleştirme + doldurma sonrası kayıtların yazılabilir kaldığının kanıtı). Yalnız doldurmanın KENDİ kayıtlarına
// dokunur; değerler belirlenimlidir (ikinci koşum aynı değeri yazar). Okuma yüzeyleri de (liste/özet) 200 beklenir.
//
//   node scripts/deneme-veri/duman.mjs --url <adres> --sir <Anahtar Zinciri servisi> [--cap YYYY-AA-GG]
// Çıkış: 0 hepsi 200 · 1 en az bir kırmızı. Çıktı sır basmaz.
// =============================================================================
import { istemciKur, zincirOku, liste } from "./lib/istemci.mjs";
import { baglamKur, katlaAd } from "./lib/baglam.mjs";
import { anaVeri } from "./adimlar/ana-veri.mjs";
import { dokumaIsleri } from "./adimlar/dokuma.mjs";

const arg = (ad, v) => { const i = process.argv.indexOf(ad); return i > 0 ? process.argv[i + 1] : v; };

async function main() {
  const url = arg("--url"), sir = arg("--sir"), cap = arg("--cap", "2026-10-16");
  if (!url || !sir) throw new Error("kullanım: duman.mjs --url <adres> --sir <zincir servisi>");
  const ist = istemciKur({ url, kullanici: "demoveri", parola: zincirOku(sir) ?? "" });
  await ist.giris();
  const c = baglamKur({ api: ist.api, cap });
  await anaVeri(c); // kimlikleri okur (yazacak bir şey yoksa no-op)
  await dokumaIsleri(c);
  const k = c.kayit;
  const sonuc = [];
  const dene = async (ad, fn) => {
    try { await fn(); sonuc.push([ad, "200"]); }
    catch (e) { sonuc.push([ad, `KIRMIZI ${e.status ?? ""} ${e.kod ?? ""} ${String(e.message).slice(0, 160)}`]); }
  };
  const bul = async (yol, ad) => (await c.hepsi(yol)).find((x) => katlaAd(x.name) === katlaAd(ad));

  await dene("depo PATCH", async () => c.api("PATCH", `/api/warehouses/${k.depo["Fason Ara Depo"]}`, { notes: "Fasondan dönen ve fasona gidecek mal — raf F1-F4" }));
  await dene("kalem PATCH", async () => c.api("PATCH", `/api/items/${k.kalem["SATEN DÖŞEMELİK 140"]}`, { name: "SATEN DÖŞEMELİK 140" }));
  await dene("cari PATCH", async () => c.api("PATCH", `/api/customers/${k.musteriler[2].id}`, { city: "Bursa" }));
  await dene("istasyon PATCH", async () => c.api("PATCH", `/api/stations/${k.istasyon.OTHER}`, { department: "PAKETLEME" }));
  await dene("makine PATCH", async () => c.api("PATCH", `/api/machines/${k.tezgahlar[31].id}`, { name: (await c.api("GET", `/api/machines/${k.tezgahlar[31].id}`)).data.name }));
  await dene("tezgah künyesi PUT", async () => c.api("PUT", `/api/machine-specs/${k.tezgahlar[0].id}`, { shedType: "ARMUR", nominalUnitsPerMin: 520 }));
  await dene("dokuma işi PATCH", async () => c.api("PATCH", `/api/weaving-orders/${k.dk.DK7.id}`, { notes: "Jakar desen D-118 — planlı" }));
  await dene("levent PATCH", async () => {
    const lv = (await c.hepsi("/api/warp-beams")).find((x) => x.physicalBeamNo === "G-203" && x.warpSpecId === k.cozgu["CZG-D02"]);
    if (!lv) throw new Error("planlı levent G-203 yok");
    return c.api("PATCH", `/api/warp-beams/${lv.id}`, { notes: "Sarım sırası: perşembe gece" });
  });
  await dene("satınalma PATCH", async () => {
    const po = liste(await c.api("GET", "/api/purchase-orders?limit=100")).find((x) => (x.notes ?? "").includes("[DV-") || x.supplier?.id === k.tedarikci["Doruk İplik Sanayi"] && x.status === "OPEN");
    if (!po) throw new Error("satınalma yok");
    return c.api("PATCH", `/api/purchase-orders/${po.id}`, { notes: po.notes ?? null });
  });
  await dene("kasa PATCH", async () => c.api("PATCH", `/api/finance/cash-boxes/${(await bul("/api/finance/cash-boxes", "Merkez Kasa")).id}`, { notes: "Günlük nakit — sorumlu muhasebe" }));
  await dene("banka PATCH", async () => c.api("PATCH", `/api/finance/bank-accounts/${(await bul("/api/finance/bank-accounts", "Vadesiz TL Hesap")).id}`, { notes: "Tahsilat hesabı" }));
  await dene("vardiya PATCH", async () => {
    const v = liste(await c.api("GET", "/api/shift-definitions?includeInactive=1")).find((x) => x.code === "SABAH");
    return c.api("PATCH", `/api/shift-definitions/${v.id}`, { plannedBreakMinutes: 30 });
  });
  await dene("çözgü kartı PATCH", async () => c.api("PATCH", `/api/warp-specs/${k.cozgu["CZG-D03"]}`, { takeUpPct: 8 }));
  for (const [ad, yol] of [["salon", "/api/loom-floor"], ["sipariş listesi", "/api/orders?limit=5"], ["iş emri listesi", "/api/work-orders?limit=5"],
    ["top listesi", "/api/rolls?limit=5"], ["fatura listesi", "/api/finance/invoices?pageSize=5"], ["çek portföyü", "/api/finance/cheques?limit=5"],
    ["cari listesi", "/api/finance/cari?limit=5"], ["istasyon canlı durum", "/api/dashboard/stations/live-state"]]) {
    await dene(`${ad} GET`, () => c.api("GET", yol));
  }
  for (const [ad, s] of sonuc) console.log(`  ${s === "200" ? "✓" : "✗"} ${ad.padEnd(22)} ${s}`);
  await ist.cikis();
  const kirmizi = sonuc.filter(([, s]) => s !== "200").length;
  console.log(kirmizi ? `\n✗ duman: ${kirmizi}/${sonuc.length} kırmızı` : `\n✓ duman: ${sonuc.length}/${sonuc.length} yeşil`);
  process.exit(kirmizi ? 1 : 0);
}
main().catch((e) => { console.error("HATA: " + e.message); process.exit(1); });
