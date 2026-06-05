#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path
from urllib.parse import urljoin


ROOT = Path(__file__).resolve().parents[1]
BASE_URL = "https://acordes.lacuerda.net/"
DB_PATHS = [
    ROOT / "tools/lacuerda-christian.db",
    ROOT / "tools/lacuerda.db",
]

LATIN_NOTES = {
    "DO": "C",
    "RE": "D",
    "MI": "E",
    "FA": "F",
    "SOL": "G",
    "LA": "A",
    "SI": "B",
}
ENGLISH_NOTE_PATTERN = re.compile(r"^([A-G])([#b]?)(.*)$", re.I)
LATIN_NOTE_PATTERN = re.compile(r"^(SOL|DO|RE|MI|FA|LA|SI)([#b]?)(.*)$", re.I)
CONTROL_TOKEN = re.compile(r"^(?:N\.C\.|NC)$", re.I)
DECORATION_TOKEN = re.compile(r"^(?:x\d*|//|/|\(|\)|-|\d+)$", re.I)
CHORD_SEPARATOR = re.compile(r"(?<=[A-Za-z0-9)#])[-,](?=(?:[A-Ga-g]|DO|RE|MI|FA|SOL|LA|SI|N\.?C\.?))")
CHORD_SUFFIX = re.compile(r"^(?:(?:m|M|min|maj|sus|dim|aug|add)?\d*(?:[#b]\d+)*(?:\([^)]*\))*|[+°º])$", re.I)
SECTION_MAP = {
    "intro": "intro",
    "introduccion": "intro",
    "verso": "verse",
    "estrofa": "verse",
    "coro": "chorus",
    "pre coro": "pre-chorus",
    "precoro": "pre-chorus",
    "puente": "bridge",
    "bridge": "bridge",
    "solo": "interlude",
    "instrumental": "interlude",
    "interludio": "interlude",
    "final": "outro",
    "outro": "outro",
}


def strip_accents(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value or "")
    return "".join(ch for ch in normalized if not unicodedata.combining(ch))


def normalize_text(value: str | None) -> str:
    value = strip_accents(value or "").lower()
    value = re.sub(r"[^a-z0-9 ]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def title_from_slug(slug: str) -> str:
    return slug.replace("_", " ").title()


def similarity(a: str | None, b: str | None) -> float:
    left = normalize_text(a)
    right = normalize_text(b)
    if not left or not right:
        return 0.0
    if left == right:
        return 1.0
    return SequenceMatcher(None, left, right).ratio()


def token_score(song_title: str, title: str) -> float:
    left_tokens = normalize_text(song_title).split()
    right_tokens = normalize_text(title).split()
    if not left_tokens or not right_tokens:
        return 0.0
    left = set(left_tokens)
    right = set(right_tokens)
    overlap = len(left & right)
    if overlap == 0:
        return 0.0
    coverage = overlap / len(right_tokens)
    f_score = (2 * overlap) / (len(left_tokens) + len(right_tokens))
    return max(coverage * 0.9, f_score)


def candidate_score(song_title: str, artist_name: str | None, title: str, artist: str | None) -> float:
    normalized_song_title = normalize_text(song_title)
    normalized_title = normalize_text(title)
    if normalized_song_title == normalized_title:
        title_score = 1.0
    elif normalized_song_title and normalized_title and normalized_title in normalized_song_title:
        title_score = 0.96
    else:
        title_score = max(similarity(song_title, title), token_score(song_title, title))

    if not artist:
        return title_score
    return title_score * 0.78 + similarity(artist_name, artist) * 0.22


def db_paths() -> list[Path]:
    return [path for path in DB_PATHS if path.exists() and path.stat().st_size > 0]


def db_rows() -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for path in db_paths():
        with sqlite3.connect(path) as con:
            con.row_factory = sqlite3.Row
            for row in con.execute(
                """
                SELECT
                    a.nombre AS artist_name,
                    c.artista_slug AS artist_slug,
                    c.slug AS song_slug,
                    c.titulo AS title,
                    c.url AS source_url,
                    v.version_id AS version_id,
                    v.slug AS version_slug,
                    v.formato AS format,
                    v.puntaje AS score,
                    v.votos AS votes,
                    v.txt_url AS txt_url,
                    LENGTH(COALESCE(v.contenido, '')) AS content_length
                FROM cancion c
                JOIN artista a ON a.slug = c.artista_slug
                JOIN version v
                  ON v.artista_slug = c.artista_slug
                 AND v.cancion_slug = c.slug
                WHERE COALESCE(v.contenido, '') <> ''
                """
            ):
                rows.append(dict(row))
    return rows


def search_db(title: str, artist: str | None, limit: int) -> list[dict[str, object]]:
    scored: list[tuple[float, dict[str, object]]] = []
    for row in db_rows():
        score = candidate_score(str(row.get("title") or ""), str(row.get("artist_name") or ""), title, artist)
        if score < 0.55:
            continue
        scored.append((score, row))

    scored.sort(
        key=lambda item: (
            item[0],
            int(item[1].get("votes") or 0),
            float(item[1].get("score") or 0),
            int(item[1].get("content_length") or 0),
        ),
        reverse=True,
    )

    candidates: list[dict[str, object]] = []
    seen: set[tuple[str, str]] = set()
    for score, row in scored:
        artist_slug = str(row.get("artist_slug") or "")
        song_slug = str(row.get("song_slug") or "")
        if not artist_slug or not song_slug:
            continue
        key = (artist_slug, song_slug)
        if key in seen:
            continue
        seen.add(key)
        title_value = str(row.get("title") or title)
        artist_name = str(row.get("artist_name") or "") or None
        source_url = str(row.get("source_url") or urljoin(BASE_URL, f"{artist_slug}/{song_slug}"))
        candidates.append({
            "id": f"local:{artist_slug}:{song_slug}",
            "title": title_value,
            "artist": artist_name,
            "key": None,
            "source": "lacuerda-db",
            "sourceUrl": source_url,
            "txtUrl": row.get("txt_url"),
            "versionId": row.get("version_id"),
            "versionSlug": row.get("version_slug"),
            "format": row.get("format"),
            "score": score,
            "votes": row.get("votes"),
            "ref": {
                "kind": "live",
                "artistSlug": artist_slug,
                "songSlug": song_slug,
                "title": title_value,
                "sourceUrl": source_url,
                "preferDirectTxt": True,
            },
        })
        if len(candidates) >= limit:
            break
    return candidates


def normalize_suffix(suffix: str) -> str | None:
    value = re.sub(r"^[,;]+|[,;]+$", "", suffix or "").strip()
    if value and not CHORD_SUFFIX.match(value):
        return None
    return value


def normalize_chord_token(token: str) -> str | None:
    value = re.sub(r"^[,;/()]+|[,;/()]+$", "", token.strip())
    if not value or DECORATION_TOKEN.match(value):
        return None
    if CONTROL_TOKEN.match(value):
        return "N.C."
    if "-" in value:
        return None
    if "/" in value:
        parts = [normalize_chord_token(part) for part in value.split("/")]
        if any(part is None for part in parts):
            return None
        return "/".join(part for part in parts if part)

    for pattern in (ENGLISH_NOTE_PATTERN, LATIN_NOTE_PATTERN):
        match = pattern.match(value)
        if not match:
            continue
        note, accidental, suffix = match.groups()
        normalized_suffix = normalize_suffix(suffix)
        if normalized_suffix is None:
            continue
        note_upper = strip_accents(note).upper()
        return f"{LATIN_NOTES.get(note_upper, note_upper)}{accidental}{normalized_suffix}"
    return None


def chord_spans(line: str) -> list[tuple[int, str]]:
    candidates: list[tuple[int, str]] = []
    for match in re.finditer(r"[^\s|]+", line):
        raw = match.group(0)
        offset = match.start()
        cursor = 0
        for part in [part for part in CHORD_SEPARATOR.split(raw) if part]:
            part_offset = raw.find(part, cursor)
            if part_offset == -1:
                part_offset = cursor
            normalized = normalize_chord_token(part)
            if normalized:
                candidates.append((offset + part_offset, normalized))
            cursor = part_offset + len(part)
    return candidates


def is_chord_line(line: str) -> bool:
    compact = line.strip()
    if not compact or len(compact) > 100:
        return False
    tokens = [token for token in re.split(r"[\s|,]+", compact) if token]
    meaningful = [token for token in tokens if not DECORATION_TOKEN.match(re.sub(r"^[,;/()]+|[,;/()]+$", "", token))]
    return len(chord_spans(compact)) >= max(1, int(len(meaningful) * 0.7))


def heading_section(value: str) -> str | None:
    heading = normalize_text(value.replace(":", ""))
    heading = re.sub(r"^(?:i|ii|iii|iv|v|vi|vii|viii|ix|x)\s+", "", heading)
    heading = re.sub(r"\s+\d+$", "", heading)
    if heading in SECTION_MAP:
        return SECTION_MAP[heading]
    first = heading.split(" ", 1)[0] if heading else ""
    return SECTION_MAP.get(first)


def chord_line_text(line: str) -> str:
    return " ".join(f"[{chord}]" for _, chord in chord_spans(line))


def merge_chords_with_lyrics(chords: str, lyric: str) -> str:
    if not lyric.strip():
        return chord_line_text(chords)
    output: list[str] = []
    cursor = 0
    for position, chord in chord_spans(chords):
        lyric_index = 0 if position <= 2 else min(position, len(lyric))
        if lyric_index > cursor:
            output.append(lyric[cursor:lyric_index])
            cursor = lyric_index
        output.append(f"[{chord}]")
    output.append(lyric[cursor:])
    return "".join(output).rstrip()


def clean_lacuerda_text(content: str) -> list[str]:
    lines = content.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    body: list[str] = []
    in_header = True
    for line in lines:
        stripped = line.strip()
        if in_header:
            if stripped.startswith("===") or stripped.startswith("+---") or stripped.startswith("|"):
                continue
            if not stripped:
                in_header = False
                continue
        if "=========================== lacuerda.net" in stripped:
            break
        if "Este fichero es trabajo propio" in stripped:
            break
        body.append(line.rstrip())
    return body


def infer_key(chordpro: str) -> str | None:
    for match in re.finditer(r"\[([^\]\n]+)\]", chordpro):
        token = match.group(1).split()[0].strip()
        normalized = normalize_chord_token(token)
        if not normalized or normalized == "N.C.":
            continue
        root = re.match(r"^([A-G][#b]?)", normalized)
        if root:
            return root.group(1)
    return None


def to_chordpro(content: str, title: str, artist: str | None, key: str | None) -> str:
    source_lines = clean_lacuerda_text(content)
    output = [f"{{title: {title}}}"]
    if artist:
        output.append(f"{{artist: {artist}}}")
    if key:
        output.append(f"{{key: {key}}}")
    output.append("")

    index = 0
    while index < len(source_lines):
        line = source_lines[index]
        stripped = line.strip()
        if not stripped:
            if output[-1] != "":
                output.append("")
            index += 1
            continue

        section = heading_section(stripped)
        if stripped.endswith(":") and section:
            if output[-1] != "":
                output.append("")
            output.append(f"{{{section}}}")
            index += 1
            continue

        if is_chord_line(line):
            next_line = source_lines[index + 1] if index + 1 < len(source_lines) else ""
            if next_line.strip() and not is_chord_line(next_line):
                output.append(merge_chords_with_lyrics(line, next_line))
                index += 2
                continue
            output.append(chord_line_text(line))
            index += 1
            continue

        output.append(stripped)
        index += 1

    return re.sub(r"\n{3,}", "\n\n", "\n".join(output)).strip() + "\n"


def is_usable_chordpro(chordpro: str) -> bool:
    if chordpro.count("[") != chordpro.count("]"):
        return False
    chord_count = len(re.findall(r"\[[^\]\n]+\]", chordpro))
    lyric_lines = [
        line for line in chordpro.splitlines()
        if line.strip() and not line.strip().startswith("{") and not is_chord_line(line.strip())
    ]
    return chord_count >= 4 and len(lyric_lines) >= 4


def selected_chart(artist_slug: str, song_slug: str, fallback_title: str, fallback_artist: str | None) -> dict[str, object] | None:
    for path in db_paths():
        with sqlite3.connect(path) as con:
            con.row_factory = sqlite3.Row
            row = con.execute(
                """
                SELECT
                    a.nombre AS artist_name,
                    c.titulo AS title,
                    c.url AS source_url,
                    v.version_id AS version_id,
                    v.slug AS version_slug,
                    v.formato AS format,
                    v.puntaje AS score,
                    v.votos AS votes,
                    v.contenido AS content,
                    v.txt_url AS txt_url
                FROM cancion c
                JOIN artista a ON a.slug = c.artista_slug
                JOIN version v
                  ON v.artista_slug = c.artista_slug
                 AND v.cancion_slug = c.slug
                WHERE c.artista_slug = ?
                  AND c.slug = ?
                  AND COALESCE(v.contenido, '') <> ''
                ORDER BY
                  CASE WHEN COALESCE(v.formato, 'R') = 'R' THEN 0 ELSE 1 END,
                  COALESCE(v.votos, 0) DESC,
                  COALESCE(v.puntaje, 0) DESC,
                  v.version_id ASC
                LIMIT 1
                """,
                [artist_slug, song_slug],
            ).fetchone()
        if not row:
            continue

        title = fallback_title or str(row["title"] or song_slug)
        artist = fallback_artist or str(row["artist_name"] or "") or title_from_slug(artist_slug)
        chordpro = to_chordpro(str(row["content"] or ""), title, artist, None)
        key = infer_key(chordpro)
        if not is_usable_chordpro(chordpro):
            continue
        return {
            "title": title,
            "artist": artist,
            "key": key,
            "chordpro": chordpro,
            "source": "lacuerda-db",
            "sourceUrl": row["source_url"] or urljoin(BASE_URL, f"{artist_slug}/{song_slug}"),
            "txtUrl": row["txt_url"],
            "versionId": row["version_id"],
            "versionSlug": row["version_slug"],
            "format": row["format"],
            "score": row["score"],
            "votes": row["votes"],
        }
    return None


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch/search one song chart from the local La Cuerda DB.")
    parser.add_argument("--title", required=True)
    parser.add_argument("--artist", default="")
    parser.add_argument("--artist-slug", default="")
    parser.add_argument("--song-slug", default="")
    parser.add_argument("--source-url", default="")
    parser.add_argument("--search", action="store_true")
    parser.add_argument("--limit", type=int, default=5)
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    title = args.title.strip()
    artist = args.artist.strip() or None
    limit = max(1, min(args.limit, 20))

    if args.search:
        print(json.dumps({"candidates": search_db(title, artist, limit)}, ensure_ascii=False))
        return 0

    artist_slug = args.artist_slug.strip()
    song_slug = args.song_slug.strip()
    result = selected_chart(artist_slug, song_slug, title, artist) if artist_slug and song_slug else None
    if result is None:
        candidates = search_db(title, artist, 1)
        if candidates:
            ref = candidates[0].get("ref") or {}
            if isinstance(ref, dict):
                result = selected_chart(
                    str(ref.get("artistSlug") or ""),
                    str(ref.get("songSlug") or ""),
                    str(candidates[0].get("title") or title),
                    str(candidates[0].get("artist") or artist or "") or None,
                )

    if result is None:
        print(json.dumps({"error": "No se encontraron acordes en La Cuerda."}, ensure_ascii=False))
        return 2

    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
