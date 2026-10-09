#!/usr/bin/env python3
"""Collection contract tests: durable repo files, no browser dependency/network needed."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import URLError

spec = importlib.util.spec_from_file_location('collector', Path(__file__).with_name('collect-semesters.py'))
C = importlib.util.module_from_spec(spec)
spec.loader.exec_module(C)
T1, T2, T3 = '2026-09-26T06:17:53Z', '2026-10-01T01:00:00Z', '2026-10-05T01:00:00Z'


def feed(fac='IBA', sid=20263, sec='01', lab='ANK'):
    return [{'sid': sid, 'c': 'CSE221', 'nm': 'ALGORITHMS', 'sec': sec, 'f': fac, 'lf': lab,
             'cls': [[2, 660, 740]], 'lab': [[0, 480, 650]], 'cap': 30, 'used': 12}]


def merge(raw, existing=None, at=T1):
    return C.merge(C.normalize(raw), existing or {}, at, 'test')


class CollectorTests(unittest.TestCase):
    def test_tba_never_erases_known_faculty_or_lab(self):
        original = merge(feed())
        for unknown in [None, '', 'TBA', 'tba', 'TBA / TBA']:
            result = merge(feed(unknown, lab=unknown), original, T2)
            self.assertEqual(result['20263']['rows']['CSE221|01'][0], 'IBA')
            self.assertEqual(result['20263']['observations']['CSE221|01']['lastKnownLabFaculty'], 'ANK')
        self.assertEqual(original['20263']['at'], int(C.dt.datetime.fromisoformat(T1.replace('Z', '+00:00')).timestamp() * 1000))

    def test_seat_updates_do_not_freeze_with_preserved_faculty(self):
        original = merge(feed())  # capacity 30, used 12 -> 18 remaining
        for capacity, used in [(30, 27), (40, 27), (30, 30), (30, 32), (0, 0), (30, 0)]:
            with self.subTest(capacity=capacity, used=used):
                changed = feed(None, lab=None)
                changed[0].update(cap=capacity, used=used)
                result = merge(changed, original, T2)['20263']
                row = result['rows']['CSE221|01']
                self.assertEqual(row[4:6], [capacity, used])
                self.assertEqual(row[0], 'IBA')
                self.assertEqual(result['observations']['CSE221|01']['lastKnownLabFaculty'], 'ANK')
                self.assertEqual(result['observations']['CSE221|01']['lastObservedAt'], T2)

    def test_missing_sections_keep_last_observed_seats_not_new_timestamp(self):
        original = merge(feed())
        result = merge(feed(sec='02'), original, T2)['20263']
        self.assertEqual(result['rows']['CSE221|01'][4:6], [30, 12])
        self.assertEqual(result['observations']['CSE221|01']['lastObservedAt'], T1)
        self.assertEqual(result['observations']['CSE221|02']['lastObservedAt'], T2)
        # Unknown counts in a received section must not be represented as known free seats.
        unknown = feed()
        unknown[0].update(cap=None, used=None)
        self.assertEqual(merge(unknown, original, T2)['20263']['rows']['CSE221|01'][4:6], [None, None])

    def test_raw_feed_seats_update_durable_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            src, out = Path(tmp) / 'feed.json', Path(tmp) / 'archive'
            command = [sys.executable, str(Path(C.__file__)), '--in', str(src), '--out', str(out), '--min-sections', '1', '--observed-at']
            src.write_text(json.dumps(feed()))
            subprocess.run(command + [T1], check=True, capture_output=True)
            src.write_text(json.dumps([{'semesterSessionId': 20263, 'courseCode': 'CSE221',
                'sectionName': '01', 'faculties': 'TBA', 'capacity': 40, 'consumedSeat': 37}]))
            subprocess.run(command + [T2], check=True, capture_output=True)
            saved = json.loads((out / '20263.json').read_text())
            row = saved['rows']['CSE221|01']
            self.assertEqual(row[0], 'IBA')
            self.assertEqual(row[4:6], [40, 37])
            self.assertEqual(max(0, row[4] - row[5]), 3)
            self.assertEqual(saved['observations']['CSE221|01']['lastObservedAt'], T2)
            # An older observation must not rewind the seat counts either.
            src.write_text(json.dumps(feed()))
            subprocess.run(command + [T1], check=True, capture_output=True)
            self.assertEqual(json.loads((out / '20263.json').read_text()), saved)

    def test_real_reassignment_preserves_history(self):
        result = merge(feed('XYZ'), merge(feed()), T2)['20263']
        self.assertEqual(result['rows']['CSE221|01'][0], 'XYZ')
        self.assertEqual([v['initials'] for v in result['observations']['CSE221|01']['facultyHistory']], ['IBA', 'XYZ'])

    def test_always_unknown_stays_unknown(self):
        self.assertEqual(merge(feed(None))['20263']['rows']['CSE221|01'][0], 'TBA')

    def test_removed_section_retained_and_later_restored(self):
        result = merge(feed('XYZ', sec='02'), merge(feed()), T2)
        self.assertEqual(set(result['20263']['rows']), {'CSE221|01', 'CSE221|02'})
        result = merge(feed(None), result, T3)
        self.assertEqual(result['20263']['rows']['CSE221|01'][0], 'IBA')

    def test_keep_latest_eight_semesters_in_chronological_order(self):
        ids = [20263, 20271, 20272, 20273, 20281, 20282, 20283, 20291, 20292, 20293]
        result = {}
        for i, sid in enumerate(ids):
            result = merge(feed('IBA' if i == 0 else None, sid), result, T2)
            self.assertEqual(sorted(result), [str(s) for s in ids[:i + 1][-8:]])
        self.assertEqual(result['20272']['rows']['CSE221|01'][0], 'TBA')
        # Re-observing an old semester must not displace a newer one.
        self.assertEqual(merge(feed('XYZ', 20263), result, T3), result)

    def test_retention_is_by_semester_not_observation_time_or_input_order(self):
        ids = [20273, 20263, 20272, 20271, 20261, 20262, 20253, 20252, 20251]
        result = merge(sum((feed(sid=sid) for sid in ids), []))
        self.assertEqual(sorted(result), sorted(map(str, ids))[-8:])

    def test_files_and_manifest_evict_oldest_and_stage_deletions(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            src, out = root / 'feed.json', root / 'data' / 'semesters'
            command = [sys.executable, str(Path(C.__file__)), '--in', str(src), '--out', str(out), '--min-sections', '1', '--observed-at', T1]
            ids = [20261, 20262, 20263, 20271, 20272, 20273, 20281, 20282]
            src.write_text(json.dumps(sum((feed(sid=sid) for sid in ids), [])))
            subprocess.run(command, check=True, capture_output=True)
            self.assertEqual(len(list(out.glob('[0-9]*.json'))), 8)
            # A temporary Git index verifies the workflow's add pathspec includes deleted files.
            subprocess.run(['git', 'init', '-q', str(root)], check=True)
            subprocess.run(['git', 'add', 'data/semesters'], cwd=root, check=True)
            subprocess.run(['git', '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'seed'], cwd=root, check=True)
            src.write_text(json.dumps(feed(sid=20283)))
            subprocess.run(command[:-1] + [T2], check=True, capture_output=True)
            expected = list(map(str, ids[1:] + [20283]))
            self.assertEqual(json.loads((out / 'index.json').read_text())['semesters'], expected)
            self.assertEqual(sorted(p.stem for p in out.glob('[0-9]*.json')), expected)
            subprocess.run(['git', 'add', '-A', '--', 'data/semesters/*.json'], cwd=root, check=True)
            changes = subprocess.check_output(['git', 'diff', '--cached', '--name-status'], cwd=root, text=True)
            self.assertIn('D\tdata/semesters/20261.json', changes)
            self.assertIn('A\tdata/semesters/20283.json', changes)
            # Repeating a run does not delete another semester.
            subprocess.run(command[:-1] + [T2], check=True, capture_output=True)
            self.assertEqual(sorted(p.stem for p in out.glob('[0-9]*.json')), expected)
            before = {p.name: p.read_bytes() for p in out.iterdir()}
            src.write_text('[]')
            self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)
            self.assertEqual({p.name: p.read_bytes() for p in out.iterdir()}, before)

    def test_backdated_import_does_not_erase_newer_observation(self):
        newer = merge(feed('XYZ'), at=T2)
        self.assertEqual(merge(feed('IBA'), newer, T1), newer)

    def test_idempotent_import(self):
        result = merge(feed())
        self.assertEqual(merge(feed(), result), result)

    def test_unknown_session_and_duplicates_rejected(self):
        for raw in [feed(sid=None), feed(sid='../../bad'), feed() * 2, [None], []]:
            with self.assertRaises(ValueError):
                C.normalize(raw)

    def test_raw_cdn_format_and_mixed_sessions(self):
        raw = [{'semesterSessionId': 20263, 'courseCode': 'CSE221', 'sectionName': '01',
                'faculties': 'IBA', 'labFaculties': 'ANK', 'sectionSchedule': {'classSchedules': [
                    {'day': 'MONDAY', 'startTime': '11:00:00', 'endTime': '12:20:00'}]}}]
        result = merge(raw)
        self.assertEqual(result['20263']['rows']['CSE221|01'][6], [2, 660, 740, 0])
        self.assertEqual(len(merge(feed() + feed(sid=20271))), 2)

    def test_workflow_runs_every_six_hours(self):
        workflow = (Path(__file__).resolve().parents[1] / '.github/workflows/collect-semesters.yml').read_text()
        self.assertIn("cron: '17 */6 * * *'", workflow)
        self.assertIn('workflow_dispatch:', workflow)
        self.assertIn('COLLECTION_BRANCH: ${{ github.event.repository.default_branch }}', workflow)
        self.assertIn('ref: ${{ env.COLLECTION_BRANCH }}', workflow)
        self.assertIn('git push origin "HEAD:refs/heads/$COLLECTION_BRANCH"', workflow)
        self.assertNotIn('arena/01a10a61-prohor', workflow)
        self.assertIn("git add -A -- 'data/semesters/*.json'", workflow)

    def test_network_failure_does_not_modify_collection(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / '20263.json'
            original = json.dumps(merge(feed())['20263'])
            path.write_text(original)
            with patch.object(sys, 'argv', ['collector', '--out', tmp]), patch.object(C.urllib.request, 'urlopen', side_effect=URLError('offline')):
                with self.assertRaises(URLError):
                    C.main()
            self.assertEqual(path.read_text(), original)
            self.assertEqual(list(Path(tmp).iterdir()), [path])

    def test_file_reload_and_bad_feed_leave_archive_intact(self):
        with tempfile.TemporaryDirectory() as tmp:
            src, out = Path(tmp) / 'feed.json', Path(tmp) / 'archive'
            command = [sys.executable, str(Path(C.__file__)), '--in', str(src), '--out', str(out), '--min-sections', '1', '--observed-at', T1]
            src.write_text(json.dumps(feed()))
            subprocess.run(command, check=True, capture_output=True)
            # A second independent process proves persistence isn't just in Python memory.
            src.write_text(json.dumps(feed(None)))
            subprocess.run(command[:-1] + [T2], check=True, capture_output=True)
            self.assertEqual(json.loads((out / '20263.json').read_text())['rows']['CSE221|01'][0], 'IBA')
            before = {p.name: p.read_bytes() for p in out.iterdir()}
            for bad in [[], [None], feed(sid=None), feed() * 2]:
                src.write_text(json.dumps(bad))
                self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)
                self.assertEqual({p.name: p.read_bytes() for p in out.iterdir()}, before)
            src.write_text(json.dumps(feed()))
            self.assertNotEqual(subprocess.run(command + ['--min-sections', '50'], capture_output=True).returncode, 0)
            self.assertEqual({p.name: p.read_bytes() for p in out.iterdir()}, before)


if __name__ == '__main__':
    unittest.main(verbosity=2)
