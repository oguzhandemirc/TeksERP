// =============================================================================
// Teks-Erp backend denetimi — ⑤ SENTEZ (Workflow script)
// Girdi: audit/findings.json (tüm turların ayakta kalan bulguları) + haritalar + tur dosyaları
// Çıktı: audit/RAPOR-bolum-*.md parçaları (orkestratör bunları RAPOR-2026-08-29.md'ye birleştirir)
// args = { effort?, stageModel?, stageEffort? }   (model verilmez → oturumdan miras)
// =============================================================================
export const meta = {
  name: 'teks-erp-denetim-sentez',
  description: 'Kök neden kümeleme, veri sağlık anlatısı, yol haritası ve yönetici özeti',
  phases: [
    { title: 'Analiz', detail: 'kök neden · veri sağlığı · yol haritası · ekibin doğru yaptıkları (paralel)' },
    { title: 'Özet', detail: 'yönetici özeti — diğer bölümlerin üstüne yazılır' },
  ],
}

const ROOT = '/Users/oad/Documents/projeler/AdnanSahin'
const A = ROOT + '/audit'
const OPT = (extra) => ({ ...(args.effort ? { effort: args.effort } : {}), ...extra })

const COMMON = `BAĞLAM: Teks-Erp (tekstil fabrikası ERP) backend'inin çok ajanlı, salt-okunur denetimi bitti. Dört tur koşuldu: kod merkezli, veri merkezli (üretimin 2026-08-25 kopyasında ölçüm), senaryo merkezli, sınır durum merkezli. Her bulgu bağımsız çürütücülerden geçti.
OKUMAN GEREKENLER: ${A}/findings.json (tüm ayakta kalan bulgular; şiddet S0-S4, kanıt K0-K3, failure_mode, veride_ihlal, öneriler) · ${A}/_rapor-tablolari.md (mekanik tablolar) · ${A}/00-map/KUNYE.md (doğrulanmış teknik künye) · ${A}/00-map/MATRIX.md ÇAPRAZ OKUMA bölümü · ${A}/00-map/KRITIK-YAZMA-YOLLARI.md · ${A}/tours/tur*.json (çürütme kayıtları) · ${A}/00-map/ERISILEMEYEN.md (kanıt boşlukları ve varsayımlar) · ${A}/03-verify/_hasat.json (denetçilerin "doğru yapılanlar", kontrol listesi, boşluk notları).
KURALLAR: SALT-OKUNUR — kaynak koda dokunma; yalnız sana söylenen çıktı dosyasını yaz. Kanıtsız cümle kurma; her iddianın arkasında bulgu id'si ya da dosya:satır olsun. Türkçe yaz. Uydurma sayı YOK — sayılar findings.json'dan gelir. Fabrika gerçekliğine dön: depoda, üretimde, sevkiyatta ne olur.`

const SCHEMA = {
  type: 'object',
  properties: {
    output_file: { type: 'string' },
    summary: { type: 'string', description: '5-10 cümle: ne ürettin, ana sonuç' },
    key_points: { type: 'array', items: { type: 'string' }, description: 'Diğer bölümlerin kullanacağı en önemli çıkarımlar (bulgu id\'leriyle)' },
  },
  required: ['output_file', 'summary', 'key_points'],
}

phase('Analiz')
const jobs = [
  {
    key: 'kok-neden', file: 'RAPOR-bolum-9-kok-neden.md', label: 'kök neden',
    task: `GÖREV — Bölüm 9: KÖK NEDEN ANALİZİ. ${'`'}findings.json${'`'}'daki bulguların TAMAMINI oku ve bunları **kök neden kümelerine** indirge: "N bulgu değil, M kök neden, N belirti". Hedef 6-10 küme.
Her küme için: (a) kümenin adı — kusuru söyleyen bir cümle (ör. "Sipariş defteri yazımı sevk yolunun yan etkisi, kendi kapısı yok"); (b) hangi bulgular bu kümeye ait (id listesi, şiddetleriyle); (c) MEKANİZMA — bu kök neden nasıl bu kadar çok yerde tekrar etti (mimari karar mı, eksik ortak katman mı, ekip alışkanlığı mı); (d) fabrikadaki toplam etkisi; (e) kümeyi kapatan TEK müdahale ne olurdu (bulgu bulgu düzeltmek yerine); (f) kümenin kalıcı bekçisi ne olmalı.
Sonra "ÇAPRAZ DESENLER" bölümü: turlar arası tekrar eden üst-desenler (ör. "kapı transaction DIŞINDA okunuyor" kaç bulguda; "istemci sözleşmesi sunucuda zorlanmıyor" kaç bulguda; "bekçi kusurla aynı yerde kör" kaç vakada). Sayıları findings.json'dan MEKANİK say, tahmin etme.
Son bölüm: "BU DENETİMİN EN ÖNEMLİ TEK CÜMLESİ" — bir cümlede sistemin asıl yapısal zaafı.`,
  },
  {
    key: 'veri-saglik', file: 'RAPOR-bolum-7-veri-saglik.md', label: 'veri sağlığı',
    task: `GÖREV — Bölüm 7: VERİ SAĞLIK RAPORU (anlatı + tablo). Kaynak: ${A}/_rapor-tablolari.md §7 (mekanik tablo, 100+ ölçüm), ${A}/01-find/tur2-V-*.md (asıl ölçüm dosyaları: sorgular, sayılar, örnek kayıtlar), ${A}/data/*.sql ve *.txt (doğrulayıcı sorguları).
Üret: (1) ÖLÇÜM ORTAMI — hangi veritabanı, hangi tarih, hangi migration seviyesi, neyin ölçülemediği (canlı prod yok; kopya 190/195 migration); (2) SAYILARLA ÖZET — üretim kopyasında kaç kayıt tarandı, kaç ihlal sınıfı bulundu, en ağır beş ihlal (fabrika diliyle: "7.200 m sevk edildi ama hiçbir siparişten düşülmedi" gibi); (3) İHLAL KATALOĞU — alan alan (top/metraj, sipariş/sevk, fason/iş emri, ana veri/yetki/audit, numara/zaman): her satırda ölçülen ihlal, saha ve dev sayısı, örnek kayıt kimliği, ilgili bulgu id'si, sorgu dosyası; (4) TEMİZ ÇIKAN KONTROLLER — "arandı, 0 bulundu" listesi (bunlar da denetimin çıktısıdır: hangi değişmezler sağlam çıktı); (5) İHLALLERİN YAŞ DAĞILIMI ve büyüme eğilimi (ölçülebiliyorsa: ne zaman başlamış, hâlâ üretiliyor mu — audit izinden); (6) FABRİKANIN BUGÜN YAPMASI GEREKEN SORGU — ekibe verilecek, canlıda koşacak 8-12 satırlık kontrol listesi (her biri tek SQL + "kaç satır çıkarsa sorun var" eşiği).`,
  },
  {
    key: 'yol-haritasi', file: 'RAPOR-bolum-10-11-12-yol-haritasi.md', label: 'yol haritası',
    task: `GÖREV — Bölüm 10 (YOL HARİTASI), 11 (VERİ ONARIM PLANI), 12 (ÖNERİLEN KALICI KONTROLLER).
Bölüm 10: bulguları dört vadeye böl — ACİL (0-2 hafta) · KISA (1-2 ay) · ORTA (3-6 ay) · UZUN. Sıralama ölçütü: şiddet × kanıt seviyesi × düzeltme eforu × yan etki riski. Her satır: bulgu id'leri, tek cümlelik iş, tahmini efor (gün), üretim riski (düşük/orta/yüksek), ön koşul (migration mı, APK mı, yalnız backend mi), kim yapmalı. **Aynı kök nedene ait bulguları TEK KALEMDE topla** (bkz. Bölüm 9 kümeleri). Vade başına toplam efor ve "bu vadede kapanan risk" özeti.
Bölüm 11: VERİ ONARIM PLANI — yalnız veride ÖLÇÜLMÜŞ ihlaller için (findings.json'da veride_ihlal dolu olanlar). Her onarım için: hangi kayıtlar (sorgu), kaç adet, doğru değerin nasıl belirleneceği (türetilebiliyor mu yoksa fabrikanın kararı mı), önerilen script adı (${'`'}Teks-Erp/scripts/fix_*.ts${'`'}, dry-run varsayılan + --apply), geri alma yolu, kimin onaylaması gerektiği (planlama/muhasebe/depo). ⚠️ Not: geliştirme veritabanı sahadakinin GERİSİNDE; onarım yalnız sahada anlamlı, script'ler sahada koşacak şekilde yazılmalı.
Bölüm 12: KALICI KONTROLLER — 12.1 eklenecek DB kısıtları (her biri için taslak SQL + hangi bulguyu kapatır + ${'`'}[PROD'DA ÇALIŞTIRMA]${'`'} etiketi + kilit/etki uyarısı), 12.2 eklenecek mutabakat işleri ve alarmlar (ne, hangi sıklıkta, eşik ne, kim görür — "sessiz başarısızlık" sınıfını kapatan), 12.3 kalıcılaştırılacak eşzamanlılık bekçileri (dosya adı + ne ölçmeli + hangi bulgunun regresyonunu tutar; mevcut ${'`'}scripts/audit_repro_*.ts${'`'} dosyalarından hangileri ${'`'}test_*.ts${'`'}'e terfi etmeli), 12.4 ekibe verilecek kod inceleme kontrol listesi (bu denetimin öğrettiği 10-15 madde, her biri "şunu yaparsan şu bozulur" biçiminde).`,
  },
  {
    key: 'dogru-yapilanlar', file: 'RAPOR-bolum-13-dogru-yapilanlar.md', label: 'doğru yapılanlar',
    task: `GÖREV — EK: EKİBİN DOĞRU YAPTIKLARI (raporun güvenilirliği ve bu kalıpların korunması için ZORUNLU bölüm). Kaynak: ${A}/03-verify/_hasat.json ${'`'}good_practices${'`'} alanı (160 gözlem, denetçilerin kendi alanlarında yazdıkları) + haritalardaki olumlu tespitler.
Üret: (1) mükerrerleri ayıklayıp 12-20 maddelik bir liste — her madde: kalıbın adı, nerede yaşıyor (dosya:satır), NEDEN doğru (hangi hata sınıfını kapatıyor), korunması için ne gerekiyor (bekçisi var mı); (2) "BU KALIPLARI BOZMAYIN" uyarı listesi — düzeltme turunda yanlışlıkla bozulabilecek olanlar (ör. tek-process invariantı, audit'in tx dışında olması, sayaç kilidinin konumu, parçalı sonuç kültürü); (3) kısa bir değerlendirme: bu kod tabanının olgunluk düzeyi hangi alanlarda sektör ortalamasının üstünde.`,
  },
]
const results = await parallel(jobs.map(j => () => agent(`${COMMON}\n\n${j.task}\n\nÇIKTI: ${A}/${j.file} dosyasını Write ile yaz (Türkçe, tablo ağırlıklı, her iddiada bulgu id'si/dosya:satır). Sonra StructuredOutput döndür.`,
  OPT({ label: `sentez:${j.label}`, phase: 'Analiz', schema: SCHEMA }))))
const meta2 = jobs.map((j, i) => ({ key: j.key, file: j.file, ok: !!results[i], summary: results[i]?.summary ?? null, key_points: results[i]?.key_points ?? [] }))
log(`Analiz bitti: ${meta2.filter(m => m.ok).length}/${jobs.length} bölüm yazıldı`)

phase('Özet')
const ozet = await agent(`${COMMON}

GÖREV — Bölüm 1: YÖNETİCİ ÖZETİ (en fazla 2 sayfa, TEKNİK OLMAYAN dille — okuyucu fabrika sahibi/yöneticisi, yazılımcı değil).
ÖNCE oku: ${A}/RAPOR-bolum-9-kok-neden.md · ${A}/RAPOR-bolum-7-veri-saglik.md · ${A}/RAPOR-bolum-10-11-12-yol-haritasi.md · ${A}/RAPOR-bolum-13-dogru-yapilanlar.md (bu turda yazıldılar) + findings.json.
Diğer bölümlerin ana çıkarımları: ${JSON.stringify(meta2.map(m => ({ b: m.key, ozet: m.summary, noktalar: m.key_points })))}
Üret: (1.1) Kapsam ve tarih — ne denetlendi, ne denetlenmedi, hangi yöntemle (bir paragraf, jargonsuz); (1.2) GENEL RİSK DEĞERLENDİRMESİ — sistem bugün ne kadar güvenli, hangi alan sağlam hangi alan zayıf, bir cümlelik hüküm + gerekçe; (1.3) EN KRİTİK BEŞ BULGU — her biri: fabrikada ne olur (somut, "şu ekranda şunu yapınca şu olur"), kaç kayıtta ölçüldü, ne kadar sürede düzelir; (1.4) VERİDE TESPİT EDİLEN FİİLİ TUTARSIZLIKLAR — sayılarla, düz Türkçe ("sevk edilen 7.200 metre mal hiçbir siparişten düşülmemiş" gibi); (1.5) ÖNCELİKLİ AKSİYON LİSTESİ — bu hafta / bu ay / bu çeyrek, her madde tek cümle ve sorumlu.
DİL KURALI: "transaction", "race condition", "idempotency", "advisory lock" gibi terimleri KULLANMA; karşılıklarını yaz ("aynı anda iki kişi aynı işi yapınca", "aynı kayıt iki kez yazılıyor", "kilit alınmıyor" yerine "sıraya sokulmuyor"). Sayılar ve bulgu id'leri kalsın (id'ler ayrıntı bölümüne referans).
ÇIKTI: ${A}/RAPOR-bolum-1-yonetici-ozeti.md — Write ile yaz, sonra StructuredOutput döndür.`,
  OPT({ label: 'sentez:yönetici özeti', phase: 'Özet', schema: SCHEMA }))

return { bolumler: meta2, yonetici_ozeti: { ok: !!ozet, summary: ozet?.summary ?? null, key_points: ozet?.key_points ?? [] } }
