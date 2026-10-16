// Salon BUGÜNÜ: fabrikanın şu anki tezgah durumu (çalışıyor · arıza · ayar · bakım · iş yok · kapalı · sınıflanmamış ·
// kayıtsız). Gövde "şimdi"den türer (tablo canlı durum); idempotentlik CANLI DURUMDAN: açık koşum/duruş varsa yazılmaz.
// Token gün + tezgah (+ son kapanış) anahtarlıdır ⇒ belirsiz hatada aynı gövdeyle yeniden deneme çift kayıt doğurmaz.
// Gün dönünce yeniden koşulur: dünden kalan açık duruş bugünün başında kapanır, bugünkü durum yeniden boyanır.
import { DEVIR, dokumaIsleri, tezgahIsi } from "./dokuma.mjs";

const DK = 60_000;
/** Tezgah → [sebep|null (sınıflanmamış), dakika önce, koşum açık mı]. 1–12 gece koşumu (dokuma adımı), 32 kayıtsız. */
export const SALON = {
  19: ["MEKANIK_ARIZA", 45, true], 20: ["ELEKTRIK_ARIZA", 20, true], 21: ["HAVA_BASINCI", 12, true], 26: ["JAKAR_ARIZA", 70, true],
  22: ["ATKI_KOPUSU", 4, true], 23: ["IPLIK_BITTI", 25, true], 24: ["LEVENT_BAGLAMA", 50, true], 25: [null, 8, true],
  27: ["PLANLI_BAKIM", 150, false], 28: ["PLANLI_BAKIM", 95, false], 29: ["SIPARIS_YOK", 300, false], 30: ["SIPARIS_YOK", 240, false],
  31: ["TEZGAH_KAPALI", 600, false],
};
const CALISAN = [13, 14, 15, 16, 17, 18];

export async function salon(c) {
  const k = c.kayit;
  if (!k.dk) await dokumaIsleri(c);
  const floor = async () => (await c.api("GET", "/api/loom-floor")).data;
  let f = await floor();
  const gunBas = Date.parse(f.factoryDayStart);
  const gunAnahtar = f.factoryDayStart.slice(0, 13);
  const loom = (id) => f.looms.find((l) => l.id === id);
  const duruslar = async (id) => (await c.api("GET", `/api/machine-stops?machineId=${id}&limit=500`)).data ?? [];
  const sonBitis = (l) => Math.max(0, ...l.filter((s) => s.endedAt).map((s) => Date.parse(s.endedAt)));

  for (const t of k.tezgahlar) {
    const hedef = SALON[t.i];
    const kosumIster = CALISAN.includes(t.i) || hedef?.[2];
    if (!kosumIster && !hedef) continue; // 1–12 dokuma adımında; 32 kayıtsız
    let st = await duruslar(t.id);
    // Dünden kalan açık duruş bugünün başında kapanır (salon bugünü yeniden boyanır).
    for (const s of st.filter((x) => !x.endedAt && Date.parse(x.startedAt) < gunBas)) {
      await c.kosulluYaz("salon-durus-devir", async () => true, () => c.api("POST", `/api/machine-stops/${s.id}/close`, { endedAt: new Date(gunBas).toISOString() }));
    }
    st = await duruslar(t.id);
    const simdi = Date.now();
    let kosumBas = 0;
    if (kosumIster) {
      const acik = loom(t.id)?.openRuns ?? [];
      if (acik.length) { c.say("salon-kosum", "mevcut"); kosumBas = Date.parse(acik[0].startedAt); }
      else {
        const dk = tezgahIsi(t.i);
        const [ppm, ppc] = DEVIR[dk];
        // Sabah vardiyası başı (07:00 + kaydırma) ya da henüz gelmediyse 2 dk önce; son duruş bitişinden sonra.
        kosumBas = Math.max(Math.min(gunBas + (7 * 60 + (t.i % 6) * 7) * DK, simdi - 2 * DK - (hedef?.[1] ?? 0) * DK), sonBitis(st) + 1000);
        if (kosumBas >= simdi) kosumBas = simdi - 30_000;
        await c.tokenli("salon-kosum", `dv:salon:run:${gunAnahtar}:${t.i}`, "/api/machine-runs", {
          machineId: t.id, productionLineNo: 1, weavingOrderId: k.dk[dk].id, targetUnitsPerMin: ppm, unitsPerCm: ppc, startedAt: new Date(kosumBas).toISOString(),
        });
      }
    }
    if (!hedef) continue;
    if (st.some((x) => !x.endedAt)) { c.say("salon-durus", "mevcut"); continue; }
    const son = sonBitis(st);
    let bas = Math.max(simdi - hedef[1] * DK, son + 1000, kosumBas ? kosumBas + DK : 0, hedef[2] ? 0 : gunBas);
    if (bas >= simdi) bas = simdi - 15_000;
    await c.tokenli("salon-durus", `dv:salon:stop:${gunAnahtar}:${t.i}:${son}`, "/api/machine-stops", {
      machineId: t.id, startedAt: new Date(bas).toISOString(), reasonCode: hedef[0],
    });
  }

  f = await floor();
  const s = f.summary;
  console.log(`  SALON: toplam ${s.total} · çalışan ${s.running} · duran ${s.stopped} · kayıtsız ${s.unmonitored} · sınıf ${JSON.stringify(s.stoppedByClass)} · şu an %${s.nowPct}`);
  const dagilim = {};
  for (const l of f.looms) { const a = l.openStop ? (l.openStop.reasonCode ?? "SINIFLANMAMIS") : l.state; dagilim[a] = (dagilim[a] ?? 0) + 1; }
  console.log(`  DAĞILIM: ${Object.entries(dagilim).map(([a, n]) => `${a} ${n}`).join(" · ")}`);
}
