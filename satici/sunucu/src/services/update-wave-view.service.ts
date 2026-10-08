// Güncelleme dalgası — salt okuma görünümü ve eşik uyarısı (durdurmaz, AK-2). Üyelik/tavan/eylemler update-wave.service.ts'te.
import { enqueueNotificationTx } from "../notifications/outbox";
import { notFoundError } from "../lib/errors";
import { lockUpdateWave } from "../lib/locks";
import { prisma, type Db } from "../lib/prisma";
import { WAVE_GROUPS, currentWave, currentWaveOf, tallyWave, waveMembers } from "./update-wave.service";

// ── Görünüm (salt okuma) ─────────────────────────────────────────────────────

export async function listWaves(db: Db, f: { channel?: string }) {
  const waves = await db.guncellemeDalgasi.findMany({
    where: f.channel ? { kanalKodu: f.channel } : {},
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
  });
  const out = [];
  for (const w of waves) {
    const current = currentWave(waves.filter((x) => x.kanalKodu === w.kanalKodu));
    out.push({ ...w, yururlukte: current?.id === w.id, sayac: tallyWave(await waveMembers(db, w)) });
  }
  return out;
}

export async function waveDetail(db: Db, id: string) {
  const w = await db.guncellemeDalgasi.findUnique({ where: { id } });
  if (!w) throw notFoundError("Güncelleme dalgası");
  const current = await currentWaveOf(db, w.kanalKodu);
  const uyeler = await waveMembers(db, w);
  return {
    ...w,
    yururlukte: current?.id === w.id,
    sayac: tallyWave(uyeler),
    uyeler,
    gecmis: await db.guncellemeDalgasiKaydi.findMany({ where: { dalgaId: w.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100 }),
  };
}

// ── Eşik uyarısı (durdurmaz) ─────────────────────────────────────────────────

/**
 * Grubun yürürlükteki dalgasını değerlendirir; aşama ≥ 1 ve eşik aşılmışsa `GUNCELLEME_DALGA_UYARI` (dalga × aşama
 * başına bir kez — tekillik anahtarı). Aşamaya DOKUNMAZ (AK-2). Kendi tx'i, ilk ifade grup kilidi: tamamlanan iki
 * denemenin eşzamanlı değerlendirmesi birbirini görmeden eşiği kaçırmaz (sonraki değerlendirme ikisini de görür).
 */
export async function evaluateWaveAlert(channelCode: string): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await lockUpdateWave(tx, channelCode);
    const wave = await currentWaveOf(tx, channelCode);
    if (!wave || wave.asama === 0) return 0;
    const tally = tallyWave(await waveMembers(tx, wave));
    if (!tally.uyariAcik) return 0;
    const back = tally.asamalar.reduce((s, a) => s + a.GERI_DONDU, 0);
    const failed = tally.asamalar.reduce((s, a) => s + a.BASARISIZ, 0);
    return enqueueNotificationTx(tx, {
      event: "GUNCELLEME_DALGA_UYARI",
      keyParts: [wave.id, wave.asama],
      installationDbId: null,
      relatedId: wave.id,
      portalPath: `/guncelleme-dalgalari/${wave.id}`,
      konu: `${wave.kanalKodu} grubu · ${wave.surum} dalgası (aşama ${wave.asama})`,
      referans: `${tally.hata} kurulum sorunlu (${back} geri döndü · ${failed} başarısız); dalgada ${tally.dalgada.kurulum} kurulum. Yayılım DURMADI — aşamayı geri çekme kararı sizin`,
    });
  });
}

/** Bildirim taraması: dalgalı her grup için değerlendirme (tamamlanan denemenin anlık değerlendirmesi kaçarsa sigorta). */
export async function scanWaveAlerts(): Promise<number> {
  let n = 0;
  for (const code of WAVE_GROUPS) {
    try {
      n += await evaluateWaveAlert(code);
    } catch (err) {
      console.error(`[satici] dalga uyarısı taraması: ${code} atlandı: ${(err as Error).message}`);
    }
  }
  return n;
}
