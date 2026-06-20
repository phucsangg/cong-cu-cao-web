import re

from crawldata.utils.text import (
    NON_ALPHANUM_RE,
    normalize_vietnamese_text,
)


def get_category_keyword(sheet_name: str = "") -> str:
    name = normalize_vietnamese_text(sheet_name)
    if "giat s" in name or "say" in name:
        return "máy sấy"
    if "giat" in name:
        return "máy giặt"
    if "bep tu" in name or "bep" in name:
        return "bếp từ"
    if "hut mui" in name or "hut" in name:
        return "máy hút mùi"
    if "lo nuong" in name or "lo" in name:
        return "lò nướng"
    if "rua bat" in name or "rua chen" in name or "rua" in name:
        return "máy rửa bát"
    if "xay" in name or "blender" in name:
        return "máy xay sinh tố"
    if "loc nuoc" in name:
        return "máy lọc nước"
    return ""


def get_normalized_model_variants(model: str) -> list[str]:
    if not model:
        return []
    clean = str(model).strip()
    no_hyphen = clean.replace("-", "").replace("_", "")
    no_space = clean.replace(" ", "")
    fully_clean = NON_ALPHANUM_RE.sub("", clean)

    variants = {
        clean,
        no_hyphen,
        no_space,
        fully_clean,
        clean.lower(),
        clean.upper(),
        no_hyphen.lower(),
        no_hyphen.upper(),
        no_space.lower(),
        no_space.upper(),
        fully_clean.lower(),
        fully_clean.upper(),
    }
    return sorted(list(variants))


def generate_keywords(brand: str = "", model: str = "", sheet_name: str = "") -> list[str]:
    keywords = set()
    clean_brand = str(brand).strip() if brand else ""
    clean_model = str(model).strip() if model else ""

    if not clean_model:
        return []

    brand_model = f"{clean_brand} {clean_model}" if clean_brand else clean_model
    keywords.add(brand_model)
    keywords.add(clean_model)
    keywords.add(f'"{clean_model}"')

    if clean_brand:
        keywords.add(f"{clean_brand} {clean_model} giá")
        keywords.add(f"{clean_brand} {clean_model} khuyến mãi")
        keywords.add(f"{clean_brand} {clean_model} site:.vn")
    else:
        keywords.add(f"{clean_model} giá")
        keywords.add(f"{clean_model} site:.vn")

    category = get_category_keyword(sheet_name)
    if category:
        cap_category = category[0].upper() + category[1:]
        if clean_brand:
            keywords.add(f"{cap_category} {clean_brand} {clean_model}")
        else:
            keywords.add(f"{cap_category} {clean_model}")

    if clean_brand.lower() == "bosch":
        keywords.add(f"Bosch Series 8 {clean_model}")
        keywords.add(f"Bosch Series 6 {clean_model}")

    suffix_match = re.match(r"^(.*?\d+)([A-Z]+)$", clean_model, re.IGNORECASE)
    if suffix_match:
        base_model = suffix_match.group(1)
        brand_base = f"{clean_brand} {base_model}" if clean_brand else base_model
        keywords.add(brand_base)
        keywords.add(base_model)
        keywords.add(f'"{base_model}"')
        if clean_brand:
            keywords.add(f"{clean_brand} {base_model} giá")

    variants = get_normalized_model_variants(clean_model)
    for variant in variants:
        if variant != clean_model:
            brand_var = f"{clean_brand} {variant}" if clean_brand else variant
            keywords.add(brand_var)
            keywords.add(variant)

    return sorted(list(keywords))
