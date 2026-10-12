// =============================================================================
// GÜVENLİK BİLDİRİMİ (patron, Bölge 7 B3) — olay → AYRI güvenlik Telegram sohbeti; Telegram SAHTE (yerel fetch; ağ yok).
//   §1 ayna: alarm çekirdeği satıcınınkiyle BAYT-EŞİT (eşik · birleştirme · günlük özet tek kaynak davranır)
//   §2 teslim: eşikte TEK ileti, pencere içi olaylar pencere sonunda TEK iletide sayaçla; ileti sır/adres taşımaz
//   §3 kanal kapalı: belirteç ya da sohbet kimliği yoksa gönderim YOK (sessiz), özet "güvenlik bildirimi: KAPALI"
//   §4 yapılandırma: aynı belirteçle ayrı sohbet; biçimsiz değer / düz http (geri döngü dışı) KAPALI; sır dosyası
//      İSTEĞE BAĞLI: yok ya da /dev/null → KAPALI ('boş'), dolu dosya → AÇIK
//   §5 olay yerleri: her sınıfın üretim kodunda en az bir `securityEvent` çağrısı (ya da açılış raporu) var
// NEGATİF SONDA (dosya DIŞI, geri alındı): N1 çekirdekte açık pencere yok sayılır → §1a/§2b ❌ · N2 sohbet kimliği yokken
//   varsayılan sohbete düşer → §3a/§3b ❌.
// Koşum: npx tsx scripts/test_guvenlik_bildirimi.ts   (DB'ye dokunmaz)
// =============================================================================
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  SECURITY_CLASSES,
  SECURITY_WINDOW_MS,
  resetSecurityEventsForTest,
  securityChannelFrom,
  securityChannelSummary,
  securityEvent,
  securityTick,
  startSecurityAlerts,
} from "../src/lib/security-events";
import { kontrol, sonuc } from "./lib/test-ortam";

const T0 = Date.UTC(2026, 9, 12, 9, 0, 0);
const TOKEN = `123456:${"A".repeat(35)}`;

function ayna(): void {
  console.log("§1 ayna");
  const a = readFileSync(path.join(__dirname, "../src/lib/guvenlik-alarm.ts"));
  const b = readFileSync(path.join(__dirname, "../../../satici/sunucu/src/lib/guvenlik-alarm.ts"));
  kontrol("§1a alarm çekirdeği satıcıyla bayt-eşit", a.equals(b), `${a.length} / ${b.length} bayt`);
}

async function teslim(): Promise<void> {
  console.log("§2 teslim");
  const giden: { url: string; body: { chat_id: string; text: string } }[] = [];
  const sahte = (async (url: string, init: { body: string }) => {
    giden.push({ url, body: JSON.parse(init.body) as { chat_id: string; text: string } });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
  const st = securityChannelFrom({ GUVENLIK_TELEGRAM_BOT_TOKEN: TOKEN, GUVENLIK_TELEGRAM_CHAT_ID: "-1009" }, sahte);
  if (!st.ok) throw new Error(`kanal açılmadı: ${st.reason}`);
  resetSecurityEventsForTest(T0, st.send);
  for (let i = 0; i < 12; i++) securityEvent("IMZA_RED", "IMZA_GECERSIZ", T0 + i * 1000);
  await new Promise((r) => setTimeout(r, 50));
  kontrol("§2a eşikte (10/dk) TEK ileti, güvenlik sohbetine", giden.length === 1 && giden[0]?.body.chat_id === "-1009" && giden[0].body.text.includes("GÜVENLİK"), `ileti ${giden.length}`);
  securityTick(T0 + SECURITY_WINDOW_MS + 10_000);
  await new Promise((r) => setTimeout(r, 50));
  const birlesik = giden.filter((g) => g.body.text.includes("2 olay daha"));
  kontrol("§2b pencere sonunda TEK birleşik ileti (sayaç 2) + günlük özet", birlesik.length === 1 && giden.filter((g) => g.body.text.includes("Günlük güvenlik özeti")).length === 1, `ileti ${giden.length}`);
  kontrol("§2c ileti belirteç/adres taşımaz", giden.every((g) => !g.body.text.includes(TOKEN) && !/\d+\.\d+\.\d+\.\d+/.test(g.body.text)));
}

async function kapali(): Promise<void> {
  console.log("§3 kanal kapalı");
  let cagri = 0;
  const sahte = (async () => {
    cagri++;
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  const st = securityChannelFrom({ GUVENLIK_TELEGRAM_BOT_TOKEN: TOKEN }, sahte);
  resetSecurityEventsForTest(T0);
  const dur = startSecurityAlerts(st);
  for (let i = 0; i < 5; i++) securityEvent("GIRIS_KILIT", null, T0 + i);
  securityTick(T0 + 2 * SECURITY_WINDOW_MS);
  await new Promise((r) => setTimeout(r, 50));
  dur();
  kontrol("§3a sohbet kimliği yokken gönderim YOK (sessiz)", !st.ok && cagri === 0, `çağrı ${cagri}`);
  kontrol("§3b özet: güvenlik bildirimi: KAPALI", securityChannelSummary(st).startsWith("güvenlik bildirimi: KAPALI (GUVENLIK_TELEGRAM_CHAT_ID yok"), securityChannelSummary(st));
}

function yapilandirma(): void {
  console.log("§4 yapılandırma");
  kontrol("§4a biçimsiz sohbet kimliği KAPALI", !securityChannelFrom({ GUVENLIK_TELEGRAM_BOT_TOKEN: TOKEN, GUVENLIK_TELEGRAM_CHAT_ID: "abc" }).ok);
  kontrol("§4b biçimsiz belirteç KAPALI", !securityChannelFrom({ GUVENLIK_TELEGRAM_BOT_TOKEN: "x", GUVENLIK_TELEGRAM_CHAT_ID: "-1" }).ok);
  kontrol("§4c düz http yalnız geri döngü", !securityChannelFrom({ GUVENLIK_TELEGRAM_BOT_TOKEN: TOKEN, GUVENLIK_TELEGRAM_CHAT_ID: "-1", GUVENLIK_TELEGRAM_API_KOKU: "http://ornek.com" }).ok);
  // Sır dosyaları İSTEĞE BAĞLI: compose değişken yoksa /dev/null bağlar → KAPALI ("boş"), açılış sürer; dosya doluysa AÇIK.
  const yok = securityChannelFrom({});
  kontrol("§4d değişken/dosya hiç yok → KAPALI (yok)", !yok.ok && /GUVENLIK_TELEGRAM_BOT_TOKEN yok/.test(securityChannelSummary(yok)), securityChannelSummary(yok));
  const bos = securityChannelFrom({ GUVENLIK_TELEGRAM_BOT_TOKEN_DOSYASI: "/dev/null", GUVENLIK_TELEGRAM_CHAT_ID_DOSYASI: "/dev/null" });
  kontrol("§4e /dev/null bağı → KAPALI, gerekçe 'boş' ('herkese okunur' DEĞİL)", !bos.ok && /_DOSYASI boş/.test(securityChannelSummary(bos)) && !/herkese/.test(securityChannelSummary(bos)), securityChannelSummary(bos));
  const d = mkdtempSync(path.join(os.tmpdir(), "patron-guvenlik-"));
  try {
    writeFileSync(path.join(d, "t"), `${TOKEN}\n`);
    writeFileSync(path.join(d, "c"), "-1009\n");
    chmodSync(path.join(d, "t"), 0o440);
    chmodSync(path.join(d, "c"), 0o440);
    const acik = securityChannelFrom({ GUVENLIK_TELEGRAM_BOT_TOKEN_DOSYASI: path.join(d, "t"), GUVENLIK_TELEGRAM_CHAT_ID_DOSYASI: path.join(d, "c") });
    kontrol("§4f dolu sır dosyaları (0440) → AÇIK", acik.ok, securityChannelSummary(acik));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}

function olayYerleri(): void {
  console.log("§5 olay yerleri");
  const metin: string[] = [];
  const gez = (d: string): void => {
    for (const ad of readdirSync(d)) {
      const p = path.join(d, ad);
      if (statSync(p).isDirectory()) gez(p);
      else if (p.endsWith(".ts") && !p.endsWith("security-events.ts")) metin.push(readFileSync(p, "utf8"));
    }
  };
  gez(path.join(__dirname, "../src"));
  const hepsi = metin.join("\n");
  const eksik = SECURITY_CLASSES.filter((c) => !new RegExp(`securityEvent\\([^;]*"${c}"|sinif: "${c}"`).test(hepsi));
  kontrol("§5a her güvenlik sınıfının üretimde olay yeri var", eksik.length === 0, eksik.join(",") || `${SECURITY_CLASSES.length} sınıf`);
}

async function main(): Promise<void> {
  try {
    ayna();
    await teslim();
    await kapali();
    yapilandirma();
    olayYerleri();
  } catch (err) {
    kontrol("beklenmeyen hata", false, err instanceof Error ? (err.stack ?? err.message) : String(err));
  } finally {
    resetSecurityEventsForTest(Date.now());
  }
  sonuc();
}

void main();
