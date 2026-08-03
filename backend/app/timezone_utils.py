from datetime import datetime, timedelta

TASHKENT_OFFSET = timedelta(hours=5)

def to_tashkent_naive(value: datetime | None) -> datetime | None:
    """Convert a UTC-naive DB timestamp to UTC+5 for display/export."""
    if value is None:
        return None
    return value + TASHKENT_OFFSET
