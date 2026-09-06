// =============================================================================
// Teks-Erp backend denetimi — GENEL TUR MOTORU (Workflow script) — v2 (2026-08-28)
// args = { tour, lens, finders:[{key,title,file,task,repro?}], seen:[...],
//          model?, effort?, premerged?:[{id,primary,merged_from,siddet,kanit_seviyesi,kategori,modul,baslik,dosya,satir}] }
// Aşamalar: ② Bulma (bağımsız denetçiler) → Birleştirme (Ç7; kompakt eşleme, tam metni JS kurar) →
//           ③ Çürütme (TOPLU: mercek × ≤6 bulgu; S0-S2 üç mercek 2/3, S3-S4 yalnız kod merceği) →
//           Doğrulama (S0/S1: K2/K3) → kalıcılaştırma (audit/tours/tur<N>.json + -full-*.json)
// NOT: Bulma aşamasının şema/prompt/opsiyonları v1 ile BAYT-BAYT aynı tutulur (önbellek prefix'i).
// =============================================================================
export const meta = {
  name: 'teks-erp-denetim-tur',
  description: 'Bir denetim turu: bulma → birleştirme → toplu 3 mercekli çürütme → S0/S1 doğrulama',
  phases: [
    { title: 'Bulma', detail: 'bağımsız denetçiler, birbirini görmez' },
    { title: 'Birleştirme', detail: 'Ç7 mükerrer ayıklama + önceki turlarla dedup (kompakt)' },
    { title: 'Çürütme', detail: 'mercek × bulgu demeti (≤6); kod / DB-veri / topoloji-etki' },
    { title: 'Doğrulama', detail: 'S0/S1 ayakta kalanlar: K2 sorgu + K3 repro; sonra kalıcılaştırma' },
  ],
}

const ROOT = '/Users/oad/Documents/projeler/AdnanSahin'
const A = ROOT + '/audit'
const { tour, lens, finders, seen } = args
const T = 'tur' + tour
// Model/efor: args.model (ör. 'opus'), args.effort (ör. 'high') — verilmezse oturumdan miras
const OPT = (extra) => ({ ...(args.model ? { model: args.model } : {}), ...(args.effort ? { effort: args.effort } : {}), ...extra })
const OPT_LOW = (extra) => ({ ...(args.model ? { model: args.model } : {}), effort: 'low', ...extra })
// Ucuz kademe (çürütme/doğrulama/birleştirme): varsayılan Sonnet + orta efor. Bulma (OPT) Opus/high KALIR.
const OPT2 = (extra) => ({ model: args.stageModel ?? 'sonnet', effort: args.stageEffort ?? 'medium', ...extra })

// ---------------------------------------------------------------------------
// Şemalar (KANIT/FINDING/FINDINGS_SCHEMA v1'den birebir)
// ---------------------------------------------------------------------------
const KANIT = { type: 'object', properties: { tur: { type: 'string', description: 'kod|sema|migration|konfig|sorgu|repro|dokuman' }, yol: { type: 'string' }, satir: { type: 'string' }, not: { type: 'string' } }, required: ['tur', 'yol', 'not'] }
const FINDING = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Denetçi-yerel id, ör. D-A-03 veya KYY-07-2' },
    baslik: { type: 'string', description: 'Kusuru SÖYLEYEN başlık: "X şu koşulda Y üretir"' },
    siddet: { type: 'string', description: 'S0|S1|S2|S3|S4' },
    kategori: { type: 'string', description: 'Prompt Bölüm 3 madde no, ör. A.1, B.3, E, G' },
    oncelik: { type: 'string', description: 'P0..P6' },
    modul: { type: 'string' },
    kanit_seviyesi: { type: 'string', description: 'K0|K1|K2|K3' },
    kanit: { type: 'array', items: KANIT },
    dosya: { type: 'string', description: 'Birincil dosya (repo köküne göre)' },
    satir: { type: 'string', description: 'Birincil satır(lar), ör. 118-146' },
    cakisma_senaryosu: { type: 'string', description: 'Yarış bulgusunda ZORUNLU: T1 A:… T2 B:… SONUÇ' },
    failure_mode: { type: 'string', description: 'Somut girdi/durum → somut yanlış çıktı' },
    veride_ihlal: { type: 'object', properties: { dev: { type: 'number' }, saha: { type: 'number' }, sorgu: { type: 'string' }, not: { type: 'string' } } },
    repro_script: { type: 'string' },
    etkilenen_degismez: { type: 'string' },
    is_etkisi: { type: 'string' },
    oneriler: { type: 'array', items: { type: 'object', properties: { vade: { type: 'string' }, aciklama: { type: 'string' } }, required: ['vade', 'aciklama'] } },
    kabul_kriteri: { type: 'string' },
    efor_gun: { type: 'number' },
    onceki_defter: { type: 'string', description: 'audit/FINDINGS.jsonl ilgili id ya da null' },
    koruma_kontrolu: { type: 'string', description: 'K1 için: hangi koruma mekanizmalarına bakıldı (kilit/claim/unique/CHECK/trigger/flag) ve neden yok' },
  },
  required: ['id', 'baslik', 'siddet', 'kategori', 'oncelik', 'modul', 'kanit_seviyesi', 'kanit', 'dosya', 'satir', 'failure_mode', 'is_etkisi'],
}
const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    output_file: { type: 'string' },
    findings: { type: 'array', items: FINDING },
    applied_checklist: { type: 'array', items: { type: 'string' }, description: 'madde: uygulandı | kapsam dışı — sebep' },
    good_practices: { type: 'array', items: { type: 'string' } },
    cross_boundary: { type: 'array', items: { type: 'string' } },
    gaps: { type: 'array', items: { type: 'string' } },
  },
  required: ['output_file', 'findings', 'applied_checklist', 'good_practices', 'cross_boundary', 'gaps'],
}
const COMPACT_ITEM = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'BULGU-T<tur>-NNN' },
    primary: { type: 'string', description: 'Temel alınan yerel id (en somut failure_mode + en yüksek kanıt)' },
    merged_from: { type: 'array', items: { type: 'string' } },
    siddet: { type: 'string' }, kanit_seviyesi: { type: 'string' }, kategori: { type: 'string' }, modul: { type: 'string' },
    baslik: { type: 'string' }, dosya: { type: 'string' }, satir: { type: 'string' },
  },
  required: ['id', 'primary', 'merged_from', 'siddet', 'kanit_seviyesi', 'baslik', 'dosya', 'satir'],
}
const MERGED_SCHEMA = {
  type: 'object',
  properties: {
    output_file: { type: 'string' },
    findings: { type: 'array', items: COMPACT_ITEM },
    dropped_as_seen: { type: 'array', items: { type: 'object', properties: { local_id: { type: 'string' }, seen_id: { type: 'string' }, reason: { type: 'string' } }, required: ['local_id', 'seen_id', 'reason'] } },
    notes: { type: 'string' },
  },
  required: ['output_file', 'findings', 'dropped_as_seen', 'notes'],
}
const VERDICT = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Bulgu id — AYNEN kopyala' },
    refuted: { type: 'boolean' },
    code: { type: 'string', description: 'Ç1|Ç2|Ç3|Ç4|Ç5|Ç6|Ç7|YOK' },
    evidence: { type: 'string', description: 'Kanıt: dosya:satır / migration satırı / konfig / sorgu sonucu. Kanıtsız çürütme geçersizdir.' },
    corrected_impact: { type: 'string', description: 'Ç6 ise doğru etki ve önerilen şiddet (S0..S4)' },
    duplicate_of: { type: 'string', description: 'Ç7 ise hangi bulgu id' },
    strengthened: { type: 'string', description: 'Çürütmeye çalışırken bulgu GÜÇLENDİYSE ne bulundu' },
    new_finding: { type: 'string', description: 'Yeni ve DAHA KÖTÜ bir şey bulunduysa tek paragraf (dosya:satır + failure_mode)' },
  },
  required: ['id', 'refuted', 'code', 'evidence'],
}
const VERDICTS_SCHEMA = { type: 'object', properties: { verdicts: { type: 'array', items: VERDICT } }, required: ['verdicts'] }
const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    output_file: { type: 'string' },
    achieved_level: { type: 'string', description: 'K0|K1|K2|K3' },
    k2: { type: 'object', properties: { sorgu: { type: 'string' }, dev: { type: 'number' }, saha: { type: 'number' }, ornek: { type: 'array', items: { type: 'string' } }, not: { type: 'string' } } },
    k3: { type: 'object', properties: { script: { type: 'string' }, log: { type: 'string' }, tekrar: { type: 'number' }, bozulma: { type: 'number' }, sonuc: { type: 'string' } } },
    verdict: { type: 'string', description: 'dogrulandi | ihlal-bulunamadi | repro-tetiklenemedi | uygulanamadi' },
    notes: { type: 'string' },
  },
  required: ['output_file', 'achieved_level', 'verdict', 'notes'],
}

// ---------------------------------------------------------------------------
// Prompt üreticiler (COMMON + finderPrompt v1'den birebir)
// ---------------------------------------------------------------------------
const COMMON = `ORTAK ZEMİN (ZORUNLU OKU, sırayla): ${A}/00-map/_BRIEF.md · ${A}/00-map/KUNYE.md · ${A}/01-find/_FINDER-BRIEF.md · /Users/oad/.claude/skills/express-api-audit/SKILL.md (+ references/*.md; §9 yanlış pozitif kataloğu bir satır yazmadan önce). Haritalar ${A}/00-map/: MATRIX.md, KRITIK-YAZMA-YOLLARI.md, SINIR-OTESI-YONLENDIRME.md (kendi alanına yönlendirilenleri işle), K12-onceki-denetim-uzlastirma.md (reddedilmiş bulguları yeni kanıt olmadan yeniden AÇMA; hâlâ açık olanları referansla) ve alanınla ilgili K*.md dosyaları. Kontrol listesi: ${ROOT}/Teks-Erp/teks-erp-denetim-promptu-v2.md Bölüm 3 (satır aralığı _FINDER-BRIEF'te).
KURALLAR: SALT-OKUNUR (Teks-Erp/src, prisma, Electron, mobil değişmez); DB yalnız ${A}/tools/sql-dev.sh ve sql-saha.sh (salt-okunur); kanıtsız bulgu YOK; failure_mode üretemiyorsan bulgu değildir; S0 için K2/K3 şart (yoksa S1 yaz); şiddet enflasyonu yok; feature-flag/SystemSetting DEĞİŞTİRME (gerekiyorsa bulguda "flag gerektirir" de). Diğer denetçilerin çıktılarını OKUMA (bağımsızlık).`

const finderPrompt = (f) => `Sen "${f.key} — ${f.title}" DENETÇİSİSİN (Teks-Erp backend denetimi, ② BULMA, TUR ${tour} — mercek: ${lens}).
${COMMON}
${f.repro ? `REPRO YÜKÜMLÜLÜĞÜ: en güçlü 2-4 yarış/mükerrer adayın için ${A}/repro/_REPRO-SOZLESMESI.md'ye uygun repro scripti YAZ (${ROOT}/Teks-Erp/scripts/audit_repro_<id>.ts — bu tek yazma iznin), 'cd ${ROOT}/Teks-Erp && npx tsx scripts/audit_repro_<id>.ts 2>&1 | tee ${A}/repro/<id>.log' ile koştur, sonucu bulguya K3 olarak işle (tetiklenemediyse bunu da yaz — negatif sonuç da kanıttır). Fixture damgası + finally temizliği ZORUNLU; global ayarlara dokunma.` : ''}
GÖREV: ${f.task}${args.extraNote ? '\nEK NOT (bu tur): ' + args.extraNote : ''}
KESİNTİDEN SÜRDÜRME: ${A}/01-find/${T}-${f.file} zaten varsa (önceki koşum kota/limit yüzünden yarıda kesilmiş demektir) onu Read ile oku; tamamlanmış bölümleri YENİDEN TÜRETME, kaldığı yerden tamamla ve StructuredOutput'u dosyadan üret.
ÇIKTI: ${A}/01-find/${T}-${f.file} dosyasını Write ile yaz (_FINDER-BRIEF'teki bulgu formatı; sonunda "Uygulanan kontrol listesi", "Doğru yapılanlar", "Sınır ötesi notlar", "Kapsanmayan"). Sonra StructuredOutput ile findings[] döndür (her bulgu için dosya/satır/kanıt/failure_mode dolu; id'ler ${f.key}-NN). Uzunluk sınırı yok; eksiksizlik önce.`

const compactRaw = (x) => ({ id: x.id, finder: x.finder, baslik: x.baslik, siddet: x.siddet, kategori: x.kategori, modul: x.modul, kanit_seviyesi: x.kanit_seviyesi, dosya: x.dosya, satir: x.satir, failure_mode: (x.failure_mode ?? '').slice(0, 320), kanit_yollari: (x.kanit ?? []).map(k => `${k.yol}${k.satir ? ':' + k.satir : ''}`).slice(0, 8) })
const dedupPrompt = (rawC) => `Sen BİRLEŞTİRME ajanısın (Teks-Erp denetimi, TUR ${tour}). Görevin yargı değil AYIKLAMA: aynı kök nedenin/aynı kod noktasının birden fazla denetçi tarafından yazılmış kopyalarını tek bulguda birleştir (Ç7) ve önceki turlarda zaten kayıtlı olanları ele. Tam metinler ${A}/01-find/${T}-*.md dosyalarında; gerekirse oradan oku.
Kurallar: (1) Aynı dosya+satır(±15) VE aynı kusur → birleştir; 'primary' = en somut failure_mode + en yüksek kanıt seviyesine sahip yerel id; merged_from'a tüm yerel id'leri yaz. (2) Aynı kök neden farklı dosyalarda → TEK bulgu. (3) Farklı kusur aynı satırda → AYRI bulgu. (4) Önceki turların listesi (seen) ile birebir aynıysa dropped_as_seen'e koy (yeni kanıt getiriyorsa DÜŞÜRME). (5) Şiddeti DEĞİŞTİRME; bulgu ekleme/silme YOK; kanit_seviyesi = kaynaklar arasındaki EN YÜKSEK. (6) Yeni id: BULGU-T${tour}-001'den başlayarak, önce S0 sonra S1…
Önceki turlarda görülenler (seen): ${args.seenFile ? `DOSYADAN OKU (Read): ${args.seenFile} — her kaydın durum alanı 'ayakta' ya da 'elendi'; elenenler yeni kanıt olmadan yeniden AÇILMAZ` : JSON.stringify(seen ?? [])}
HAM BULGULAR (kompakt, ${rawC.length} adet): ${JSON.stringify(rawC)}
ÇIKTI: ${A}/01-find/${T}-BIRLESIK.md (tablo: yeni id · başlık · şiddet · kanıt sev. · kaynak id'ler) Write ile; StructuredOutput ile KOMPAKT findings[] döndür (tam metin DEĞİL — yalnız id/primary/merged_from/siddet/kanit_seviyesi/kategori/modul/baslik/dosya/satir).`

const LENSES = [
  { key: 'kod', title: 'KOD MERCEĞİ (Ç1/Ç3/Ç5/Ç7)', task: `Bulguyu kod okuyarak YIK: (Ç1) iddia edilen yerde gerçekte kilit / atomik claim (updateMany+count) / advisory lock / unique-retry / idempotency (clientToken) var mı — çağrı zincirinin TAMAMINI izle (helper'lar, Tx-helper'lar, BaseService/BaseController sarmalayıcıları, route middleware'i; beceri §7.8 altı kaynak); (Ç3) kod erişilebilir mi — route'a bağlı mı, ölü mü, feature-flag varsayılanı kapalı mı, yalnız script'ten mi çağrılıyor; (Ç5) üst katmanda zod/validation girdiyi engelliyor mu; (Ç7) aynı kusur önceki defterde ya da bu demette başka id'yle var mı. Kanıt olarak dosya:satır + 1-6 satır alıntı ver.` },
  { key: 'db', title: 'VERİTABANI & VERİ MERCEĞİ (Ç2 + K2 teyidi)', task: `Bulguyu DB tarafından YIK: (Ç2) migration SQL'lerinde ya da canlı katalogda (audit/tools/sql-dev.sh ve sql-saha.sh ile pg_constraint / pg_indexes / pg_trigger) bu kusuru engelleyen unique / partial unique / CHECK / FK / trigger / EXCLUDE var mı — Prisma şemasında görünmeyen HAM kısıtları ara (K2b). Ayrıca bulgunun "veride fiili ihlal" iddiasını KENDİN sorgula (sorgusu varsa aynısını koş, yoksa yaz): saha'da ve dev'de kaç satır? İhlal 0 ise bu tek başına çürütme DEĞİLDİR (yarış nadir olabilir) ama olasılığı düşürür → Ç6 olarak raporla. Kanıt: migration dosyası:satır ya da sorgu + sonuç.` },
  { key: 'topoloji', title: 'TOPOLOJİ & ETKİ MERCEĞİ (Ç4/Ç6)', task: `Bulguyu koşullar ve etki üzerinden YIK: (Ç4) eşzamanlılık fiilen mümkün mü — tek process (PM2 fork, instances 1) bunu imkânsız kılıyor mu (Node event loop: iki await arasında yield var mı — beceri §1), istemci sözleşmesi (mobil kuyruk, tek tablet, buton disable) SAYILMAZ; kilit başka bir noktada (üst çağıran) alınıyor olabilir mi; (Ç6) etki iddia edilenden hafif mi — fabrikada gerçekten ne olur (metraj/top/sevk/rapor), kullanıcı anında hata görür mü, alarm/mutabakat yakalar mı, geri alınabilir mi; doğru şiddeti öner. İşlem hacmi: ~2.400 top / 3 ay, 5-10 tablet, ~0,7 istek/dk ortalama, mobil kuyruk paralel boşalır. Kanıt: konfig satırı / kod satırı / gerekçe.` },
]
const refutePrompt = (batch, l) => `Sen ÇÜRÜTÜCÜSÜN — ${l.title} (Teks-Erp denetimi, ③ ÇÜRÜTME, TUR ${tour}). Aşağıdaki ${batch.length} bulgunun HER BİRİNİ ayrı ayrı YIKMAYA çalış; görevin doğrulamak değil çürütmektir. "Bence olmaz" çürütme değildir; kanıt göstermeyen çürütme GEÇERSİZDİR. Çürütmeye çalışırken bulgunun daha KÖTÜ olduğunu görürsen 'strengthened' / 'new_finding' alanlarına yaz. Bulguların tam metni ${A}/01-find/${T}-*.md dosyalarında (kaynak id'ler merged_from'da; kaynak_dosyalar alanı).
${COMMON}
Geçerli çürütme kodları: Ç1 kod yanlış okundu (kilit/guard/claim var) · Ç2 DB koruyor (unique/check/FK/trigger) · Ç3 kod erişilemez (route'a bağlı değil, ölü, flag kapalı) · Ç4 eşzamanlılık fiilen imkânsız · Ç5 girdi mümkün değil (validation) · Ç6 etki yanlış tanımlanmış (bulgu doğru, sonuç hafif → doğru şiddet) · Ç7 mükerrer. refuted=true yalnız kanıtla; Ç6 tek başına bulguyu düşürmez, şiddetini düşürür.
MERCEĞİN: ${l.task}
BULGULAR: ${JSON.stringify(batch)}
Her bulgu için bir verdict döndür (id'yi AYNEN kopyala; ${batch.length} verdict). Kısa ve kanıtlı yaz.`

const verifyPrompt = (f) => `Sen DOĞRULAYICISIN (Teks-Erp denetimi, ③ sonrası DOĞRULAMA, TUR ${tour}). Bulgu çürütmeyi geçti ve S0/S1; görevin kanıt seviyesini K2/K3'e ÇIKARMAYI denemektir.
${COMMON}
Repro sözleşmesi: ${A}/repro/_REPRO-SOZLESMESI.md. Adımlar: (1) K2 — fiili ihlal sorgusu yaz/koş: ${A}/tools/sql-saha.sh (prod kopyası) ve sql-dev.sh; sorguyu ${A}/data/${f.id}.sql'e, sonucu ${A}/data/${f.id}.txt'e yaz (örnek kayıtlar id ile; kişisel veri yok). (2) K3 — yarış/mükerrer sınıfı bulguysa: bulguya bağlı bir repro scripti ZATEN varsa (repro_script alanı / ${ROOT}/Teks-Erp/scripts/audit_repro_<yerel id>.ts + ${A}/repro/<yerel id>.log) önce onu oku ve YENİDEN KOŞTUR (N=2/5/10, 10 tekrar); yoksa ${ROOT}/Teks-Erp/scripts/audit_repro_${f.id}.ts yaz (TEK yazma iznin) ve 'cd ${ROOT}/Teks-Erp && npx tsx scripts/audit_repro_${f.id}.ts 2>&1 | tee ${A}/repro/${f.id}.log' ile koştur; bozulma sayısını say; fixture damgası + finally temizliği; global ayar değiştirme; yazıcı/pg_dump/rclone çağırma. Tetiklenemediyse NEDENİNİ yaz — bu da kanıttır. KESİNTİDEN SÜRDÜRME: ${A}/03-verify/${f.id}.md zaten varsa önceki koşum yarıda kesilmiştir — oku, bitmiş adımları tekrarlama. (3) Sonucu ${A}/03-verify/${f.id}.md'ye yaz (sorgu, sayılar, script, log özeti, yorum) ve StructuredOutput döndür. Yarış olmayan bulgu sınıflarında (yetki, hesap, hata yutma) K3 yerine "tek istekle davranışsal kanıt" üret.
BULGU: ${JSON.stringify(f)}`

// ---------------------------------------------------------------------------
// ② BULMA (v1 ile aynı çağrı imzası — önbellek)
// ---------------------------------------------------------------------------
phase('Bulma')
log(`② TUR ${tour} (${lens}): ${finders.length} denetçi başlıyor`)
const found = await parallel(finders.map(f => () => agent(finderPrompt(f), OPT({ label: `find:${f.key}`, phase: 'Bulma', schema: FINDINGS_SCHEMA }))))
const raw = []
const finderMeta = []
found.forEach((r, i) => {
  const f = finders[i]
  finderMeta.push({ key: f.key, ok: !!r, output_file: r?.output_file ?? null, n: r?.findings?.length ?? 0, applied_checklist: r?.applied_checklist ?? [], good_practices: r?.good_practices ?? [], cross_boundary: r?.cross_boundary ?? [], gaps: r?.gaps ?? [] })
  for (const x of (r?.findings ?? [])) raw.push({ ...x, finder: f.key })
})
const rawById = {}
for (const x of raw) { if (!rawById[x.id]) rawById[x.id] = x; else log(`UYARI: yerel id çakışması ${x.id} (${x.finder} ↔ ${rawById[x.id].finder})`) }
log(`② bitti: ${raw.length} ham bulgu; düşen denetçi: ${finderMeta.filter(m => !m.ok).map(m => m.key).join(', ') || 'yok'}`)

// ---------------------------------------------------------------------------
// BİRLEŞTİRME (barrier meşru: Ç7 tüm liste üzerinde) — kompakt
// ---------------------------------------------------------------------------
phase('Birleştirme')
let mergedList = []
let droppedSeen = []
if (Array.isArray(args.premerged) && args.premerged.length) {
  mergedList = args.premerged
  log(`Birleştirme: args.premerged kullanıldı (${mergedList.length} birleşik bulgu)`)
} else if (raw.length > 0) {
  const m = await agent(dedupPrompt(raw.map(compactRaw)), OPT2({ label: 'dedup', phase: 'Birleştirme', schema: MERGED_SCHEMA }))
  mergedList = m?.findings ?? []
  droppedSeen = m?.dropped_as_seen ?? []
}
const LEVEL = ['K0', 'K1', 'K2', 'K3']
const maxLevel = (a, b) => LEVEL.indexOf(a) >= LEVEL.indexOf(b) ? a : b
const canon = mergedList.map(m => {
  const base = rawById[m.primary] ?? rawById[(m.merged_from ?? [])[0]] ?? {}
  const srcs = (m.merged_from ?? []).map(id => rawById[id]).filter(Boolean)
  const kanit = []
  const seenK = new Set()
  for (const s of srcs) for (const k of (s.kanit ?? [])) { const key = `${k.yol}|${k.satir ?? ''}|${(k.not ?? '').slice(0, 40)}`; if (!seenK.has(key)) { seenK.add(key); kanit.push(k) } }
  let level = m.kanit_seviyesi ?? base.kanit_seviyesi ?? 'K0'
  for (const s of srcs) level = maxLevel(level, s.kanit_seviyesi ?? 'K0')
  const repro = srcs.map(s => s.repro_script).filter(Boolean)
  return {
    ...base,
    id: m.id, merged_from: m.merged_from ?? [], primary: m.primary,
    siddet: m.siddet ?? base.siddet, kanit_seviyesi: level, kategori: m.kategori ?? base.kategori, modul: m.modul ?? base.modul,
    baslik: m.baslik ?? base.baslik, dosya: m.dosya ?? base.dosya, satir: m.satir ?? base.satir,
    kanit: kanit.length ? kanit : (base.kanit ?? []),
    repro_script: repro.length ? repro.join(' ; ') : (base.repro_script ?? null),
    kaynak_dosyalar: [...new Set(srcs.map(s => `${A}/01-find/${T}-${(finders.find(f => f.key === s.finder) || {}).file || ''}`))],
  }
})
log(`Birleştirme: ${raw.length} ham → ${canon.length} birleşik; önceki turlarla elenen: ${droppedSeen.length}`)

// ---------------------------------------------------------------------------
// ③ ÇÜRÜTME — TOPLU: mercek × demet (≤6 bulgu); S3/S4 yalnız kod merceği
// ---------------------------------------------------------------------------
phase('Çürütme')
const SEV = ['S0', 'S1', 'S2', 'S3', 'S4']
const downgrade = (s) => SEV[Math.min(SEV.indexOf(s) + 1, 4)]
const isEvidenced = (v) => v && v.refuted && v.code && v.code !== 'YOK' && v.code !== 'Ç6' && (v.evidence ?? '').length >= 40
const forRefute = (f) => ({ id: f.id, baslik: f.baslik, siddet: f.siddet, kategori: f.kategori, modul: f.modul, kanit_seviyesi: f.kanit_seviyesi, dosya: f.dosya, satir: f.satir, failure_mode: f.failure_mode, cakisma_senaryosu: f.cakisma_senaryosu ?? null, kanit: (f.kanit ?? []).slice(0, 10), veride_ihlal: f.veride_ihlal ?? null, repro_script: f.repro_script ?? null, koruma_kontrolu: f.koruma_kontrolu ?? null, merged_from: f.merged_from, kaynak_dosyalar: f.kaynak_dosyalar })
const sortKey = (f) => `${f.modul ?? ''}|${f.dosya ?? ''}`
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out }
const hi = canon.filter(f => f.siddet === 'S0' || f.siddet === 'S1' || f.siddet === 'S2').sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
const lo = canon.filter(f => f.siddet === 'S3' || f.siddet === 'S4').sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
const hiBatches = chunk(hi, 6)
const loBatches = chunk(lo, 8)
log(`③ çürütme: S0-S2 ${hi.length} bulgu → ${hiBatches.length} demet × 3 mercek; S3-S4 ${lo.length} bulgu → ${loBatches.length} demet × 1 mercek`)
const jobs = []
hiBatches.forEach((b, bi) => LENSES.forEach(l => jobs.push({ batch: b, lens: l, label: `refute:hi${bi + 1}:${l.key}` })))
loBatches.forEach((b, bi) => jobs.push({ batch: b, lens: LENSES[0], label: `refute:lo${bi + 1}:kod` }))
const verdictLists = await parallel(jobs.map(j => () => agent(refutePrompt(j.batch.map(forRefute), j.lens), OPT2({ label: j.label, phase: 'Çürütme', schema: VERDICTS_SCHEMA })).then(r => ({ job: j, verdicts: r?.verdicts ?? null }))))
const verdictsById = {}
for (const f of canon) verdictsById[f.id] = []
verdictLists.filter(Boolean).forEach(({ job, verdicts }) => {
  const byId = new Map((verdicts ?? []).map(v => [v.id, v]))
  for (const f of job.batch) {
    const v = byId.get(f.id)
    verdictsById[f.id].push({ lens: job.lens.key, ...(v ?? { refuted: false, code: 'YOK', evidence: verdicts ? 'çürütücü bu bulgu için verdict döndürmedi' : 'çürütücü ajan yanıt vermedi' }) })
  }
})
const refutedAll = canon.map(f => {
  const verdicts = verdictsById[f.id]
  const need = verdicts.length >= 3 ? 2 : 1
  const evidenced = verdicts.filter(isEvidenced)
  const c6 = verdicts.filter(v => v.code === 'Ç6')
  const dupOf = verdicts.filter(v => v.code === 'Ç7' && v.duplicate_of).map(v => v.duplicate_of)
  let status = 'ayakta', siddet = f.siddet, reason = ''
  if (evidenced.length >= need) { status = 'elendi'; reason = evidenced.map(v => `${v.lens}:${v.code} — ${v.evidence}`).join(' || ') }
  else if (c6.length >= 1) { status = 'ayakta-siddet-dustu'; siddet = downgrade(f.siddet); reason = c6.map(v => `${v.lens}:Ç6 — ${v.corrected_impact ?? v.evidence}`).join(' || ') }
  else if (evidenced.length === 1) { status = 'ayakta'; reason = `1 çürütme yetersiz (${evidenced[0].lens}:${evidenced[0].code})` }
  const strengthened = verdicts.filter(v => v.strengthened).map(v => `${v.lens}: ${v.strengthened}`)
  const newFindings = verdicts.filter(v => v.new_finding).map(v => ({ from: f.id, lens: v.lens, text: v.new_finding }))
  return { ...f, siddet_ilk: f.siddet, siddet, curutme: { verdicts, status, reason, strengthened, dupOf, lens_count: verdicts.length }, newFindings }
})
const standing = refutedAll.filter(f => f.curutme.status !== 'elendi')
const dropped = refutedAll.filter(f => f.curutme.status === 'elendi')
log(`③ çürütme: ${refutedAll.length} bulgu → ayakta ${standing.length}, elendi ${dropped.length}, şiddeti düşen ${standing.filter(f => f.curutme.status === 'ayakta-siddet-dustu').length}`)

// ---------------------------------------------------------------------------
// DOĞRULAMA — S0/S1 ayakta kalanlar
// ---------------------------------------------------------------------------
phase('Doğrulama')
const toVerify = standing.filter(f => f.siddet === 'S0' || f.siddet === 'S1')
const verified = await parallel(toVerify.map(f => () =>
  agent(verifyPrompt(forRefute(f)), OPT2({ label: `verify:${f.id}`, phase: 'Doğrulama', schema: VERIFY_SCHEMA })).then(v => ({ id: f.id, v }))
))
const vmap = Object.fromEntries(verified.filter(Boolean).map(x => [x.id, x.v]))
const final = standing.map(f => {
  const v = vmap[f.id]
  let level = f.kanit_seviyesi ?? 'K0'
  if (v && LEVEL.indexOf(v.achieved_level) > LEVEL.indexOf(level)) level = v.achieved_level
  let siddet = f.siddet
  let kural = ''
  if (siddet === 'S0' && LEVEL.indexOf(level) < 2) { siddet = 'S1'; kural = 'S0 için K2/K3 şart → S1' }
  return { ...f, kanit_seviyesi_ilk: f.kanit_seviyesi, kanit_seviyesi: level, siddet, siddet_kurali: kural, dogrulama: v ?? null }
})
log(`Doğrulama: ${toVerify.length} S0/S1 bulgu için K2/K3 denendi; ulaşılan: ${final.filter(f => f.kanit_seviyesi === 'K3').length} K3, ${final.filter(f => f.kanit_seviyesi === 'K2').length} K2`)
const newFromRefuters = refutedAll.flatMap(f => f.newFindings)

// ---------------------------------------------------------------------------
// KALICILAŞTIRMA — kompakt sonuç + tam metin parçaları (script'in fs erişimi yok → ajan yazar)
// ---------------------------------------------------------------------------
const slimVerdicts = (vs) => vs.map(v => ({ lens: v.lens, refuted: v.refuted, code: v.code, evidence: v.evidence, corrected_impact: v.corrected_impact ?? null, duplicate_of: v.duplicate_of ?? null }))
const compact = {
  tour, lens,
  counts: { raw: raw.length, merged: canon.length, standing: final.length, dropped: dropped.length },
  finders: finderMeta,
  dropped_as_seen: droppedSeen,
  findings: final.map(f => ({ id: f.id, merged_from: f.merged_from, primary: f.primary, baslik: f.baslik, siddet_ilk: f.siddet_ilk, siddet: f.siddet, siddet_kurali: f.siddet_kurali, kategori: f.kategori, oncelik: f.oncelik ?? null, modul: f.modul, kanit_seviyesi_ilk: f.kanit_seviyesi_ilk, kanit_seviyesi: f.kanit_seviyesi, dosya: f.dosya, satir: f.satir, repro_script: f.repro_script ?? null, curutme: { status: f.curutme.status, reason: f.curutme.reason, strengthened: f.curutme.strengthened, lens_count: f.curutme.lens_count, verdicts: slimVerdicts(f.curutme.verdicts) }, dogrulama: f.dogrulama })),
  dropped: dropped.map(f => ({ id: f.id, merged_from: f.merged_from, baslik: f.baslik, siddet_ilk: f.siddet_ilk, kategori: f.kategori, dosya: f.dosya, satir: f.satir, reason: f.curutme.reason, verdicts: slimVerdicts(f.curutme.verdicts) })),
  new_from_refuters: newFromRefuters,
}
// NOT: kompakt sonuç ajanla yazılmıyor (2026-08-28: düşük eforlu ajan 300 KB JSON'u kısaltarak yazdı) — tur sonu
// audit/tools/rebuild-tour.py journal'dan mekanik kurar. Yalnız tam metin parçaları (25'lik) ajanla yazılır.
const persistJobs = []
const fullAll = final.map(f => { const { curutme, newFindings, dogrulama, ...rest } = f; return { ...rest, curutme_status: curutme.status } })
chunk(fullAll, 25).forEach((part, i) => persistJobs.push({ file: `${A}/tours/${T}-full-${i + 1}.json`, data: part, count: part.length, countPath: 'length' }))
await parallel(persistJobs.map(p => () => agent(`Mekanik görev: aşağıdaki JSON'u OLDUĞU GİBİ (hiçbir alanı değiştirmeden/kısaltmadan) ${p.file} dosyasına Write aracıyla yaz; sonra 'jq -r "${p.countPath}" ${p.file}' ile geçerli JSON olduğunu ve sayının ${p.count} olduğunu doğrula. Başka hiçbir şey yapma. JSON:\n${JSON.stringify(p.data)}`, OPT_LOW({ label: `persist:${p.file.split('/').pop()}`, phase: 'Doğrulama' }))))

return {
  tour, lens,
  counts: { raw: raw.length, merged: canon.length, standing: final.length, dropped: dropped.length, s0: final.filter(f => f.siddet === 'S0').length, s1: final.filter(f => f.siddet === 'S1').length, s2: final.filter(f => f.siddet === 'S2').length, s3s4: final.filter(f => f.siddet === 'S3' || f.siddet === 'S4').length, k3: final.filter(f => f.kanit_seviyesi === 'K3').length, k2: final.filter(f => f.kanit_seviyesi === 'K2').length },
  finders: finderMeta.map(m => ({ key: m.key, ok: m.ok, n: m.n })),
  standing: final.map(f => ({ id: f.id, siddet: f.siddet, kanit: f.kanit_seviyesi, status: f.curutme.status, baslik: f.baslik })),
  dropped: dropped.map(f => ({ id: f.id, siddet_ilk: f.siddet_ilk, baslik: f.baslik, reason: f.curutme.reason.slice(0, 300) })),
  new_from_refuters: newFromRefuters,
  persisted: persistJobs.map(p => p.file),
}
