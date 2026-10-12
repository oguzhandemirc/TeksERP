#!/usr/bin/env node
// =============================================================================
// Bekçi: Windows kod imzası hazırlığı (güvenlik Bölge 5 B9).
// Sertifika YOKKEN bugünkü davranış (tek satır uyarı, çıkış 0, dosya değişmez); VARKEN imza + doğrulama
// düşerse durur; iki derleme yolu (sunucu setup'ı · panel) adımı taşır; sır/parmak izi repoda yok.
// Çalıştır: node scripts/test_kod_imzasi.mjs   (pwsh yoksa §2 ⏭ beyanla atlanır)
// =============================================================================
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const kok = join(dirname(fileURLToPath(import.meta.url)), '..');
const oku = (r) => readFileSync(join(kok, r), 'utf8');
let gecti = 0;
let kaldi = 0;
const check = (ad, ok, ayrinti = '') => {
  ok ? gecti++ : kaldi++;
  console.log(`${ok ? '✅' : '❌'} ${ad}${ayrinti ? ` — ${ayrinti}` : ''}`);
};

// §1 statik: adımın yeri ve koşulu
const yardimci = oku('deploy/kurulum/kod-imzala.ps1');
const tp = oku('deploy/korumali-thinkpad.sh');
const panel = oku('deploy/electron-paketle.sh');
const isccAt = tp.indexOf('tekserp-kurulum.iss');
const imzaAt = tp.indexOf('kod-imzala.ps1 \\" -Dosya') >= 0 ? tp.indexOf('kod-imzala.ps1 \\" -Dosya') : tp.indexOf('kod-imzala.ps1\\" -Dosya');
const ozetAt = tp.indexOf("'SETUP=' + ");
check('§1a setup imza adımı ISCC derlemesinden SONRA, özet (SHA256) alınmadan ÖNCE', isccAt > 0 && imzaAt > isccAt && ozetAt > imzaAt, `iscc ${isccAt} · imza ${imzaAt} · özet ${ozetAt}`);
check('§1b imza düşerse uzak adım durur (LASTEXITCODE → exit)', /kod-imzala\.ps1[^\n]*if \(\\\$LASTEXITCODE\) \{ exit \\\$LASTEXITCODE \}/.test(tp));
check('§1c yardımcı imzadan sonra doğrular (signtool verify + Get-AuthenticodeSignature + zaman damgası)',
  /signtool verify \/pa/.test(yardimci) && /Get-AuthenticodeSignature/.test(yardimci) && /TimeStamperCertificate/.test(yardimci));
check('§1d panel: signtool seçenekleri YALNIZ parmak izi ortamdaysa ve Windows makinesindeyse',
  /if \[ -n "\$\{TEKSERP_KOD_IMZA_PARMAKIZI:-\}" \] && \[ "\$\(uname\)" != "Darwin" \]; then\n\s+derleme_argumanlari\+=\("-c\.win\.signtoolOptions\.certificateSha1=/.test(panel));
check('§1e panel: imzasız yolda tek satır UYARI', /else\n\s+echo "UYARI: kod imzası yok/.test(panel));
const pj = JSON.parse(oku('Electron/package.json'));
check('§1f Electron/package.json win bloğu sertifika/parmak izi taşımaz (derleme anında enjekte edilir)',
  !JSON.stringify(pj.build?.win ?? {}).match(/signtoolOptions|certificate|cscLink/i));
const izliler = execFileSync('git', ['ls-files', 'deploy', 'scripts', 'Electron/package.json', 'docs/ops'], { cwd: kok }).toString().split('\n').filter(Boolean);
const sizan = izliler.filter((f) => /kod-imza\.json$|\.pfx$|\.p12$/i.test(f));
check('§1g repoda kod imzası sır dosyası yok (kod-imza.json / .pfx / .p12)', sizan.length === 0, sizan.join(', '));

// §2 gerçek koşum (pwsh): sertifikasız → uyarı + 0, dosya değişmez · -Zorunlu → 1 · yanlış parmak izi → 1
const pwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' });
if (pwsh.status !== 0) {
  console.log('⏭ §2 pwsh yok — gerçek koşum atlandı (beyan)');
} else {
  const gecici = mkdtempSync(join(tmpdir(), 'kodimza-'));
  try {
    const exe = join(gecici, 'TeksERP-Kurulum-0.0.0.exe');
    writeFileSync(exe, Buffer.from('MZ deneme'));
    const ozet = () => createHash('sha256').update(readFileSync(exe)).digest('hex');
    const once = ozet();
    const kos = (ek, env = {}) => spawnSync('pwsh', ['-NoProfile', '-File', join(kok, 'deploy/kurulum/kod-imzala.ps1'), '-Dosya', exe, ...ek], {
      encoding: 'utf8',
      env: { ...process.env, USERPROFILE: gecici, TEKSERP_KOD_IMZA_PARMAKIZI: '', ...env },
    });
    const a = kos([]);
    check('§2a sertifika yok → çıkış 0 + tek satır UYARI (bugünkü davranış)', a.status === 0 && /^KODIMZA: UYARI/m.test(a.stdout) && a.stdout.trim().split('\n').length === 1, `${a.status} ${a.stdout.trim()}`);
    check('§2b sertifika yok → dosya DEĞİŞMEZ', ozet() === once);
    const b = kos(['-Zorunlu']);
    check('§2c -Zorunlu + sertifika yok → çıkış 1', b.status === 1 && /HATA/.test(b.stdout), `${b.status}`);
    const c = kos([], { TEKSERP_KOD_IMZA_PARMAKIZI: 'AB'.repeat(20) });
    check('§2d depoda olmayan parmak izi → çıkış 1 (sessiz imzasız geçiş YOK)', c.status === 1 && /HATA/.test(c.stdout), `${c.status} ${c.stdout.trim()}`);
    const d = kos([], { TEKSERP_KOD_IMZA_PARMAKIZI: 'xyz' });
    check('§2e biçimsiz parmak izi → çıkış 1', d.status === 1, `${d.status}`);
  } finally {
    rmSync(gecici, { recursive: true, force: true });
  }
}

console.log(`\n=== Sonuç: ${gecti} geçti, ${kaldi} başarısız ===`);
process.exit(kaldi ? 1 : 0);
