#!/usr/bin/env python3
"""Weather data source using Open-Meteo (free, no API key).
Accepts ?city=name parameter. Defaults to Derby, UK."""
import sys, os, json, time, urllib.request, urllib.parse
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'lib'))
from config import DATA_DIR

CACHE_DIR = os.path.join(DATA_DIR, 'cache')
CACHE_MAX_AGE = 900  # 15 minutes

# Known cities with coordinates
CITIES = {
    'derby': (52.9225, -1.4746),
    'london': (51.5074, -0.1278),
    'manchester': (53.4808, -2.2426),
    'birmingham': (52.4862, -1.8904),
    'leeds': (53.8008, -1.5491),
    'edinburgh': (55.9533, -3.1883),
    'cardiff': (51.4816, -3.1791),
    'belfast': (54.5973, -5.9301),
    'nottingham': (52.9548, -1.1581),
    'sheffield': (53.3811, -1.4701),
    'bristol': (51.4545, -2.5879),
    'liverpool': (53.4084, -2.9916),
    'york': (53.9591, -1.0815),
    'bath': (51.3751, -2.3617),
    'oxford': (51.7520, -1.2577),
    'cambridge': (52.2053, 0.1218),
    'glasgow': (55.8642, -4.2518),
    'newcastle': (54.9783, -1.6178),
    'brighton': (50.8225, -0.1372),
    'plymouth': (50.3755, -4.1427),
    'new york': (40.7128, -74.0060),
    'paris': (48.8566, 2.3522),
    'tokyo': (35.6762, 139.6503),
    'sydney': (-33.8688, 151.2093),
    'berlin': (52.5200, 13.4050),
}

DEFAULT_CITY = 'derby'

# WMO weather codes to short descriptions
WMO_CODES = {
    0: 'Clear', 1: 'Mostly Clear', 2: 'Partly Cloudy', 3: 'Overcast',
    45: 'Foggy', 48: 'Rime Fog',
    51: 'Light Drizzle', 53: 'Drizzle', 55: 'Heavy Drizzle',
    61: 'Light Rain', 63: 'Rain', 65: 'Heavy Rain',
    66: 'Freezing Rain', 67: 'Heavy Freezing Rain',
    71: 'Light Snow', 73: 'Snow', 75: 'Heavy Snow', 77: 'Snow Grains',
    80: 'Light Showers', 81: 'Showers', 82: 'Heavy Showers',
    85: 'Light Snow Showers', 86: 'Snow Showers',
    95: 'Thunderstorm', 96: 'Hail Storm', 99: 'Heavy Hail Storm',
}

# Parse query string
qs = urllib.parse.parse_qs(os.environ.get('QUERY_STRING', ''))
city_name = qs.get('city', [DEFAULT_CITY])[0].lower().strip()

coords = CITIES.get(city_name)
if not coords:
    print('Content-Type: application/json')
    print()
    print(json.dumps({'value': 'Unknown city', 'error': 'City not found: ' + city_name,
                      'cities': sorted(CITIES.keys())}))
    sys.exit(0)

lat, lon = coords
cache_file = os.path.join(CACHE_DIR, 'weather_' + city_name.replace(' ', '_') + '.json')


def fetch_weather():
    url = (
        'https://api.open-meteo.com/v1/forecast'
        '?latitude={}&longitude={}'
        '&current=temperature_2m,weather_code'
    ).format(lat, lon)
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
        current = data.get('current', {})
        temp = current.get('temperature_2m', 0)
        code = current.get('weather_code', 0)
        desc = WMO_CODES.get(code, 'Unknown')
        return {'value': '{:.0f}\u00b0C {}'.format(temp, desc),
                'temp': temp, 'description': desc, 'city': city_name}
    except Exception:
        return None


def get_cached():
    if not os.path.exists(cache_file):
        return None
    try:
        with open(cache_file, 'r') as f:
            cached = json.load(f)
        if time.time() - cached.get('_fetched', 0) < CACHE_MAX_AGE:
            return cached
    except Exception:
        pass
    return None


def save_cache(data):
    os.makedirs(CACHE_DIR, exist_ok=True)
    data['_fetched'] = time.time()
    try:
        with open(cache_file, 'w') as f:
            json.dump(data, f)
    except Exception:
        pass


# Main
result = get_cached()
if not result:
    result = fetch_weather()
    if result:
        save_cache(result)
    else:
        if os.path.exists(cache_file):
            try:
                with open(cache_file, 'r') as f:
                    result = json.load(f)
            except Exception:
                result = {'value': 'Weather unavailable'}
        else:
            result = {'value': 'Weather unavailable'}

output = {k: v for k, v in result.items() if not k.startswith('_')}

print('Content-Type: application/json')
print()
print(json.dumps(output))
