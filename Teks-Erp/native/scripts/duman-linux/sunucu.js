// T1 dumanının sahte backend'i: `/health/yerel` (güncelleyicinin sondası) + `/health`; `db` PG'ye gerçek erişimdir
// (pg_isready) — Docker yeniden başlatması ve PG kesintisi sağlıkta görünür. Doğrulama kipinde yalnız 127.0.0.1.
"use strict";
const http = require("http");
const { execFileSync } = require("child_process");

const surum = process.env.TEKSERP_DUMAN_SURUM;
const host = process.env.TEKSERP_DOGRULAMA_KIPI === "1" ? "127.0.0.1" : "0.0.0.0";
const db = () => {
  try {
    // Kullanıcı adı açık: imajın 10001 kullanıcısının passwd satırı yok (pg_isready "no attempt" döner).
    execFileSync("pg_isready", ["-q", "-h", "postgres", "-U", "duman", "-d", "duman", "-t", "2"], { stdio: "ignore" });
    return "UP";
  } catch {
    return "DOWN";
  }
};
const sunucu = http.createServer((q, s) => {
  if (q.url !== "/health/yerel" && q.url !== "/health") {
    s.writeHead(404).end();
    return;
  }
  const d = db();
  s.writeHead(d === "UP" ? 200 : 503, { "content-type": "application/json" });
  s.end(JSON.stringify({ status: "UP", db: d, version: surum, lisans: { kip: "NORMAL", butunluk: "GECERLI", cekirdek: "NATIVE" } }));
});
sunucu.listen(4000, host, () => console.log(`duman backend ${surum} ${host}:4000`));
process.on("SIGTERM", () => sunucu.close(() => process.exit(0)));
