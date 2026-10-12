"""
One shared Postgres connection (read-only use), reopened if it drops.

The backend's DATABASE_URL is a Prisma URL. Two small fixes make it work here:
  - Prisma-only options such as ?schema=public are removed (psycopg rejects them).
  - With DB_SSL_CA_FILE set (AWS RDS), the server certificate is verified.
"""
import threading
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import psycopg
from psycopg.rows import dict_row

from app import config

PRISMA_ONLY_OPTIONS = {"schema", "connection_limit", "pool_timeout", "pgbouncer", "socket_timeout"}

_conn = None
_lock = threading.Lock()


def _clean_url(url):
    parts = urlsplit(url)
    query = [(k, v) for k, v in parse_qsl(parts.query) if k not in PRISMA_ONLY_OPTIONS]
    return urlunsplit(parts._replace(query=urlencode(query)))


def _ssl_options():
    if not config.DB_SSL_CA_FILE:
        return {}
    ca = Path(config.DB_SSL_CA_FILE)
    if not ca.is_absolute():
        ca = config.BACKEND_DIR / ca
    return {"sslmode": "verify-full", "sslrootcert": str(ca)}


def connect():
    if not config.DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not set (chatbot/.env or backend/.env)")
    return psycopg.connect(
        _clean_url(config.DATABASE_URL),
        autocommit=True,          # we only read; no transactions to manage
        row_factory=dict_row,     # rows come back as dicts: row["name"]
        connect_timeout=10,
        **_ssl_options(),
    )


def query(sql, params=None):
    """Run a SELECT and return a list of dict rows."""
    global _conn
    with _lock:
        for attempt in (1, 2):
            if _conn is None or _conn.closed:
                _conn = connect()
            try:
                with _conn.cursor() as cur:
                    cur.execute(sql, params)
                    return cur.fetchall()
            except psycopg.OperationalError:
                # The connection died (network blip, DB restart). Reconnect once and retry.
                _conn = None
                if attempt == 2:
                    raise
