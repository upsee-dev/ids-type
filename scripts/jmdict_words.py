"""Extract attested kanji/readings, respecting JMdict's spelling and sense restrictions."""
import unicodedata


def is_kanji(char):
    return char in '々〆〇' or unicodedata.name(char, '').startswith(('CJK UNIFIED IDEOGRAPH-', 'CJK COMPATIBILITY IDEOGRAPH-'))


def reading_spellings(entry, reading):
    kana = reading.findtext('reb') or ''
    if reading.find('re_nokanji') is not None:
        return []  # This reading explicitly does not belong to the kanji spellings.
    spellings = [n.text for n in entry.findall('k_ele/keb')]
    restricted = [n.text for n in reading.findall('re_restr')]
    allowed = [word for word in spellings if not restricted or word in restricted]
    senses = entry.findall('sense')
    def valid(word, sense):
        ks = [n.text for n in sense.findall('stagk')]
        rs = [n.text for n in sense.findall('stagr')]
        return (not ks or word in ks) and (not rs or kana in rs)
    return [word for word in allowed if any(valid(word, sense) for sense in senses)]


def kanji_readings(entry):
    for reading in entry.findall('r_ele'):
        kana = reading.findtext('reb') or ''
        gikun = any(n.text == 'gikun' for n in reading.findall('re_inf'))
        for word in reading_spellings(entry, reading):
            if any(is_kanji(c) for c in word):
                yield kana, word, gikun


def jis_kanji():
    """JIS X 0208 level 1/2, not an official Kanken grade assignment."""
    out = {}
    for ku in range(16, 85):
        for ten in range(1, 95):
            try:
                char = bytes([ku + 160, ten + 160]).decode('euc_jp')
            except UnicodeDecodeError:
                continue
            out[char] = 1 if ku <= 47 else 2
    return out
