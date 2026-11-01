#!/usr/bin/env node
// =============================================================================
// BEKÇİ — bulut kenarı sertleştirmesi (denetim 2026-11-01 K1-3 · O7 · O9 · D6). Zero-dep, DB'siz, ağsız.
// =============================================================================
//   §1 compose ortam geçişi: deploy/.env.production.example'daki her backend değişkeni iki korumalı compose'un
//      (elle + güncelleyicili) backend environment bloğunda geçer; geçmeyen yalnız beyanlı İSTİSNA (gerekçeli,
//      bayat istisna da kırmızı). HTTPS_ENABLED/CORS_ORIGINS boş varsayılanla (fabrika = bugünkü davranış);
//      bulut örneği HTTPS_ENABLED=true sabitler ve muaf dizinini bağlar.
//   §2 kenar şablonu (deploy/bulut/kenar/site.conf.ornek): üç limit_req bölgesi (IP başına genel · IP başına giriş · TOPLAM giriş),
//      giriş anahtarı eşlemesi örnek isteklerle (muaf adres, GET/OPTIONS, büyük harf, sondaki "/"), IPv6 /64
//      anahtarı, 429 gövdesi backend biçiminde (success:false · details.code RATE_LIMITED · Retry-After), günlük
//      biçimi sorgu dizesi/referer taşımaz, AOP + TLS 1.2+, HSTS kenarda basılmaz (tek kaynak backend).
//   §3 barındırma kontrol betiği (deploy/bulut/barindirma-kontrol.sh): yazan komut yok, sır anahtarı okumaz,
//      çıkış kodu = KIRMIZI sayısı, ölçtüğü maddeler yerinde.
// Her bölümün kalıcı negatif sondaları aynı koşuda (mutasyon → kırmızı).
// Koşum: node scripts/test_bulut_kenar.mjs   (çıkış 0 yeşil · 1 kırmızı)
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? '✅' : '❌'} ${name}${!ok && extra ? ` — ${extra}` : ''}`);
}
function probes(section, base, fn, list) {
  for (const [name, mutated] of list) {
    const applied = JSON.stringify(mutated) !== JSON.stringify(base);
    check(`${section} sonda: ${name} → kırmızı`, applied && fn(mutated).length > 0, applied ? '' : 'MUTASYON UYGULANMADI');
  }
}

// --- §1 compose ortam geçişi ----------------------------------------------------
const COMPOSE = 'Teks-Erp/docker/korumali/docker-compose.yml';
const COMPOSE_UPDATER = 'Teks-Erp/docker/korumali/docker-compose.guncelleyici.yml';
const COMPOSE_CLOUD = 'Teks-Erp/docker/korumali/docker-compose.bulut-ornek.yml';
const ENV_EXAMPLE = 'deploy/.env.production.example';
// Geçirilmeyen değişkenler ve NEDEN geçirilmedikleri (yeni değişken eklenince ya geçirilir ya buraya gerekçeyle yazılır).
const EXEMPT = {
  SWAGGER_ENABLED: 'korumalı kurulumda API belgesi kapalı kalır (geçirilmez = kapalı)',
  BACKUP_DIR: "yedek ayrı `yedek` konteynerinde, YEDEK_* ile",
  BACKUP_SCHEDULE_ENABLED: "yedek ayrı `yedek` konteynerinde, YEDEK_* ile",
  BACKUP_RETENTION_DAYS: 'yedek konteyneri YEDEK_SAKLAMA_GUN okur',
  BACKUP_HOUR: 'yedek konteyneri YEDEK_SAAT okur',
  BACKUP_OFFSITE_DIR: 'makine dışı kopya konakta (K2), konteyner yolu değil',
  PG_BIN_DIR: 'pg araçları imajın içinde',
};
const EMPTY_DEFAULT = ['HTTPS_ENABLED', 'CORS_ORIGINS'];

function backendBlock(compose) {
  const start = compose.indexOf('\n  backend:');
  if (start < 0) return '';
  const rest = compose.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}
function composeEnvFindings(d) {
  const out = [];
  const keys = [...d.example.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);
  if (keys.length === 0) return ['örnek ortam dosyasında değişken bulunamadı (ÖLÇÜLEMEDİ)'];
  for (const [name, c] of [['elle compose', d.compose], ['güncelleyicili compose', d.updater]]) {
    const be = backendBlock(c);
    if (!be) { out.push(`${name}: backend servisi bulunamadı`); continue; }
    for (const k of keys) {
      if (EXEMPT[k]) continue;
      if (!new RegExp(`^ {6}${k}:`, 'm').test(be)) out.push(`${name} backend'e ${k} geçirmiyor (ya geçir ya istisnaya gerekçeyle yaz)`);
    }
    for (const k of EMPTY_DEFAULT) {
      if (!new RegExp(`^ {6}${k}: \\$\\{${k}:-\\}$`, 'm').test(be)) out.push(`${name} ${k}'ı boş varsayılanla geçirmiyor (fabrika = bugünkü davranış)`);
    }
  }
  for (const k of Object.keys(EXEMPT)) if (!keys.includes(k)) out.push(`bayat istisna: ${k} örnek dosyada yok`);
  const cloudBackend = backendBlock(`\n${d.cloud}`);
  if (!/^ {6}HTTPS_ENABLED: "true"$/m.test(cloudBackend)) out.push('bulut örneği backend\'e HTTPS_ENABLED="true" vermiyor (HSTS)');
  if (!/^ {6}- \.\/kenar\/muaf:\/etc\/nginx\/muaf:ro$/m.test(d.cloud)) out.push('bulut örneği kenar/muaf dizinini bağlamıyor');
  return out;
}
{
  const d = { compose: read(COMPOSE), updater: read(COMPOSE_UPDATER), cloud: read(COMPOSE_CLOUD), example: read(ENV_EXAMPLE) };
  const f = composeEnvFindings(d);
  check('§1 ⭐ örnek ortamdaki backend değişkenleri iki compose\'da geçer (istisnalar beyanlı), bulut örneği HTTPS + muaf', f.length === 0, f.join(' | '));
  probes('§1', d, composeEnvFindings, [
    ['elle compose HTTPS_ENABLED geçirmiyor', { ...d, compose: d.compose.replace(/^ {6}HTTPS_ENABLED: .*\n/m, '') }],
    ['güncelleyicili compose CORS_ORIGINS geçirmiyor', { ...d, updater: d.updater.replace(/^ {6}CORS_ORIGINS: .*\n/m, '') }],
    ['CORS varsayılanı dolu', { ...d, compose: d.compose.replace('${CORS_ORIGINS:-}', '${CORS_ORIGINS:-*}') }],
    ['örneğe yeni değişken eklendi, geçmiyor', { ...d, example: `${d.example}\nYENI_DEGISKEN=1\n` }],
    ['bayat istisna', { ...d, example: d.example.replace(/^PG_BIN_DIR=.*$/m, '') }],
    ['anahtar yalnız yedek servisinde', { ...d, compose: d.compose.replace(/^ {6}HTTPS_ENABLED: .*\n/m, '').replace('      YEDEK_SAAT:', '      HTTPS_ENABLED: ${HTTPS_ENABLED:-}\n      YEDEK_SAAT:') }],
    ['bulut örneği HTTPS açmıyor', { ...d, cloud: d.cloud.replace(/^ {6}HTTPS_ENABLED: "true"\n/m, '') }],
    ['bulut örneği muaf bağlamıyor', { ...d, cloud: d.cloud.replace(/^ {6}- \.\/kenar\/muaf.*\n/m, '') }],
  ]);
}

// --- §2 kenar şablonu ---------------------------------------------------------------
const SITE = 'deploy/bulut/kenar/site.conf.ornek';
function nginxMap(conf, variable) {
  const m = new RegExp(`map\\s+(\\S+)\\s+\\$${variable}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(conf);
  if (!m) return null;
  const rows = [];
  for (const line of m[2].split('\n')) {
    const r = /^\s*"(~\*?)(.*)"\s+(.+?);\s*$/.exec(line);
    if (r) rows.push({ re: new RegExp(r[2], r[1] === '~*' ? 'i' : ''), value: r[3].replace(/^"|"$/g, '') });
  }
  const def = /^\s*default\s+(.+?);\s*$/m.exec(m[2])?.[1]?.replace(/^"|"$/g, '');
  return (input) => {
    for (const { re, value } of rows) {
      const hit = re.exec(input);
      if (hit) return value.replace(/\$(\w+)/g, (all, g) => (hit.groups && g in hit.groups ? hit.groups[g] : all));
    }
    return def ?? '';
  };
}
function siteFindings(conf) {
  const out = [];
  const zone = (name, key) => new RegExp(`^limit_req_zone \\$${key}\\s+zone=${name}:\\d+m\\s+rate=(\\d+)r/(s|m);`, 'm').exec(conf);
  const perSec = (z) => (z[2] === 'm' ? Number(z[1]) / 60 : Number(z[1]));
  const ipZone = zone('kenar_ip', 'kenar_ip_kova');
  const loginIpZone = zone('kenar_giris_ip', 'kenar_giris_ip_anahtar');
  const loginZone = zone('kenar_giris', 'kenar_giris_anahtar');
  if (!ipZone) out.push('IP başına genel bölge (kenar_ip, muafı saymayan $kenar_ip_kova) yok');
  else if (perSec(ipZone) < 10) out.push(`genel bölge fabrika NAT'ını boğar (${ipZone[1]} r/s < 10)`);
  if (!loginZone) out.push('toplam giriş bölgesi (kenar_giris) yok');
  if (!loginIpZone) out.push('IP başına giriş bölgesi (kenar_giris_ip) yok — tek adres toplam kovayı boşaltır');
  else if (loginZone && perSec(loginIpZone) >= perSec(loginZone)) out.push('IP başına giriş hızı toplamdan küçük değil — tek adres toplam kovayı boşaltır');
  const order = ['kenar_ip', 'kenar_giris_ip', 'kenar_giris'].map((z) => {
    const m = new RegExp(`^ {4}limit_req zone=${z}\\s+burst=\\d+\\s+nodelay;`, 'm').exec(conf);
    if (!m) out.push(`${z} sunucu bloğunda uygulanmıyor`);
    return m ? m.index : -1;
  });
  if (order.every((i) => i >= 0) && !(order[0] < order[1] && order[1] < order[2])) out.push('limit_req sırası kenar_ip → kenar_giris_ip → kenar_giris değil (toplam önce sayılır)');
  const ipBucket = nginxMap(conf, 'kenar_ip_kova');
  if (!ipBucket) out.push('genel kova eşlemesi yok');
  else for (const [input, want] of [['0|192.0.2.4', '192.0.2.4'], ['1|192.0.2.4', ''], ['0|6:2001:db8:1:2', '6:2001:db8:1:2']]) {
    if (ipBucket(input) !== want) out.push(`genel kova «${input}» → «${ipBucket(input)}» (beklenen «${want}»; muaf sayılmaz)`);
  }
  const loginIp = nginxMap(conf, 'kenar_giris_ip_anahtar');
  if (!loginIp) out.push('IP başına giriş anahtarı eşlemesi yok');
  else for (const [input, want] of [['giris|192.0.2.4', '192.0.2.4'], ['|192.0.2.4', ''], ['giris|6:2001:db8:1:2', '6:2001:db8:1:2']]) {
    if (loginIp(input) !== want) out.push(`IP giriş anahtarı «${input}» → «${loginIp(input)}» (beklenen «${want}»)`);
  }
  if (!/^limit_req_status 429;/m.test(conf)) out.push('ret durumu 429 değil');
  if (!/^geo \$kenar_muaf \{\n {4}default 0;\n {4}include \/etc\/nginx\/muaf\/adresler\.conf;\n\}/m.test(conf)) out.push('muaf adresler geo eşlemesi (adresler.conf) yok');
  const login = nginxMap(conf, 'kenar_giris_anahtar');
  if (!login) out.push('giriş anahtarı eşlemesi yok');
  else {
    const cases = [
      ['0|POST|/api/auth/login', 'giris'], ['0|POST|/api/auth/login-quick-pin', 'giris'], ['0|POST|/api/auth/login-card', 'giris'],
      ['0|POST|/api/AUTH/Login/', 'giris'], ['0|POST|/api/devices/announce', 'giris'],
      ['0|POST|/api/devices/rebind-requests/onsite-approve', 'giris'], ['0|PUT|/api/auth/login', 'giris'],
      ['1|POST|/api/auth/login', ''], ['0|GET|/api/auth/login-methods', ''], ['0|OPTIONS|/api/auth/login', ''],
      ['0|POST|/api/auth/me', ''], ['0|POST|/api/auth/change-password', ''], ['0|GET|/api/devices/status', ''],
    ];
    for (const [input, want] of cases) {
      const got = login(input);
      if (got !== want) out.push(`giriş anahtarı «${input}» → «${got}» (beklenen «${want}»)`);
    }
  }
  const ip = nginxMap(conf, 'kenar_ip_anahtar');
  if (!ip) out.push('IP anahtarı eşlemesi yok');
  else {
    const cases = [['2001:db8:1:2::5', '6:2001:db8:1:2'], ['2001:db8:1:2:a:b:c:d', '6:2001:db8:1:2'], ['2001:db8::1', '6:2001:db8:0:0'],
      ['2001:db8:5::1', '6:2001:db8:5:0'], ['::1', '6:0:0:0:0'], ['192.0.2.4', '$remote_addr']];
    for (const [input, want] of cases) if (ip(input) !== want) out.push(`IP anahtarı «${input}» → «${ip(input)}» (beklenen «${want}»)`);
  }
  if (!/^ {4}error_page 429 = @kenar_hiz_siniri;/m.test(conf)) out.push('429 adlı konuma yönlenmiyor');
  const named = /location @kenar_hiz_siniri \{([\s\S]*?)\n {4}\}/.exec(conf)?.[1] ?? '';
  const body = /return 429 '([^']+)';/.exec(named)?.[1];
  let parsed = null;
  try { parsed = body ? JSON.parse(body) : null; } catch { /* aşağıda */ }
  if (!parsed || parsed.success !== false || parsed.details?.code !== 'RATE_LIMITED' || typeof parsed.message !== 'string') out.push('429 gövdesi backend biçiminde değil (success:false · details.code RATE_LIMITED)');
  if (parsed && 'code' in parsed) out.push('429 gövdesi body.code taşıyor (sözleşme details.code)');
  if (!/add_header Retry-After \d+ always;/.test(named)) out.push('429 Retry-After basmıyor');
  if (!/default_type "application\/json/.test(named)) out.push('429 JSON değil');
  const fmt = /^log_format tekserp_kenar ([\s\S]*?);\n/m.exec(conf)?.[1];
  if (!fmt) out.push('tekserp_kenar günlük biçimi yok');
  else for (const v of ['$request ', '$request"', '$request_uri', '$args', '$query_string', '$is_args', '$http_referer', '$arg_']) if (fmt.includes(v)) out.push(`günlük biçimi ${v.trim()} yazıyor (belirteçli adres düz kalır)`);
  if (!/^ {4}access_log \S+ tekserp_kenar;/m.test(conf)) out.push('erişim günlüğü tekserp_kenar biçimini kullanmıyor');
  if (!/^ {4}ssl_protocols TLSv1\.2 TLSv1\.3;/m.test(conf)) out.push('köken TLS 1.2+ değil');
  if (!/^ {4}ssl_verify_client on;/m.test(conf) || !/^ {4}ssl_client_certificate \S+;/m.test(conf)) out.push('AOP (ssl_verify_client) yok');
  if (/strict-transport-security/i.test(conf.replace(/^\s*#.*$/gm, ''))) out.push('HSTS kenarda basılıyor (tek kaynak backend HTTPS_ENABLED; çift başlık)');
  if (!/^ {4}proxy_set_header X-Forwarded-For \$remote_addr;/m.test(conf)) out.push('X-Forwarded-For gerçek adresle ezilmiyor (TRUST_PROXY=1 güvenliği)');
  if (!/ssl_reject_handshake on;/.test(conf)) out.push('tanınmayan ad reddedilmiyor');
  return out;
}
{
  const conf = read(SITE);
  const f = siteFindings(conf);
  check('§2 ⭐ kenar şablonu: üç hız bölgesi (genel · IP giriş · toplam giriş) + muaf + 429 JSON + sorgusuz günlük + AOP/TLS1.2 + HSTS tek kaynak', f.length === 0, f.join(' | '));
  probes('§2', conf, siteFindings, [
    ['toplam giriş bölgesi yok', conf.replace(/^limit_req_zone \$kenar_giris_anahtar.*\n/m, '')],
    ['genel bölge uygulanmıyor', conf.replace(/^ {4}limit_req zone=kenar_ip .*\n/m, '')],
    ['IP başına giriş bölgesi yok', conf.replace(/^limit_req_zone \$kenar_giris_ip_anahtar.*\n/m, '')],
    ['IP giriş sırası ters', conf.replace(/^( {4}limit_req zone=kenar_giris_ip .*\n)( {4}limit_req zone=kenar_giris .*\n)/m, '$2$1')],
    ['IP giriş hızı toplamı boşaltır', conf.replace('zone=kenar_giris_ip:10m rate=60r/m', 'zone=kenar_giris_ip:10m rate=5r/s')],
    ['muaf genel kovaya sayılıyor', conf.replace('"~^0\\|(?<ipk>.+)$"', '"~^[01]\\|(?<ipk>.+)$"')],
    ['muaf GET de sayılıyor', conf.replace('(?!(GET|HEAD|OPTIONS)\\|)', '')],
    ['muaf adres sayılıyor', conf.replace(/"~\*\^0\\\|/g, '"~*^[01]\\|')],
    ['announce kapsam dışı', conf.replace('(announce|rebind-requests/onsite-approve)', '(rebind-requests/onsite-approve)')],
    ['IPv6 /128 anahtar', conf.replace(/^ {4}"~\^\(\?<g1>.*\n/gm, '')],
    ['günlük $request yazıyor', conf.replace('"$request_method $uri $server_protocol"', '"$request"')],
    ['günlük referer yazıyor', conf.replace('"$http_user_agent"', '"$http_referer" "$http_user_agent"')],
    ['ret 503', conf.replace('limit_req_status 429;', 'limit_req_status 503;')],
    ['ret gövdesi body.code', conf.replace('"success":false,', '"success":false,"code":"RATE_LIMITED",')],
    ['Retry-After yok', conf.replace(/^ {8}add_header Retry-After .*\n/m, '')],
    ['AOP kapalı', conf.replace('ssl_verify_client on;', 'ssl_verify_client off;')],
    ['TLS 1.0 açık', conf.replace('ssl_protocols TLSv1.2 TLSv1.3;', 'ssl_protocols TLSv1 TLSv1.2 TLSv1.3;')],
    ['HSTS kenarda', conf.replace('    client_max_body_size', '    add_header Strict-Transport-Security "max-age=1" always;\n    client_max_body_size')],
  ]);
}

// --- §3 barındırma kontrol betiği --------------------------------------------------
const CHECKER = 'deploy/bulut/barindirma-kontrol.sh';
function checkerFindings(src) {
  const out = [];
  const code = src.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const writers = [
    [/\brm\s+-/, 'rm'], [/\bmv\s/, 'mv'], [/\bsed\s+-i/, 'sed -i'], [/\btee\b/, 'tee'], [/\bchmod\b|\bchown\b/, 'chmod/chown'],
    [/\bufw\s+(allow|deny|delete|enable|disable|reload|reset|insert)\b/, 'ufw yazma'],
    [/\bsystemctl\s+(restart|stop|start|enable|disable|reload)\b/, 'systemctl yazma'],
    [/\bdocker\s+(rm|stop|start|restart|run|kill|compose|pull|volume\s+rm|system)\b/, 'docker yazma'],
    [/\bdocker\s+exec\s+"\$KENAR"\s+(?!nginx -T\b)/, 'kenarda nginx -T dışı komut'],
    [/\bfail2ban-client\s+(set|unban|reload|stop|start)\b/, 'fail2ban yazma'],
    [/\b(apt|apt-get|reboot|shutdown)\s/, 'paket/yeniden başlatma'],
    [/(^|[^0-9&>])>\s*(?!\/dev\/null|&)[^\s|;)]+/m, 'dosyaya yönlendirme'],
  ];
  for (const [re, name] of writers) if (re.test(code)) out.push(`salt-okur değil: ${name}`);
  const envFilter = /grep -E '\^\(([A-Z_|]+)\)='/.exec(code)?.[1];
  if (!envFilter) out.push('konteyner ortamı izin listesiyle süzülmüyor (sır basabilir)');
  else if (/SECRET|PASSWORD|DATABASE_URL|TOKEN|KEY/.test(envFilter)) out.push('ortam süzgeci sır anahtarı içeriyor');
  if (/\{\{\s*json\s+\.Config\.Env/.test(code) || /docker inspect "\$BACKEND"(?![^\n]*grep)/.test(code)) out.push('ortam süzgeçsiz okunuyor');
  if (!/exit "\$KIRMIZI"/.test(code)) out.push('çıkış kodu KIRMIZI sayısı değil');
  for (const [re, name] of [
    [/ss -Hltn/, 'ss'], [/ufw status/, 'ufw'], [/sshd -T/, 'sshd -T'], [/permitrootlogin no/, 'root girişi'], [/fail2ban-client status/, 'fail2ban'],
    [/recidive/, 'recidive'], [/reboot-required/, 'reboot-required'], [/Automatic-Reboot/, 'otomatik yeniden başlatma'],
    [/\.dump\.tkenc/, 'şifreli yedek'], [/-name '\*\.dump'/, 'düz döküm'], [/RATE_LIMIT_LOGIN_MAX/, 'hız sınırı ortamı'],
    [/NanoCpus/, 'kaynak sınırı'], [/strict-transport-security/i, 'HSTS'], [/--tls-max/, 'TLS 1.0/1.1'], [/location: https:/i, 'HTTP→HTTPS'],
    [/zone=kenar_giris/, 'kenar hız bölgesi'], [/ssl_verify_client/, 'AOP'], [/son-cekim/, 'makine dışı çekim yaşı'],
  ]) if (!re.test(code)) out.push(`ölçülmüyor: ${name}`);
  return out;
}
{
  const src = read(CHECKER);
  const f = checkerFindings(src);
  check('§3 ⭐ kontrol betiği salt-okur, sır basmaz, çıkış = KIRMIZI sayısı, maddeleri ölçer', f.length === 0, f.join(' | '));
  const mode = fs.statSync(path.join(ROOT, CHECKER)).mode;
  check('§3 kontrol betiği çalıştırılabilir', (mode & 0o111) !== 0);
  probes('§3', src, checkerFindings, [
    ['ufw kuralı yazıyor', src.replace('bolum "SSH (sshd -T)"', 'ufw allow 443\nbolum "SSH (sshd -T)"')],
    ['konteyner yeniden başlatıyor', src.replace('bolum "Donanım"', 'docker restart x\nbolum "Donanım"')],
    ['dosyaya yazıyor', src.replace('bolum "Donanım"', 'echo x > /etc/ssh/sshd_config\nbolum "Donanım"')],
    ['ortam süzgecinde sır', src.replace('|LOGIN_LOCKOUT_SCOPE)=', '|LOGIN_LOCKOUT_SCOPE|JWT_SECRET)=')],
    ['çıkış hep 0', src.replace('exit "$KIRMIZI"', 'exit 0')],
    ['HSTS ölçülmüyor', src.replace(/^.*strict-transport-security.*\n/gim, '')],
    ['makine dışı çekim yaşı ölçülmüyor', src.replace(/son-cekim/g, 'x')],
  ]);
}

console.log(`\n${passed} geçti, ${failed} kaldı`);
process.exit(failed === 0 ? 0 : 1);
