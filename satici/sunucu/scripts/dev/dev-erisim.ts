// Yerel geliştirme düzeneği (npm run dev:erisim): sahte Access takımı + JWKS + jeton basar, satıcı sunucusunun
// ERİŞİM ayarlarını ve vite vekilinin jetonunu yazdırır. scripts/dev altında durur ki üretim imajına (dist-cli) girmesin.
// Betik açık kaldıkça JWKS dosyası durur (kapanınca silinir) — satıcı sunucusunu o ortamla başlat.
import { erisimJetonu, erisimOrtami } from "../lib/erisim-duzenegi";

const OMUR_SN = 12 * 3600;
const ortam = erisimOrtami();
const dev = { ...ortam, PORT_ERISIM: "4613" };

console.log("# satici/sunucu/.env (ya da süreç ortamı) için:");
for (const [k, v] of Object.entries(dev)) console.log(`${k}=${v}`);
console.log("\n# satici/web vekili için (12 saat geçerli; süre dolunca betiği yeniden başlat):");
console.log(`SATICI_ERISIM_URL=http://127.0.0.1:4613`);
console.log(`SATICI_ERISIM_JETON=${erisimJetonu({ omurSn: OMUR_SN })}`);
console.log("\nKapatmak için Ctrl+C (JWKS dosyası silinir).");
for (const sinyal of ["SIGINT", "SIGTERM"] as const) process.on(sinyal, () => process.exit(0));
setInterval(() => undefined, 1 << 30);
