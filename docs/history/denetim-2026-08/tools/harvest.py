#!/usr/bin/env python3
"""Denetçi çıktılarından rapor eklerini hasat eder: doğru yapılanlar, uygulanan kontrol listesi, boşluklar.
Kullanım: harvest.py <journal.jsonl> [journal2...] > audit/03-verify/_hasat.json"""
import sys, json
good, checks, gaps, cross = [], [], [], []
for path in sys.argv[1:]:
    try: lines = open(path, encoding='utf-8').read().splitlines()
    except FileNotFoundError: continue
    for line in lines:
        try: e = json.loads(line)
        except Exception: continue
        if e.get('type') != 'result': continue
        r = e.get('result')
        if not isinstance(r, dict) or 'applied_checklist' not in r: continue
        src = (r.get('output_file') or '').split('/')[-1]
        for x in r.get('good_practices', []): good.append({'src': src, 'text': x})
        for x in r.get('applied_checklist', []): checks.append({'src': src, 'text': x})
        for x in r.get('gaps', []): gaps.append({'src': src, 'text': x})
        for x in r.get('cross_boundary', []): cross.append({'src': src, 'text': x})
json.dump({'good_practices': good, 'applied_checklist': checks, 'gaps': gaps, 'cross_boundary': cross},
          sys.stdout, ensure_ascii=False, indent=1)
