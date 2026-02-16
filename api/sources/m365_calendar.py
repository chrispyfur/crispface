#!/usr/bin/env python3
"""Calendar events source via ICS feed.
Accepts ?url=ICS_URL&events=N&days=N&detail=title|location|full
Works with any ICS feed: Outlook, Google Calendar, Apple, etc."""
import sys, os, json, time, urllib.request, urllib.parse, re, hashlib
from datetime import datetime, timezone, timedelta
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'lib'))
from config import DATA_DIR

CACHE_DIR = os.path.join(DATA_DIR, 'cache')
CACHE_MAX_AGE = 300  # 5 minutes

# Parse query parameters
qs = urllib.parse.parse_qs(os.environ.get('QUERY_STRING', ''))
ics_url = qs.get('url', [''])[0].strip()
max_events = int(qs.get('events', ['3'])[0])
days_ahead = int(qs.get('days', ['1'])[0])
detail = qs.get('detail', ['title'])[0]
max_chars = int(qs.get('maxchars', ['20'])[0])
alert_enabled = qs.get('alert', ['false'])[0].lower() == 'true'
insistent_enabled = qs.get('insistent', ['false'])[0].lower() == 'true'

if max_events < 1:
    max_events = 1
elif max_events > 20:
    max_events = 20

if days_ahead < 1:
    days_ahead = 1
elif days_ahead > 30:
    days_ahead = 30

if max_chars < 5:
    max_chars = 5
elif max_chars > 200:
    max_chars = 200


def respond(data):
    print('Content-Type: application/json')
    print()
    print(json.dumps(data))
    sys.exit(0)


if not ics_url:
    respond({'value': 'No ICS URL set'})


# ---- ICS Parser ----

def unfold_ics(text):
    """Unfold long lines per RFC 5545 (continuation lines start with space/tab)."""
    return re.sub(r'\r?\n[ \t]', '', text)


def parse_ics_datetime(val):
    """Parse an ICS datetime value into a UTC datetime object."""
    val = val.strip()
    if val.endswith('Z'):
        val = val[:-1]
    try:
        if 'T' in val:
            return datetime.strptime(val, '%Y%m%dT%H%M%S').replace(tzinfo=timezone.utc)
        else:
            return datetime.strptime(val, '%Y%m%d').replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def parse_ics_events(ics_text):
    """Parse ICS text and return a list of event dicts."""
    ics_text = unfold_ics(ics_text)
    events = []
    in_event = False
    event = {}

    for line in ics_text.splitlines():
        line = line.strip()
        if line == 'BEGIN:VEVENT':
            in_event = True
            event = {}
        elif line == 'END:VEVENT':
            in_event = False
            if 'dtstart' in event:
                events.append(event)
        elif in_event and ':' in line:
            prop_part, _, value = line.partition(':')
            prop_name = prop_part.split(';')[0].upper()

            if prop_name == 'DTSTART':
                event['dtstart'] = parse_ics_datetime(value)
                if 'VALUE=DATE' in prop_part.upper():
                    event['all_day'] = True
            elif prop_name == 'DTEND':
                event['dtend'] = parse_ics_datetime(value)
            elif prop_name == 'SUMMARY':
                event['summary'] = value
            elif prop_name == 'LOCATION':
                event['location'] = value
            elif prop_name == 'DESCRIPTION':
                event['description'] = value.replace('\\n', '\n').replace('\\,', ',')
            elif prop_name == 'TRANSP':
                event['transp'] = value.strip().upper()

    return events


def calc_time_window(days):
    """Return (start, end) datetimes for N days ahead."""
    now = datetime.now(timezone.utc)
    end = now + timedelta(days=days)
    return now, end


def filter_and_sort_events(events, start, end, limit):
    """Filter events within time window, sort by start time, limit count."""
    filtered = []
    for ev in events:
        dt = ev.get('dtstart')
        if not dt:
            continue
        ev_end = ev.get('dtend', dt)
        if ev_end >= start and dt <= end:
            filtered.append(ev)
    filtered.sort(key=lambda e: e['dtstart'])
    return filtered[:limit]


def truncate(text, limit):
    """Truncate text with ... if it exceeds the character limit."""
    if len(text) <= limit:
        return text
    return text[:limit - 3] + '...'


def format_events(events, detail, max_chars):
    """Format event list into display text.

    All-day events get a filled circle prefix, timed events get HH:MM.
    Lines are truncated with ... if they exceed max_chars.
    Detail levels:
      title    - prefix + title
      location - prefix + title + @ location
      full     - prefix + title + @ location + description
    """
    lines = []
    for ev in events:
        subject = ev.get('summary', 'No title')

        # Prefix: all-day gets * (busy) or o (free), timed gets HH:MM
        if ev.get('all_day'):
            is_free = ev.get('transp') == 'TRANSPARENT'
            prefix = 'o' if is_free else '*'
        else:
            prefix = ev['dtstart'].strftime('%H:%M')

        line = '{} {}'.format(prefix, subject)

        if detail in ('location', 'full'):
            location = ev.get('location', '')
            if location:
                line += ' @ ' + location

        line = truncate(line, max_chars)

        if detail == 'full':
            desc = ev.get('description', '')
            if desc:
                snippet = desc[:60].replace('\n', ' ').strip()
                if len(desc) > 60:
                    snippet += '...'
                lines.append(line)
                lines.append(truncate('  ' + snippet, max_chars))
                continue

        lines.append(line)

    return '\n'.join(lines) if lines else 'No events'


# ---- Caching ----

url_hash = hashlib.md5(ics_url.encode()).hexdigest()[:12]
cache_file = os.path.join(CACHE_DIR, 'ical_{}.json'.format(url_hash))


def get_cached():
    if not os.path.exists(cache_file):
        return None
    try:
        with open(cache_file, 'r') as f:
            cached = json.load(f)
        if time.time() - cached.get('_fetched', 0) < CACHE_MAX_AGE:
            return cached.get('_ics_text')
    except Exception:
        pass
    return None


def save_cache(ics_text):
    os.makedirs(CACHE_DIR, exist_ok=True)
    try:
        with open(cache_file, 'w') as f:
            json.dump({'_fetched': time.time(), '_ics_text': ics_text}, f)
    except Exception:
        pass


# ---- Main ----

ics_text = get_cached()

if not ics_text:
    try:
        req = urllib.request.Request(ics_url, headers={
            'User-Agent': 'CrispFace/1.0'
        })
        with urllib.request.urlopen(req, timeout=10) as resp:
            ics_text = resp.read().decode('utf-8', errors='replace')
        save_cache(ics_text)
    except Exception:
        if os.path.exists(cache_file):
            try:
                with open(cache_file, 'r') as f:
                    ics_text = json.load(f).get('_ics_text', '')
            except Exception:
                respond({'value': 'Feed unavailable'})
        else:
            respond({'value': 'Feed unavailable'})

if not ics_text:
    respond({'value': 'Feed unavailable'})

events = parse_ics_events(ics_text)
start, end = calc_time_window(days_ahead)
events = filter_and_sort_events(events, start, end, max_events)
value_text = format_events(events, detail, max_chars)

result = {'value': value_text}

# Build alerts array when alert or insistent is enabled
if alert_enabled or insistent_enabled:
    now = datetime.now(timezone.utc)
    alerts = []
    for ev in events:
        # Skip all-day events and past events
        if ev.get('all_day'):
            continue
        dt = ev.get('dtstart')
        if not dt or dt <= now:
            continue
        minutes_from_now = int((dt - now).total_seconds() / 60)
        if minutes_from_now <= 0:
            continue
        alerts.append({
            'min': minutes_from_now,
            'text': ev.get('summary', 'Event')[:39],
            'ins': insistent_enabled
        })
    # Sort by nearest first, cap at 10
    alerts.sort(key=lambda a: a['min'])
    result['alerts'] = alerts[:10]

respond(result)
