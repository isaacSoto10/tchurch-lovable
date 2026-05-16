#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import re
import sqlite3
import sys
import unicodedata
from pathlib import Path


DEFAULT_DB = Path(__file__).with_name("lacuerda.db")
DEFAULT_ARTISTS = Path(__file__).with_name("christian_artist_slugs.txt")
DEFAULT_OUT = Path(__file__).with_name("top_registered_christian_songs.csv")


def normalize(value: str) -> str:
    value = unicodedata.normalize("NFKD", value)
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    value = value.lower()
    value = re.sub(r"\([^)]*\)", " ", value)
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def read_artist_slugs(path: Path) -> list[str]:
    slugs: list[str] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.split("#", 1)[0].strip()
        if line:
            slugs.append(line)
    return slugs


def export_top_registered(
    con: sqlite3.Connection,
    artist_slugs: list[str],
    limit: int,
    out_path: Path,
) -> int:
    placeholders = ",".join("?" for _ in artist_slugs)
    rows = con.execute(
        f"""
        SELECT
            c.titulo,
            a.nombre AS artista,
            c.artista_slug,
            c.slug AS cancion_slug,
            c.url,
            COUNT(v.version_id) AS versiones,
            MAX(COALESCE(v.votos, 0)) AS votos,
            MAX(COALESCE(v.puntaje, 0)) AS puntaje,
            GROUP_CONCAT(DISTINCT v.formato) AS formatos
        FROM cancion c
        JOIN artista a ON a.slug = c.artista_slug
        LEFT JOIN version v
            ON v.artista_slug = c.artista_slug
            AND v.cancion_slug = c.slug
        WHERE c.artista_slug IN ({placeholders})
        GROUP BY c.artista_slug, c.slug
        ORDER BY votos DESC, puntaje DESC, versiones DESC, c.titulo ASC
        LIMIT ?
        """,
        [*artist_slugs, limit],
    ).fetchall()

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(
            [
                "rank",
                "title",
                "artist",
                "artist_slug",
                "song_slug",
                "votes",
                "score",
                "versions",
                "formats",
                "lacuerda_url",
            ]
        )
        for index, row in enumerate(rows, start=1):
            title, artist, artist_slug, song_slug, url, versions, votes, score, formats = row
            writer.writerow(
                [
                    index,
                    title,
                    artist,
                    artist_slug,
                    song_slug,
                    votes,
                    score,
                    versions,
                    formats or "",
                    url,
                ]
            )

    return len(rows)


def verify_candidates(
    con: sqlite3.Connection,
    candidates_path: Path,
    out_path: Path,
) -> int:
    songs = con.execute(
        """
        SELECT c.titulo, a.nombre, c.artista_slug, c.slug, c.url
        FROM cancion c
        JOIN artista a ON a.slug = c.artista_slug
        """
    ).fetchall()
    by_title = {}
    by_title_artist = {}
    for title, artist, artist_slug, song_slug, url in songs:
        item = {
            "title": title,
            "artist": artist,
            "artist_slug": artist_slug,
            "song_slug": song_slug,
            "url": url,
        }
        by_title.setdefault(normalize(title), []).append(item)
        by_title_artist[(normalize(title), normalize(artist))] = item

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with candidates_path.open("r", encoding="utf-8", newline="") as input_fh:
        reader = csv.DictReader(input_fh)
        fieldnames = [
            *reader.fieldnames,
            "registered",
            "match_title",
            "match_artist",
            "match_url",
        ] if reader.fieldnames else []
        if not fieldnames:
            raise ValueError("El CSV necesita encabezados, al menos title y artist.")

        with out_path.open("w", encoding="utf-8", newline="") as output_fh:
            writer = csv.DictWriter(output_fh, fieldnames=fieldnames)
            writer.writeheader()
            total = 0
            for row in reader:
                total += 1
                title = row.get("title") or row.get("titulo") or ""
                artist = row.get("artist") or row.get("artista") or ""
                match = by_title_artist.get((normalize(title), normalize(artist)))
                if match is None:
                    candidates = by_title.get(normalize(title), [])
                    match = candidates[0] if candidates else None
                row["registered"] = "yes" if match else "no"
                row["match_title"] = match["title"] if match else ""
                row["match_artist"] = match["artist"] if match else ""
                row["match_url"] = match["url"] if match else ""
                writer.writerow(row)
    return total


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Genera o verifica reportes de canciones cristianas registradas."
    )
    parser.add_argument("--db", default=str(DEFAULT_DB), help="SQLite creado por lacuerda_crawler.py")
    parser.add_argument("--artists-file", default=str(DEFAULT_ARTISTS), help="Archivo con slugs cristianos")
    parser.add_argument("--top", type=int, default=300, help="Cantidad de canciones a exportar")
    parser.add_argument("--out", default=str(DEFAULT_OUT), help="CSV de salida")
    parser.add_argument(
        "--verify-csv",
        help="CSV con columnas title/artist para verificar si estan registradas en el DB",
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    db_path = Path(args.db)
    if not db_path.exists():
        print(f"No existe el DB: {db_path}", file=sys.stderr)
        return 1

    with sqlite3.connect(db_path) as con:
        if args.verify_csv:
            total = verify_candidates(con, Path(args.verify_csv), Path(args.out))
            print(f"Verified {total} candidate songs -> {args.out}")
            return 0

        artist_slugs = read_artist_slugs(Path(args.artists_file))
        if not artist_slugs:
            print("No artist slugs found.", file=sys.stderr)
            return 1
        total = export_top_registered(con, artist_slugs, args.top, Path(args.out))
        print(f"Exported {total} registered Christian songs -> {args.out}")
        return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
