"""Classify JMdict senses, never derive Japanese pronunciations from meanings."""
import re

NATURE_IDS = ('plant', 'mineral', 'animal', 'bird', 'insect', 'fish', 'algae')

class NatureClassifier:
    def __init__(self, rules):
        self.fields = rules['fieldTags']
        self.terms = {k: {v.lower() for v in values} for k, values in rules['headTerms'].items()}
        self.overrides = {}
        for row in rules['senseOverrides']:
            for sense in row['senses']:
                self.overrides.setdefault((row['entry'], sense), set()).add(row['category'])
        self.excluded = {(row['entry'], row['category'], word)
                         for row in rules.get('spellingExclusions', []) for word in row['spellings']}

    def spelling_allowed(self, entry, category, word):
        return (entry, category, word) not in self.excluded

    def categories(self, entry, number, sense):
        fields = {node.text for node in sense.findall('field')}
        categories = {self.fields[f] for f in fields if f in self.fields}
        categories.update(self.overrides.get((entry, number), set()))
        pos = {node.text for node in sense.findall('pos')}
        misc = {node.text for node in sense.findall('misc')}
        glosses = [node.text or '' for node in sense.findall('gloss')]
        # Animal metaphors, tools, sports, etc. must not become species by a homonym.
        blocked = fields & {'comp', 'music', 'sports', 'baseb', 'golf', 'aviat', 'mech', 'engr', 'archit', 'chess', 'go', 'shogi'}
        metaphor = any(re.search(r'\b(?:figurative|color|colour|machine|tool|gear|shaft|software|computer|vehicle|decoy|imitation|toy|sport|game|person|woman|man)\b', g.lower()) for g in glosses)
        if not blocked and not metaphor and not (misc & {'sl', 'derog', 'vulg'}) and (not pos or any(p in {'n', 'n-pref', 'n-suf', 'adj-no'} for p in pos)):
            for node in sense.findall('gloss'):
                gloss = (node.text or '').lower()
                if re.search(r'\b(?:figurative|color|colour|machine|tool|sport|person|woman|man)\b', gloss):
                    continue
                head = re.sub(r'\s+', ' ', gloss.split('(')[0].strip(' .;,')).replace('esp. ', '')
                if head.startswith(('hot dog', 'corn dog', 'family tree', 'directory tree', 'syntax tree')):
                    continue
                matches = []
                for category, terms in self.terms.items():
                    # Species names commonly have adjectives (Japanese bush warbler, etc.).
                    # Ambiguous nouns require an explicit biological qualifier below.
                    hits = [term for term in terms if head == term or head.endswith(' ' + term)]
                    if not hits:
                        continue
                    scientific = re.search(r'\([A-Z][a-z]+ (?:[a-z]+)|\([A-Z][a-z]*(?:idae|aceae)', node.text or '')
                    biological = scientific or re.search(r'\b(?:bird|fish|insect|animal|mammal|rodent|plant|tree|flower|alga|seaweed|stone|mineral)\b', node.text or '')
                    qualifiers = {'japanese','chinese','asian','european','african','american','australian','indian','eurasian','siberian',
                                  'atlantic','pacific','north','south','northern','southern','eastern','western','common','domestic','wild',
                                  'red','green','blue','black','white','yellow','brown','grey','gray','silver','golden','purple',
                                  'giant','great','greater','lesser','small','large','little','true','edible','sweet','bitter'}
                    hits = [term for term in hits if head == term or scientific or all(word in qualifiers for word in head[:-len(term)].strip().split())]
                    if not hits:
                        continue
                    ambiguous = {'swallow', 'martin', 'swift', 'tit', 'kite', 'crane', 'fly', 'tick', 'worm', 'reed', 'skate', 'sponge', 'rose', 'seal', 'bat', 'mole', 'rat', 'jade', 'agar-agar'}
                    if all(term in ambiguous for term in hits) and not biological:
                        continue
                    matches.append((max(len(term) for term in hits), category))
                # "sea cucumber" is an animal, not a cucumber plant.
                longest = max((length for length, _ in matches), default=0)
                categories.update(category for length, category in matches if length == longest)
        # More specific groups remain independently reorderable; algae are not plants.
        if 'algae' in categories:
            categories.discard('plant')
        if categories & {'bird', 'insect', 'fish'}:
            categories.discard('animal')
        return [c for c in NATURE_IDS if c in categories]
