// GÖNDERİCİ ROLÜNE GİRİŞ AÇ — kurulumda bir kez (ve parola döndürmede), SAHİP rolle (DATABASE_URL, satıcı
// imajında `satici-baslat` kurar) koşar; parola YALNIZ stdin'den okunur (argv/ortam ASLA):
//   sudo cat $K/sirlar/bildirim-db-parolasi | sudo docker compose --profile goc run --rm -T satici-goc \
//     node dist/notifications/role-cli.js
// Çıktı: rol adı + ölçülen tablo sayısı + yetki kümesi hükmü. Parola ve doğrulayıcı hiçbir yere basılmaz.
import { Client } from "pg";
import { PG_SESSION_OPTIONS } from "../lib/pg-session";
import { SENDER_ROLE, enableSenderLogin } from "./sender-role";

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) throw new Error("Parola stdin'den verilmeli (dosyadan boru: `cat <dosya> | …`); etkileşimli giriş yok");
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)));
  const text = Buffer.concat(chunks).toString("utf8").replace(/[\r\n]+$/, "");
  chunks.forEach((b) => b.fill(0));
  return text;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL yok (satici-baslat sahip rolün URL'ini kurar)");
  const role = /^--rol=(.+)$/.exec(process.argv.slice(2).find((a) => a.startsWith("--rol=")) ?? "")?.[1] ?? SENDER_ROLE;
  const password = await readStdin();
  const client = new Client({ connectionString: url, options: PG_SESSION_OPTIONS });
  await client.connect();
  try {
    const r = await enableSenderLogin(client, { role, password });
    console.log(`✅ ${role}: giriş açık · ${r.tables} tablo ölçüldü · yetki: YALNIZ bildirim SELECT + durum kolonlarında UPDATE`);
  } finally {
    await client.end();
  }
}

main().then(
  () => process.exit(0),
  (err: Error) => {
    console.error(`⛔ ${err.message}`);
    process.exit(1);
  },
);
