#!/usr/bin/env node
// =============================================================================
// Satıcı portalına Mac'ten SSH üzerinden bağlanma — GERİ DÖNGÜ KİPİ (Tailscale öncesi) aracı.
// =============================================================================
// ⚠️ KALDIRILACAK (kullanıcı kararı 2026-10-04): portalın bütün işlemleri internetten (ERİŞİM, 4613); bu araç,
// 4611 dinleyicisi ve tailnet servisi internet yolu VDS'te doğrulanınca D5 diliminde kalkar. Yedek yol değildir.
// VDS'in sshd'si TCP yönlendirmeyi kapatır (`AllowTcpForwarding no`) → `ssh -L`/`-W` "administratively
// prohibited" döner. Bu araç Mac'te YALNIZ 127.0.0.1'i dinler ve her tarayıcı bağlantısı için bir SSH
// OTURUMU açıp VDS'te `nc -N <köprü> 4611` koşturur: bayt akışı SSH'in içinden portal ileticisine
// (portal-tunel) gider. Bağlantılar tek SSH ana bağlantısını paylaşır (ControlMaster) — ilk istek
// ~1 sn, sonrakiler anında. Kimlik doğrulama SSH anahtarıyla; parola sorulmaz (BatchMode).
//
// Kullanım: node deploy/satici/portal-baglan.mjs [--hedef oguzhan@80.253.255.188] [--ssh-port 2222]
//             [--kopru 172.31.253.2:4611] [--yerel-port 14611]
//   → tarayıcıda http://127.0.0.1:14611/portal/   (Ctrl+C ile kapanır)
// Runbook: docs/ops/SATICI-KURULUM.md §4a
// =============================================================================
import { spawn } from "node:child_process";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const al = (ad, varsayilan) => {
  const i = args.indexOf(ad);
  return i >= 0 && args[i + 1] ? args[i + 1] : varsayilan;
};
const hedef = al("--hedef", "oguzhan@80.253.255.188");
const sshPort = al("--ssh-port", "2222");
const kopru = al("--kopru", "172.31.253.2:4611");
const yerelPort = Number(al("--yerel-port", "14611"));

const m = /^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/.exec(kopru);
if (!m || !/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$/.test(hedef) || !/^\d{1,5}$/.test(sshPort)) {
  console.error("kullanım: portal-baglan.mjs [--hedef kullanici@makine] [--ssh-port N] [--kopru A.B.C.D:PORT] [--yerel-port N]");
  process.exit(2);
}
const [, kopruIp, kopruPort] = m;
// Unix soket yolu ≤ 104 bayt: macOS tmpdir uzun, bu yüzden ~/.ssh altında (%C = 40 hane özet).
const kontrolYolu = path.join(os.homedir(), ".ssh", "cm-tekserp-portal-%C");
const sshArgs = [
  "-p", sshPort,
  "-o", "BatchMode=yes",
  "-o", "ConnectTimeout=10",
  "-o", "ServerAliveInterval=30",
  "-o", "ControlMaster=auto",
  "-o", `ControlPath=${kontrolYolu}`,
  "-o", "ControlPersist=300",
  hedef,
  "nc", "-N", kopruIp, kopruPort,
];

const sunucu = net.createServer((yerel) => {
  const ssh = spawn("ssh", sshArgs, { stdio: ["pipe", "pipe", "inherit"] });
  const kapat = () => {
    yerel.destroy();
    ssh.kill();
  };
  yerel.on("error", kapat).on("close", () => ssh.stdin.end());
  ssh.on("error", kapat).on("exit", () => yerel.end());
  ssh.stdin.on("error", () => undefined);
  yerel.pipe(ssh.stdin);
  ssh.stdout.pipe(yerel);
});
sunucu.on("error", (err) => {
  console.error(`dinlenemedi: ${err.message}`);
  process.exit(1);
});
sunucu.listen(yerelPort, "127.0.0.1", () =>
  console.log(`portal: http://127.0.0.1:${yerelPort}/portal/  (SSH ${hedef}:${sshPort} → ${kopruIp}:${kopruPort}; Ctrl+C kapatır)`),
);
