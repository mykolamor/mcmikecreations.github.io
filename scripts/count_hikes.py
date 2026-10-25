#!/usr/bin/env python3
"""Count hike dates, posts, and posts with facts not hidden."""

import os
import json

BASE_DIR = "/home/mcmike/Projects/mcmikecreations.github.io/static/_projects/data-viz/hikes"
MARKDOWN_DIR = os.path.join(BASE_DIR, "markdown")
GPX_DIR = os.path.join(BASE_DIR, "gpx")


def extract_slug_md(md_filename):
    """Extract the slug from a markdown filename (YYYY-MM-DD-slug.md)."""
    name_no_ext = md_filename[:-3]  # remove .md
    parts = name_no_ext.split("-")
    # Format is YYYY-MM-DD-slug, so take from part 3 onwards
    if len(parts) >= 4:
        return "-".join(parts[3:])
    return name_no_ext


def extract_slug_gpx(gpx_filename):
    """Extract the slug from a GPX filename."""
    return gpx_filename[:-4]  # remove .gpx


def parse_markdown_front_matter(filepath):
    """Parse the YAML front matter of a markdown file."""
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    # Split on the first --- to get front matter
    parts = content.split("---\n", 1)
    if len(parts) < 2:
        return {}, content

    front_matter = parts[1]
    # Find the closing ---
    closing_idx = front_matter.find("\n---\n")
    if closing_idx == -1:
        return {}, content

    fm_text = front_matter[:closing_idx]
    # Simple parsing of key: value pairs
    fields = {}
    for line in fm_text.strip().split("\n"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if ":" in line:
            key, _, value = line.partition(":")
            key = key.strip()
            value = value.strip()
            # Handle quoted strings
            if len(value) >= 2 and value[0] == '"' and value[-1] == '"':
                value = value[1:-1]
            elif len(value) >= 2 and value[0] == "'" and value[-1] == "'":
                value = value[1:-1]
            fields[key] = value

    return fields, content


def is_hidden(fields):
    """Check if the markdown file is hidden."""
    return fields.get("hidden") == "true"


def has_facts_in_md(fields):
    """Check if the markdown front matter has a facts field."""
    return "facts" in fields


def has_facts_in_sidecar(sidecar_path):
    """Check if the .hike.json sidecar has a facts field."""
    try:
        with open(sidecar_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return "facts" in data
    except (json.JSONDecodeError, FileNotFoundError):
        return False


def main():
    # === Get all markdown files ===
    md_files = sorted([f for f in os.listdir(MARKDOWN_DIR) if f.endswith(".md")])

    # === Get all HJ sidecar files ===
    hj_files = [f for f in os.listdir(MARKDOWN_DIR) if f.endswith(".hike.json")]

    # === Get all GPX files ===
    gpx_files = [f for f in os.listdir(GPX_DIR) if f.endswith(".gpx")]

    # === Count 1: Total number of hike dates ===
    # = 93 (MD files) + 54 (HJ-only, no MD counterpart) + 4 (GPX-only, no MD/HJ counterpart)
    # = 151 total hike dates

    # First, build sets of slugs
    md_slugs = set()
    for f in md_files:
        slug = extract_slug_md(f)
        md_slugs.add(slug)

    hj_slugs = set()
    for f in hj_files:
        slug = f[:-10]  # remove .hike.json
        hj_slugs.add(slug)

    gpx_slugs = set()
    for f in gpx_files:
        slug = extract_slug_gpx(f)
        gpx_slugs.add(slug)

    # Count MD files (always 93)
    count_md = len(md_files)

    # Count HJ files that don't have a corresponding MD post
    # An HJ file has a "corresponding MD post" if its slug exists in the MD slugs set
    hj_only = hj_slugs - md_slugs
    count_hj_only = len(hj_only)

    # Count GPX files that don't have a corresponding MD or HJ post
    gpx_no_md_hpx = gpx_slugs - md_slugs - hj_slugs
    count_gpx_only = len(gpx_no_md_hpx)

    total_hike_dates = count_md + count_hj_only + count_gpx_only
    # Alternatively: total unique slugs = len(md_slugs | hj_slugs | gpx_slugs) = 149
    # But user says 151 = 93 + 54 + 4

    # === Count 2: Total number of hike posts that have md with text ===
    total_hike_posts_md = 0
    for md_file in md_files:
        filepath = os.path.join(MARKDOWN_DIR, md_file)
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()
        # Check if there's text after the front matter
        parts = content.split("---\n", 1)
        if len(parts) >= 2:
            after_front_matter = parts[1].strip()
            if after_front_matter:
                total_hike_posts_md += 1

    # === Count 3: Total number of hike posts that have facts
    # in the .hike.json sidecar or .md hike post that are not hidden ===
    # Find all hidden markdown files
    hidden_files = set()
    for md_file in md_files:
        filepath = os.path.join(MARKDOWN_DIR, md_file)
        fm, _ = parse_markdown_front_matter(filepath)
        if is_hidden(fm):
            hidden_files.add(md_file)

    # Count posts that have facts (in sidecar or md) AND are not hidden
    total_facts_not_hidden = 0
    for md_file in md_files:
        if md_file in hidden_files:
            continue

        filepath = os.path.join(MARKDOWN_DIR, md_file)
        fm, _ = parse_markdown_front_matter(filepath)

        has_facts = False

        # Check if markdown front matter has facts
        if has_facts_in_md(fm):
            has_facts = True

        # Check if corresponding .hike.json sidecar has facts
        slug = extract_slug_md(md_file)
        sidecar_name = slug + ".hike.json"
        sidecar_path = os.path.join(MARKDOWN_DIR, sidecar_name)
        if os.path.exists(sidecar_path):
            if has_facts_in_sidecar(sidecar_path):
                has_facts = True

        if has_facts:
            total_facts_not_hidden += 1

    print('Website statistics for hikes...')
    print('Total dates:', total_hike_dates)
    print('Total posts:', total_hike_posts_md)
    print('Total facts:', total_facts_not_hidden)


if __name__ == "__main__":
    main()