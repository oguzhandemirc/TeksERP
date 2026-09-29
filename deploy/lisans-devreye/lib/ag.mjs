// Lisans devreye alma betiklerinin TEK ağ boğazı: kuru kipte hiçbir bağlantı açılmaz, yalnız plan basılır;
// `--olc` ile bile yalnız OKUMA gider (HTTP GET/HEAD, ssh/PowerShell'de salt-okuma komutu). Sözleşme her iki
// kipte de ÖNCE denetlenir — kuru koşum komutların salt-okuma olduğunu da kanıtlar (bekçi: test_lisans_devreye_kuru).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const VDS = Object.freeze({ hedef: 'oguzhan@80.253.255.188', port: '2222' });
export const YAYIN_SSH = 'tekserp-yayin';
export const TP = Object.freeze({ hedef: 'oguzhan@100.70.47.46', tailscaleIp: '100.70.47.46' });
export const OKUMA_YONTEMLERI = Object.freeze(['GET', 'HEAD']);
/** Kuru kipte bile koşturulabilen tek yerel betik: VDS'i salt okur (Teks-Erp-wt kökünde, repo dışı). */
export const YEREL_BETIKLER = Object.freeze(['vds-dogrula.sh']);

// ssh: her `&&`/`;`/`|` parçasının ilk sözcükleri bu listeden biri olmalı (salt-okuma).
const SSH_IZINLI = [
  /^docker (ps|inspect|images|logs)\b/, /^docker network (ls|inspect)\b/, /^docker exec [\w.-]+ (ls|sha256sum|stat)\b/,
  /^docker exec [\w.-]+ psql\b/, /^(ls|stat|test|sha256sum|cut|grep|sort|wc|head|tail|echo|free|df|hostname|date|find|xargs|awk|tr)\b/,
  /^curl -s\b/, /^cd [\w/.-]+$/, /^[A-Z]=[\w/.-]+$/,
];
const SSH_YASAK = [/>/, /\$\(/, /`/, /\btee\b/, /\brm\b/, /\bmv\b/, /\bcp\b/, /\bchmod\b/, /\bchown\b/, /\bsudo\b/, /\bsystemctl\b/,
  /\biptables\b/, /\bxargs\b(?!\s+-0\s+sha256sum)/, /\s-(delete|exec|execdir|ok)\b/,
  /\bsystem\s*\(/, /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|vacuum)\b/i, /\bcat\s+\S*\.env\b/, /\bdocker exec\b.*\s-i\b/];
// curl parçasında yalnız GET: yöntem değiştiren ya da gövde yollayan bayrak RED.
const CURL_YASAK = [/\s-X\s*(?!GET\b)/, /\s(-d|--data\S*|-T|-F|--form|--upload-file|--json)(\s|=|$)/, /\s-(o|O)\s/];
// PowerShell: cmdlet adında yalnız okuma fiilleri; yazma fiili, pm2 CLI'ı, kurulum betikleri ve yönlendirme RED.
const PS_YASAK_HAM = [
  /\b(Set|New|Remove|Stop|Start|Restart|Register|Unregister|Copy|Move|Rename|Clear|Add|Out|Export|Enable|Disable|Suspend|Resume|Install|Uninstall|Update|Expand|Compress)-[A-Z]\w*/,
  /\bInvoke-(?!WebRequest\b|RestMethod\b|CimMethod\b[^\n]*-MethodName\s+GetOwner\b)\w+/, /-Method\s+(?!Get\b)\w+/i, /\bpm2(\.cmd)?\b/i,
  /\bkur\.ps1\b/, /\buzaktan-kos\b/, /\bschtasks\b/i, /\bsc(\.exe)?\s/i, /\bpowercfg\s+\/(change|set|setactive)/i, /\b(IEX|rd|del|rmdir|mkdir|md|icacls|takeown|net\s+(stop|start|user))\b/i,
  /-EncodedCommand/i];
// Tırnaklar soyulduktan sonra: yönlendirme ve çağrı işleci (dize içindeki `>` ya da `&` masumdur).
const PS_YASAK_SOYULMUS = [/>/, /(^|[\s;(])&\s*["'$\w]/];

export class SozlesmeIhlali extends Error {}

/** ssh uzak komutunun salt-okuma olduğunu denetler; değilse fırlatır (kuru kipte de). */
export function sshDenetle(komut) {
  for (const y of SSH_YASAK) if (y.test(komut)) throw new SozlesmeIhlali(`ssh komutu salt-okuma değil (${y}): ${komut}`);
  const parcalar = komut.split(/&&|\|\||;|\|/).map((p) => p.trim()).filter(Boolean);
  for (const p of parcalar) {
    if (!SSH_IZINLI.some((r) => r.test(p))) throw new SozlesmeIhlali(`ssh parçası izin listesinde yok: ${p}`);
    if (p.startsWith('curl') && CURL_YASAK.some((y) => y.test(p))) throw new SozlesmeIhlali(`curl parçası GET değil: ${p}`);
  }
}

/** PowerShell betiğinin salt-okuma olduğunu denetler (satır satır). */
export function psDenetle(betik) {
  for (const satir of betik.split('\n')) {
    const ham = satir.replace(/(^|\s)#.*$/, '');
    const soyulmus = ham.replace(/'[^']*'|"[^"]*"/g, '""');
    for (const y of PS_YASAK_HAM) if (y.test(ham)) throw new SozlesmeIhlali(`PowerShell satırı salt-okuma değil (${y}): ${satir.trim()}`);
    for (const y of PS_YASAK_SOYULMUS) if (y.test(soyulmus)) throw new SozlesmeIhlali(`PowerShell satırı salt-okuma değil (${y}): ${satir.trim()}`);
  }
}

export function httpDenetle(url, yontem) {
  if (!OKUMA_YONTEMLERI.includes(yontem)) throw new SozlesmeIhlali(`HTTP yöntemi okuma değil: ${yontem} ${url}`);
  if (!/^https?:\/\//.test(url)) throw new SozlesmeIhlali(`HTTP adresi biçimsiz: ${url}`);
}

/** `--olc` yoksa kuru. Başka bir bayrak kuru kipi açmaz/kapatmaz. */
export function kipOku(argv) {
  return { olc: argv.includes('--olc') };
}

export function evYolu(p) {
  return p && p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

/** Belirteç dosyası: 0600'den gevşekse ölçüm başlamaz (sır hijyeni); içerik hiçbir yere basılmaz. */
export function belirtecOku(dosya) {
  const f = evYolu(dosya);
  const st = fs.statSync(f);
  if ((st.mode & 0o077) !== 0) throw new SozlesmeIhlali(`belirteç dosyası izinleri gevşek (0600 olmalı): ${f}`);
  const b = fs.readFileSync(f, 'utf8').trim();
  if (!/^[\w.-]{20,4096}$/.test(b)) throw new SozlesmeIhlali(`belirteç dosyası biçimsiz: ${f}`);
  return b;
}

/** Ağ çağrılarının tek kapısı. Kuru kipte `plan`a satır ekler ve `{ kuru: true }` döner. */
export class Ag {
  constructor({ olc, zamanAsimiMs = 20_000 } = {}) {
    this.olc = Boolean(olc);
    this.zamanAsimiMs = zamanAsimiMs;
    this.plan = [];
  }

  async http(url, { yontem = 'GET', belirtec = null } = {}) {
    httpDenetle(url, yontem);
    if (!this.olc) return this.#kuru(`HTTP ${yontem} ${url}${belirtec ? ' (Bearer)' : ''}`);
    try {
      const r = await fetch(url, { method: yontem, headers: belirtec ? { authorization: `Bearer ${belirtec}` } : {}, redirect: 'manual', signal: AbortSignal.timeout(this.zamanAsimiMs) });
      const govde = yontem === 'HEAD' ? '' : await r.text();
      let json = null;
      try { json = govde ? JSON.parse(govde) : null; } catch { /* JSON değil */ }
      return { kuru: false, durum: r.status, govde, json, basliklar: Object.fromEntries(r.headers) };
    } catch (e) {
      return { kuru: false, durum: null, hata: e instanceof Error ? e.message : String(e) };
    }
  }

  ssh(komut, { hedef = 'vds' } = {}) {
    sshDenetle(komut);
    const args = hedef === 'yayin' ? [YAYIN_SSH] : ['-p', VDS.port, VDS.hedef];
    if (!this.olc) return this.#kuru(`ssh ${args.join(' ')} '${komut}'`);
    return this.#kos('ssh', ['-n', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=5', ...args, komut]);
  }

  /** thinkpad-1'de PowerShell 5.1 (tp.sh kalıbı): önce Tailscale kimlik kapısı, tutmazsa 99. */
  tp(betik) {
    psDenetle(betik);
    if (!this.olc) return this.#kuru(`tp (${TP.hedef}) PowerShell:\n    ${betik.trim().split('\n').join('\n    ')}`);
    const kapi = `$ProgressPreference="SilentlyContinue"; $ip = (tailscale ip -4); if ($ip -ne "${TP.tailscaleIp}") { Write-Output "KIMLIK KAPISI: YANLIS MAKINE ($ip)"; exit 99 }`;
    const enc = Buffer.from(`${kapi}\n${betik}`, 'utf16le').toString('base64');
    return this.#kos('ssh', ['-n', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=5', TP.hedef,
      `powershell -NoProfile -NonInteractive -EncodedCommand ${enc}`]);
  }

  /** Yalnız `YEREL_BETIKLER`deki salt-okuma betiği (tam yol verilir, adı listede olmalı). */
  yerelBetik(tamYol) {
    if (!YEREL_BETIKLER.includes(path.basename(tamYol))) throw new SozlesmeIhlali(`yerel betik izinli değil: ${tamYol}`);
    if (!this.olc) return this.#kuru(`yerel ${tamYol}`);
    return this.#kos(tamYol, []);
  }

  #kuru(satir) {
    this.plan.push(satir);
    return { kuru: true };
  }

  #kos(komut, args) {
    const r = spawnSync(komut, args, { encoding: 'utf8', timeout: 90_000, maxBuffer: 16 * 1024 * 1024 });
    return { kuru: false, kod: r.status, cikti: `${r.stdout ?? ''}`, hata: `${r.stderr ?? ''}${r.error ? r.error.message : ''}` };
  }
}
