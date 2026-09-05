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
 * İki liste de İKİ YÖNLÜDÜR: bir kayıt artık hiçbir çağrıyı karşılamıyorsa
 * bekçi KIRMIZI verir — bayat muafiyet sessizce koruma boşluğu açmasın,
 * devralınan liste de yalnız KISALSIN.
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
};

/** DEVRALINAN — okutma yolunda ham `Haptics` taşıyan, henüz çevrilmemiş
 *  handler'lar (2026-09-05 ölçümü). Bu liste yalnız KISALIR. */
const DEVRALINAN: Record<string, string> = {
  'screens/Modules/FasonKabul/FasonKabulScreen.tsx#handleResolveCard': 'İ-20 kalan iş',
  'screens/Modules/FasonSevk/FasonSevkScreen.tsx#handleCardScan': 'İ-20 kalan iş (top yolu çevrildi, KART yolu bekliyor)',
  'screens/Modules/FasonSevk/FasonSevkScreen.tsx#addBarcodeFromString': 'İ-20 kalan iş',
  'screens/Modules/FasonSevk/FasonSevkScreen.tsx#notifyReject': 'İ-20 kalan iş',
  'screens/Modules/FasonSevk/FasonSevkScreen.tsx#addRollToList': 'İ-20 kalan iş',
  'screens/Modules/Tambur/TamburScreen.tsx#resolveCard': 'İ-20 kalan iş',
  'screens/Modules/Tambur/TamburScreen.tsx#resolveScanned': 'İ-20 kalan iş',
  'screens/Modules/KartelaSevk/KartelaSevkScreen.tsx#addRoll': 'İ-20 kalan iş',
  'screens/Modules/IadeGirisi/IadeGirisiScreen.tsx#lookup': 'İ-20 kalan iş',
  'screens/Auth/LoginScreen.tsx#submitCard': 'KİMLİK yolu (personel QR kartı) — istasyon sözlüğü uygulanacak mı, AÇIK KARAR',
};

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
    expect(scanSites).toBeGreaterThanOrEqual(10);
  });

  it('okutma handler’ında listelenmemiş ham Haptics çağrısı yok', () => {
    expect(offenders).toEqual([]);
  });

  it('muafiyet ve devralınan kayıtlar bayat değil (iki yönlü)', () => {
    const stale = [...Object.keys(MUAF), ...Object.keys(DEVRALINAN), ...Object.keys(EK_OKUTMA_HANDLERLARI)]
      .filter((k) => !hits.has(k));
    // Kayıt karşılıksız kaldıysa handler çevrildi ya da adı değişti → kaydı SİL.
    expect(stale).toEqual([]);
  });

  it('çevrilen üç ekran okutma yolunda signalScan kullanır', () => {
    for (const f of [
      'screens/Modules/Depo/DepoScreen.tsx',
      'screens/Modules/KursunQc/KursunQcScreen.tsx',
      'screens/Modules/TartiPaket/PaketlemeScreen.tsx',
    ]) {
      expect(fs.readFileSync(path.join(SRC, f), 'utf8')).toContain("signalScan(");
    }
  });
});
