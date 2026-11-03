from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from scout import deadlines

NY = ZoneInfo("America/New_York")


def test_parse_long_form_with_time():
    dt = deadlines.parse_deadline("Bids are due no later than December 4, 2026 at 2:00 PM local time.")
    assert dt == datetime(2026, 12, 4, 14, 0, tzinfo=NY)


def test_parse_numeric_without_time_defaults_end_of_day():
    dt = deadlines.parse_deadline("Due 11/21/2026")
    assert (dt.hour, dt.minute) == (23, 59)


def test_parse_noon_and_am():
    assert deadlines.parse_deadline("June 1, 2027 at 12:00 noon").hour == 12
    assert deadlines.parse_deadline("June 1, 2027 at 10:30 a.m.").hour == 10


def test_storage_roundtrip_and_tz():
    dt = datetime(2026, 7, 4, 14, 0, tzinfo=NY)  # EDT
    utc, local, tz = deadlines.to_storage(dt)
    assert utc.endswith("+00:00") and "18:00" in utc
    assert local.endswith("-04:00") and tz == "America/New_York"
    assert deadlines.from_storage(utc) == dt


def test_urgency_buckets():
    now = datetime(2026, 11, 1, 12, 0, tzinfo=timezone.utc)
    def iso(days):
        return datetime(2026, 11, 1 + days, 12, 0, tzinfo=timezone.utc).isoformat()
    assert deadlines.urgency_bucket(iso(2), now) == "Due in 3 days or less"
    assert deadlines.urgency_bucket(iso(6), now) == "Due within 7 days"
    assert deadlines.urgency_bucket(iso(13), now) == "Due within 14 days"
    assert deadlines.urgency_bucket(iso(20), now) == "More than 14 days"
    assert deadlines.urgency_bucket(None, now) == "No deadline on file"
    assert deadlines.urgency_bucket(datetime(2026, 10, 1, tzinfo=timezone.utc).isoformat(), now) == "Passed"


def test_unparseable_returns_none():
    assert deadlines.parse_deadline("sometime soon") is None
    assert deadlines.parse_deadline("") is None
