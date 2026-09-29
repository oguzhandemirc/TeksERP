// `test_bildirim_gonderim` §4–§7 (dosya boyu sınırı için ayrı; `test_` öneki yok → koşucu saymaz).
import { withTesis } from "../../src/lib/tenant";
import { RecordingTransport } from "../../src/push/transports";
import { runDaily } from "../../src/services/maintenance";
import { deliverDue, MAX_ATTEMPTS } from "../../src/services/notification-sender";
import { ayar, ayarYaz, bildirimler, cihazKaydet } from "./bildirim-fikstur";
import { api, hesapKur, kontrol, type Ortam, type TestHesabi } from "./test-ortam";

const DAY = 86_400_000;
const sub = (endpoint: string) => JSON.stringify({ endpoint, keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) } });

async function kuyrugaKoy(o: Ortam, tesisId: string, accountId: string, dedupKey: string): Promise<void> {
  await withTesis(o.goc.prisma, { tesisId }, (tx) =>
    tx.notification.create({ data: { tesisId, accountId, kind: "geciken-siparis", dedupKey, title: "Bekçi", body: "Bekçi", nextAttemptAt: new Date(o.saat.simdi()) } }),
  );
}

async function ssrf(o: Ortam, h: TestHesabi): Promise<void> {
  console.log("\n§4 SSRF / belirteç biçimi");
  const yolla = (platform: string, belirtec: string) => api(o, "POST", "/api/cihazlar", { belirtec: h.belirtec, govde: { platform, belirtec } });
  const ic = await yolla("web", sub("http://127.0.0.1:4641/api/oturum"));
  const yabanci = await yolla("web", sub("https://iç-ag.ornek.test/push"));
  const ip = await yolla("web", sub("https://10.0.0.5/push"));
  const sahte = await yolla("web", sub("https://fcm.googleapis.com.saldirgan.test/x"));
  kontrol("§4a ⭐ iç ağ / http / IP / sonek hilesi web aboneliği REDDEDİLİR (400)", [ic, yabanci, ip, sahte].every((r) => r.status === 400 && r.json.details?.code === "GOVDE_GECERSIZ"), [ic, yabanci, ip, sahte].map((r) => r.status).join(","));
  kontrol("§4b Expo platformunda Expo dışı belirteç 400", (await yolla("ios", "https://ornek.test/x")).status === 400);
  kontrol("§4c pozitif: Mozilla push servisine abonelik 201", (await yolla("web", sub("https://updates.push.services.mozilla.com/wpush/v2/abc"))).status === 201);
}

async function teslim(o: Ortam, tesisId: string): Promise<void> {
  console.log("\n§5 geçersiz cihaz · geçici hata");
  const h = await hesapKur(o, tesisId, ["bulut:ozet:oku", "bulut:siparis:oku"]);
  await ayarYaz(o, h, ayar());
  const tok = await cihazKaydet(o, h);
  const t = new RecordingTransport();
  t.forced.set(tok, { kind: "GECERSIZ_CIHAZ", code: "EXPO_CIHAZ_KAYITSIZ" });
  await kuyrugaKoy(o, tesisId, h.accountId, "bekci:gecersiz");
  await deliverDue(o.ctx, t, tesisId, o.saat.simdi());
  const cihaz = await withTesis(o.goc.prisma, { tesisId }, (tx) => tx.pushDevice.findFirst({ where: { tesisId, accountId: h.accountId } }));
  const satir = (await bildirimler(o, tesisId)).find((n) => n.dedupKey === "bekci:gecersiz")!;
  kontrol("§5a ⭐ geçersiz cihaz pasife çekilir, tek cihazsa bildirim BASARISIZ", cihaz?.active === false && satir.status === "BASARISIZ", `${String(cihaz?.active)}/${satir.status}`);
  const tok2 = await cihazKaydet(o, h);
  t.forced.set(tok2, { kind: "GECICI", code: "HTTP_503" });
  await kuyrugaKoy(o, tesisId, h.accountId, "bekci:gecici");
  await deliverDue(o.ctx, t, tesisId, o.saat.simdi());
  let g = (await bildirimler(o, tesisId)).find((n) => n.dedupKey === "bekci:gecici")!;
  kontrol("§5b geçici hata → BEKLIYOR, ileri tarihli yeniden deneme", g.status === "BEKLIYOR" && g.attempts === 1 && g.nextAttemptAt.getTime() > o.saat.simdi() && g.lastError === "HTTP_503");
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    o.saat.ilerlet(2 * 3_600_000);
    await deliverDue(o.ctx, t, tesisId, o.saat.simdi());
  }
  g = (await bildirimler(o, tesisId)).find((n) => n.dedupKey === "bekci:gecici")!;
  kontrol("§5c deneme hakkı bitince BASARISIZ (sonsuz döngü yok)", g.status === "BASARISIZ" && g.attempts === MAX_ATTEMPTS, `${g.status}/${g.attempts}`);
  t.forced.delete(tok2);
  await kuyrugaKoy(o, tesisId, h.accountId, "bekci:iyi");
  await deliverDue(o.ctx, t, tesisId, o.saat.simdi());
  kontrol("§5d pozitif: sağlam cihaza gider (GONDERILDI)", (await bildirimler(o, tesisId)).find((n) => n.dedupKey === "bekci:iyi")?.status === "GONDERILDI");
}

async function ayarApi(o: Ortam, tesisId: string, yonetici: TestHesabi): Promise<void> {
  console.log("\n§6 ayar API'si");
  const uye = await hesapKur(o, tesisId, ["bulut:ozet:oku"]);
  const fazla = await api(o, "POST", "/api/bildirim/ayarlar", { belirtec: uye.belirtec, govde: { ayarlar: { ...ayar(), gizliAlan: 1 } } });
  kontrol("§6a katı şema: tanınmayan anahtar 400", fazla.status === 400 && fazla.json.details?.code === "GOVDE_GECERSIZ");
  const yetkisiz = await api(o, "POST", "/api/bildirim/tesis-varsayilani", { belirtec: uye.belirtec, govde: { ayarlar: ayar({ acik: false }) } });
  kontrol("§6b ⭐ tesis varsayılanı yönetici izni olmadan 403", yetkisiz.status === 403 && yetkisiz.json.details?.code === "YETKISIZ");
  const yetkili = await api(o, "POST", "/api/bildirim/tesis-varsayilani", { belirtec: yonetici.belirtec, govde: { ayarlar: ayar({ acik: false }) } });
  const uyeGorunum = (await api(o, "GET", "/api/bildirim/ayarlar", { belirtec: uye.belirtec })).json.data as { kaynak: string; etkin: { acik: boolean }; gonderim: string };
  kontrol("§6c pozitif: yönetici varsayılanı yazar, ayarsız hesap onu devralır", yetkili.status === 200 && uyeGorunum.kaynak === "TESIS" && uyeGorunum.etkin.acik === false && uyeGorunum.gonderim === "sahte");
  const liste = (await api(o, "GET", "/api/bildirimler", { belirtec: uye.belirtec })).json.data as { kayitlar: unknown[] };
  kontrol("§6d geçmiş yalnız kendi bildirimleri (başkasınınki yok)", Array.isArray(liste.kayitlar) && liste.kayitlar.length === 0);
}

async function budama(o: Ortam, tesisId: string, h: TestHesabi): Promise<void> {
  console.log("\n§7 budama");
  await kuyrugaKoy(o, tesisId, h.accountId, "bekci:bekleyen-eski");
  const simdi = o.saat.simdi();
  const eski = new Date(simdi - (o.ctx.config.BILDIRIM_SAKLAMA_GUN + 1) * DAY);
  await withTesis(o.goc.prisma, { tesisId }, (tx) => tx.$executeRaw`UPDATE notifications SET updated_at = ${eski}::timestamptz WHERE tesis_id = ${tesisId}::uuid`);
  await runDaily(o.ctx, simdi);
  const kalan = await bildirimler(o, tesisId);
  kontrol("§7a sonuçlanmış eski satırlar budandı", !kalan.some((n) => ["GONDERILDI", "BASARISIZ", "ATLANDI"].includes(n.status)), kalan.map((n) => n.status).join(","));
  kontrol("§7b ⭐ bekleyen satır budanmaz", kalan.some((n) => n.dedupKey === "bekci:bekleyen-eski" && n.status === "BEKLIYOR"));
}

export async function ekBolumler(o: Ortam, tesisId: string, yonetici: TestHesabi): Promise<void> {
  await ssrf(o, yonetici);
  await teslim(o, tesisId);
  await ayarApi(o, tesisId, yonetici);
  await budama(o, tesisId, yonetici);
}
