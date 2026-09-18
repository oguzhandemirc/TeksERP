// =============================================================================
// TABLET TEST SÜRÜCÜSÜ — adb katmanı (child_process + adb; YENİ PAKET YOK)
// =============================================================================
// Bir cihaza `-s <seri>` ile bağlanır; ekran ağacını `uiautomator dump` ile okur,
// dokunma/yazma `input` ile gider, görüntü `screencap -p` ile stdout'tan alınır.
// TR karakter: `input text` yalnız ASCII taşır (ölçüldü: ş/ğ/ı düşer) → ASCII dışı
// metin için `yazUnicode` klavye olmadan çalışmaz; güzergâh verisi `TEST-` ASCII.
// =============================================================================
import { execFileSync, spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const ADB_ADAYLARI = [process.env.ADB, join(homedir(), 'Library/Android/sdk/platform-tools/adb'), 'adb'].filter(Boolean);

export function adbYolu() {
  for (const a of ADB_ADAYLARI) {
    if (a === 'adb') return a;
    if (existsSync(a)) return a;
  }
  return 'adb';
}

export class Cihaz {
  /** @param {string|undefined} seri  adb seri no (boşsa tek cihaz varsayılır) */
  constructor(seri, { zamanAsimiMs = 20_000 } = {}) {
    this.seri = seri;
    this.adb = adbYolu();
    this.zamanAsimiMs = zamanAsimiMs;
  }

  #arg(args) {
    return this.seri ? ['-s', this.seri, ...args] : args;
  }

  /** Metin çıktı (stdout, utf8). */
  run(args, { girdi } = {}) {
    return execFileSync(this.adb, this.#arg(args), { encoding: 'utf8', timeout: this.zamanAsimiMs, input: girdi, maxBuffer: 64 * 1024 * 1024 });
  }

  /** İkili çıktı (screencap). */
  runBin(args) {
    const r = spawnSync(this.adb, this.#arg(args), { timeout: this.zamanAsimiMs, maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`adb ${args.join(' ')} rc=${r.status}: ${r.stderr?.toString() ?? ''}`);
    return r.stdout;
  }

  shell(cmd) {
    return this.run(['shell', cmd]);
  }

  /** uiautomator ekran ağacı (XML metni). Dump cihazda dosyaya yazılır, `cat` ile okunur (stdout'a doğrudan dump bazı ROM'larda boş döner). Emülatör jank'ında dump zaman aşımına uğrar → 3 deneme. */
  dump({ deneme = 3 } = {}) {
    let sonHata;
    for (let i = 0; i < deneme; i++) {
      try {
        const yol = '/sdcard/tekserp-surucu.xml';
        const out = this.shell(`uiautomator dump ${yol} >/dev/null 2>&1; cat ${yol}`);
        const j = out.indexOf('<?xml');
        if (j >= 0) return out.slice(j);
        sonHata = new Error(`uiautomator dump boş: ${out.slice(0, 120)}`);
      } catch (e) {
        sonHata = e;
      }
    }
    throw sonHata ?? new Error('dump başarısız');
  }

  tik(x, y) {
    this.shell(`input tap ${Math.round(x)} ${Math.round(y)}`);
  }

  uzunBas(x, y, ms = 800) {
    this.shell(`input swipe ${Math.round(x)} ${Math.round(y)} ${Math.round(x)} ${Math.round(y)} ${ms}`);
  }

  kaydir(x1, y1, x2, y2, ms = 300) {
    this.shell(`input swipe ${Math.round(x1)} ${Math.round(y1)} ${Math.round(x2)} ${Math.round(y2)} ${ms}`);
  }

  /** ASCII metin — boşluk `%s`, kabuk özel karakterleri kaçışlı. ASCII dışı karakter varsa hata (sessiz düşme YOK). */
  yaz(metin) {
    if (/[^\x20-\x7e]/.test(metin)) throw new Error(`input text ASCII dışı taşımaz: ${JSON.stringify(metin)} — numpad/tık dizisi ya da ASCII veri kullan`);
    const kacisli = metin.replace(/[\\"'`$&|;<>()]/g, (c) => `\\${c}`).replace(/ /g, '%s');
    this.shell(`input text "${kacisli}"`);
  }

  tus(kod) {
    this.shell(`input keyevent ${kod}`);
  }

  geri() {
    this.tus('KEYCODE_BACK');
  }

  /** PNG dosyası; dizin yoksa açılır. Dönüş: yazılan yol. */
  ekran(dizin, ad) {
    mkdirSync(dizin, { recursive: true });
    const yol = join(dizin, `${ad}.png`);
    writeFileSync(yol, this.runBin(['exec-out', 'screencap', '-p']));
    return yol;
  }

  /** Ön plandaki etkinlik (paket/aktivite) — uygulamanın açık olduğunu doğrulamak için. */
  onPlan() {
    const out = this.shell('dumpsys activity activities | grep -E "topResumedActivity|mResumedActivity" | head -1');
    const m = out.match(/([\w.]+)\/([\w.$]+)/);
    return m ? { paket: m[1], aktivite: m[2] } : null;
  }

  baslat(paket, aktivite = '.MainActivity') {
    this.shell(`am start -n ${paket}/${aktivite}`);
  }

  durdur(paket) {
    this.shell(`am force-stop ${paket}`);
  }

  ekranBoyutu() {
    const m = this.shell('wm size').match(/(\d+)x(\d+)/);
    return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
  }
}

export function cihazlar() {
  const out = execFileSync(adbYolu(), ['devices', '-l'], { encoding: 'utf8' });
  return out
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l && /\sdevice\b/.test(l))
    .map((l) => {
      const [seri, ...rest] = l.split(/\s+/);
      const model = rest.find((p) => p.startsWith('model:'))?.slice(6) ?? '';
      return { seri, model, emulator: seri.startsWith('emulator-') };
    });
}
