/**
 * BEKÇİ — okutma handler'ında doğrudan `Haptics.` çağrısı yasak.
 *
 * Okutmanın ÜÇ sonucu vardır (`services/scanFeedback.ts`: accept · duplicate ·
 * reject) ve tek kapısı `signalScan` / `useScanFeedback`tir. Ham `Haptics`
 * çağıran ekran iki şeyi birden kaybeder: "mükerrer" deseni (kabulle aynı
 * hissi verir → operatör topu iki kez saydığını sanır) ve `scanSoundEnabled`
 * cihaz ayarı (ses HİÇ çıkmaz). 2026-09-05 ölçümü: 11 dosya bu haldeydi.
 *
 * Tarama TS AST ile: her `Haptics.*` çağrısının EN YAKIN adlı bildirimi
 * çözülür; adı okutma-biçimliyse (`scan` / `barcode` / `okut` / `card`) ya da
 * `EK_OKUTMA_HANDLERLARI`nda ise o çağrı ihlaldir.
 *
 * Bilinen sınır: yalnız EN YAKIN adlı bildirime bakılır. Bir üst halkaya da
 * bakmak ölçüldü ve reddedildi — `ScannerSettingsScreen` içindeki `toggle`
 * gibi ayar fonksiyonlarını yanlış pozitif yapıyordu.
 *
 * MUAFİYET listeleri (`MUAF` · `DEVRALINAN`) İKİ YÖNLÜDÜR: bir kayıt artık
 * hiçbir çağrıyı karşılamıyorsa bekçi KIRMIZI verir — bayat muafiyet sessizce
 * koruma boşluğu açmasın, devralınan liste de yalnız KISALSIN. `DEVRALINAN`
 * 2026-09-05'te (İ-20) boşaldı; okutma yolunda ham `Haptics` yalnız üç
 * gerekçeli muafiyette kaldı.
 *
 * `EK_OKUTMA_HANDLERLARI` bir muafiyet DEĞİL, kapsam genişleticidir; tazeliği
 * "handler hâlâ duruyor mu" diye ayrı ölçülür (aşağıdaki sonda).
 */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';

const SRC = path.resolve(__dirname, '..');

/** Okutma-biçimli handler adı. Ölçümle seçildi (2026-09-05, 208 `Haptics.`
 *  çağrısı / 44 dosya): bu dört kök yalnız okutma yollarını yakalıyor. */
const OKUTMA_ADI = /scan|barcode|okut|card/i;

/** Okutma yolunda olan ama adından anlaşılmayan handler'lar (ölçümle bulundu). */
const EK_OKUTMA_HANDLERLARI: Record<string, string> = {
  'screens/Modules/FasonSevk/FasonSevkScreen.tsx#notifyReject':
    'okutulan topun RET yüzeyi — tarayıcı kapalıyken çalışan kol',
  'screens/Modules/FasonSevk/FasonSevkScreen.tsx#addRollToList':
    'okutulan topu listeye alır; kumaş uyuşmazlığı dalı okutmanın sonucudur',
  'screens/Modules/KartelaSevk/KartelaSevkScreen.tsx#addRoll':
    'kartela sevkinde okutulan topu listeye alır',
  'screens/Modules/IadeGirisi/IadeGirisiScreen.tsx#lookup':
    'iade girişinde barkod sorgusu — okutmanın kendisi',
};

/** MUAF — okutma yolunda ama SONUÇ sinyali vermiyor (gerekçeli). */
const MUAF: Record<string, string> = {
  'components/BarcodeScannerView.tsx#handleScanned':
    'YAKALAMA onayı (opt-in `captureHaptic`): "gördüm" der, kabul/ret demez. Paylaşılan tarayıcı bileşeni; sonucu ÇAĞIRAN yönetir (bileşenin kendi notu).',
  'screens/Modules/HizliIsEmri/useQuickWorkOrder.ts#handleScan':
    'yakalama tıkı; sonucu aynı dosya `signalScan`/`flashDuplicate` ile ayrıca veriyor. Sözleşmede "yakalandı" sonucu YOK — dördüncüsü uydurulmaz.',
  'screens/Auth/LoginScreen.tsx#submitCard':
    'KİMLİK yolu, istasyon okutması DEĞİL: sonucu bir giriş denemesidir ve üç sonuçluk sözlük karşılık bulmuyor ("mükerrer giriş" diye bir şey yok). Aynı ekranda PIN ve şifre kolları birebir aynı geri bildirimi veriyor; yalnız kart kolunu çevirmek giriş ekranını kendi içinde ayrıştırırdı. `scanSoundEnabled` istasyon okutması ayarıdır, giriş bipini yönetmez. Adı `card` içerdiği için OKUTMA_ADI regexine takılıyor.',
};

/** DEVRALINAN — okutma yolunda ham `Haptics` taşıyan, henüz çevrilmemiş
 *  handler'lar. Bu liste yalnız KISALIR; 2026-09-05'te (İ-20) BOŞALDI. */
const DEVRALINAN: Record<string, string> = {};

/** Sinyalin KENDİSİ burada üretilir — tek meşru `Haptics` sahibi. */
const SINYAL_KAYNAGI = 'services/scanFeedback.ts';

function walkSrc(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkSrc(p, out);
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/** Çağrıyı saran EN YAKIN adlı bildirimin adı (arrow fonksiyonların adı
 *  atandıkları değişkendir; `onSuccess: () => {}` gibi nesne alanları da ad sayılır). */
function enclosingName(n: ts.Node, sf: ts.SourceFile): string {
  let cur: ts.Node | undefined = n.parent;
  while (cur) {
    if (ts.isVariableDeclaration(cur)) return cur.name.getText(sf);
    if (ts.isFunctionDeclaration(cur) && cur.name) return cur.name.getText(sf);
    if (ts.isMethodDeclaration(cur)) return cur.name.getText(sf);
    if (ts.isPropertyAssignment(cur)) return cur.name.getText(sf);
    cur = cur.parent;
  }
  return '<anonim>';
}

describe('Okutma handler’ında doğrudan Haptics çağrılmaz (signalScan tek kapı)', () => {
  const offenders: string[] = [];
  const hits = new Set<string>();
  let hapticsCalls = 0;
  let filesWithHaptics = 0;
  let scanSites = 0;

  for (const file of walkSrc(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join('/');
    if (rel === SINYAL_KAYNAGI) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (!text.includes('Haptics.')) continue;
    filesWithHaptics++;
    const sf = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    const visit = (n: ts.Node): void => {
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        n.expression.expression.getText(sf) === 'Haptics'
      ) {
        hapticsCalls++;
        const name = enclosingName(n, sf);
        const key = `${rel}#${name}`;
        if (OKUTMA_ADI.test(name) || key in EK_OKUTMA_HANDLERLARI) {
          scanSites++;
          hits.add(key);
          if (!(key in MUAF) && !(key in DEVRALINAN)) {
            const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
            offenders.push(`${rel}:${line + 1} (${name})`);
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }

  it('körlük zemini: tarayıcı gerçekten kod okudu', () => {
    // "0 ihlal" ile "hiçbir şeye bakılmadı" aynı yeşile çıkmasın (bekçi konvansiyonu).
    expect(hapticsCalls).toBeGreaterThanOrEqual(150);
    expect(filesWithHaptics).toBeGreaterThanOrEqual(30);
    // İ-20 bitince okutma yolunda ham `Haptics` YALNIZ üç MUAF kaydında kaldı
    // (4 çağrı). Zemin bu yüzden 10'dan 4'e indi: sayı düşerse bir muafiyet
    // kaybolmuş demektir ve onu zaten aşağıdaki iki yönlü sonda yakalar.
    expect(scanSites).toBeGreaterThanOrEqual(4);
  });

  it('okutma handler’ında listelenmemiş ham Haptics çağrısı yok', () => {
    expect(offenders).toEqual([]);
  });

  it('muafiyet ve devralınan kayıtlar bayat değil (iki yönlü)', () => {
    const stale = [...Object.keys(MUAF), ...Object.keys(DEVRALINAN)].filter((k) => !hits.has(k));
    // Kayıt karşılıksız kaldıysa handler çevrildi ya da adı değişti → kaydı SİL.
    // MUAF ve DEVRALINAN birer MUAFİYETtir: bayat kalanı sessiz bir koruma
    // boşluğudur. `EK_OKUTMA_HANDLERLARI` ise TERSİ — kapsamı GENİŞLETİR
    // (adı okutma-biçimli olmayan handler'ı tarar), o yüzden burada ölçülmez:
    // handler çevrilince kaydı silmek, aynı yere yarın konacak ham `Haptics`i
    // görünmez yapardı. Onun tazeliği bir sonraki sondada ölçülür.
    expect(stale).toEqual([]);
  });

  it('EK_OKUTMA_HANDLERLARI kayıtları hâlâ var olan handler’ları gösterir', () => {
    // Genişletici liste `hits`le ölçülemez (çevrilmiş handler hiç `Haptics`
    // çağırmaz). Ölçülen şey ADIN yaşıyor olması: dosya duruyor mu, handler o
    // dosyada hâlâ tanımlı mı — yeniden adlandırılmış/silinmiş kayıt ölüdür.
    const dead = Object.keys(EK_OKUTMA_HANDLERLARI).filter((k) => {
      const [rel, name] = k.split('#');
      const file = path.join(SRC, rel);
      if (!fs.existsSync(file)) return true;
      return !new RegExp(`\\b${name}\\b`).test(fs.readFileSync(file, 'utf8'));
    });
    expect(dead).toEqual([]);
  });

  it('çevrilen ekranların hepsi okutma yolunda signalScan kullanır', () => {
    for (const f of [
      'screens/Modules/Depo/DepoScreen.tsx',
      'screens/Modules/KursunQc/KursunQcScreen.tsx',
      'screens/Modules/TartiPaket/PaketlemeScreen.tsx',
      'screens/Modules/FasonKabul/FasonKabulScreen.tsx',
      'screens/Modules/FasonSevk/FasonSevkScreen.tsx',
      'screens/Modules/Tambur/TamburScreen.tsx',
      'screens/Modules/KartelaSevk/KartelaSevkScreen.tsx',
      'screens/Modules/IadeGirisi/IadeGirisiScreen.tsx',
    ]) {
      expect(fs.readFileSync(path.join(SRC, f), 'utf8')).toContain("signalScan(");
    }
  });
});
