#!/usr/bin/env python3
import json, random

words = [
    'apple', 'brave', 'crane', 'dream', 'eagle',
    'flame', 'grace', 'haste', 'ivory', 'joker',
    'kneel', 'lemon', 'maple', 'night', 'ocean',
    'pearl', 'queen', 'raven', 'stone', 'tiger',
    'ultra', 'vivid', 'water', 'xenon', 'youth',
    'zebra', 'amber', 'blaze', 'crest', 'delta'
]

print('Content-Type: application/json')
print('Access-Control-Allow-Origin: *')
print()
print(json.dumps({'value': random.choice(words)}))
