import re
import unicodedata
from typing import Any

# Global precompiled regexes
PARENTHESES_RE = re.compile(r"\s*\([^)]*\)\s*$")
CM_SPEC_RE = re.compile(r"[-_\s]*\d+\s*cm\b", re.IGNORECASE)
COLOR_SPEC_RE = re.compile(
    r"[-_\s]+(bạc|đen|trắng|xám|đỏ|gold|silver|black|white|grey|gray|new|inox|kính)\b", re.IGNORECASE
)
MM_RE = re.compile(r"\b(\d+(?:\.\d+)?)\s*mm\b", re.IGNORECASE)
M_RE = re.compile(r"\b(\d+(?:[.,]\d+)?)\s*m\b", re.IGNORECASE)
CM_RE = re.compile(r"\b(\d+(?:\.\d+)?)\s*cm\b", re.IGNORECASE)
NON_ALPHANUM_RE = re.compile(r"[^a-zA-Z0-9]")


def normalize_vietnamese_text(value: str = "") -> str:
    if not value:
        return ""
    # Normalize unicode to NFD and strip diacritics
    nfd_normalized = unicodedata.normalize("NFD", str(value))
    without_accents = "".join(c for c in nfd_normalized if not unicodedata.combining(c))
    res = without_accents.replace("đ", "d").replace("Đ", "d")
    return res.strip().lower()


def normalize_model_text(value: str = "") -> str:
    str_val = normalize_vietnamese_text(value)
    str_val = str_val.replace("+", " plus ")

    # 1. mm to cm
    def replace_mm(m):
        return f"{float(m.group(1)) / 10:.1f}cm".replace(".0cm", "cm")

    str_val = MM_RE.sub(replace_mm, str_val)

    # 2. m to cm
    def replace_m(m):
        parsed_num = float(m.group(1).replace(",", "."))
        return f"{parsed_num * 100:.1f}cm".replace(".0cm", "cm")

    str_val = M_RE.sub(replace_m, str_val)

    # 3. remove cm unit suffix
    str_val = CM_RE.sub(r"\1", str_val)

    return NON_ALPHANUM_RE.sub("", str_val).upper()


def clean_model_specs(model: str) -> str:
    if not model:
        return ""
    cleaned = str(model).strip()
    while True:
        previous = cleaned
        cleaned = PARENTHESES_RE.sub("", cleaned).strip()
        cleaned = CM_SPEC_RE.sub("", cleaned).strip()
        cleaned = COLOR_SPEC_RE.sub("", cleaned).strip()
        if cleaned == previous:
            break
    return cleaned


def clean_text(text: Any) -> str:
    s = str(text or "")
    s = re.sub(r"\[[^\]]+\]", " ", s)
    s = re.sub(r"\([^)]*\)", " ", s)
    s = s.replace("|", " ")
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def decode_html_entities(text: str = "") -> str:
    return (
        str(text)
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
    )


def extract_sheet_names_from_html(html: str = "") -> list[str]:
    names = []
    seen = set()

    def add_name(val):
        name = decode_html_entities(str(val or "").strip())
        if name and name not in seen:
            seen.add(name)
            names.append(name)

    caption_matches = re.finditer(r'docs-sheet-tab-caption">([^<]+)<', html)
    for m in caption_matches:
        add_name(m.group(1))

    if not names:
        json_matches = re.finditer(r'\[0,0,"([^"]+)"\]', html)
        for m in json_matches:
            add_name(m.group(1))

    return names
