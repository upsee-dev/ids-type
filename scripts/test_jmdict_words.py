import unittest
import xml.etree.ElementTree as ET
from jmdict_words import kanji_readings, jis_kanji


class JMdictWordsTests(unittest.TestCase):
    def pairs(self, xml):
        return list(kanji_readings(ET.fromstring('<entry>' + xml + '</entry>')))

    def test_reading_restriction_does_not_cross_spellings(self):
        self.assertEqual(self.pairs('''<k_ele><keb>甲</keb></k_ele><k_ele><keb>乙</keb></k_ele>
            <r_ele><reb>こう</reb><re_restr>甲</re_restr></r_ele><sense/>'''), [('こう', '甲', False)])

    def test_no_kanji_reading_never_becomes_a_kanji_candidate(self):
        self.assertEqual(self.pairs('''<k_ele><keb>甲</keb></k_ele>
            <r_ele><reb>こう</reb><re_nokanji/><re_inf>gikun</re_inf></r_ele><sense/>'''), [])

    def test_both_sense_restrictions_must_match(self):
        self.assertEqual(self.pairs('''<k_ele><keb>甲</keb></k_ele><k_ele><keb>乙</keb></k_ele>
            <r_ele><reb>こう</reb></r_ele><r_ele><reb>おつ</reb></r_ele>
            <sense><stagk>甲</stagk><stagr>こう</stagr></sense>
            <sense><stagk>乙</stagk><stagr>おつ</stagr></sense>'''), [('こう', '甲', False), ('おつ', '乙', False)])

    def test_gikun_is_explicit_and_kana_only_spellings_are_excluded(self):
        self.assertEqual(self.pairs('''<k_ele><keb>躑躅</keb></k_ele><k_ele><keb>ツツジ</keb></k_ele>
            <r_ele><reb>つつじ</reb><re_inf>gikun</re_inf></r_ele><sense/>'''), [('つつじ', '躑躅', True)])

    def test_rare_spelling_is_not_discarded_by_frequency(self):
        self.assertEqual(self.pairs('''<k_ele><keb>轗軻</keb><ke_inf>rK</ke_inf></k_ele>
            <r_ele><reb>かんか</reb></r_ele><sense/>'''), [('かんか', '轗軻', False)])

    def test_jis_baseline_has_the_complete_two_levels(self):
        chars = jis_kanji()
        self.assertEqual(sum(level == 1 for level in chars.values()), 2965)
        self.assertEqual(sum(level == 2 for level in chars.values()), 3390)
        self.assertEqual(chars['漢'], 1)
        self.assertEqual(chars['鬱'], 2)


if __name__ == '__main__':
    unittest.main()
