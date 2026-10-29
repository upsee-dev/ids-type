import json
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET
from nature_categories import NatureClassifier

class NatureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.classifier = NatureClassifier(json.loads((Path(__file__).resolve().parents[1]/'data-src/japanese/nature-categories.json').read_text()))

    def classify(self, gloss, field='', entry='test'):
        sense = ET.Element('sense')
        ET.SubElement(sense,'pos').text='n'
        if field: ET.SubElement(sense,'field').text=field
        ET.SubElement(sense,'gloss').text=gloss
        return self.classifier.categories(entry,1,sense)

    def test_fishing_is_not_a_fish_species(self):
        self.assertEqual(self.classify('fishing tackle','fish'),[])
        self.assertEqual(self.classify('bamboo basket for catching fish','fish'),[])

    def test_cricket_sport_is_not_an_insect(self):
        self.assertEqual(self.classify('cricket','sports'),[])
        self.assertEqual(self.classify('cricket (game)'),[])
        self.assertEqual(self.classify('cricket (Gryllidae spp.)'),['insect'])

    def test_seal_stamp_is_not_an_animal(self):
        self.assertEqual(self.classify('personal seal'),[])
        self.assertEqual(self.classify('earless seal (Phocidae)'),['animal'])

    def test_sea_cucumber_is_not_a_plant(self):
        self.assertEqual(self.classify('sea cucumber'),['animal'])

    def test_algae_are_separate_from_plants(self):
        self.assertEqual(self.classify('sea lettuce (Ulva spp.)','bot'),['algae'])

    def test_birds_are_separate_from_other_animals(self):
        self.assertEqual(self.classify('kingfisher (Alcedo atthis)','zool'),['bird'])
        self.assertEqual(self.classify('clay pigeon'),[])

    def test_prepared_food_is_not_classified_by_an_ingredient(self):
        self.assertEqual(self.classify('cucumber sushi wrapped in nori','food'),[])
        self.assertEqual(self.classify('grated yam'),[])
        self.assertEqual(self.classify('worm (gear, shaft, etc.)'),[])

    def test_rose_override_is_specific_to_the_reviewed_entry(self):
        self.assertEqual(self.classify('rose',entry='1571760'),['plant'])
        self.assertEqual(self.classify('rose (color)'),[])

    def test_sakura_shill_spelling_is_not_a_plant(self):
        self.assertTrue(self.classifier.spelling_allowed('1593710','plant','桜'))
        self.assertFalse(self.classifier.spelling_allowed('1593710','plant','偽客'))

if __name__=='__main__': unittest.main()
