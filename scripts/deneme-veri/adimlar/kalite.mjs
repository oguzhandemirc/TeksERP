// Kalite dolgusu (dolgu-2): dokuma hata tipleri katalogu · iş emri şablonları (ürün reçetesi) · müşteri iadeleri.
// İade = mal müşteriye ULAŞTI (storno değil): yalnız SEVK EDİLMİŞ toplardan, sevkiyat başına bir belge, sebep katalogdan.
// Seçim çapaya bağlıdır (pencere = çapa−60 gün … çapa) ⇒ ikinci koşum aynı sevkiyatları görür; iade notundaki
// [DV2-IADE:<sevkiyat no>] işaretiyle aranır, toplam en çok IADE_SAYISI belge (tokensız uç → canlı durumdan karar).
import { katlaAd } from "../lib/baglam.mjs";

export const HATA_TIPLERI = [
  ["Atkı Kaçığı", "MAJOR", "Atkı ipliği eksik/atlamış — boydan boya çizgi"],
  ["Çözgü Kopuğu", "MAJOR", "Kopuk çözgü teli — boyuna iz"],
  ["Ende Darlık", "MINOR", "Kumaş eni sipariş eninin altında"],
  ["Yağ Lekesi", "MINOR", "Tezgah yağı lekesi"],
  ["Boya Tonu Farkı", "MAJOR", "Parti içi ton farkı (boyahane dönüşü)"],
  ["Desen Kayması", "CRITICAL", "Jakar desen kayması — tekrar boyu bozuk"],
  ["Düğüm / Nope", "MINOR", "İplik düğümü veya nope kabarması"],
];
/** [ad, kumaş, en, katlama, rota türleri (istasyon kind sırası)] */
export const SABLONLAR = [
  ["Ham Perdelik 280 — Kontrol + Tambur", "HAM PERDELİK 280", 280, "2-KAT", ["PROCESS_QC", "TAMBUR"]],
  ["Saten Döşemelik 140 — Standart", "SATEN DÖŞEMELİK 140", 140, "TUP", ["PROCESS_QC", "TAMBUR"]],
  ["Ham Tül 300 — Katlamalı", "HAM TÜL 300", 300, "2-KAT", ["PROCESS_QC", "TAMBUR"]],
  ["Jakarlı Döşemelik 140 — Boyalı", "JAKARLI DÖŞEMELİK 140", 140, "TUP", ["SUBCONTRACTOR", "SUBCONTRACTOR", "PROCESS_QC", "TAMBUR"]],
];
export const IADE_SAYISI = 3;

/** Kat değeri kurulumun KAT kataloğundan (panelden değişir): istenen varsa o, yoksa ilk aktif değer; katalog yoksa istenen
 *  (backend katalog boşken fail-open). Kod karşılaştırması ASCII büyük harfle — kod kimliktir. */
export async function katSec(c, istenen) {
  if (!c.kayit.katKatalog) {
    const kat = (await c.hepsi("/api/fabric-properties")).find((p) => p.code === "KAT");
    c.kayit.katKatalog = (kat?.values ?? []).filter((v) => v.isActive !== false).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)).map((v) => v.code);
  }
  const kk = c.kayit.katKatalog;
  if (!kk.length) return istenen;
  return kk.find((x) => x.toUpperCase() === istenen.toUpperCase()) ?? kk[0];
}
const IADE_NEDENI = ["Boya Tonu Farkı — müşteri numuneyle karşılaştırdı", "Ende darlık — 2 cm dar", "Leke — sevk sırasında"];

export async function kalite(c) {
  const k = c.kayit;
  // Hata tipleri (kod sunucuda doğar ⇒ ad ile bulunur)
  for (const [name, severity, description] of HATA_TIPLERI) {
    await c.bulYaDaYarat("hata-tipi", async () => (await c.hepsi("/api/defect-types")).find((x) => katlaAd(x.name) === katlaAd(name)),
      async () => (await c.api("POST", "/api/defect-types", { name, severity, description }, { tekDeneme: true })).data);
  }
  // İş emri şablonları — rota istasyon türü dizisine göre seçilir (yoksa rotasız şablon)
  const rotalar = await c.hepsi("/api/routes");
  const rotaOf = (turler) => rotalar.filter((r) => r.isActive !== false).sort((a, b) => String(a.code).localeCompare(String(b.code)))
    .find((r) => JSON.stringify((r.steps ?? []).slice().sort((a, b) => a.sequence - b.sequence).map((s) => s.station?.kind)) === JSON.stringify(turler));
  for (const [name, kumas, width, foldType, turler] of SABLONLAR) {
    const rota = rotaOf(turler);
    await c.bulYaDaYarat("is-emri-sablonu", async () => (await c.hepsi("/api/product-recipes")).find((x) => katlaAd(x.name) === katlaAd(name)),
      async () => (await c.api("POST", "/api/product-recipes", { name, itemId: k.kalem[kumas], width, foldType: await katSec(c, foldType), routeId: rota?.id ?? null }, { tekDeneme: true })).data);
  }

  // İadeler
  const mevcut = (await c.hepsi("/api/returns")).filter((r) => /\[DV2-IADE:/.test(r.note ?? r.notes ?? ""));
  k.iadeler = mevcut;
  if (mevcut.length >= IADE_SAYISI) { c.say("iade", "mevcut"); return; }
  const nedenler = (await c.hepsi("/api/return-reasons")).filter((r) => r.isActive !== false).sort((a, b) => String(a.code).localeCompare(String(b.code)));
  const bas = Date.parse(c.an(-60, 0)), son = Date.parse(c.an(1, 0));
  const sevkler = (await c.hepsi("/api/shipping/shipments?status=DISPATCHED"))
    .filter((s) => s.kind !== "DIRECT" && s.status === "DISPATCHED" && s.dispatchedAt && Date.parse(s.dispatchedAt) >= bas && Date.parse(s.dispatchedAt) < son && Number(s.totalMeters ?? 0) > 0)
    .sort((a, b) => String(a.shipmentNo).localeCompare(String(b.shipmentNo)));
  let n = mevcut.length;
  for (const s of sevkler) {
    if (n >= IADE_SAYISI) break;
    if (mevcut.some((r) => (r.note ?? r.notes ?? "").includes(`[DV2-IADE:${s.shipmentNo}]`))) continue;
    const d = (await c.api("GET", `/api/shipping/shipments/${s.id}`)).data;
    // Detayın `rolls` dizisi durum taşımaz; durum çuval topundadır (sevk edilmiş = SHIPPED, iade edilen `returnedRolls`ta)
    const iadeli = new Set((d.returnedRolls ?? []).map((r) => r.id ?? r.rollId));
    const top = (d.sacks ?? []).flatMap((sk) => sk.rolls ?? []).filter((r) => r.status === "SHIPPED" && !iadeli.has(r.id))
      .sort((a, b) => String(a.barcode).localeCompare(String(b.barcode)))[0];
    if (!top) continue;
    const neden = nedenler[n % Math.max(1, nedenler.length)];
    const r = await c.api("POST", "/api/returns", {
      rollIds: [top.id], reasonId: neden?.id ?? null, reasonText: IADE_NEDENI[n % IADE_NEDENI.length],
      note: `Müşteri iadesi — kalite kontrole alındı [DV2-IADE:${s.shipmentNo}]`,
    }, { tekDeneme: true });
    c.say("iade", "yeni");
    k.iadeler.push(r.data ?? r);
    n++;
  }
}

export const iadeListesi = async (c) => (await c.hepsi("/api/returns")).filter((r) => /\[DV2-IADE:/.test(r.note ?? r.notes ?? ""));
