#!/usr/bin/env python3
"""Repository-owned semester archive. No browser or third-party Python packages required.

Fetch the feed, validate it completely, merge by semester/course/section, then write.
TBA never overwrites known faculty. Missing sections are retained within the latest eight semesters.
--in accepts raw CDN JSON or our compact snapshot; --observed-at dates imported data.
"""
import argparse
import copy
import datetime as dt
import importlib.util
import json
from pathlib import Path
import re
import tempfile
import urllib.request

SOURCE = 'https://usis-cdn.eniamza.com/connect.json'
SEMESTERS_TO_KEEP = 8
spec = importlib.util.spec_from_file_location('snapshot', Path(__file__).with_name('build-snapshot.py'))
snapshot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(snapshot)


def known(value):
    return isinstance(value, str) and any(w != 'TBA' for w in re.findall(r'[A-Z]+', value.upper()))


def normalize(raw):
    items = raw if isinstance(raw, list) else raw.get('sections', raw.get('data'))
    if not isinstance(items, list) or not items:
        raise ValueError('Empty or invalid feed')
    sessions = raw.get('meta', {}).get('semesterSessionIds', []) if isinstance(raw, dict) else []
    result, seen = [], set()
    for item in items:
        if not isinstance(item, dict):
            raise ValueError('Invalid section record')
        if 'c' in item:
            row = copy.deepcopy(item)
            sid = row.get('sid') or (sessions[0] if len(sessions) == 1 else None)
        else:
            ss = item.get('sectionSchedule') or {}
            sid = item.get('semesterSessionId')
            row = dict(c=item.get('courseCode'), nm=item.get('courseName'), sec=item.get('sectionName'),
                       f=item.get('faculties'), lf=item.get('labFaculties'),
                       r=item.get('roomNumber') or item.get('roomName'), lr=item.get('labRoomName'), lc=item.get('labCourseCode'),
                       cap=item.get('capacity'), used=item.get('consumedSeat'),
                       cls=snapshot.ev(ss.get('classSchedules')), lab=snapshot.ev(item.get('labSchedules')),
                       start=ss.get('classStartDate'), end=ss.get('classEndDate'),
                       md=ss.get('midExamDate'), ms=snapshot.mins(ss.get('midExamStartTime')), me=snapshot.mins(ss.get('midExamEndTime')),
                       fd=ss.get('finalExamDate'), fs=snapshot.mins(ss.get('finalExamStartTime')), fe=snapshot.mins(ss.get('finalExamEndTime')))
        sid = str(sid or '')
        if not re.fullmatch(r'\d{4}[123]', sid):
            raise ValueError('Missing/invalid semester ID; refusing to mix semesters')
        code, sec = row.get('c'), row.get('sec')
        if not isinstance(code, str) or not re.fullmatch(r'[A-Za-z0-9_-]+', code) or sec is None or not str(sec).strip() or '|' in str(sec):
            raise ValueError('Missing/invalid course or section')
        row['c'], row['sec'] = code.upper(), str(sec).strip()
        key = (sid, row['c'], row['sec'])
        if key in seen:
            raise ValueError('Duplicate semester/course/section: ' + repr(key))
        seen.add(key)
        for field in ('f', 'lf'):
            if row.get(field) is not None and not isinstance(row[field], str):
                raise ValueError('Invalid faculty initials')
        result.append((sid, row))
    return result


def merge(records, existing, observed_at, source):
    result = copy.deepcopy(existing)
    stamp = int(dt.datetime.fromisoformat(observed_at.replace('Z', '+00:00')).timestamp() * 1000)
    for sid, row in records:
        rec = result.setdefault(sid, dict(schemaVersion=1, session=sid,
            label={'1': 'Spring', '2': 'Summer', '3': 'Fall'}[sid[-1]] + ' ' + sid[:4],
            at=stamp, start=None, end=None, count=0, courses={}, rows={}, observations={}))
        if rec.get('session') != sid or rec.get('schemaVersion') != 1:
            raise ValueError('Invalid existing archive: ' + sid)
        key = row['c'] + '|' + row['sec']
        prior = rec['rows'].get(key)
        memo = rec['observations'].setdefault(key, dict(firstObservedAt=observed_at, facultyHistory=[], labFacultyHistory=[]))
        # An explicitly backdated import must not replace newer observations.
        if memo.get('lastObservedAt', '') > observed_at:
            continue
        faculty = row.get('f') if known(row.get('f')) else (prior[0] if prior else 'TBA')
        lab_faculty = row.get('lf') if known(row.get('lf')) else memo.get('lastKnownLabFaculty', 'TBA')
        for field, value in [('facultyHistory', row.get('f')), ('labFacultyHistory', row.get('lf'))]:
            if known(value) and (not memo[field] or memo[field][-1]['initials'] != value):
                memo[field].append(dict(initials=value, observedAt=observed_at))
        memo.update(lastObservedAt=observed_at, source=source, latestPublishedFaculty=row.get('f') or 'TBA',
                    lastKnownLabFaculty=lab_faculty, latestPublishedLabFaculty=row.get('lf') or 'TBA')
        events, exams = [], []
        for kind, field in [(0, 'cls'), (1, 'lab')]:
            for event in row.get(field) or []:
                if len(event) != 3 or not all(isinstance(n, (int, float)) for n in event):
                    raise ValueError('Invalid meeting time')
                events.extend([*event, kind])
        for kind, prefix in [(0, 'm'), (1, 'f')]:
            if row.get(prefix + 'd') and row.get(prefix + 's') is not None and row.get(prefix + 'e') is not None:
                exams.extend([kind, row[prefix + 'd'], row[prefix + 's'], row[prefix + 'e']])
        rec['rows'][key] = [faculty, row.get('r') or '', row.get('lr') or '', row.get('lc') or '', row.get('cap'), row.get('used'), events, exams]
        rec['courses'][row['c']] = row.get('nm') or row['c']
        rec['at'] = max(rec['at'], stamp)
        rec['start'] = row.get('start') or rec['start']
        rec['end'] = row.get('end') or rec['end']
        rec['count'] = len(rec['rows'])
    # Session IDs sort chronologically: YYYY followed by Spring=1, Summer=2, Fall=3.
    # A late old response must not evict a newer term just because it was observed last.
    return {sid: result[sid] for sid in sorted(result)[-SEMESTERS_TO_KEEP:]}


def write_json(path, payload):
    content = json.dumps(payload, ensure_ascii=True, sort_keys=True, separators=(',', ':')) + '\n'
    if path.exists() and path.read_text() == content:
        return
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False, encoding='utf-8') as out:
        out.write(content)
        tmp = Path(out.name)
    tmp.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--in', dest='src')
    parser.add_argument('--out', default='data/semesters')
    parser.add_argument('--url', default=SOURCE)
    parser.add_argument('--observed-at', help='UTC observation time, e.g. 2026-09-26T06:17:53Z')
    parser.add_argument('--min-sections', type=int, default=50)
    args = parser.parse_args()
    if args.src:
        raw = json.loads(Path(args.src).read_text())
    else:
        request = urllib.request.Request(args.url, headers={'User-Agent': 'Prohor-semester-collector/1.0'})
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = json.load(response)
    records = normalize(raw)
    if len(records) < args.min_sections:
        raise ValueError('Suspiciously small feed; existing archive left unchanged')
    observed_at = args.observed_at or dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z', observed_at):
        raise ValueError('--observed-at must be a UTC timestamp ending in Z')
    directory = Path(args.out)
    existing = {p.stem: json.loads(p.read_text()) for p in directory.glob('[0-9][0-9][0-9][0-9][123].json')}
    # Finish every validation/merge before modifying any output; Git commits all files together.
    merged = merge(records, existing, observed_at, args.url if not args.src else 'import:' + Path(args.src).name)
    directory.mkdir(parents=True, exist_ok=True)
    for sid, payload in sorted(merged.items()):
        write_json(directory / (sid + '.json'), payload)
    write_json(directory / 'index.json', dict(schemaVersion=1, semesters=sorted(merged)))
    # Publish the manifest first; remove only known semester files outside its retained set.
    # Git stages these deletions with the new files and manifest as one collection commit.
    for sid in sorted(set(existing) - set(merged)):
        (directory / (sid + '.json')).unlink()
    print(f'Collected {len(records)} sections; retained {len(merged)} semesters in {directory}')


if __name__ == '__main__':
    main()
