#!/usr/bin/env python3
"""UK weather data source using Met Office DataHub API.
Accepts ?apikey=KEY&town=Derby&display=summary parameters."""
import sys, os, json, time, math, urllib.request, urllib.parse
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'lib'))
from config import DATA_DIR

CACHE_DIR = os.path.join(DATA_DIR, 'cache')
CACHE_MAX_AGE = 1800  # 30 minutes

TOWNS_FILE = os.path.join(DATA_DIR, 'uk_towns.json')

# Met Office significantWeatherCode to short text
WEATHER_CODES = {
    0: 'Clear',         1: 'Sunny',
    2: 'Partly cloudy', 3: 'Partly cloudy',
    5: 'Mist',          6: 'Fog',
    7: 'Cloudy',        8: 'Overcast',
    9: 'Light showers', 10: 'Light showers',
    11: 'Drizzle',      12: 'Light rain',
    13: 'Heavy showers', 14: 'Heavy showers',
    15: 'Heavy rain',
    16: 'Sleet showers', 17: 'Sleet showers', 18: 'Sleet',
    19: 'Hail showers',  20: 'Hail showers',  21: 'Hail',
    22: 'Lt snow shwrs', 23: 'Lt snow shwrs', 24: 'Light snow',
    25: 'Hvy snow shwrs', 26: 'Hvy snow shwrs', 27: 'Heavy snow',
    28: 'Thunder shwrs', 29: 'Thunder shwrs', 30: 'Thunder',
}

# 16-point compass from degrees
COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
           'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']

def wind_direction(deg):
    idx = round(deg / 22.5) % 16
    return COMPASS[idx]

def load_towns():
    try:
        with open(TOWNS_FILE, 'r') as f:
            return json.load(f)
    except Exception:
        return []

def find_town(name, towns):
    name_lower = name.lower().strip()
    for t in towns:
        if t['name'].lower() == name_lower:
            return t
    return None

def format_value(display, ts):
    temp = ts.get('screenTemperature', 0)
    feels = ts.get('feelsLikeTemperature', 0)
    code = ts.get('significantWeatherCode', 0)
    conditions = WEATHER_CODES.get(code, 'Unknown')
    wind_speed = ts.get('windSpeed10m', 0)
    wind_deg = ts.get('windDirectionFrom10m', 0)
    wind_dir = wind_direction(wind_deg)
    wind_mph = round(wind_speed * 2.237)  # m/s to mph
    humidity = ts.get('screenRelativeHumidity', 0)
    uv = ts.get('uvIndex', 0)
    precip = ts.get('probOfPrecipitation', 0)

    if display == 'temp':
        return '{:.0f}\u00b0C'.format(temp)
    elif display == 'feels':
        return 'Feels {:.0f}\u00b0C'.format(feels)
    elif display == 'conditions':
        return conditions
    elif display == 'wind':
        return '{}mph {}'.format(wind_mph, wind_dir)
    elif display == 'humidity':
        return 'Hum {:.0f}%'.format(humidity)
    elif display == 'uv':
        return 'UV {}'.format(uv)
    elif display == 'precip':
        return 'Rain {:.0f}%'.format(precip)
    elif display == 'detail':
        return '{:.0f}\u00b0 {}\nWind {}mph\nRain {:.0f}%'.format(
            temp, conditions, wind_mph, precip)
    else:  # summary
        return '{:.0f}\u00b0 {}'.format(temp, conditions)


# Parse query string
qs = urllib.parse.parse_qs(os.environ.get('QUERY_STRING', ''))
apikey = qs.get('apikey', [''])[0].strip()
town_name = qs.get('town', ['Derby'])[0].strip()
display = qs.get('display', ['summary'])[0].strip()

# Validate
if not apikey:
    print('Content-Type: application/json')
    print()
    print(json.dumps({'value': 'No API key'}))
    sys.exit(0)

towns = load_towns()
town = find_town(town_name, towns)
if not town:
    print('Content-Type: application/json')
    print()
    print(json.dumps({'value': '? Unknown town'}))
    sys.exit(0)

lat = town['lat']
lon = town['lon']
cache_key = town['name'].lower().replace(' ', '_')
cache_file = os.path.join(CACHE_DIR, 'ukweather_' + cache_key + '.json')


def fetch_weather():
    url = (
        'https://data.hub.api.metoffice.gov.uk/sitespecific/v0/point/hourly'
        '?latitude={}&longitude={}'
        '&excludeParameterMetadata=true'
        '&includeLocationName=true'
    ).format(lat, lon)
    try:
        req = urllib.request.Request(url)
        req.add_header('apikey', apikey)
        req.add_header('Accept', 'application/json')
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
        # Navigate GeoJSON: features[0].properties.timeSeries[0]
        features = data.get('features', [])
        if not features:
            return None
        props = features[0].get('properties', {})
        series = props.get('timeSeries', [])
        if not series:
            return None
        # Find closest entry to current time
        now = time.time()
        best = series[0]
        for entry in series:
            t_str = entry.get('time', '')
            # Parse ISO time to compare
            try:
                from datetime import datetime
                dt = datetime.fromisoformat(t_str.replace('Z', '+00:00'))
                entry_ts = dt.timestamp()
                if entry_ts <= now:
                    best = entry
                else:
                    break
            except Exception:
                best = entry
                break
        return best
    except Exception as e:
        sys.stderr.write('uk_weather: API error: {}\n'.format(e))
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
    to_save = dict(data)
    to_save['_fetched'] = time.time()
    try:
        with open(cache_file, 'w') as f:
            json.dump(to_save, f)
    except Exception:
        pass


# Main
cached = get_cached()
if cached:
    ts = cached
else:
    ts = fetch_weather()
    if ts:
        save_cache(ts)
    else:
        # Try stale cache
        if os.path.exists(cache_file):
            try:
                with open(cache_file, 'r') as f:
                    ts = json.load(f)
            except Exception:
                ts = None

if ts:
    value = format_value(display, ts)
else:
    value = 'Weather unavailable'

print('Content-Type: application/json')
print()
print(json.dumps({'value': value}))
