// SENARYO L — L37: kapanış kirası, fabrika tarafı uçtan uca (tasarım `docs/design/LISANS-V2-CEVRIMDISI-KIRA.md` §1.2
// K6 + "İkinci anahtar (K3)" · §6 K3/K6; kural `docs/kurallar/lisans.md:30 (c)`; arşiv "Lisans v2 kira bağı kapısı").
// Kopya (ikinci pencere) ve taşınan eski anahtar imzalı kapanış kirasını kabul eder → ek süre → kısıtlama tarihinde
// KISITLI. Ayrıca ölçülür: kapanış kirası yeniden gelince yoklama "kira yenilenmedi" sayılır — bu, kopya tarafında
// kısıtlamayı öne çekmemeli, asıl kurulumda hiç görülmemeli. Saat yalnız kapanış alan fabrikada kayar.
import fs from "node:fs";
import { DAY_MS } from "../../src/lib/license/protocol";
import type { LisansDetayi } from "./senaryo-lisans-istemci";
import { etkinlestirZayifOnayli, kiraSatiri } from "./senaryo-lisans-v2-duzenek";
import type { G4Baglami } from "./senaryo-lisans-v2-g4";
import { ilerlet, kur, veriErisimiAcik, type AdimYuzu, type RolFabrika } from "./senaryo-lisans-v2-merdiven";

const PARMAK_IZLERI = {
  M: { makine: "5E0A0001-0000-4000-8000-0000000000E2", seri: "SENARYOM01" },
  N: { makine: "5E0A0001-0000-4000-8000-0000000000E3", seri: "SENARYON01" },
  M2: { makine: "5E0A0001-0000-4000-8000-0000000000E4", seri: "SENARYOM02" },
} as const;

const kademe = (d: LisansDetayi): string => `${d.durum.hesaplananKademe}/${d.durum.uygulananKademe}`;
const ozetle = (d: LisansDetayi): string =>
  `${kademe(d)} yaptirim=${d.kira?.yaptirim.kademe ?? "-"} kisitlamaKalanGun=${String(d.durum.kisitlamaKalanGun)} ekSure=${String(d.durum.ekSureKalanGun)} internet=${String(d.durum.baglanti.internetVar)} sonHata=${String(d.yoklama.sonHataKodu)}`;
const bekle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface KapanisGozlemi {
  /** Kapanış alan tarafın, kapanış kirası ikinci kez geldiğinde gördüğü yoklama sonucu (W1 gözlemi: KIRA_YENILENMEDI). */
  kopyaTekrar: string[];
  /** Asıl kurulumun aynı aralıktaki yoklama sonuçları. */
  asil: string[];
}

/** Kapanış kirasını alan tarafın ek süresi: zil yarışından bağımsız (kira kimliği bekler), sonra tekrar yoklama. */
async function kapanisAl<F extends RolFabrika>(b: G4Baglami<F>, a: AdimYuzu, x: F, dbId: string, neden: string, g: KapanisGozlemi): Promise<boolean> {
  await x.istemci.yokla();
  const w = await x.istemci.bekle((d) => d.kira?.yaptirim.kademe === "K3", 20_000);
  const d = w.detay;
  const satir = kiraSatiri(await b.detayKurulum(dbId), d.kira?.kiraId);
  const ok = a.kontrol(
    `${x.ad}: imzalı KAPANIŞ kirası (neden ${neden}) kabul edildi — yaptırım K3, kısıtlamaya 29–30 g, anında KISITLI değil — §1.2 K6 · lisans.md:30 (c)`,
    satir?.karar === "KAPANIS" && satir.kapanisNedeni === neden && d.durum.kisitlamaKalanGun !== null && d.durum.kisitlamaKalanGun >= 29 && d.durum.hesaplananKademe !== "KISITLI",
    `karar=${satir?.karar} neden=${satir?.kapanisNedeni} ${ozetle(d)}`,
  );
  const t = await x.istemci.yokla();
  g.kopyaTekrar.push(`${t.outcome}${t.code ? ` ${t.code}` : ""}`);
  return ok;
}

/** Kapanış alan tarafta zaman: ek süre içinde yoklamalar "kira yenilenmedi" olsa da KISITLI'ya sıçramaz; tarihte KISITLI. */
async function ekSureSonu<F extends RolFabrika>(b: G4Baglami<F>, a: AdimYuzu, x: F, g: KapanisGozlemi): Promise<void> {
  const k0 = (await x.istemci.detay()).durum.kisitlamaKalanGun ?? 30;
  await ilerlet(b, x, 2 * DAY_MS);
  const y1 = await x.istemci.yokla();
  g.kopyaTekrar.push(`+2g ${y1.outcome}${y1.code ? ` ${y1.code}` : ""}`);
  const d1 = await x.istemci.detay();
  a.kontrol(
    `${x.ad} +2 g: son başarılı alışveriş > 24 sa (K3 ikinci anahtarı DOLU) ve yoklama 'kira yenilenmedi' — yine KISITLI değil, sayaç ${k0 - 2} civarı — §1.2 K3 · K6 ('asla anında durdurma')`,
    d1.durum.hesaplananKademe !== "KISITLI" && !d1.durum.baglanti.internetVar && d1.durum.kisitlamaKalanGun !== null && Math.abs(d1.durum.kisitlamaKalanGun - (k0 - 2)) <= 1,
    `yoklama=${y1.outcome} ${y1.code ?? ""} ${ozetle(d1)}`,
  );
  await ilerlet(b, x, (k0 - 3) * DAY_MS);
  const d2 = await x.istemci.detay();
  a.kontrol(`${x.ad} kısıtlama tarihinden ~1 g önce: hâlâ KISITLI değil — K6 (K3 + ek süre)`, d2.durum.hesaplananKademe !== "KISITLI", ozetle(d2));
  await ilerlet(b, x, 2 * DAY_MS);
  const y3 = await x.istemci.yokla();
  const d3 = await x.istemci.detay();
  a.kontrol(`${x.ad} kısıtlama tarihi geçti: KISITLI + tehlike bandı — K6 · §1.3 satır 4`, kademe(d3) === "KISITLI/KISITLI" && d3.durum.uygulanan.bant?.ton === "tehlike", `yoklama=${y3.outcome} ${y3.code ?? ""} ${ozetle(d3)}`);
  const yaz = await x.istemci.istek("POST", "/api/orders", {});
  a.kontrol(`${x.ad} KISITLI (zorla): POST /api/orders → 403 LICENSE_RESTRICTED — lisans.md:56`, yaz.status === 403 && yaz.kod === "LICENSE_RESTRICTED", `${yaz.status} ${yaz.kod ?? ""}`);
  await veriErisimiAcik(x, a);
}

/** Asıl kurulum: kapanış süresince her yoklama YENİ kira alır — KIRA_YENILENMEDI görülmez, NORMAL, internet VAR. */
async function asilEtkilenmez(a: AdimYuzu, x: RolFabrika, g: KapanisGozlemi, etiket: string): Promise<void> {
  for (let i = 0; i < 2; i++) {
    const y = await x.istemci.yokla();
    g.asil.push(`${y.outcome}${y.code ? ` ${y.code}` : ""}`);
  }
  const d = await x.istemci.detay();
  a.kontrol(
    `${etiket}: asıl kurulumun yoklamaları BASARILI, KIRA_YENILENMEDI yok, internet VAR, NORMAL — §1.2 K3 'internet varken kademeyi yalnız satıcı kararı düşürür'`,
    g.asil.every((s) => s === "BASARILI") && d.yoklama.sonHataKodu !== "KIRA_YENILENMEDI" && d.durum.baglanti.internetVar && kademe(d) === "NORMAL/NORMAL",
    `yoklamalar=[${g.asil.join(", ")}] ${ozetle(d)}`,
  );
}

// ============================================================ L37
export async function l37KapanisKirasi<F extends RolFabrika>(b: G4Baglami<F>, a: AdimYuzu): Promise<void> {
  const gozlem: KapanisGozlemi = { kopyaTekrar: [], asil: [] };
  try {
    await l37Kos(b, a, gozlem);
  } finally {
    a.not(`K3 etkileşimi — kapanış alan taraf yoklamaları: [${gozlem.kopyaTekrar.join(" · ")}] · asıl kurulum: [${gozlem.asil.join(" · ")}]`);
  }
}

async function l37Kos<F extends RolFabrika>(b: G4Baglami<F>, a: AdimYuzu, gozlem: KapanisGozlemi): Promise<void> {
  const k = await kur(b, a, "M", { zorla: true, parmakIzi: { ...PARMAK_IZLERI.M } });
  if (!k) return;
  const M = k.f;
  // (1) kopya: lisans klasörü farklı parmak izli makineye; ikinci pencerede kapanış.
  const N = await b.yeniFabrika("N", await b.rolDb("N"), { ...PARMAK_IZLERI.N });
  fs.cpSync(M.lisansDizini, N.lisansDizini, { recursive: true });
  await b.baslat(N);
  const n1 = await N.istemci.yokla();
  const m1 = await M.istemci.yokla();
  a.kontrol("kopya ilk pencere: iki taraf da kira alır (yalnız portal uyarısı) — lisans.md:30 (c)", n1.outcome === "BASARILI" && m1.outcome === "BASARILI", `N=${n1.outcome} M=${m1.outcome}`);
  await bekle(21_000); // KOPYA_PENCERE_SN=20
  if (await kapanisAl(b, a, N, k.dbId, "KOPYA", gozlem)) {
    await asilEtkilenmez(a, M, gozlem, "kopya kapanışı");
    await ekSureSonu(b, a, N, gozlem);
  }
  await b.durdur(N);
  for (const u of ((await b.detayKurulum(k.dbId)).kopyaUyarilari as Array<{ id: string; durum: string }>).filter((x) => x.durum === "ACIK")) {
    await b.portal.istek("POST", `/kopya-uyarilari/${u.id}/kapat`, { sebep: "Senaryo L37 incelendi", digerParmakIziniKabulEt: false });
  }
  // (2) taşıma (L12 deseni): yeni makine kendi anahtarıyla kimliksiz talep açar, operatör hedefi seçer, taşıma koduyla
  // etkinleşir; eski anahtar kapanış alır. Yeni makine kendi DB'sini taşır (v2 DB izi paylaşılmaz).
  const M2 = await b.yeniFabrika("M2", await b.rolDb("M2"), { ...PARMAK_IZLERI.M2 });
  await b.baslat(M2);
  const t = await M2.istemci.istek("POST", "/api/license/tasima-talebi", { gerekce: "Senaryo L37 sunucu değişimi" });
  const yeniAnahtar = (await M2.istemci.detay()).kurulum.anahtarKimligi;
  const liste = await b.portal.istek("GET", "/tasima-talepleri?durum=BEKLIYOR");
  const talep = ((liste.veri.items ?? []) as Array<{ id: string; yeniAnahtarKimligi: string }>).find((x) => x.yeniAnahtarKimligi === yeniAnahtar);
  const o = await b.portal.istek("POST", `/tasima-talepleri/${talep?.id}/onayla`, { sebep: "Senaryo L37 onay", kurulumId: k.dbId });
  const kod = String((o.veri.tasimaKodu as { kod?: string } | null)?.kod);
  await M2.istemci.sozlesmeyiKabulEt();
  const e = await etkinlestirZayifOnayli({ fabrika: M2.istemci, portal: b.portal, kurulumDbId: k.dbId, kod, kontrol: (x, ok, ay) => a.kontrol(x, ok, ay), etiket: "M2" });
  a.kontrol("taşıma: talep → portal onayı → yeni makine (M2) kodla etkinleşir", t.status === 200 && o.status === 200 && e.status === 200, `talep=${t.status} ${t.kod ?? ""} ${String(t.details.vendorCode ?? "")} onay=${o.status} ${o.kod ?? ""} etkinleştirme=${e.status} ${e.kod ?? ""}`);
  if (e.status === 200) {
    const tasima: KapanisGozlemi = { kopyaTekrar: [], asil: [] };
    if (await kapanisAl(b, a, M, k.dbId, "TASIMA", tasima)) {
      await asilEtkilenmez(a, M2, tasima, "taşıma kapanışı (yeni sahip M2)");
      await ekSureSonu(b, a, M, tasima);
    }
    gozlem.kopyaTekrar.push(...tasima.kopyaTekrar.map((s) => `M: ${s}`));
    gozlem.asil.push(...tasima.asil.map((s) => `M2: ${s}`));
  }
  await b.durdur(M);
  await b.durdur(M2);
}
