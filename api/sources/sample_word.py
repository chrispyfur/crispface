#!/usr/bin/env python3
import json, random

words = [
   'Contrafibularities', 'Soupling', 'Dammit', 'Nipple', 'Marjorie', 'Tsk', 'Control', 'Lavishly', 'Towlette', 'Sausage', 'Drawers', 'Nudely', 'Pimhole', 'Christ...', 'Mystery', 'Instruments', 'Custardy', 'Tantric', 'Trousers', 'Smell', 'Magnificent', 'Compliant', 'Plenum', 'Language', 'Spectacles', 'Rubber', 'Uttoxeter', 'Moist', 'Damn'
]

print('Content-Type: application/json')
print('Access-Control-Allow-Origin: *')
print()
print(json.dumps({'value': random.choice(words)}))
