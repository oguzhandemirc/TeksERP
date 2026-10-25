// =============================================================================
// BİLDİRİM — PATRON TELEFON PUSH BEKÇİSİ (bildirim v2 F5 hazırlığı, N5-PATRON) — DB GEREKTİRMEZ
//   §1 ⭐ native yük İÇERİKSİZ: anahtarlar yalnız `NATIVE_PAYLOAD_KEYS`, `data` yalnız {bildirimId, rota, tesisId}; `body` YOK
//   §2 ⭐ iş verisi sızmaz: tutar, müşteri adı, belge numarası, gövde metni yükte (JSON'un hiçbir yerinde) geçmez;
//      başlık katalog etiketidir (olay başlığı değil); her katalog türünün etiketi rakamsız
//   §3 Expo taşıyıcısının ağa yazdığı gövde = kurucunun yükü (sahte fetch; gerçek gönderim YOK)
//   §4 ⭐ bayrak kapalı (varsayılan) → telefon hedefine istek ATILMAZ (KALICI `NATIVE_PUSH_KAPALI`); web push aynen
//   §5 ⭐ yapılandırma yoksa sessiz fail-closed: `acik` + belirteç yok / kip gerçek değil → kapalı + TEK satır günlük
//      (sır değeri günlükte yok); `gercek` kip çalışma zamanı bayrak kapalıyken fetch'e hiç dokunmaz
// Koşum: npx tsx scripts/test_bildirim_patron_push.ts
//
// NEGATİF SONDA (2026-10-25, md5 ile birebir geri alındı):
//   S1 `nativePushPayload`a `body: msg.body` eklendi            ⇒ 4 ❌ (§1 · §2 · §2c · §3)
//   S2 `RoutingTransport.send` native kapısı yok sayıldı        ⇒ 3 ❌ (§4 · §4c · §5c)
// =============================================================================
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { KIND_RULES } from "../src/catalog/notifications";
import type { CloudConfig } from "../src/config";
import {
  ExpoTransport,
  NATIVE_DATA_KEYS,
  NATIVE_PAYLOAD_KEYS,
  RoutingTransport,
  nativePushPayload,
  type PushMessage,
  type PushOutcome,
  type PushTarget,
  type PushTransport,
} from "../src/push/transports";
import { createNotificationRuntime, nativePushState } from "../src/services/notification-scheduler";
import { NOTIFICATION_KINDS } from "../src/wire/api";

let gecen = 0;
let kalan = 0;
function kontrol(ad: string, kosul: boolean, ayrinti = ""): void {
  if (kosul) { gecen++; console.log(`✅ ${ad}`); }
  else { kalan++; console.error(`❌ ${ad}${ayrinti ? ` — ${ayrinti}` : ""}`); }
}

const ANDROID: PushTarget = { platform: "ANDROID", token: "ExponentPushToken[sonda]" };
const WEB: PushTarget = { platform: "WEB", token: "{}" };
const TESIS = "00000000-0000-4000-8000-000000000001";
// İş verisi taşıyan olay: hiçbir parçası telefona gitmemeli.
const IS_VERISI = { musteri: "ACME Tekstil", tutar: "45.000,00", belge: "IRS-2026-000123" };
const DOLU: PushMessage = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "cek-vadesi",
  title: `${IS_VERISI.musteri} çeki ${IS_VERISI.tutar} TL`,
  body: `${IS_VERISI.musteri} — ${IS_VERISI.tutar} TL, irsaliye ${IS_VERISI.belge}`,
  route: "/finans",
  tesisId: TESIS,
};

class Casus implements PushTransport {
  readonly cagri: PushTarget[] = [];
  send(t: PushTarget): Promise<PushOutcome> { this.cagri.push(t); return Promise.resolve({ kind: "OK" }); }
}

async function main(): Promise<void> {
  console.log("=== PATRON TELEFON PUSH (içeriksiz yük + bayrak) ===\n");

  // ── §1 anahtar kümesi ─────────────────────────────────────────────────────
  const y = nativePushPayload(ANDROID, DOLU) as Record<string, unknown>;
  kontrol("§1 ⭐ yük anahtarları yalnız to/title/sound/priority/data (body YOK)",
    JSON.stringify(Object.keys(y).sort()) === JSON.stringify([...NATIVE_PAYLOAD_KEYS].sort()) && !("body" in y), Object.keys(y).join(","));
  const data = y.data as Record<string, unknown>;
  kontrol("§1b data anahtarları yalnız bildirimId/rota/tesisId",
    JSON.stringify(Object.keys(data).sort()) === JSON.stringify([...NATIVE_DATA_KEYS].sort()) && data.bildirimId === DOLU.id, Object.keys(data).join(","));

  // ── §2 iş verisi ──────────────────────────────────────────────────────────
  const metin = JSON.stringify(y);
  const sizan = [...Object.values(IS_VERISI), DOLU.body, "45"].filter((p) => metin.includes(p));
  kontrol("§2 ⭐ tutar · müşteri adı · belge no · gövde yükte YOK", sizan.length === 0, sizan.join(" | "));
  const etiketler = NOTIFICATION_KINDS.map((k) => ({ k, b: (nativePushPayload(ANDROID, { ...DOLU, kind: k }) as { title: string }).title }));
  kontrol("§2b başlık = katalog etiketi (olay başlığı değil), etiket rakamsız",
    etiketler.every(({ k, b }) => b === KIND_RULES[k].label && !/\d/.test(b)), JSON.stringify(etiketler.filter(({ k, b }) => b !== KIND_RULES[k].label || /\d/.test(b))));
  const deneme = nativePushPayload(ANDROID, { id: "d", title: "Deneme bildirimi", body: "gövde", route: null, tesisId: TESIS }) as Record<string, unknown>;
  kontrol("§2c türsüz (deneme) ileti: sabit başlık kalır, gövde yine yok", deneme.title === "Deneme bildirimi" && !("body" in deneme));

  // ── §3 ağa yazılan gövde ──────────────────────────────────────────────────
  let govde = "";
  const sahteFetch = ((_u: unknown, init?: { body?: unknown }) => {
    govde = String(init?.body ?? "");
    return Promise.resolve(new Response(JSON.stringify({ data: [{ status: "ok", id: "bilet-1" }] }), { status: 200 }));
  }) as typeof fetch;
  const expo = new ExpoTransport({ EXPO_PUSH_URL: "https://exp.ornek.invalid/send", EXPO_MAKBUZ_URL: "https://exp.ornek.invalid/r", EXPO_ERISIM_BELIRTECI: undefined }, sahteFetch);
  await expo.send(ANDROID, DOLU);
  kontrol("§3 Expo'ya giden gövde = içeriksiz kurucu yükü", govde === JSON.stringify([nativePushPayload(ANDROID, DOLU)]) && !govde.includes(IS_VERISI.musteri), govde.slice(0, 200));

  // ── §4 bayrak kapalı ──────────────────────────────────────────────────────
  const e = new Casus();
  const w = new Casus();
  const kapali = new RoutingTransport(e, w);
  const s1 = await kapali.send(ANDROID, DOLU);
  await kapali.send({ platform: "IOS", token: "ExponentPushToken[ios]" }, DOLU);
  kontrol("§4 ⭐ varsayılan (kapalı): telefon hedefine istek yok, KALICI NATIVE_PUSH_KAPALI",
    e.cagri.length === 0 && s1.kind === "KALICI" && s1.code === "NATIVE_PUSH_KAPALI", `${e.cagri.length} çağrı, ${JSON.stringify(s1)}`);
  await kapali.send(WEB, DOLU);
  kontrol("§4b web push bayraktan bağımsız sürer", w.cagri.length === 1);
  const acik = new RoutingTransport(e, w, true);
  await acik.send(ANDROID, DOLU);
  kontrol("§4c pozitif: bayrak açıkken telefon hedefi Expo'ya gider", e.cagri.length === 1);

  // ── §5 yapılandırma ve fail-closed ────────────────────────────────────────
  const BELIRTEC = "sonda-belirteci-0123456789";
  const durum = (c: Partial<CloudConfig>) => nativePushState({ BILDIRIM_KIPI: "gercek", BILDIRIM_NATIVE_PUSH: "kapali", EXPO_ERISIM_BELIRTECI: undefined, ...c } as CloudConfig);
  kontrol("§5 bayrak verilmemiş → kapalı, günlüksüz", !durum({}).acik && durum({}).neden === null);
  kontrol("§5b `acik` ama belirteç yok / kip gerçek değil → kapalı + neden",
    !durum({ BILDIRIM_NATIVE_PUSH: "acik" }).acik && !!durum({ BILDIRIM_NATIVE_PUSH: "acik" }).neden
    && !durum({ BILDIRIM_NATIVE_PUSH: "acik", BILDIRIM_KIPI: "sahte", EXPO_ERISIM_BELIRTECI: BELIRTEC }).acik
    && durum({ BILDIRIM_NATIVE_PUSH: "acik", EXPO_ERISIM_BELIRTECI: BELIRTEC }).acik);

  const dizin = mkdtempSync(path.join(os.tmpdir(), "n5-vapid-"));
  const loglar: string[] = [];
  const asilLog = console.log;
  const asilFetch = globalThis.fetch;
  let fetchSayisi = 0;
  globalThis.fetch = (() => { fetchSayisi++; return Promise.reject(new Error("ağ yok")); }) as typeof fetch;
  console.log = (...a: unknown[]) => { loglar.push(a.map(String).join(" ")); };
  try {
    const cfg = (n: Partial<CloudConfig>) => ({ ANAHTAR_DIZINI: dizin, BILDIRIM_KIPI: "gercek", BILDIRIM_VAPID_KONU: "mailto:sonda@ornek.invalid", BILDIRIM_NATIVE_PUSH: "kapali", EXPO_PUSH_URL: "https://exp.ornek.invalid/s", EXPO_MAKBUZ_URL: "https://exp.ornek.invalid/r", EXPO_ERISIM_BELIRTECI: undefined, ...n }) as CloudConfig;
    const rt = createNotificationRuntime(cfg({}));
    const sonuc = await rt!.transport.send(ANDROID, DOLU);
    const sessizLog = loglar.length;
    createNotificationRuntime(cfg({ BILDIRIM_NATIVE_PUSH: "acik" }));
    const rt3 = createNotificationRuntime(cfg({ BILDIRIM_NATIVE_PUSH: "acik", EXPO_ERISIM_BELIRTECI: BELIRTEC }));
    console.log = asilLog;
    kontrol("§5c ⭐ gerçek kip + bayrak kapalı: telefon gönderimi fetch'e hiç dokunmaz",
      sonuc.kind === "KALICI" && fetchSayisi === 0 && sessizLog === 0, `${JSON.stringify(sonuc)} fetch=${fetchSayisi} log=${sessizLog}`);
    kontrol("§5d `acik` + belirteç yok → TEK satır günlük, çökme yok; belirteç değeri hiçbir günlükte yok",
      loglar.length === 1 && /native=kapali/.test(loglar[0]!) && !loglar.some((l) => l.includes(BELIRTEC)) && !!rt3, JSON.stringify(loglar));
  } finally {
    console.log = asilLog;
    globalThis.fetch = asilFetch;
    rmSync(dizin, { recursive: true, force: true });
  }

  console.log(`\n=== Sonuç: ${gecen} geçti, ${kalan} başarısız ===`);
  process.exit(kalan > 0 ? 1 : 0);
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
