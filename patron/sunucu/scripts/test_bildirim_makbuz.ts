// =============================================================================
// BİLDİRİM MAKBUZU + DENEME BİLDİRİMİ BEKÇİSİ (B5 borçları) — negatif + pozitif:
//   §1 Expo taşıyıcısı: bilet kimliği okunur · makbuz `DeviceNotRegistered` → GECERSIZ_CIHAZ · hazır olmayan
//      makbuz haritada yok · ağ/5xx → GECICI (sahte fetch; gerçek gönderim YOK)
//   §2 ⭐ makbuz turu: bilet alan teslim 15 dk sonra yoklanır · kayıtsız cihaz pasife · bildirim durumu değişmez ·
//      hazır olmayan tekrar sorulur, 24 saatte ZAMAN_ASIMI · biletsiz teslim yoklamaya hiç girmez (bugünkü
//      davranış) · eşzamanlı iki tur aynı satırı bir kez işler · geçici hata makbuzu düşürmez
//   §3 ⭐ deneme bildirimi: yalnız kendi etkin cihazları · kayıtsız cihaz pasife · dakikada bir (429) ·
//      cihazsız 409 · kip kapalıyken 409 · geçmişe yazılmaz · ayak izi audit'te · oturumsuz 401
// Koşum: npx tsx scripts/test_bildirim_makbuz.ts
// =============================================================================
import { withTesis } from "../src/lib/tenant";
import { ExpoTransport, RecordingTransport, type PushTransport, type ReceiptBatch } from "../src/push/transports";
import { checkReceipts, readDeliveries, RECEIPT_DELAY_MS, RECEIPT_GIVE_UP_MS } from "../src/services/notification-receipts";
import { deliverDue } from "../src/services/notification-sender";
import { TEST_INTERVAL_MS } from "../src/services/notification-test.service";
import { ayar, ayarYaz, bildirimler, cihazKaydet } from "./lib/bildirim-fikstur";
import { api, hesapKur, kontrol, ortamKur, sonuc, temizleTesis, tesisKur, type Ortam, type TestHesabi } from "./lib/test-ortam";

const IZIN = ["bulut:ozet:oku", "bulut:siparis:oku"];

async function expoTasiyici(): Promise<void> {
  console.log("\n§1 Expo taşıyıcısı (sahte fetch)");
  let yanit: () => Response = () => new Response("{}");
  const f = (() => Promise.resolve(yanit())) as unknown as typeof fetch;
  const t = new ExpoTransport({ EXPO_PUSH_URL: "https://exp.ornek.invalid/send", EXPO_MAKBUZ_URL: "https://exp.ornek.invalid/getReceipts", EXPO_ERISIM_BELIRTECI: undefined }, f);
  yanit = () => Response.json({ data: [{ status: "ok", id: "XXXX-1234" }] });
  const s = await t.send({ platform: "ANDROID", token: "ExponentPushToken[a]" }, { id: "n", title: "t", body: "b", route: null });
  kontrol("§1a bilet kimliği okunur", s.kind === "OK" && s.ticket === "XXXX-1234", JSON.stringify(s));
  yanit = () => Response.json({ data: { A: { status: "error", details: { error: "DeviceNotRegistered" } }, B: { status: "ok" }, C: { status: "error", details: { error: "MessageTooBig" } } } });
  const r = await t.receipts(["A", "B", "C", "D"]);
  const g = r.kind === "OK" ? r.results : new Map();
  kontrol("§1b ⭐ makbuz DeviceNotRegistered → GECERSIZ_CIHAZ; ok → OK; diğer → KALICI; yok → haritada yok", g.get("A")?.kind === "GECERSIZ_CIHAZ" && g.get("B")?.kind === "OK" && g.get("C")?.kind === "KALICI" && !g.has("D"), JSON.stringify([...g]));
  yanit = () => new Response("x", { status: 502 });
  kontrol("§1c 5xx → GECICI (makbuz düşmez)", (await t.receipts(["A"])).kind === "GECICI");
}

async function kuyrugaKoy(o: Ortam, tesisId: string, accountId: string, dedupKey: string): Promise<void> {
  await withTesis(o.goc, { tesisId }, (tx) => tx.notification.create({ data: { tesisId, accountId, kind: "geciken-siparis", dedupKey, title: "Bekçi", body: "Bekçi", nextAttemptAt: new Date(o.saat.simdi()) } }));
}

const satir = async (o: Ortam, tesisId: string, key: string) => {
  const n = (await bildirimler(o, tesisId)).find((x) => x.dedupKey === key)!;
  const due = await withTesis(o.goc, { tesisId }, (tx) => tx.notification.findFirst({ where: { tesisId, dedupKey: key }, select: { receiptDueAt: true } }));
  return { ...n, d: readDeliveries(n.deliveries), due: due?.receiptDueAt ?? null };
};
const aktif = (o: Ortam, tesisId: string, accountId: string) =>
  withTesis(o.goc, { tesisId }, (tx) => tx.pushDevice.findMany({ where: { tesisId, accountId }, orderBy: { id: "asc" }, select: { id: true, token: true, active: true } }));

async function makbuzTuru(o: Ortam, tesisId: string): Promise<void> {
  console.log("\n§2 makbuz turu");
  const h = await hesapKur(o, tesisId, IZIN);
  await ayarYaz(o, h, ayar());
  const [tok1, tok2] = [await cihazKaydet(o, h), await cihazKaydet(o, h)];
  const t = new RecordingTransport({ tickets: true });
  await kuyrugaKoy(o, tesisId, h.accountId, "makbuz:1");
  await deliverDue(o.ctx, t, tesisId, o.saat.simdi());
  let n = await satir(o, tesisId, "makbuz:1");
  kontrol("§2a bilet teslim kaydına yazılır, yoklama 15 dk sonraya kurulur", n.status === "GONDERILDI" && n.d.length === 2 && n.d.every((d) => typeof d.bilet === "string") && n.due?.getTime() === o.saat.simdi() + RECEIPT_DELAY_MS, `${n.status} ${JSON.stringify(n.d)}`);
  await checkReceipts(o.ctx, t, tesisId, o.saat.simdi());
  kontrol("§2b vadesi gelmeyen makbuz sorulmaz", t.receiptCalls.length === 0);
  o.saat.ilerlet(RECEIPT_DELAY_MS);
  const cihazlar = await aktif(o, tesisId, h.accountId);
  const bilet1 = n.d.find((d) => d.cihazId === cihazlar.find((c) => c.token === tok1)!.id)!.bilet!;
  t.forcedReceipts.set(bilet1, { kind: "GECERSIZ_CIHAZ", code: "EXPO_CIHAZ_KAYITSIZ" });
  const [a, b] = await Promise.all([checkReceipts(o.ctx, t, tesisId, o.saat.simdi()), checkReceipts(o.ctx, t, tesisId, o.saat.simdi())]);
  kontrol("§2c eşzamanlı iki tur satırı BİR kez işler (atomik claim)", a.checked + b.checked === 1 && a.invalid + b.invalid === 1, `${a.checked}+${b.checked}`);
  n = await satir(o, tesisId, "makbuz:1");
  const sonra = await aktif(o, tesisId, h.accountId);
  kontrol("§2d ⭐ makbuzda kayıtsız cihaz PASİFE, öteki etkin kalır", sonra.find((c) => c.token === tok1)?.active === false && sonra.find((c) => c.token === tok2)?.active === true);
  kontrol("§2e bildirim durumu değişmez; çözülen makbuz yazılır, hazır olmayan bekler", n.status === "GONDERILDI" && n.d.some((d) => d.makbuz === "GECERSIZ_CIHAZ:EXPO_CIHAZ_KAYITSIZ") && n.d.some((d) => d.makbuz === undefined) && n.due !== null, JSON.stringify(n.d));
  const gecici: PushTransport = { send: (x, m) => t.send(x, m), receipts: (): Promise<ReceiptBatch> => Promise.resolve({ kind: "GECICI", code: "HTTP_502" }) };
  o.saat.ilerlet(RECEIPT_DELAY_MS);
  await checkReceipts(o.ctx, gecici, tesisId, o.saat.simdi());
  n = await satir(o, tesisId, "makbuz:1");
  kontrol("§2f geçici hata makbuzu düşürmez, yeniden kurar", n.d.some((d) => d.makbuz === undefined) && n.due?.getTime() === o.saat.simdi() + RECEIPT_DELAY_MS);
  o.saat.ilerlet(RECEIPT_GIVE_UP_MS);
  await checkReceipts(o.ctx, t, tesisId, o.saat.simdi());
  n = await satir(o, tesisId, "makbuz:1");
  kontrol("§2g 24 saatte vazgeçilir: ZAMAN_ASIMI, yoklama biter", n.d.some((d) => d.makbuz === "ZAMAN_ASIMI") && n.due === null, JSON.stringify(n.d));
  const biletsiz = new RecordingTransport();
  await kuyrugaKoy(o, tesisId, h.accountId, "makbuz:biletsiz");
  await deliverDue(o.ctx, biletsiz, tesisId, o.saat.simdi());
  n = await satir(o, tesisId, "makbuz:biletsiz");
  kontrol("§2h biletsiz teslim (web / sahte kip) yoklamaya girmez — bugünkü davranış", n.status === "GONDERILDI" && n.due === null && n.d.every((d) => d.bilet === undefined));
}

async function deneme(o: Ortam, kapali: Ortam, tesisId: string): Promise<void> {
  console.log("\n§3 deneme bildirimi");
  const h = await hesapKur(o, tesisId, ["bulut:ozet:oku"]);
  const baska = await hesapKur(o, tesisId, ["bulut:ozet:oku"]);
  const cihazsiz = await hesapKur(o, tesisId, ["bulut:ozet:oku"]);
  const [iyi, kotu] = [await cihazKaydet(o, h), await cihazKaydet(o, h)];
  const yabanci = await cihazKaydet(o, baska);
  const t = o.ctx.notifications!.transport as RecordingTransport;
  t.forced.set(kotu, { kind: "GECERSIZ_CIHAZ", code: "EXPO_CIHAZ_KAYITSIZ" });
  const once = (await bildirimler(o, tesisId)).length;
  const gonder = (x: TestHesabi, ortam = o) => api(ortam, "POST", "/api/bildirim/deneme", { belirtec: x.belirtec, govde: {} });
  const r1 = await gonder(h);
  const veri = r1.json.data as { gonderilen: number; cihazlar: { sonuc: string }[] };
  const giden = t.sent.filter((x) => x.msg.title === "Deneme bildirimi").map((x) => x.target.token);
  kontrol("§3a ⭐ yalnız KENDİ etkin cihazlarına gider (başka hesabınkine değil)", r1.status === 200 && veri.gonderilen === 1 && giden.includes(iyi) && !giden.includes(yabanci), `${r1.status} ${JSON.stringify(veri)}`);
  kontrol("§3b kayıtsız cihaz pasife çekilir", (await aktif(o, tesisId, h.accountId)).find((c) => c.token === kotu)?.active === false);
  const r2 = await gonder(h);
  kontrol("§3c ⭐ dakikada bir: hemen tekrar → 429 HIZ_SINIRI", r2.status === 429 && r2.json.details?.code === "HIZ_SINIRI", `${r2.status}`);
  o.saat.ilerlet(TEST_INTERVAL_MS);
  const r3 = await gonder(h);
  kontrol("§3d pozitif: süre dolunca yeniden gönderilir", r3.status === 200 && (r3.json.data as { gonderilen: number }).gonderilen === 1, `${r3.status}`);
  const r4 = await gonder(cihazsiz);
  kontrol("§3e cihazsız hesap → 409 (CIHAZ_YOK)", r4.status === 409 && r4.json.details?.neden === "CIHAZ_YOK", `${r4.status}`);
  const kh = await hesapKur(kapali, tesisId, ["bulut:ozet:oku"]);
  const r5 = await gonder(kh, kapali);
  kontrol("§3f kip kapalıyken → 409 (BILDIRIM_KAPALI; bugünkü davranış)", r5.status === 409 && r5.json.details?.neden === "BILDIRIM_KAPALI", `${r5.status}`);
  kontrol("§3g deneme bildirim geçmişine/kuyruğuna yazılmaz", (await bildirimler(o, tesisId)).length === once);
  const iz = await withTesis(o.goc, { tesisId }, (tx) => tx.accountAudit.count({ where: { tesisId, event: "BILDIRIM_DENEME" } }));
  kontrol("§3h ayak izi account_audit'te (iki başarılı deneme)", iz === 2, String(iz));
  kontrol("§3i oturumsuz → 401", (await api(o, "POST", "/api/bildirim/deneme", { govde: {} })).status === 401);
}

async function main(): Promise<void> {
  await expoTasiyici();
  const o = await ortamKur({ BILDIRIM_KIPI: "sahte" });
  const kapali = await ortamKur();
  o.saat.ayarla(Date.parse("2026-10-01T09:00:00Z"));
  const k = await tesisKur(o);
  try {
    await makbuzTuru(o, k.tesisId);
    await deneme(o, kapali, k.tesisId);
  } finally {
    await temizleTesis(o, k.tesisId);
    await o.kapat();
    await kapali.kapat();
  }
  sonuc();
}

main().catch((e: Error) => {
  console.error(`❌ bekçi çöktü: ${e.stack ?? e.message}`);
  process.exit(1);
});
