// =============================================================================
// BEKÇİ — SUNUCU SİMGESİ DURUMU (`GET /health/tepsi`, docs/design/GUNCELLEYICI.md §14)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts tepsi_durumu   (DB'siz; saf + statik)
//   §1 renk kararı vektörleri (kırmızı > sarı > yeşil; güncelleme sürüyor → sürücü + ilerleme)
//   §2 çıktı SIR/YOL/İLETİ taşımaz: güncelleyicinin serbest `mesaj`ı ve tanımsız alanlar çıktıya girmez
//   §3 uç: yalnız döngü adresi (dışarıya 404), ilk iş adres kapısı (DB'ye dokunmadan önce)
//   §4 negatif sonda: karar bozulursa vektör KIRMIZI (mutasyonun uygulandığı ölçülür)
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import { trayStatus, type TrayStatus } from "../src/lib/tepsi-durumu";
import type { UpdaterRead } from "../src/lib/license/updater-ipc";

const KOK = path.resolve(__dirname, "..");
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}

const NOW = Date.parse("2026-10-06T10:00:00.000Z");
const iso = (msOnce: number) => new Date(NOW - msOnce).toISOString();
type Doc = Record<string, unknown>;
const okOku = (d: Doc): UpdaterRead => ({ status: { kind: "ok", doc: { v: 1, durum: "BEKLIYOR", sonCanlilik: iso(10_000), canlilikEsigiSn: 180, ...d } }, history: [] }) as unknown as UpdaterRead;
const durum = (o: { db?: "UP" | "DOWN"; kip?: string | null; read: UpdaterRead }): TrayStatus => trayStatus({ db: o.db ?? "UP", surum: "2.12.4", lisansKipi: o.kip === undefined ? "NORMAL" : o.kip, read: o.read, nowMs: NOW });

function vektorler(durumFn: typeof durum): Array<[string, boolean, string]> {
  const s: Array<[string, boolean, string]> = [];
  const y = durumFn({ read: okOku({ durum: "BEKLIYOR" }) });
  s.push(["yeşil: db UP · lisans NORMAL · güncelleyici canlı", y.renk === "YESIL" && y.nedenler.length === 0 && !y.guncelleme.surucu, y.renk]);
  const d = durumFn({ db: "DOWN", read: okOku({}) });
  s.push(["kırmızı: veritabanı yok", d.renk === "KIRMIZI", d.renk]);
  const h = durumFn({ read: okOku({ durum: "HATA", hataKodu: "IC_HATA" }) });
  s.push(["kırmızı: güncelleyici HATA (insan gerekir)", h.renk === "KIRMIZI", h.renk]);
  const l = durumFn({ kip: "KISITLI", read: okOku({}) });
  s.push(["kırmızı: lisans kısıtlı", l.renk === "KIRMIZI", l.renk]);
  const u = durumFn({ kip: "UYARI", read: okOku({}) });
  s.push(["sarı: lisans uyarı", u.renk === "SARI", u.renk]);
  const eski = durumFn({ read: okOku({ sonCanlilik: iso(10 * 60_000) }) });
  s.push(["sarı: kalp atışı eşiği aştı (güncelleyici yanıt vermiyor)", eski.renk === "SARI", eski.renk]);
  const yok = durumFn({ read: { status: { kind: "missing" }, history: [] } as unknown as UpdaterRead });
  s.push(["sarı: durum dosyası yok", yok.renk === "SARI", yok.renk]);
  const g = durumFn({ read: okOku({ durum: "INDIRILIYOR", surum: "2.13.0", adim: "INDIR", ilerleme: { indirilen: 5, toplam: 10 } }) });
  s.push(["sarı + sürücü: indirme sürerken ilerleme taşınır", g.renk === "SARI" && g.guncelleme.surucu && g.guncelleme.hedefSurum === "2.13.0" && g.guncelleme.ilerleme?.toplam === 10, JSON.stringify(g.guncelleme)]);
  const uy = durumFn({ read: okOku({ durum: "UYGULANIYOR", surum: "2.13.0" }) });
  s.push(["sarı + sürücü: uygulama", uy.renk === "SARI" && uy.guncelleme.surucu, uy.renk]);
  const b = durumFn({ read: okOku({ durum: "HAZIR", bekleyen: { surum: "2.13.0", karar: "ONAY_BEKLIYOR", neden: null } }) });
  s.push(["sarı: bekleyen sürüm onay bekliyor (sürücü DEĞİL)", b.renk === "SARI" && !b.guncelleme.surucu, b.renk + " " + b.nedenler.join("|")]);
  const gu = durumFn({ read: okOku({ durum: "HAZIR", bekleyen: { surum: "2.12.4", karar: "GUNCEL", neden: "SURUM_GUNCEL" } }) });
  s.push(["yeşil: bekleyen GUNCEL", gu.renk === "YESIL", gu.renk]);
  const k = durumFn({ db: "DOWN", kip: "UYARI", read: okOku({ durum: "INDIRILIYOR" }) });
  s.push(["öncelik: kırmızı sarıyı ezer", k.renk === "KIRMIZI", k.renk]);
  return s;
}

function main(): void {
  console.log("=== SUNUCU SİMGESİ DURUMU ===");
  console.log("\n§1 renk kararı");
  for (const [ad, ok, det] of vektorler(durum)) check(`§1 ${ad}`, ok, ok ? "" : det);

  console.log("\n§2 sır/yol/ileti sızmaz");
  const sizdir = durum({ read: okOku({ durum: "INDIRILIYOR", surum: "2.13.0", mesaj: "C:\\TeksERP\\gizli yol SIR=abc", sonAyrinti: { urun: "backend", hataKodu: "X", mesaj: "ic-ileti" }, ek: "SIR" }) });
  const json = JSON.stringify(sizdir);
  check("§2a güncelleyici serbest iletisi çıktıda YOK", !json.includes("gizli") && !json.includes("SIR") && !json.includes("ic-ileti") && !json.includes("TeksERP\\\\"));
  const kotuAdim = durum({ read: okOku({ durum: "UYGULANIYOR", surum: "..\\..\\x y", adim: "../etc/passwd" }) });
  check("§2b adım/sürüm sabit desenden geçmeyen değer null (yol/komut taşınamaz)", kotuAdim.guncelleme.adim === null && kotuAdim.guncelleme.hedefSurum === null);
  check("§2c alan kümesi kapalı", Object.keys(sizdir).sort().join() === "baslik,guncelleme,lisansKipi,nedenler,renk,surum,v,veritabani,zaman");

  console.log("\n§3 uç (statik)");
  const src = fs.readFileSync(path.join(KOK, "src/app.ts"), "utf8");
  const bas = src.indexOf('app.get("/health/tepsi"');
  const govde = bas < 0 ? "" : src.slice(bas, src.indexOf("\n});", bas));
  check("§3a /health/tepsi var, ilk iş adres kapısı (DB'den önce)", govde.length > 0 && govde.indexOf("isDirectLoopback(req.socket.remoteAddress, req.headers)") > 0 && govde.indexOf("isDirectLoopback") < govde.indexOf("prisma."));
  check("§3b dışarıya 404", /if \(!isDirectLoopback[\s\S]{0,120}res\.status\(404\)/.test(govde));
  check("§3c renk kararı tek yerde: uç trayStatus'tan geçer", /trayStatus\(/.test(govde));

  console.log("\n§4 negatif sondalar (mutasyonun uygulandığı ölçülür)");
  const kaynak = fs.readFileSync(path.join(KOK, "src/lib/tepsi-durumu.ts"), "utf8");
  const sondalar: Array<[string, string, string]> = [
    ["S1 veritabanı DOWN kırmızı saymıyor", 'if (g.db === "DOWN") kirmizi.push(', 'if (g.db === "DOWN") sari.push('],
    ["S2 güncelleyici HATA kırmızı saymıyor", 'if (d.durum === "HATA") kirmizi.push(', 'if (d.durum === "HATA") sari.push('],
    ["S3 indirme sürücüyü açmıyor", 'd.durum === "INDIRILIYOR" || d.durum === "UYGULANIYOR"', 'd.durum === "UYGULANIYOR"'],
  ];
  for (const [ad, eski, yeni] of sondalar) {
    if (!kaynak.includes(eski)) { check(`§4 ${ad}`, false, "MUTASYON UYGULANMADI (desen bayat)"); continue; }
    const mod = kaynak.replace(eski, () => yeni);
    const gecici = path.join(KOK, "src/lib", `.tepsi-sonda-${process.pid}.ts`);
    fs.writeFileSync(gecici, mod);
    try {
      const m = require(gecici) as { trayStatus: typeof trayStatus };
      const sonda = (o: Parameters<typeof durum>[0]) => m.trayStatus({ db: o.db ?? "UP", surum: "2.12.4", lisansKipi: o.kip === undefined ? "NORMAL" : o.kip, read: o.read, nowMs: NOW });
      const kirmizi = vektorler(sonda).some(([, ok]) => !ok);
      check(`§4 ${ad} → vektör KIRMIZI`, kirmizi);
    } finally {
      fs.rmSync(gecici, { force: true });
    }
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
