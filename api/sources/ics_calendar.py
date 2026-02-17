#!/usr/bin/env python3
"""ICS Calendar — multi-feed calendar events source.
Accepts ?feeds=JSON_ARRAY&events=N&days=N&detail=title|location|full
Also accepts legacy ?url=ICS_URL for backwards compatibility."""
import sys, os, json, time, urllib.request, urllib.parse, re, hashlib
from datetime import datetime, timezone, timedelta
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'lib'))
from config import DATA_DIR

CACHE_DIR = os.path.join(DATA_DIR, 'cache')
CACHE_MAX_AGE = 60


# Parse query parameters
qs = urllib.parse.parse_qs(os.environ.get('QUERY_STRING', ''))
max_events = int(qs.get('events', ['3'])[0])
days_ahead = int(qs.get('days', ['1'])[0])
detail = qs.get('detail', ['title'])[0]
max_chars = int(qs.get('maxchars', ['20'])[0])

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


# ---- Build feeds list ----

feeds = []
feeds_raw = qs.get('feeds', [''])[0].strip()
if feeds_raw:
    try:
        feeds = json.loads(feeds_raw)
    except (json.JSONDecodeError, ValueError):
        feeds = []

# Backwards compat: legacy single url param
if not feeds:
    legacy_url = qs.get('url', [''])[0].strip()
    if legacy_url:
        feeds = [{'name': '', 'url': legacy_url, 'bold': False}]

if not feeds:
    respond({'value': 'No calendars configured'})


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


def filter_events(events, start, end):
    """Filter events within time window."""
    filtered = []
    for ev in events:
        dt = ev.get('dtstart')
        if not dt:
            continue
        ev_end = ev.get('dtend', dt)
        if ev_end >= start and dt <= end:
            filtered.append(ev)
    return filtered


def truncate(text, limit):
    """Truncate text with ... if it exceeds the character limit."""
    if len(text) <= limit:
        return text
    return text[:limit - 3] + '...'


def format_events(events, detail, max_chars):
    """Format event list into display text.

    All-day events get a filled circle prefix, timed events get HH:MM.
    Lines are truncated with ... if they exceed max_chars.
    Bold-flagged events have their summary UPPERCASED.
    Detail levels:
      title    - prefix + title
      location - prefix + title + @ location
      full     - prefix + title + @ location + description
    """
    lines = []
    for ev in events:
        subject = ev.get('summary', 'No title')

        # Bold feeds: UPPERCASE the summary
        if ev.get('_bold'):
            subject = subject.upper()

        # Prefix: all-day gets * (busy) or o (free), timed gets HH:MM
        if ev.get('all_day'):
            is_free = ev.get('transp') == 'TRANSPARENT'
            prefix = '\x02' if is_free else '\x01'
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


# ---- Caching (per-URL) ----

def get_cached(url):
    url_hash = hashlib.md5(url.encode()).hexdigest()[:12]
    cache_file = os.path.join(CACHE_DIR, 'ical_{}.json'.format(url_hash))
    if not os.path.exists(cache_file):
        return None, cache_file
    try:
        with open(cache_file, 'r') as f:
            cached = json.load(f)
        if time.time() - cached.get('_fetched', 0) < CACHE_MAX_AGE:
            return cached.get('_ics_text'), cache_file
    except Exception:
        pass
    return None, cache_file


def save_cache(cache_file, ics_text):
    os.makedirs(CACHE_DIR, exist_ok=True)
    try:
        with open(cache_file, 'w') as f:
            json.dump({'_fetched': time.time(), '_ics_text': ics_text}, f)
    except Exception:
        pass


def fetch_ics(url):
    """Fetch ICS text from URL with caching."""
    # webcal:// is just https:// with a different scheme
    if url.startswith('webcal://'):
        url = 'https://' + url[9:]
    ics_text, cache_file = get_cached(url)
    if ics_text:
        return ics_text

    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'CrispFace/1.0'
        })
        with urllib.request.urlopen(req, timeout=10) as resp:
            ics_text = resp.read().decode('utf-8', errors='replace')
        save_cache(cache_file, ics_text)
        return ics_text
    except Exception:
        # Try stale cache on failure
        if os.path.exists(cache_file):
            try:
                with open(cache_file, 'r') as f:
                    return json.load(f).get('_ics_text', '')
            except Exception:
                pass
    return None


# ---- Main ----

start, end = calc_time_window(days_ahead)
all_events = []

any_alerts = False

for feed in feeds:
    url = feed.get('url', '').strip()
    if not url:
        continue
    bold = feed.get('bold', False)
    feed_alert = feed.get('alert', False)
    feed_insistent = feed.get('insistent', False)

    if feed_alert or feed_insistent:
        any_alerts = True

    ics_text = fetch_ics(url)
    if not ics_text:
        continue

    events = parse_ics_events(ics_text)
    events = filter_events(events, start, end)

    # Tag events with per-feed flags
    for ev in events:
        if bold:
            ev['_bold'] = True
        if feed_alert or feed_insistent:
            ev['_alert'] = True
            if feed_insistent:
                ev['_insistent'] = True

    all_events.extend(events)

# Backwards compat: top-level alert/insistent params (legacy faces)
legacy_alert = qs.get('alert', ['false'])[0].lower() == 'true'
legacy_insistent = qs.get('insistent', ['false'])[0].lower() == 'true'
if legacy_alert or legacy_insistent:
    any_alerts = True
    for ev in all_events:
        if not ev.get('_alert'):
            ev['_alert'] = True
            if legacy_insistent:
                ev['_insistent'] = True

# Sort combined events by start time and limit
all_events.sort(key=lambda e: e['dtstart'])
all_events = all_events[:max_events]

value_text = format_events(all_events, detail, max_chars)

result = {'value': value_text}

# Build alerts array from events that have alert enabled
if any_alerts:
    now = datetime.now(timezone.utc)
    alerts = []
    for ev in all_events:
        if not ev.get('_alert'):
            continue
        # Skip all-day events and past events
        if ev.get('all_day'):
            continue
        dt = ev.get('dtstart')
        if not dt or dt <= now:
            continue
        minutes_from_now = int((dt - now).total_seconds() / 60)
        if minutes_from_now <= 0:
            continue
        title = ev.get('summary', 'Event')
        loc = ev.get('location', '')
        alert_text = title if not loc else '{}\n@ {}'.format(title, loc)
        alerts.append({
            'min': minutes_from_now,
            'text': alert_text[:59],
            'ins': bool(ev.get('_insistent'))
        })
    # Sort by nearest first, cap at 10
    alerts.sort(key=lambda a: a['min'])
    result['alerts'] = alerts[:10]

respond(result)
