#!/usr/bin/env python3
"""UK weather data source using Met Office DataHub API.
Accepts ?apikey=KEY&town=Derby&display=summary parameters."""
import sys, os, json, time, math, urllib.request, urllib.parse, urllib.error
from datetime import datetime, timezone, timedelta
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'lib'))
from config import DATA_DIR

CACHE_DIR = os.path.join(DATA_DIR, 'cache')

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

# Precipitation weather codes (rain, sleet, hail, snow)
PRECIP_CODES = set(range(9, 28))

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

def utc_to_uk_hour(dt_utc):
    """Convert UTC datetime to UK local time string like '3pm'."""
    year = dt_utc.year
    # BST: last Sunday in March 01:00 UTC to last Sunday in October 01:00 UTC
    mar31 = datetime(year, 3, 31, 1, 0, tzinfo=timezone.utc)
    while mar31.weekday() != 6:
        mar31 -= timedelta(days=1)
    oct31 = datetime(year, 10, 31, 1, 0, tzinfo=timezone.utc)
    while oct31.weekday() != 6:
        oct31 -= timedelta(days=1)
    if mar31 <= dt_utc < oct31:
        dt_local = dt_utc + timedelta(hours=1)
    else:
        dt_local = dt_utc
    hour = dt_local.hour
    if hour == 0:
        return '12am'
    elif hour < 12:
        return '{}am'.format(hour)
    elif hour == 12:
        return '12pm'
    else:
        return '{}pm'.format(hour - 12)

def format_rainstop(current, series):
    """Predict when rain will stop based on future hourly data."""
    cur_precip = current.get('probOfPrecipitation', 0)
    cur_code = current.get('significantWeatherCode', 0)
    is_raining = cur_precip >= 50 or cur_code in PRECIP_CODES

    if not is_raining:
        return 'Dry'

    for entry in series:
        precip = entry.get('probOfPrecipitation', 0)
        code = entry.get('significantWeatherCode', 0)
        if precip < 30 and code not in PRECIP_CODES:
            t_str = entry.get('time', '')
            try:
                dt = datetime.fromisoformat(t_str.replace('Z', '+00:00'))
                return 'Dry by {}'.format(utc_to_uk_hour(dt))
            except Exception:
                return 'Dry soon'

    return 'Rain 12h+'

def format_value(display, data, iconsize=48):
    current = data.get('current', data)
    series = data.get('series', [])

    temp = current.get('screenTemperature', 0)
    feels = current.get('feelsLikeTemperature', 0)
    code = current.get('significantWeatherCode', 0)
    conditions = WEATHER_CODES.get(code, 'Unknown')
    wind_speed = current.get('windSpeed10m', 0)
    wind_deg = current.get('windDirectionFrom10m', 0)
    wind_dir = wind_direction(wind_deg)
    wind_mph = round(wind_speed * 2.237)  # m/s to mph
    humidity = current.get('screenRelativeHumidity', 0)
    uv = current.get('uvIndex', 0)
    precip = current.get('probOfPrecipitation', 0)

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
    elif display == 'icon':
        return 'icon:{}:{}'.format(code, iconsize)
    elif display == 'rainstop':
        return format_rainstop(current, series)
    else:  # summary
        return '{:.0f}\u00b0 {}'.format(temp, conditions)


# Parse query string
qs = urllib.parse.parse_qs(os.environ.get('QUERY_STRING', ''))
apikey = qs.get('apikey', [''])[0].strip()
town_name = qs.get('town', ['Derby'])[0].strip()
display = qs.get('display', ['summary'])[0].strip()
try:
    iconsize = int(qs.get('iconsize', ['48'])[0])
except ValueError:
    iconsize = 48
try:
    refresh_mins = int(qs.get('refresh', ['30'])[0])
except ValueError:
    refresh_mins = 30
cache_max_age = max(5, refresh_mins) * 60  # minimum 5 minutes, convert to seconds

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
    """Fetch hourly forecast. Returns {current: {...}, series: [...]} or {_error: msg}."""
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
        # Navigate GeoJSON: features[0].properties.timeSeries
        features = data.get('features', [])
        if not features:
            return {'_error': 'No data'}
        props = features[0].get('properties', {})
        all_series = props.get('timeSeries', [])
        if not all_series:
            return {'_error': 'No forecast'}
        # Split into current and future entries
        now = time.time()
        current = all_series[0]
        future = []
        found_current = False
        for entry in all_series:
            t_str = entry.get('time', '')
            try:
                dt = datetime.fromisoformat(t_str.replace('Z', '+00:00'))
                entry_ts = dt.timestamp()
                if entry_ts <= now:
                    current = entry
                    found_current = True
                else:
                    future.append(entry)
            except Exception:
                if not found_current:
                    current = entry
                break
        return {'current': current, 'series': future}
    except urllib.error.HTTPError as e:
        sys.stderr.write('uk_weather: HTTP {}: {}\n'.format(e.code, e.reason))
        if e.code in (401, 403):
            return {'_error': 'Bad API key'}
        elif e.code == 429:
            return {'_error': 'Rate limited'}
        return {'_error': 'HTTP {}'.format(e.code)}
    except Exception as e:
        sys.stderr.write('uk_weather: error: {}\n'.format(e))
        return {'_error': 'Connection error'}


def get_cached():
    if not os.path.exists(cache_file):
        return None
    try:
        with open(cache_file, 'r') as f:
            cached = json.load(f)
        if time.time() - cached.get('_fetched', 0) < cache_max_age:
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
    weather_data = cached
else:
    weather_data = fetch_weather()
    if weather_data and '_error' not in weather_data:
        save_cache(weather_data)
    elif weather_data and '_error' in weather_data:
        # API returned an error — try stale cache before giving up
        error_msg = weather_data['_error']
        weather_data = None
        if os.path.exists(cache_file):
            try:
                with open(cache_file, 'r') as f:
                    weather_data = json.load(f)
            except Exception:
                pass
        if not weather_data:
            print('Content-Type: application/json')
            print()
            print(json.dumps({'value': error_msg}))
            sys.exit(0)

if weather_data:
    value = format_value(display, weather_data, iconsize)
else:
    value = 'Weather unavailable'

print('Content-Type: application/json')
print()
print(json.dumps({'value': value}))
