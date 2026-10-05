// =============================================================================
// VEKİL GÜVENİ (DB'siz): hız sınırı anahtarı ve denetimdeki istemci adresi vekil başlığını YALNIZ güvenilen
// kenardan (Cloudflare; iç vekil Traefik ise XFF son halkası) gelen bağlantıda okur.
//   §1 doğrudan kökene gelen istek sahte `cf-connecting-ip` ile adres seçemez (✓K: eski koşulsuz okuma ısırır)
//   §2 Cloudflare'den (doğrudan ya da Traefik üzerinden) gelen istekte başlık okunur
//   §3 başlık sahteciliğiyle giriş hız sınırı atlanamaz; gerçek ayrı istemciler ayrı kova
//   §4 yapılandırma: biçimsiz CIDR açılışı durdurur · compose başlığı iç vekil ağıyla birlikte verir
// Koşum: npx tsx scripts/test_vekil_guveni.ts   (DB GEREKMEZ)
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Request, Response } from "express";
import { loadConfig } from "../src/config";
import { clientAddress, rateLimit } from "../src/http/rate-limit";

let gecti = 0;
let kaldi = 0;
function kontrol(ad: string, kosul: boolean, ayrinti = ""): void {
  if (kosul) gecti++;
  else kaldi++;
  console.log(`  ${kosul ? "✅" : "❌"} ${ad}${ayrinti ? ` — ${ayrinti}` : ""}`);
}

const TABAN = { DATABASE_URL: "postgresql://x/y", ESITLEME_DATABASE_URL: "postgresql://x/z" };
const KENAR = "172.31.250.0/28";
const TRAEFIK = "172.31.250.2";
const CF = "172.70.1.9"; // 172.64.0.0/13 içinde
const SALDIRGAN = "203.0.113.7";

const cfg = (ek: Record<string, string>) => loadConfig({ ...TABAN, ...ek } as NodeJS.ProcessEnv, process.cwd());
const istek = (soket: string, basliklar: Record<string, string> = {}) =>
  ({ headers: basliklar, socket: { remoteAddress: soket } }) as unknown as Request;
/** Eski davranış (başlık koşulsuz): sondanın kıyas tabanı. */
const eskiAdres = (req: Request, baslik: string): string => (req.headers[baslik] as string | undefined)?.split(",")[0]!.trim() ?? req.socket.remoteAddress ?? "?";

function bolum1ve2(): void {
  console.log("\n§1–§2 adres seçimi");
  const dogrudan = cfg({ VEKIL_IP_BASLIGI: "cf-connecting-ip" });
  const sahte = istek(SALDIRGAN, { "cf-connecting-ip": "198.51.100.1" });
  kontrol("§1a ✓K sonda: eski koşulsuz okuma sahte adresi kabul ederdi", eskiAdres(sahte, "cf-connecting-ip") === "198.51.100.1");
  kontrol("§1b doğrudan bağlantıda sahte başlık yok sayılır", clientAddress(sahte, dogrudan) === SALDIRGAN, clientAddress(sahte, dogrudan));
  kontrol("§2a Cloudflare soketinden gelen başlık okunur", clientAddress(istek(CF, { "cf-connecting-ip": "198.51.100.1" }), dogrudan) === "198.51.100.1");
  kontrol("§2b başlık yapılandırılmamışsa soket adresi", clientAddress(istek(CF, { "cf-connecting-ip": "198.51.100.1" }), cfg({})) === CF);

  const traefik = cfg({ VEKIL_IP_BASLIGI: "cf-connecting-ip", IC_VEKIL_AGLARI: KENAR });
  kontrol(
    "§2c Traefik üzerinden, XFF son halkası Cloudflare → başlık okunur",
    clientAddress(istek(`::ffff:${TRAEFIK}`, { "cf-connecting-ip": "198.51.100.1", "x-forwarded-for": `198.51.100.1, ${CF}` }), traefik) === "198.51.100.1",
  );
  const kokene = istek(TRAEFIK, { "cf-connecting-ip": "198.51.100.1", "x-forwarded-for": `${CF}, ${SALDIRGAN}` });
  kontrol("§1c Traefik üzerinden kökene doğrudan: sahte XFF ön halkası ve başlık yok sayılır, son halka sayılır", clientAddress(kokene, traefik) === SALDIRGAN, clientAddress(kokene, traefik));
  kontrol("§1d iç vekil ağı verilmemişse Traefik'ten gelen başlık okunmaz (Traefik Cloudflare değil)", clientAddress(kokene, dogrudan) === TRAEFIK);
}

function bolum3(): void {
  console.log("\n§3 giriş hız sınırı");
  const config = cfg({ VEKIL_IP_BASLIGI: "cf-connecting-ip", IC_VEKIL_AGLARI: KENAR });
  const sinir = rateLimit({ perMinute: 3, config });
  const kos = (req: Request): number => {
    let durum = 200;
    const res = { set: () => res, status: (s: number) => ((durum = s), res), json: () => res } as unknown as Response;
    sinir(req, res, () => undefined);
    return durum;
  };
  const sonuclar: number[] = [];
  for (let i = 0; i < 5; i++) sonuclar.push(kos(istek(TRAEFIK, { "cf-connecting-ip": `198.51.100.${i + 10}`, "x-forwarded-for": SALDIRGAN })));
  kontrol("§3a başlığı her istekte değiştiren saldırgan sınıra takılır (4. istekte 429)", sonuclar.join(",") === "200,200,200,429,429", sonuclar.join(","));
  const gercek: number[] = [];
  for (let i = 0; i < 5; i++) gercek.push(kos(istek(TRAEFIK, { "cf-connecting-ip": `198.51.100.${i + 50}`, "x-forwarded-for": CF })));
  kontrol("§3b Cloudflare'den gelen ayrı istemciler ayrı kova (paylaşılan Traefik adresinde birleşmez)", gercek.every((d) => d === 200), gercek.join(","));
}

function bolum4(): void {
  console.log("\n§4 yapılandırma");
  let hata = "";
  try {
    cfg({ IC_VEKIL_AGLARI: "172.31.250.0/33" });
  } catch (e) {
    hata = e instanceof Error ? e.message : String(e);
  }
  kontrol("§4a biçimsiz CIDR açılışı durdurur", hata.includes("IC_VEKIL_AGLARI"), hata.slice(0, 80));
  kontrol("§4b varsayılan: iç vekil yok, güvenilen kenar = Cloudflare", cfg({}).IC_VEKIL_AGLARI.length === 0 && cfg({}).GUVENILIR_VEKIL_AGLARI === undefined);
  const compose = readFileSync(path.resolve(__dirname, "../../../deploy/patron/docker-compose.yml"), "utf8");
  const baslik = /^\s*VEKIL_IP_BASLIGI:/m.test(compose);
  const ic = /^\s*IC_VEKIL_AGLARI:\s*\$\{KENAR_AGI\}\s*$/m.test(compose);
  kontrol("§4c compose vekil başlığını iç vekil ağıyla (KENAR_AGI) birlikte verir — yoksa herkes Traefik adresinde tek kova", !baslik || ic);
}

bolum1ve2();
bolum3();
bolum4();
console.log(`\n=== Sonuç: ${gecti} geçti, ${kaldi} başarısız ===`);
process.exit(kaldi > 0 ? 1 : 0);
