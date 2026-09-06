#!/usr/bin/env python3
"""Tur sonucunu Workflow journal'ından + tam metin parçalarından MEKANİK olarak yeniden kurar.
Kullanım: rebuild-tour.py <tur_no> <task_output.json> <journal.jsonl>
Yazar: audit/tours/tur<N>.json (kompakt + verdict'ler + doğrulama) ve audit/tours/tur<N>-seen.json (sonraki tur için)."""
import sys, json, glob, os, re
tour, out_path, journal_path = int(sys.argv[1]), sys.argv[2], sys.argv[3]
A = '/Users/oad/Documents/projeler/AdnanSahin/audit'
T = f'tur{tour}'
out = json.load(open(out_path, encoding='utf-8'))
res = out.get('result')
if isinstance(res, str):
    try: res = json.loads(res)
    except Exception: res = None
if not isinstance(res, dict):
    # bazı sürümlerde dönüş değeri farklı anahtarda olabilir
    for k in ('returnValue', 'value', 'output'):
        v = out.get(k)
        if isinstance(v, dict) and 'standing' in v: res = v; break
        if isinstance(v, str):
            try:
                vv = json.loads(v)
                if isinstance(vv, dict) and 'standing' in vv: res = vv; break
            except Exception: pass
assert isinstance(res, dict) and 'standing' in res, f"dönüş değeri bulunamadı; anahtarlar: {list(out.keys())}"
# journal
verdicts_by_id, verify_by_id, raw = {}, {}, []
for line in open(journal_path, encoding='utf-8'):
    try: e = json.loads(line)
    except Exception: continue
    if e.get('type') != 'result': continue
    r = e.get('result')
    if not isinstance(r, dict): continue
    if 'verdicts' in r:
        for v in r['verdicts']:
            verdicts_by_id.setdefault(v.get('id'), []).append({k: v.get(k) for k in ('refuted','code','evidence','corrected_impact','duplicate_of','strengthened','new_finding') if v.get(k) is not None})
    elif 'achieved_level' in r and r.get('output_file'):
        fid = os.path.basename(r['output_file']).replace('.md','')
        verify_by_id[fid] = r
    elif 'findings' in r and 'applied_checklist' in r:
        raw.extend(r['findings'])
# tam metin parçaları
full = []
for p in sorted(glob.glob(f'{A}/tours/{T}-full-*.json'), key=lambda s: int(re.search(r'-full-(\d+)', s).group(1))):
    full.extend(json.load(open(p, encoding='utf-8')))
full_by_id = {f['id']: f for f in full}
standing = []
for s in res['standing']:
    f = dict(full_by_id.get(s['id'], {}))
    f.update({'id': s['id'], 'siddet': s['siddet'], 'kanit_seviyesi': s['kanit'], 'curutme_status': s['status'], 'baslik': s.get('baslik', f.get('baslik'))})
    f['verdicts'] = verdicts_by_id.get(s['id'], [])
    f['dogrulama'] = verify_by_id.get(s['id'])
    standing.append(f)
dropped = []
for d in res['dropped']:
    dropped.append({**d, 'verdicts': verdicts_by_id.get(d['id'], [])})
compact = {
    'tour': tour, 'lens': res.get('lens'), 'counts': res.get('counts'), 'finders': res.get('finders'),
    'standing': standing, 'dropped': dropped, 'new_from_refuters': res.get('new_from_refuters', []),
    'raw_count': len(raw), 'verify_files': sorted(verify_by_id.keys()),
}
json.dump(compact, open(f'{A}/tours/{T}.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
seen = [{'id': f['id'], 'durum': 'ayakta', 'siddet': f['siddet'], 'baslik': f.get('baslik'), 'dosya': f.get('dosya'), 'satir': f.get('satir'), 'kategori': f.get('kategori')} for f in standing]
seen += [{'id': d['id'], 'durum': 'elendi', 'siddet': d.get('siddet_ilk'), 'baslik': d.get('baslik'), 'dosya': d.get('dosya'), 'satir': d.get('satir'), 'kategori': d.get('kategori'), 'eleme_gerekcesi': (d.get('reason') or '')[:200]} for d in dropped]
json.dump(seen, open(f'{A}/tours/{T}-seen.json', 'w', encoding='utf-8'), ensure_ascii=False)
print(f"{T}.json: standing={len(standing)} dropped={len(dropped)} raw={len(raw)} verdict_ids={len(verdicts_by_id)} verify={len(verify_by_id)} new_from_refuters={len(compact['new_from_refuters'])}")
print(f"{T}-seen.json: {len(seen)} kayıt, {os.path.getsize(f'{A}/tours/{T}-seen.json')} bayt")
