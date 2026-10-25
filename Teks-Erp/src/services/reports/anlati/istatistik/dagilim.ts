// =============================================================================
// Dağılım fonksiyonları — Student-t ve ki-kare kuyruk olasılıkları (R3-ISTAT; plan §3.8)
// =============================================================================
// Paket yerine ~80 satır kendi kodumuz (KARARLAR: "p-değeri kendi"): düzenlenmiş eksik beta
// (t) ve eksik gama (ki-kare). Yakınsama sınırlıdır; tanımsız girdi NaN döner, sessizce 0/1 olmaz.
// Referans değerler `test_rapor_istatistik` §1'de dört haneyle ölçülür.

const MAX_ITER = 300;
const EPS = 1e-14;
const TINY = 1e-300;

/** ln Γ(x) — Lanczos (g=7, n=9); x > 0. */
export function logGamma(x: number): number {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - logGamma(1 - x);
  const z = x - 1;
  let a = c[0]!;
  const t = z + 7.5;
  for (let i = 1; i < 9; i++) a += c[i]! / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Eksik beta sürekli kesri (Lentz). */
function betaFraction(a: number, b: number, x: number): number {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAX_ITER; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) return h;
  }
  return NaN;
}

/** Düzenlenmiş eksik beta I_x(a, b). */
export function regularizedBeta(x: number, a: number, b: number): number {
  if (!(a > 0 && b > 0) || !(x >= 0 && x <= 1)) return NaN;
  if (x === 0 || x === 1) return x;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  // Simetri: kesir x < (a+1)/(a+b+2) bölgesinde hızlı yakınsar.
  return x < (a + 1) / (a + b + 2) ? (front * betaFraction(a, b, x)) / a : 1 - (front * betaFraction(b, a, 1 - x)) / b;
}

/** Düzenlenmiş üst eksik gama Q(a, x) = 1 − P(a, x). */
export function upperRegularizedGamma(a: number, x: number): number {
  if (!(a > 0) || !(x >= 0) || !Number.isFinite(x)) return x === Infinity ? 0 : NaN;
  if (x === 0) return 1;
  const lead = -x + a * Math.log(x) - logGamma(a);
  if (x < a + 1) {
    let sum = 1 / a;
    let term = sum;
    for (let n = 1; n <= MAX_ITER; n++) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * EPS) return 1 - sum * Math.exp(lead);
    }
    return NaN;
  }
  let b = x + 1 - a;
  let c = 1 / TINY;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= MAX_ITER; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < TINY) d = TINY;
    c = b + an / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) return Math.exp(lead) * h;
  }
  return NaN;
}

/** Student-t birikimli dağılımı P(T ≤ t), `df` serbestlik derecesi. */
export function studentTCdf(t: number, df: number): number {
  if (!(df > 0) || Number.isNaN(t)) return NaN;
  const tail = 0.5 * regularizedBeta(df / (df + t * t), df / 2, 0.5);
  return t >= 0 ? 1 - tail : tail;
}

/** İki yönlü t olasılığı P(|T| ≥ |t|). */
export function studentTTwoSided(t: number, df: number): number {
  if (!(df > 0) || Number.isNaN(t)) return NaN;
  return regularizedBeta(df / (df + t * t), df / 2, 0.5);
}

/** Ki-kare birikimli dağılımı P(X ≤ x), `df` serbestlik derecesi. */
export function chiSquareCdf(x: number, df: number): number {
  return 1 - chiSquareSurvival(x, df);
}

/** Ki-kare üst kuyruk P(X ≥ x) — küçük olasılıkta 1−CDF'in yuvarlama kaybı olmasın diye doğrudan Q. */
export function chiSquareSurvival(x: number, df: number): number {
  if (!(df > 0) || Number.isNaN(x)) return NaN;
  if (x <= 0) return 1;
  return upperRegularizedGamma(df / 2, x / 2);
}
