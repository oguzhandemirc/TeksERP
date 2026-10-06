// =============================================================================
// BİLDİRİM CİHAZI KAYDI BEKÇİSİ (gönderim B5; bu dilim yalnız kayıt uçları):
//   §1 kayıt 201 · aynı belirteçle tekrar → AYNI satır (belirteç doğal kimlik) · yanıt belirteci
//      geri SIZDIRMAZ · başka hesap aynı cihazdan kaydolursa satır ona geçer (bir telefon, tek oturum)
//   §2 liste yalnız kendi aktif cihazları · kaldır = soft (aktif=false), tekrar aynı sonuç; başkasının
//      cihazı 404 · biçimsiz platform 400 · oturumsuz 401
// Koşum: npx tsx scripts/test_cihaz_kaydi.ts
// =============================================================================
import { randomUUID } from "node:crypto";
import { withTesis } from "../src/lib/tenant";
import { api, hesapKur, kontrol, ortamKur, sonuc, temizleTesis, tesisKur } from "./lib/test-ortam";

type Cihaz = { id: string; platform: string; aktif: boolean };

async function main(): Promise<void> {
  const o = await ortamKur();
  const k = await tesisKur(o);
  try {
    const a = await hesapKur(o, k.tesisId, ["bulut:siparis:oku"]);
    const b = await hesapKur(o, k.tesisId, ["bulut:siparis:oku"]);
    const belirtec = `ExponentPushToken[${randomUUID()}]`;
    console.log("\n§1 kayıt");
    const r1 = await api(o, "POST", "/api/cihazlar", { belirtec: a.belirtec, govde: { platform: "android", belirtec, ad: "Patronun telefonu" } });
    const r2 = await api(o, "POST", "/api/cihazlar", { belirtec: a.belirtec, govde: { platform: "android", belirtec } });
    const c1 = r1.json.data as Cihaz;
    kontrol("§1a kayıt 201", r1.status === 201 && c1.platform === "android" && c1.aktif);
    kontrol("§1b aynı belirteç → AYNI satır", r2.status === 201 && (r2.json.data as Cihaz).id === c1.id);
    kontrol("§1c yanıt push belirtecini geri SIZDIRMAZ", !JSON.stringify(r1.json).includes(belirtec));
    const r3 = await api(o, "POST", "/api/cihazlar", { belirtec: b.belirtec, govde: { platform: "android", belirtec } });
    const sahip = await withTesis(o.goc, { tesisId: k.tesisId }, (tx) => tx.pushDevice.findUnique({ where: { id: c1.id } }));
    kontrol("§1d başka hesap aynı cihazdan → satır ona geçer", (r3.json.data as Cihaz).id === c1.id && sahip?.accountId === b.accountId);

    console.log("\n§2 liste · kaldır");
    const la = await api(o, "GET", "/api/cihazlar", { belirtec: a.belirtec });
    const lb = await api(o, "GET", "/api/cihazlar", { belirtec: b.belirtec });
    kontrol("§2a liste yalnız kendi cihazı (a: 0 · b: 1)", (la.json.data as Cihaz[]).length === 0 && (lb.json.data as Cihaz[]).length === 1);
    const baskasi = await api(o, "POST", `/api/cihazlar/${c1.id}/kaldir`, { belirtec: a.belirtec, govde: {} });
    kontrol("§2b başkasının cihazı → 404", baskasi.status === 404);
    const k1 = await api(o, "POST", `/api/cihazlar/${c1.id}/kaldir`, { belirtec: b.belirtec, govde: {} });
    const k2 = await api(o, "POST", `/api/cihazlar/${c1.id}/kaldir`, { belirtec: b.belirtec, govde: {} });
    const satir = await withTesis(o.goc, { tesisId: k.tesisId }, (tx) => tx.pushDevice.findUnique({ where: { id: c1.id } }));
    kontrol("§2c kaldır = soft (satır durur, aktif=false); tekrar aynı sonuç", k1.status === 200 && k2.status === 200 && satir !== null && satir.active === false);
    const kotu = await api(o, "POST", "/api/cihazlar", { belirtec: a.belirtec, govde: { platform: "symbian", belirtec } });
    kontrol("§2d biçimsiz platform 400", kotu.status === 400);
    const anon = await api(o, "POST", "/api/cihazlar", { govde: { platform: "ios", belirtec } });
    kontrol("§2e oturumsuz 401", anon.status === 401);
  } finally {
    await temizleTesis(o, k.tesisId);
    await o.kapat();
  }
  sonuc();
}

main().catch((err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  process.exit(1);
});
