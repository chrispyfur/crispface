#!/usr/bin/env python3
"""ICS Calendar — multi-feed calendar events source.
Accepts ?feeds=JSON_ARRAY&events=N&days=N&detail=title|location|full
Also accepts legacy ?url=ICS_URL for backwards compatibility."""
import sys, os, json, time, urllib.request, urllib.parse, re, hashlib
from datetime import datetime, timezone, timedelta
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'lib'))
from config import DATA_DIR

CACHE_DIR = os.path.join(DATA_DIR, 'cache')


# Parse query parameters
qs = urllib.parse.parse_qs(os.environ.get('QUERY_STRING', ''))
max_events = int(qs.get('events', ['3'])[0])
days_ahead = int(qs.get('days', ['1'])[0])
detail = qs.get('detail', ['title'])[0]
max_chars = int(qs.get('maxchars', ['20'])[0])
use_dividers = qs.get('dividers', ['true'])[0].lower() == 'true'

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
            elif prop_name == 'RRULE':
                event['rrule'] = value
            elif prop_name == 'EXDATE':
                exdates = event.get('exdates', set())
                for part in value.split(','):
                    part = part.strip()
                    if part:
                        exdates.add(part[:8])  # Just YYYYMMDD
                event['exdates'] = exdates

    return events


def parse_rrule(rrule_str):
    """Parse RRULE value string into a dict, e.g. {"FREQ": "YEARLY", "INTERVAL": "1"}."""
    parts = {}
    for part in rrule_str.split(';'):
        if '=' in part:
            k, v = part.split('=', 1)
            parts[k.upper()] = v
    return parts


def expand_recurring(events, window_start, window_end):
    """Expand recurring events (RRULE) into concrete occurrences within the window."""
    result = []
    for ev in events:
        if 'rrule' not in ev:
            result.append(ev)
            continue

        rule = parse_rrule(ev['rrule'])
        freq = rule.get('FREQ', '').upper()
        interval = int(rule.get('INTERVAL', '1'))
        if interval < 1:
            interval = 1

        dtstart = ev.get('dtstart')
        if not dtstart:
            continue

        # Event duration (preserve for each occurrence)
        dtend = ev.get('dtend', dtstart)
        duration = dtend - dtstart

        # UNTIL limit
        until = None
        if 'UNTIL' in rule:
            until = parse_ics_datetime(rule['UNTIL'])

        # COUNT limit
        count = int(rule['COUNT']) if 'COUNT' in rule else None

        exdates = ev.get('exdates', set())

        # Generate occurrences — jump near window to avoid iterating from distant past
        occurrences = 0  # Total from original dtstart (for COUNT)

        if freq == 'YEARLY':
            # Start from window_start year minus 1 to catch events that span into window
            first_year = window_start.year - 1
            # Count how many occurrences from dtstart to first_year
            if first_year > dtstart.year:
                years_skip = first_year - dtstart.year
                occurrences = years_skip // interval
                year = dtstart.year + (occurrences * interval)
            else:
                year = dtstart.year

            while year <= window_end.year + 1:
                occ_start = dtstart.replace(year=year)
                occ_end = occ_start + duration

                if until and occ_start > until:
                    break
                if count is not None and occurrences >= count:
                    break

                occurrences += 1

                if occ_start > window_end:
                    break

                if occ_end >= window_start and occ_start <= window_end:
                    date_key = occ_start.strftime('%Y%m%d')
                    if date_key not in exdates:
                        occ = dict(ev)
                        occ['dtstart'] = occ_start
                        occ['dtend'] = occ_end
                        occ.pop('rrule', None)
                        occ.pop('exdates', None)
                        result.append(occ)

                year += interval

        elif freq == 'MONTHLY':
            # Jump near window start
            months_from_start = (window_start.year - dtstart.year) * 12 + (window_start.month - dtstart.month)
            if months_from_start > interval:
                skip = (months_from_start - 1) // interval
                occurrences = skip
            else:
                skip = 0

            step = skip * interval
            cur_year = dtstart.year + (dtstart.month - 1 + step) // 12
            cur_month = (dtstart.month - 1 + step) % 12 + 1

            for _ in range(60):  # Safety limit
                try:
                    occ_start = dtstart.replace(year=cur_year, month=cur_month)
                except ValueError:
                    # Day doesn't exist in this month (e.g., Jan 31 → Feb), skip
                    cur_month += interval
                    if cur_month > 12:
                        cur_year += (cur_month - 1) // 12
                        cur_month = (cur_month - 1) % 12 + 1
                    occurrences += 1
                    continue

                occ_end = occ_start + duration

                if until and occ_start > until:
                    break
                if count is not None and occurrences >= count:
                    break

                occurrences += 1

                if occ_start > window_end:
                    break

                if occ_end >= window_start and occ_start <= window_end:
                    date_key = occ_start.strftime('%Y%m%d')
                    if date_key not in exdates:
                        occ = dict(ev)
                        occ['dtstart'] = occ_start
                        occ['dtend'] = occ_end
                        occ.pop('rrule', None)
                        occ.pop('exdates', None)
                        result.append(occ)

                cur_month += interval
                if cur_month > 12:
                    cur_year += (cur_month - 1) // 12
                    cur_month = (cur_month - 1) % 12 + 1

        elif freq in ('WEEKLY', 'DAILY'):
            day_step = interval * 7 if freq == 'WEEKLY' else interval
            delta = timedelta(days=day_step)

            # Jump near window start
            days_from_start = (window_start - dtstart).days
            if days_from_start > day_step:
                skip = (days_from_start - day_step) // day_step
                occurrences = skip
                cur = dtstart + timedelta(days=skip * day_step)
            else:
                cur = dtstart

            for _ in range(400):  # Safety limit (> 1 year of daily)
                occ_start = cur
                occ_end = occ_start + duration

                if until and occ_start > until:
                    break
                if count is not None and occurrences >= count:
                    break

                occurrences += 1

                if occ_start > window_end:
                    break

                if occ_end >= window_start and occ_start <= window_end:
                    date_key = occ_start.strftime('%Y%m%d')
                    if date_key not in exdates:
                        occ = dict(ev)
                        occ['dtstart'] = occ_start
                        occ['dtend'] = occ_end
                        occ.pop('rrule', None)
                        occ.pop('exdates', None)
                        result.append(occ)

                cur += delta

    return result


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


def format_events(events, detail, max_chars, dividers=True):
    """Format event list into display text.

    All-day events get a filled circle prefix, timed events get HH:MM.
    Lines are truncated with ... if they exceed max_chars.
    Bold-flagged events are prefixed with \\x03 (bold marker byte).
    Detail levels:
      title    - prefix + title
      location - prefix + title + @ location
      full     - prefix + title + @ location + description
    """
    lines = []
    prev_date = None
    for ev in events:
        # Day divider: insert \x04 + 3-letter day name between events on different days
        ev_date = ev['dtstart'].date()
        if dividers and prev_date and ev_date != prev_date:
            day_name = ev['dtstart'].strftime('%a')
            lines.append('\x04' + day_name)
        prev_date = ev_date

        subject = ev.get('summary', 'No title')
        lineBold = bool(ev.get('_bold'))

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

        # Bold marker: \x03 prefix tells firmware/editor to use bold font
        if lineBold:
            line = '\x03' + line

        if detail == 'full':
            desc = ev.get('description', '')
            if desc:
                snippet = desc[:60].replace('\n', ' ').strip()
                if len(desc) > 60:
                    snippet += '...'
                lines.append(line)
                desc_line = truncate('  ' + snippet, max_chars)
                if lineBold:
                    desc_line = '\x03' + desc_line
                lines.append(desc_line)
                continue

        lines.append(line)

    return '\n'.join(lines) if lines else 'No events'


# ---- Fetch ICS (always fresh, cache only as network-error fallback) ----

def fetch_ics(url):
    """Fetch ICS text from URL. Caches last successful fetch as fallback."""
    url_hash = hashlib.md5(url.encode()).hexdigest()[:12]
    cache_file = os.path.join(CACHE_DIR, 'ical_{}.json'.format(url_hash))

    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'CrispFace/1.0'
        })
        with urllib.request.urlopen(req, timeout=10) as resp:
            ics_text = resp.read().decode('utf-8', errors='replace')
        # Save for fallback on future network failures
        os.makedirs(CACHE_DIR, exist_ok=True)
        try:
            with open(cache_file, 'w') as f:
                json.dump({'_ics_text': ics_text}, f)
        except Exception:
            pass
        return ics_text
    except Exception:
        # Network failed — try last known good data
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
    alert_mode = feed.get('alert_mode', '')
    # Backwards compat: old feeds with separate alert/insistent fields
    if not alert_mode:
        if feed.get('insistent'):
            alert_mode = 'insistent'
        elif feed.get('alert'):
            alert_mode = 'gentle'
    feed_alert = alert_mode in ('gentle', 'insistent')
    feed_insistent = alert_mode == 'insistent'
    feed_alert_before = int(feed.get('alert_before', 5))

    if feed_alert or feed_insistent:
        any_alerts = True

    ics_text = fetch_ics(url)
    if not ics_text:
        continue

    events = parse_ics_events(ics_text)
    events = expand_recurring(events, start, end)
    events = filter_events(events, start, end)

    # Per-feed event type filter
    show = feed.get('show', 'all')
    if show == 'timed':
        events = [ev for ev in events if not ev.get('all_day')]
    elif show == 'allday':
        events = [ev for ev in events if ev.get('all_day')]

    # Tag events with per-feed flags
    for ev in events:
        ev['_feed_url'] = url
        if bold:
            ev['_bold'] = True
        if feed_alert or feed_insistent:
            ev['_alert'] = True
            ev['_alert_before'] = feed_alert_before
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

value_text = format_events(all_events, detail, max_chars, use_dividers)

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
        seconds_from_now = int((dt - now).total_seconds())
        if seconds_from_now <= 0:
            continue
        title = ev.get('summary', 'Event')
        loc = ev.get('location', '')
        alert_text = title if not loc else '{}\n@ {}'.format(title, loc)
        feed_url = ev.get('_feed_url', '')
        dt_iso = ev['dtstart'].isoformat() if ev.get('dtstart') else ''
        uid = hashlib.md5((feed_url + '|' + dt_iso + '|' + title).encode()).hexdigest()[:16]
        alerts.append({
            'sec': seconds_from_now,
            'text': alert_text[:59],
            'time': dt.strftime('%H:%M'),
            'ins': bool(ev.get('_insistent')),
            'uid': uid,
            'pre': ev.get('_alert_before', 5) * 60,
        })
    # Sort by nearest first, cap at 10
    alerts.sort(key=lambda a: a['sec'])
    result['alerts'] = alerts[:10]

respond(result)
