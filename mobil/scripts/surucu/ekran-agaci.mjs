// =============================================================================
// EKRAN AĞACI — uiautomator dump XML'ini paketsiz ayrıştırır, düğüm arar
// =============================================================================
// Dump'ta her `<node …/>` düz bir öznitelik çantasıdır; hiyerarşi derinlik sayacıyla
// tutulur. RN Android eşlemesi (ÖLÇÜLDÜ 2026-09-18, Expo 54 / RN 0.81, emülatör):
//   testID            → resource-id   (paket öneki YOK, olduğu gibi)
//   accessibilityLabel→ content-desc
//   <Text> içeriği    → text          (TextView); Button etiketi de text
// Bu yüzden `bul({ id })` resource-id'ye, `bul({ desc })` content-desc'e, `bul({ text })`
// text'e bakar; hepsi TAM eşleşme, `re` düzenli ifade.
// =============================================================================

/** @typedef {{ tag: string, derinlik: number, index: number, text: string, desc: string, id: string, sinif: string, paket: string, clickable: boolean, enabled: boolean, focused: boolean, selected: boolean, checked: boolean, bounds: {x1:number,y1:number,x2:number,y2:number}, merkez: {x:number,y:number} }} Dugum */

const OZNITELIK = /([\w:-]+)="((?:[^"\\]|\\.)*)"/g;

function kacisCoz(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

function boundsCoz(s) {
  const m = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(s ?? '');
  if (!m) return { x1: 0, y1: 0, x2: 0, y2: 0 };
  return { x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4] };
}

/** @returns {Dugum[]} belge sırasında düz liste */
export function ayristir(xml) {
  const dugumler = [];
  let derinlik = 0;
  const etiket = /<(\/?)node\b([^>]*?)(\/?)>/g;
  let m;
  while ((m = etiket.exec(xml))) {
    const kapanis = m[1] === '/';
    const tekil = m[3] === '/';
    if (kapanis) {
      derinlik--;
      continue;
    }
    const a = {};
    let om;
    OZNITELIK.lastIndex = 0;
    while ((om = OZNITELIK.exec(m[2]))) a[om[1]] = kacisCoz(om[2]);
    const bounds = boundsCoz(a.bounds);
    dugumler.push({
      tag: 'node',
      derinlik,
      index: Number(a.index ?? -1),
      text: a.text ?? '',
      desc: a['content-desc'] ?? '',
      id: a['resource-id'] ?? '',
      sinif: a.class ?? '',
      paket: a.package ?? '',
      clickable: a.clickable === 'true',
      enabled: a.enabled !== 'false',
      focused: a.focused === 'true',
      selected: a.selected === 'true',
      checked: a.checked === 'true',
      bounds,
      merkez: { x: Math.round((bounds.x1 + bounds.x2) / 2), y: Math.round((bounds.y1 + bounds.y2) / 2) },
    });
    if (!tekil) derinlik++;
  }
  return dugumler;
}

/**
 * Seçici: { text?, desc?, id?, re?: RegExp (text|desc|id üstünde), icerir?: string (text içinde geçer), clickable?: boolean }
 * Tam eşleşme; `icerir` alt dize; `re` üç alanı da tarar.
 */
export function esle(d, sec) {
  if (sec.text != null && d.text !== sec.text) return false;
  if (sec.desc != null && d.desc !== sec.desc) return false;
  if (sec.id != null && d.id !== sec.id) return false;
  if (sec.icerir != null && !d.text.includes(sec.icerir) && !d.desc.includes(sec.icerir)) return false;
  if (sec.re != null && !(sec.re.test(d.text) || sec.re.test(d.desc) || sec.re.test(d.id))) return false;
  if (sec.clickable != null && d.clickable !== sec.clickable) return false;
  if (sec.enabled != null && d.enabled !== sec.enabled) return false;
  return true;
}

/** @returns {Dugum[]} */
export function hepsiniBul(dugumler, sec) {
  return dugumler.filter((d) => esle(d, sec));
}

/** İlk eşleşen; yoksa null. `n` ile n. eşleşme (0 tabanlı). */
export function bul(dugumler, sec, n = 0) {
  const l = hepsiniBul(dugumler, sec);
  return l[n] ?? null;
}

/**
 * Metin düğümü çoğu zaman dokunulamaz (clickable=false); dokunulabilir ATA'yı bulur:
 * belge sırasında geriye gidip derinliği küçük olan ilk clickable düğüm. Yoksa düğümün kendisi.
 */
export function dokunulabilir(dugumler, dugum) {
  const i = dugumler.indexOf(dugum);
  if (dugum.clickable || i < 0) return dugum;
  for (let k = i - 1; k >= 0; k--) {
    const a = dugumler[k];
    if (a.derinlik < dugum.derinlik && a.clickable) return a;
    if (a.derinlik < dugum.derinlik && !a.clickable) {
      // ata ama tıklanamaz — daha yukarıya bakmaya devam (RN'de Pressable birkaç kat üstte olabilir)
      continue;
    }
  }
  return dugum;
}

/** Kısa özet (log için): görünür metinler + id/desc'li düğümler. */
export function ozet(dugumler, { enCok = 60 } = {}) {
  return dugumler
    .filter((d) => d.text || d.desc || d.id)
    .slice(0, enCok)
    .map((d) => `${' '.repeat(Math.min(d.derinlik, 12))}${d.clickable ? '●' : '·'} ${d.text ? `"${d.text}"` : ''}${d.desc ? ` desc=${JSON.stringify(d.desc)}` : ''}${d.id ? ` id=${d.id}` : ''} @${d.merkez.x},${d.merkez.y}`)
    .join('\n');
}
