#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import sqlite3
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup


BASE_URL = "https://acordes.lacuerda.net/"
DEFAULT_DB = Path(__file__).with_name("lacuerda.db")
REQUEST_TIMEOUT = 20
USER_AGENT = (
    "Mozilla/5.0 (compatible; lacuerda-crawler/2.0; "
    "+https://github.com/cript0nauta/crawler-lacuerda)"
)

FORMATOS = {
    "R": "Acordes",
    "K": "Piano",
    "T": "Tablatura para guitarra",
    "H": "Armonica",
    "B": "Bajo",
    "D": "Bateria",
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS formato (
    id TEXT PRIMARY KEY,
    descripcion TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artista (
    slug TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    url TEXT NOT NULL,
    descargado INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cancion (
    artista_slug TEXT NOT NULL,
    slug TEXT NOT NULL,
    titulo TEXT NOT NULL,
    url TEXT NOT NULL,
    PRIMARY KEY (artista_slug, slug),
    FOREIGN KEY (artista_slug) REFERENCES artista(slug)
);

CREATE TABLE IF NOT EXISTS version (
    artista_slug TEXT NOT NULL,
    cancion_slug TEXT NOT NULL,
    version_id INTEGER NOT NULL,
    slug TEXT NOT NULL,
    formato TEXT,
    puntaje REAL,
    votos INTEGER,
    contenido TEXT,
    txt_url TEXT NOT NULL,
    PRIMARY KEY (artista_slug, cancion_slug, version_id),
    FOREIGN KEY (artista_slug, cancion_slug)
        REFERENCES cancion(artista_slug, slug),
    FOREIGN KEY (formato) REFERENCES formato(id)
);
"""


@dataclass(frozen=True)
class Artist:
    slug: str
    name: str
    url: str


@dataclass(frozen=True)
class Song:
    artist_slug: str
    slug: str
    title: str
    url: str


@dataclass(frozen=True)
class Version:
    artist_slug: str
    song_slug: str
    version_id: int
    slug: str
    formato: str | None
    puntaje: float | None
    votos: int | None
    contenido: str
    txt_url: str


class LaCuerdaCrawler:
    def __init__(self, verbose: bool = False, pause_seconds: float = 0.0) -> None:
        self.verbose = verbose
        self.pause_seconds = pause_seconds
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": USER_AGENT})

    def log(self, *parts: object) -> None:
        if self.verbose:
            print(*parts)

    def fetch(self, url: str, retries: int = 3) -> str:
        last_error: Exception | None = None
        for attempt in range(1, retries + 1):
            try:
                self.log(f"[GET] {url}")
                response = self.session.get(url, timeout=REQUEST_TIMEOUT)
                response.raise_for_status()
                if self.pause_seconds:
                    time.sleep(self.pause_seconds)
                return response.text
            except requests.RequestException as exc:
                last_error = exc
                if attempt == retries:
                    break
                wait = min(5 * attempt, 15)
                self.log(f"Request failed, retrying in {wait}s:", exc)
                time.sleep(wait)
        assert last_error is not None
        raise last_error

    def fetch_soup(self, url: str) -> BeautifulSoup:
        return BeautifulSoup(self.fetch(url), "html.parser")

    def get_letter_pages(self) -> list[str]:
        soup = self.fetch_soup(urljoin(BASE_URL, "tabs/"))
        pages: list[str] = []
        seen: set[str] = set()
        for link in soup.select("#a_menu a[href]"):
            href = link.get("href", "").strip()
            if not href.startswith("/tabs/"):
                continue
            url = urljoin(BASE_URL, href)
            if url not in seen:
                seen.add(url)
                pages.append(url)
        return pages

    def get_index_pages_for_letter(self, letter_url: str) -> list[str]:
        soup = self.fetch_soup(letter_url)
        pages = {letter_url}

        for button in soup.select("button[onclick]"):
            onclick = button.get("onclick", "")
            match = re.search(r"window\.location='([^']+)'", onclick)
            if match:
                pages.add(urljoin(letter_url, match.group(1)))

        for item in soup.select(".multipag li[onclick]"):
            onclick = item.get("onclick", "")
            match = re.search(r"w\.location='([^']+)'", onclick)
            if match:
                pages.add(urljoin(letter_url, match.group(1)))

        for link in soup.select(".multipag a[href]"):
            pages.add(urljoin(letter_url, link["href"]))

        return sorted(pages)

    def parse_artists_from_page(self, page_url: str) -> list[Artist]:
        soup = self.fetch_soup(page_url)
        artists: list[Artist] = []
        seen: set[str] = set()
        for link in soup.select("#i_main li a[href]"):
            href = link.get("href", "").strip()
            match = re.match(r"^/([^/]+)/$", href)
            if not match:
                continue
            slug = match.group(1)
            if slug in seen:
                continue
            seen.add(slug)
            text = link.get_text(" ", strip=True)
            name = re.sub(r"^\s*Acordes de\s+", "", text, flags=re.IGNORECASE)
            artists.append(Artist(slug=slug, name=name, url=urljoin(BASE_URL, href)))
        return artists

    def get_artists(self, limit: int | None = None) -> list[Artist]:
        artists: list[Artist] = []
        seen: set[str] = set()

        for letter_url in self.get_letter_pages():
            self.log("Exploring letter page:", letter_url)
            for page_url in self.get_index_pages_for_letter(letter_url):
                for artist in self.parse_artists_from_page(page_url):
                    if artist.slug in seen:
                        continue
                    seen.add(artist.slug)
                    artists.append(artist)
                    if limit and len(artists) >= limit:
                        return artists
        return artists

    def get_songs(self, artist_slug: str, limit: int | None = None) -> list[Song]:
        artist_url = urljoin(BASE_URL, f"{artist_slug}/")
        soup = self.fetch_soup(artist_url)
        songs: list[Song] = []
        seen: set[str] = set()

        for link in soup.select("#b_main li a[href]"):
            href = link.get("href", "").strip()
            if not href or href.endswith(".shtml"):
                continue
            slug = href.split("/")[-1]
            if slug in seen:
                continue
            seen.add(slug)
            title = self._extract_song_title(link)
            songs.append(
                Song(
                    artist_slug=artist_slug,
                    slug=slug,
                    title=title,
                    url=urljoin(artist_url, slug),
                )
            )
            if limit and len(songs) >= limit:
                break

        return songs

    def _extract_song_title(self, link) -> str:
        raw = link.get_text(" ", strip=True)
        raw = re.sub(
            r"\s+(acordes|tabs?|tablaturas?|bajo|piano|ukulele)\s*$",
            "",
            raw,
            flags=re.IGNORECASE,
        )
        return raw.strip()

    def get_versions(self, song: Song) -> list[Version]:
        soup = self.fetch_soup(song.url)
        metadata = self._get_song_metadata(soup, song.url)
        versions: list[Version] = []

        for item in soup.select("li[id^=liElm]"):
            onclick = item.get("onclick", "")
            match = re.search(r"tOpen\((\d+)\)", onclick)
            if not match:
                continue

            version_id = int(match.group(1))
            slug = song.slug if version_id == 1 else f"{song.slug}-{version_id}"
            txt_url = urljoin(BASE_URL, f"TXT/{song.artist_slug}/{slug}.txt")
            contenido = self.fetch(txt_url)
            meta = metadata.get(version_id - 1)
            if meta is None:
                meta = metadata.get(version_id, {})
            versions.append(
                Version(
                    artist_slug=song.artist_slug,
                    song_slug=song.slug,
                    version_id=version_id,
                    slug=slug,
                    formato=meta.get("formato"),
                    puntaje=meta.get("puntaje"),
                    votos=meta.get("votos"),
                    contenido=contenido,
                    txt_url=txt_url,
                )
            )

        return versions

    def _get_song_metadata(
        self, soup: BeautifulSoup, page_url: str
    ) -> dict[int, dict[str, float | int | str]]:
        cal_src = None
        for script in soup.select("script[src]"):
            src = script.get("src", "")
            if "cal.php" in src:
                cal_src = src
                break

        if not cal_src:
            return {}

        cal_url = urljoin(page_url, cal_src)
        cal_js = self.fetch(cal_url)
        metadata: dict[int, dict[str, float | int | str]] = {}
        pattern = re.compile(
            r"trcal\[(\d+)\]=\['([A-Z])',([0-9.]+),([0-9]+),\s*([0-9]+)\];"
        )
        for version_str, formato, puntaje, votos, _order in pattern.findall(cal_js):
            version_id = int(version_str)
            metadata[version_id] = {
                "formato": formato,
                "puntaje": float(puntaje),
                "votos": int(votos),
            }
        return metadata


def init_db(con: sqlite3.Connection) -> None:
    con.executescript(SCHEMA)
    con.executemany(
        "INSERT OR REPLACE INTO formato(id, descripcion) VALUES (?, ?)",
        sorted(FORMATOS.items()),
    )
    con.commit()


def store_artists(con: sqlite3.Connection, artists: Iterable[Artist]) -> None:
    con.executemany(
        """
        INSERT INTO artista(slug, nombre, url, descargado)
        VALUES (?, ?, ?, 0)
        ON CONFLICT(slug) DO UPDATE SET
            nombre=excluded.nombre,
            url=excluded.url,
            updated_at=CURRENT_TIMESTAMP
        """,
        [(artist.slug, artist.name, artist.url) for artist in artists],
    )
    con.commit()


def store_song_bundle(
    con: sqlite3.Connection, song: Song, versions: Iterable[Version]
) -> None:
    con.execute(
        """
        INSERT INTO cancion(artista_slug, slug, titulo, url)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(artista_slug, slug) DO UPDATE SET
            titulo=excluded.titulo,
            url=excluded.url
        """,
        (song.artist_slug, song.slug, song.title, song.url),
    )

    con.executemany(
        """
        INSERT INTO version(
            artista_slug, cancion_slug, version_id, slug,
            formato, puntaje, votos, contenido, txt_url
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(artista_slug, cancion_slug, version_id) DO UPDATE SET
            slug=excluded.slug,
            formato=excluded.formato,
            puntaje=excluded.puntaje,
            votos=excluded.votos,
            contenido=excluded.contenido,
            txt_url=excluded.txt_url
        """,
        [
            (
                version.artist_slug,
                version.song_slug,
                version.version_id,
                version.slug,
                version.formato,
                version.puntaje,
                version.votos,
                version.contenido,
                version.txt_url,
            )
            for version in versions
        ],
    )


def mark_artist_downloaded(con: sqlite3.Connection, artist_slug: str) -> None:
    con.execute(
        """
        UPDATE artista
        SET descargado = 1, updated_at = CURRENT_TIMESTAMP
        WHERE slug = ?
        """,
        (artist_slug,),
    )
    con.commit()


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Descarga artistas, canciones y versiones desde lacuerda.net"
    )
    parser.add_argument("--db", default=str(DEFAULT_DB), help="Ruta del archivo SQLite")
    parser.add_argument(
        "--artist",
        action="append",
        dest="artists",
        help="Slug de artista a descargar, por ejemplo: barak",
    )
    parser.add_argument(
        "--limit-artists",
        type=int,
        default=None,
        help="Limita el numero de artistas al explorar el indice completo",
    )
    parser.add_argument(
        "--limit-songs",
        type=int,
        default=None,
        help="Limita el numero de canciones por artista",
    )
    parser.add_argument(
        "--pause",
        type=float,
        default=0.0,
        help="Pausa en segundos entre requests",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Muestra progreso detallado",
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    db_path = Path(args.db)
    db_path.parent.mkdir(parents=True, exist_ok=True)

    crawler = LaCuerdaCrawler(verbose=args.verbose, pause_seconds=args.pause)
    with sqlite3.connect(db_path) as con:
        init_db(con)

        if args.artists:
            artists = [
                Artist(
                    slug=slug,
                    name=slug.replace("_", " ").title(),
                    url=urljoin(BASE_URL, f"{slug}/"),
                )
                for slug in args.artists
            ]
        else:
            artists = crawler.get_artists(limit=args.limit_artists)

        if not artists:
            print("No artists found.", file=sys.stderr)
            return 1

        store_artists(con, artists)

        for artist in artists:
            crawler.log(f"Downloading artist: {artist.slug}")
            try:
                songs = crawler.get_songs(artist.slug, limit=args.limit_songs)
                for song in songs:
                    crawler.log(f"  Song: {song.title}")
                    versions = crawler.get_versions(song)
                    store_song_bundle(con, song, versions)
                mark_artist_downloaded(con, artist.slug)
                print(
                    f"{artist.slug}: {len(songs)} songs downloaded",
                    flush=True,
                )
            except Exception as exc:  # pragma: no cover - CLI reporting path
                print(f"{artist.slug}: failed - {exc}", file=sys.stderr, flush=True)

        con.commit()

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
