// =============================================================================
// BİLDİRİM GÖNDERİMİ BEKÇİSİ (B5) — negatif + pozitif:
//   §1 katalog kuralı: finans türü finans izni ister · tür kaynağın iznini kapsar (sentetik ihlal kırmızı)
//   §2 kip: varsayılan `kapali` (bugünkü davranış, çalışma zamanı YOK) · `gercek` VAPID konusu olmadan açılmaz
//   §3 VAPID sırrı: dosya 0600 · JSON/metin/inspect gizli anahtarı taşımaz · taşıyıcı hatası gizli anahtarı
//      içerse de günlüğe, DB'ye, API yanıtına DÜŞMEZ · yeniden yüklemede üstüne yazılmaz
//   §4 SSRF: web aboneliği yalnız izinli push servisine; Expo belirteci biçimi
//   §5 geçersiz cihaz pasife · geçici hata yeniden denenir, hak bitince BASARISIZ
//   §6 ayar API'si: katı şema · tesis varsayılanı yalnız yönetici · geçmiş yalnız kendi
//   §7 budama: sonuçlanmış eski satır budanır, bekleyen kalır
// Koşum: npx tsx scripts/test_bildirim_gonderim.ts
// =============================================================================
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { inspect } from "node:util";
import webpush from "web-push";
import { catalogProblems, KIND_RULES } from "../src/catalog/notifications";
import { loadConfig } from "../src/config";
import { WebPushTransport } from "../src/push/transports";
import { VAPID_KEY_FILE, VapidKeys } from "../src/push/vapid";
import { createNotificationRuntime } from "../src/services/notification-scheduler";
import { ayar, ayarYaz, anlikYaz, bildirimler, GECIKEN, tur } from "./lib/bildirim-fikstur";
import { ekBolumler } from "./lib/bildirim-gonderim-ek";
import { api, hesapKur, kontrol, ortamKur, PATRON_KOKU, sonuc, temizleTesis, tesisKur } from "./lib/test-ortam";

const FCM = (id: string) => JSON.stringify({ endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) } });

function katalogVeKip(): void {
  console.log("\n§1 katalog");
  kontrol("§1a gerçek katalog tutarlı", catalogProblems().length === 0, catalogProblems().join("; ") || "temiz");
  const finansIzinsiz = catalogProblems({ ...KIND_RULES, "cek-vadesi": { ...KIND_RULES["cek-vadesi"], source: null, permissions: ["bulut:ozet:oku"] } });
  kontrol("§1b ⭐ finans türü finans izni istemiyorsa KIRMIZI", finansIzinsiz.some((p) => p.includes("finans türü")), finansIzinsiz.join("; "));
  const kaynakKapsamaz = catalogProblems({ ...KIND_RULES, "stok-esigi": { ...KIND_RULES["stok-esigi"], permissions: ["bulut:ozet:oku"] } });
  kontrol("§1c ⭐ tür kaynağın iznini kapsamıyorsa KIRMIZI", kaynakKapsamaz.some((p) => p.includes("kapsanmıyor")), kaynakKapsamaz.join("; "));

  console.log("\n§2 kip");
  const env = { DATABASE_URL: "x", ESITLEME_DATABASE_URL: "y" };
  const kapali = loadConfig(env, PATRON_KOKU);
  kontrol("§2a ⭐ varsayılan kip `kapali` → çalışma zamanı YOK (bugünkü davranış)", kapali.BILDIRIM_KIPI === "kapali" && createNotificationRuntime(kapali) === null);
  let red = "";
  try {
    loadConfig({ ...env, BILDIRIM_KIPI: "gercek" }, PATRON_KOKU);
  } catch (e) {
    red = (e as Error).message;
  }
  kontrol("§2b `gercek` VAPID konusu olmadan AÇILMAZ (fail-closed)", red.includes("BILDIRIM_VAPID_KONU"), red.slice(0, 120));
  kontrol("§2c pozitif: konu verilince açılır", loadConfig({ ...env, BILDIRIM_KIPI: "gercek", BILDIRIM_VAPID_KONU: "mailto:bildirim@ornek.test" }, PATRON_KOKU).BILDIRIM_KIPI === "gercek");
}

async function main(): Promise<void> {
  katalogVeKip();
  const o = await ortamKur({ BILDIRIM_KIPI: "sahte" });
  o.saat.ayarla(Date.parse("2026-10-01T09:00:00Z"));
  const k = await tesisKur(o);
  const dizin = mkdtempSync(path.join(os.tmpdir(), "patron-vapid-"));
  const kayitlar: string[] = [];
  const asil = { log: console.log, error: console.error, warn: console.warn };
  try {
    console.log("\n§3 VAPID sırrı");
    const v = VapidKeys.load(dizin, { create: true });
    const dosya = path.join(dizin, VAPID_KEY_FILE);
    const gizli = (JSON.parse(readFileSync(dosya, "utf8")) as { privateKey: string }).privateKey;
    kontrol("§3a anahtar dosyası 0600", (statSync(dosya).mode & 0o777) === 0o600, (statSync(dosya).mode & 0o777).toString(8));
    const yuzeyler = [JSON.stringify(v), String(v), inspect(v), JSON.stringify({ v })];
    kontrol("§3b ⭐ JSON/metin/inspect gizli anahtarı TAŞIMAZ", yuzeyler.every((y) => !y.includes(gizli)) && JSON.stringify(v).includes(v.publicKey));
    kontrol("§3c yeniden yüklemede anahtar değişmez (üstüne yazılmaz)", VapidKeys.load(dizin, { create: true }).publicKey === v.publicKey);
    const yonetici = await hesapKur(o, k.tesisId, ["bulut:ozet:oku", "bulut:siparis:oku", "bulut:hesap:yonet"]);
    const webTok = FCM("bekci-web-1");
    const kayit = await api(o, "POST", "/api/cihazlar", { belirtec: yonetici.belirtec, govde: { platform: "web", belirtec: webTok } });
    kontrol("§3d pozitif: izinli servise web aboneliği kaydolur", kayit.status === 201, String(kayit.status));
    await ayarYaz(o, yonetici, ayar());
    await anlikYaz(o, k.tesisId, "ozet.siparis", GECIKEN(4));
    const orijinal = webpush.sendNotification;
    (webpush as { sendNotification: unknown }).sendNotification = () => Promise.reject(Object.assign(new Error(`vapid ${gizli} reddedildi`), { statusCode: 403, body: gizli }));
    for (const k2 of ["log", "error", "warn"] as const) console[k2] = (...a: unknown[]) => void kayitlar.push(a.map(String).join(" "));
    try {
      await tur(o, k.tesisId, new WebPushTransport(v, "mailto:bildirim@ornek.test"));
    } finally {
      Object.assign(console, asil);
      (webpush as { sendNotification: unknown }).sendNotification = orijinal;
    }
    const satir = (await bildirimler(o, k.tesisId)).at(-1)!;
    const ayarYaniti = JSON.stringify((await api(o, "GET", "/api/bildirim/ayarlar", { belirtec: yonetici.belirtec })).json);
    kontrol("§3e ⭐ taşıyıcı hatası gizli anahtarı içerse de günlüğe DÜŞMEZ", kayitlar.every((l) => !l.includes(gizli)), `${kayitlar.length} satır`);
    kontrol("§3f ⭐ DB satırı (hata kodu + teslim) gizli anahtarı taşımaz; kısa kod yazılır", satir.status === "BASARISIZ" && satir.lastError === "HTTP_403" && !JSON.stringify(satir).includes(gizli), `${satir.status}/${satir.lastError}`);
    kontrol("§3g API yanıtı yalnız AÇIK anahtarı verir", ayarYaniti.includes("webPushAnahtari") && !ayarYaniti.includes(gizli));
    await ekBolumler(o, k.tesisId, yonetici);
  } finally {
    Object.assign(console, asil);
    rmSync(dizin, { recursive: true, force: true });
    await temizleTesis(o, k.tesisId);
    await o.kapat();
  }
  sonuc();
}

main().catch((e: Error) => {
  console.error(`❌ bekçi çöktü: ${e.stack ?? e.message}`);
  process.exit(1);
});
