#!/usr/bin/env python3
"""Offline, reproducible Japanese lexicon + Unicode radical/stroke index.

No frequency cutoff: every valid Mozc reading/surface survives deduplication.
Shards keep an iOS keyboard from loading the complete lexicon into memory.
"""
from pathlib import Path
import collections
import gzip
import hashlib
import json
import re
import subprocess
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from nature_categories import NatureClassifier
from jmdict_words import kanji_readings, is_kanji, jis_kanji

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'data-src/japanese'
ASSETS = ROOT / 'native/ime/assets'
CATEGORIES = [
    ('common', '日本語でよく使われる語'), ('name', '人名・人名用字'),
    ('place', '地名・地名用字'), ('kokuji', '国字'), ('symbol', '記号'),
    ('ketsuren', '欠画連綿詞'), ('jukujikun', '熟字訓・義訓'), ('kanji', 'その他の漢字'),
    ('plant', '植物'), ('mineral', '鉱物'), ('animal', '動物'),
    ('bird', '鳥類'), ('insect', '虫類'), ('fish', '魚類'), ('algae', '藻類'),
]
BITS = {key: 1 << i for i, (key, _) in enumerate(CATEGORIES)}
KUN_READING_FLAG = 1 << 24  # attribute, never a user-visible category

def hira(s):
    s = unicodedata.normalize('NFC', s)
    return ''.join(chr(ord(c)-0x60) if 'ァ' <= c <= 'ヶ' else c for c in s)

def build_words():
    rows = {}
    kun_pairs = set()
    def add(reading, text, category, cost=8000):
        reading = hira(reading)
        if not re.fullmatch('[ぁ-ゖー]+', reading) or not text or any(c in text for c in '\t\r\n'):
            return
        key = (reading, text)
        added = key not in rows
        mask, oldcost = rows.get(key, (0, 100000))
        rows[key] = (mask | BITS[category], min(oldcost, max(0, int(cost))))
        return added

    pos = dict(line.rstrip().split(' ', 1) for line in (SRC/'mozc-id.def').read_text().splitlines())
    with gzip.open(SRC/'mozc.tsv.gz', 'rt') as f:
        for line in f:
            fields = line.rstrip('\n').split('\t')
            if len(fields) < 5: continue
            reading, left, _, cost, word = fields[:5]
            tag = pos[left]
            category = 'name' if ',人名,' in tag else 'place' if ',地域,' in tag else 'symbol' if tag.startswith('記号,') else 'common'
            add(reading, word, category, cost)

    for line in (SRC/'mozc-symbol.tsv').read_text().splitlines()[1:]:
        fields = line.split('\t')
        if len(fields) >= 3:
            for reading in fields[2].split(): add(reading, fields[1], 'symbol', 6000)

    # Raw KANJIDIC2: do not inherit display-era on/kun/nanori slice limits.
    with gzip.open(ROOT/'data-src/kanjidic2/kanjidic2.xml.gz', 'rb') as f:
        tree = ET.parse(f)
    bare_kun_added = 0
    for node in tree.findall('character'):
        ch = node.findtext('literal')
        meanings = [m.text or '' for m in node.findall('.//meaning') if not m.attrib]
        kokuji = any('kokuji' in m.lower() for m in meanings)
        grade = node.findtext('misc/grade')
        for r in node.findall('.//reading'):
            if r.get('r_type') not in ['ja_on', 'ja_kun']: continue
            value = (r.text or '').strip('-')
            # 送仮名は表記にも付ける。あ.う → 会う (会 alone is also available under あ).
            stem, _, tail = value.partition('.')
            cat = 'kokuji' if kokuji else 'name' if grade in ['9','10'] else 'kanji'
            add(stem + tail, ch + tail, cat)
            if r.get('r_type') == 'ja_kun':
                # Full kun input can select the character alone as well as its inflected spelling.
                bare_kun_added += bool(add(stem + tail, ch, cat))
                kun_pairs.add((hira(stem + tail), ch + tail))
                kun_pairs.add((hira(stem + tail), ch))
            if tail: add(stem, ch, cat)
        for n in node.findall('.//nanori'):
            add(n.text or '', ch, 'name')

    # Known Japanese reference readings; never turn foreign transcriptions into Japanese.
    data = json.loads((ROOT/'core/kanji-data.json').read_text())
    for ch, v in data['chars'].items():
        if v[10] and not v[10].startswith('i:'):
            for r in v[9].split():
                reading = r.replace('.', '').strip('-')
                add(reading, ch, 'kanji')
                if re.fullmatch('[ぁ-ゖー.-]+', r): kun_pairs.add((hira(reading), ch))
    for ch, v in data['ext'].items():
        if v[2] and not v[2].startswith('i:'):
            for r in v[1].split():
                reading = r.replace('.', '').strip('-')
                add(reading, ch, 'kanji')
                if re.fullmatch('[ぁ-ゖー.-]+', r): kun_pairs.add((hira(reading), ch))

    # gikun explicitly includes jukujikun; respect spelling restrictions/no-kanji tags.
    # Entity tags are kept as their names so their classification is unambiguous.
    xml = gzip.open(SRC/'JMdict_e.gz', 'rt').read()
    xml = re.sub(r'<!DOCTYPE JMdict \[.*?\]>', '', xml, flags=re.S)
    xml = re.sub(r'&([A-Za-z0-9_-]+);', lambda m: m[0] if m[1] in ['amp','lt','gt','quot','apos'] else m[1], xml)
    jmdict_count = 0
    lexical_pairs = set()
    four_kanji_pairs = set()
    lexical_added = 0
    classifier = NatureClassifier(json.loads((SRC/'nature-categories.json').read_text()))
    nature_audit = []
    for entry in ET.fromstring(xml).findall('entry'):
        spellings = [k.text for k in entry.findall('k_ele/keb')]
        # Include the complete kanji vocabulary, not just gikun and nature terms.
        # Rare compounds retain the kanji category; Mozc keeps its common-word costs.
        for reading, word, gikun in kanji_readings(entry):
            if not re.fullmatch('[ぁ-ゖー]+', hira(reading)): continue
            pair = (hira(reading), word)
            lexical_pairs.add(pair)
            if len(word) == 4 and all(is_kanji(c) for c in word): four_kanji_pairs.add(pair)
            lexical_added += bool(add(reading, word, 'kanji', 8000))
            if gikun:
                add(reading, word, 'jukujikun', 6000)
                jmdict_count += 1
        # Classify each sense before pairing it with spellings and readings. Do not
        # leak jade's mineral category into a separate kingfisher reading of 翡翠.
        for number, sense in enumerate(entry.findall('sense'), 1):
            categories = classifier.categories(entry.findtext('ent_seq'), number, sense)
            if not categories: continue
            for r in entry.findall('r_ele'):
                reading = r.findtext('reb')
                if sense.findall('stagr') and reading not in [n.text for n in sense.findall('stagr')]: continue
                allowed = [reading] if r.find('re_nokanji') is not None else ([n.text for n in r.findall('re_restr')] or spellings or [reading])
                for word in allowed:
                    if sense.findall('stagk') and word not in [n.text for n in sense.findall('stagk')]: continue
                    for category in categories:
                        if classifier.spelling_allowed(entry.findtext('ent_seq'), category, word):
                            add(reading, word, category, 6000)
            nature_audit.append({'entry': entry.findtext('ent_seq'), 'sense': number, 'spellings': spellings,
                                 'categories': categories, 'fields': [n.text for n in sense.findall('field')],
                                 'glosses': [n.text for n in sense.findall('gloss')]})
    (SRC/'nature-audit.jsonl').write_text(''.join(json.dumps(row, ensure_ascii=False)+'\n' for row in nature_audit))

    # JMnedict adds low-frequency surnames/given names and place/station names that
    # the everyday conversion dictionary does not cover. Do not infer readings from kanji.
    names_count = 0
    name_tags = {'female given name or forename', 'given name or forename, gender not specified',
                 'male given name or forename', 'full name of a particular person',
                 'family or surname', 'unclassified name'}
    with gzip.open(SRC/'JMnedict.xml.gz','rb') as stream:
        for _, entry in ET.iterparse(stream,events=('end',)):
            if entry.tag != 'entry': continue
            tags = {n.text for n in entry.findall('trans/name_type')}
            categories = []
            if tags & name_tags: categories.append('name')
            if tags & {'place name','railway station'}: categories.append('place')
            spellings = [n.text for n in entry.findall('k_ele/keb')]
            for r in entry.findall('r_ele'):
                allowed = [n.text for n in r.findall('re_restr')] or spellings
                for word in allowed:
                    for category in categories:
                        add(r.findtext('reb'),word,category,9000)
                        names_count += 1
            entry.clear()

    extra = json.loads((SRC/'supplement.json').read_text())
    accepted_pairs = pending_pairs = 0
    for item in extra:
        if item.get('status') == 'pending':
            pending_pairs += len(item['readings'])
            continue
        sources = item.get('sources', [])
        if item.get('status') != 'accepted' or any(not all(source.get(k) for k in ['id','title','url','locator']) for source in sources):
            raise ValueError(f"Invalid supplement evidence: {item['text']}")
        # Count publications, not mirrors of the same work on different websites.
        if len({source['id'] for source in sources}) < 2 or len({source['url'] for source in sources}) < 2:
            raise ValueError(f"Supplement needs at least two publications: {item['text']} {item['readings']}")
        for reading in item['readings']: add(reading, item['text'], item['category'], 6000)
        accepted_pairs += len(item['readings'])

    # The official first-grade scope uses JIS level 1/2 as a guide, not as an
    # exact grade list. Audit character availability without inventing grade labels.
    jis = jis_kanji()
    available = {word for _, word in rows if len(word) == 1}
    core_chars = set(data['chars']) | set(data['ext'])
    jis_coverage = {}
    for level in [1, 2]:
        expected = {ch for ch, n in jis.items() if n == level}
        missing = sorted(expected - available)
        missing_core = sorted(expected - core_chars)
        jis_coverage[f'level{level}'] = dict(expected=len(expected), characterSearch=len(expected)-len(missing_core), flickReading=len(expected)-len(missing), missing=missing, missingCharacterSearch=missing_core)
        assert not missing and not missing_core, jis_coverage
    joyo = {node.findtext('literal') for node in tree.findall('character')
            if node.findtext('misc/grade') in {str(n) for n in range(1, 9)}}
    joyo_missing = sorted(joyo - available)
    joyo_missing_core = sorted(joyo - core_chars)
    assert len(joyo) == 2136 and not joyo_missing and not joyo_missing_core
    scope = dict(
        basis='JIS X 0208 first and second levels; a guide to first-grade Kanken scope, not an official grade assignment or exhaustive exam-word list',
        officialScope='https://www.kanken.or.jp/kanken/grades/overview/',
        officialGradeList='https://faq-kanken.dga.jp/dantai-sprt/faq_detail.html?id=1010040&page=1',
        jisX0208=jis_coverage,
        joyo=dict(expected=len(joyo), characterSearch=len(joyo)-len(joyo_missing_core), flickReading=len(joyo)-len(joyo_missing), missing=joyo_missing),
        jmdictLexicalPairs=len(lexical_pairs),
        jmdictNewPairs=lexical_added, fourKanjiSpellingPairs=len(four_kanji_pairs),
        fullKunCharacterPairsAdded=bare_kun_added)
    (SRC/'kanken-coverage.json').write_text(json.dumps(scope,ensure_ascii=False,indent=2)+'\n')

    shards = collections.defaultdict(list)
    counts = collections.Counter()
    for (r, word), (mask, cost) in sorted(rows.items()):
        if (r, word) in kun_pairs: mask |= KUN_READING_FLAG
        shards[f'{ord(r[0]):04x}'].append(f'{r}\t{word}\t{mask}\t{cost}\n')
        for k, bit in BITS.items():
            if mask & bit: counts[k] += 1
    foreign = (SRC/'foreign.tsv').read_text().splitlines()
    for line in foreign:
        reading = line.split('\t', 1)[0]
        shards[f'{ord(reading[0]):04x}'].append(line + '\n')
    for old in ASSETS.glob('japanese-*.tsv'): old.unlink()
    for key, lines in shards.items():
        text = ''.join(sorted(lines))
        (ASSETS/f'japanese-{key}.tsv').write_text(text)
    info = dict(entries=len(rows), foreignEntries=len(foreign), categories=counts, jmdictPairs=jmdict_count, jmdictLexicalPairs=len(lexical_pairs), jmdictNewPairs=lexical_added, fourKanjiSpellingPairs=len(four_kanji_pairs), fullKunCharacterPairsAdded=bare_kun_added, jmnedictPairs=names_count, manualReadings=accepted_pairs, pendingManualReadings=pending_pairs, shards=len(shards))
    (SRC/'coverage.json').write_text(json.dumps(info,ensure_ascii=False,indent=2)+'\n')
    print(info)
    license_text = '日本語拡張フリック辞書\n\nMozc dictionary / Google, IPAdic (NAIST), Okinawa dictionary\nhttps://github.com/google/mozc\n\n' + (SRC/'MOZC-LICENSE.txt').read_text() + '\n\n' + (SRC/'MOZC-DICTIONARY-README.txt').read_text() + '\n\nJMdict / JMnedict / KANJIDIC2: Copyright Jim Breen and the Electronic Dictionary Research and Development Group.\n熟語・四字熟語を含む語彙、熟字訓・義訓、人名・地名および単漢字の読みを抽出・分類しました。これらの派生辞書は CC BY-SA 4.0。\nhttps://www.edrdg.org/edrdg/licence.html\nhttps://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project\nhttps://creativecommons.org/licenses/by-sa/4.0/\n\n部首索引: Unicode Unihan (Unicode License v3)\nhttps://www.unicode.org/reports/tr38/\nhttps://www.unicode.org/license.txt\n'
    license_text += '\n外国語の読み: Unicode Unihan kMandarin / kHangul / kVietnamese (Unicode License v3)。\nかなは検索用のカナ転写で、声調など一部の発音の区別を省略しています。原語の読みを保持しています。\n台湾語（閩南語）: iTaigi華台對照典 / iTaigi contributors、ChhoeTaigi資料庫 (CC0 1.0)。\nhttps://github.com/ChhoeTaigi/ChhoeTaigiDatabase\nhttps://creativecommons.org/publicdomain/zero/1.0/\n'
    license_text += '\n漢検一級までの語彙拡充: JIS第一・第二水準6,355字の単漢字候補を照合し、JMdictの漢字を含む語彙を頻度で切らず取り込みました。公式の級別配当・全出題語一覧の転載や網羅認定ではありません。\nhttps://www.kanken.or.jp/kanken/grades/overview/\n'
    license_text += '\n手動補足の読み（独立した2文献以上で確認したものを採用）\n'
    license_text += '自然分野の分類: JMdictの分野タグ・語義から植物、鉱物、動物、鳥類、虫類、魚類、藻類を分類。読み・表記の制限を尊重し、同じ綴りでも語義の違う別の読みへ分類を流用しません。\n'
    for item in extra:
        if item['status'] != 'accepted': continue
        license_text += item['text'] + ': ' + '・'.join(item['readings']) + '\n'
        for source in item['sources']:
            license_text += source['title'] + '\n' + source['locator'] + '\n' + source['url'] + '\n'
    (ROOT/'native/assets/japanese-license.json').write_text(json.dumps(license_text,ensure_ascii=False)+'\n')
    (ASSETS/'japanese-license.txt').write_text(license_text)

def build_radicals():
    groups = collections.defaultdict(set)
    with zipfile.ZipFile(ROOT/'data-src/unihan/Unihan.zip') as z:
        for line in z.read('Unihan_IRGSources.txt').decode().splitlines():
            if '\tkRSUnicode\t' not in line: continue
            cp, _, values = line.split('\t')
            for value in values.split():
                m = re.fullmatch(r"(\d+)('*)\.(-?\d+)", value)
                if not m: raise ValueError(value)
                # Variants of a radical are grouped under its Kangxi radical number.
                groups[(int(m[1]), int(m[3]))].add(chr(int(cp[2:],16)))
    index = {f'{rad}.{rest}': ''.join(sorted(chars,key=ord)) for (rad,rest),chars in sorted(groups.items())}
    (ROOT/'core/radical-index.json').write_text(json.dumps(index,ensure_ascii=False,separators=(',',':'))+'\n')
    (ASSETS/'radical-index.tsv').write_text(''.join(f'{key}\t{chars}\n' for key,chars in index.items()))
    print('radical index:',len(index),'groups,',sum(len(s) for s in index.values()),'memberships')

if __name__ == '__main__':
    for info in json.loads((SRC/'sources.json').read_text()).values():
        assert hashlib.sha256((SRC/info['file']).read_bytes()).hexdigest() == info['sha256'], info['file']
    subprocess.run(['node', '--experimental-strip-types', str(ROOT/'scripts/build-foreign-readings.mts')], check=True)
    build_words()
    build_radicals()
