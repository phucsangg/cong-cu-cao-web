from typing import Any


def parse_specific_rows(value: str) -> set[int] | None:
    if not value or not str(value).strip():
        return None
    res = set()
    cleaned = str(value).strip()
    parts = [p.strip() for p in cleaned.split(",")]
    for part in parts:
        if not part:
            continue
        if "-" in part:
            range_parts = [r.strip() for r in part.split("-")]
            if len(range_parts) == 2:
                try:
                    start = int(range_parts[0])
                    end = int(range_parts[1])
                    if start <= end:
                        res.update(range(start, end + 1))
                    else:
                        res.update(range(end, start + 1))
                except ValueError:
                    return None
            else:
                return None
        else:
            try:
                res.add(int(part))
            except ValueError:
                return None
    return res if res else None


def clean_numeric_code(val: Any) -> str:
    s = str(val or "").strip()
    if s.endswith(".0"):
        s = s[:-2]
    return s


def normalize_selected_sheet_names(sheet_name: Any) -> list[str]:
    if isinstance(sheet_name, list):
        raw_items = sheet_name
    else:
        raw_items = str(sheet_name or "").split(",")

    seen = set()
    res = []
    for item in raw_items:
        s = str(item or "").strip()
        if s and s not in seen:
            seen.add(s)
            res.append(s)
    return res
