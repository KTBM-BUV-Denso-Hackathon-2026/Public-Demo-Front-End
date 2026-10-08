#!/usr/bin/env python
"""
Static server cho thư mục ``frontend`` — dùng để chạy thử/demo nội bộ.

Vì sao không dùng `python -m http.server`?
    Nó KHÔNG gửi các header bảo mật mà CSP meta-tag không thể thay thế
    (`X-Frame-Options`, `frame-ancestors`, `Referrer-Policy`, `nosniff`,
    `Permissions-Policy`). Server này gửi đủ, đồng thời:
      - ép HTTPS khi deploy (tuỳ chọn --https với file chứng thư).
      - chặn lộ danh sách thư mục.
      - chặn path traversal.
      - đặt cache dài hạn cho file tĩnh có hash/version, và `no-store` cho .html.

⚠️ ĐÂY KHÔNG PHẢI máy chủ production. Với production hãy dùng nginx —
xem mẫu cấu hình trong `frontend/README.md`.

Cách chạy:
    python frontend/serve.py                      # http://127.0.0.1:5173
    python frontend/serve.py --port 8080
    python frontend/serve.py --host 0.0.0.0
"""

from __future__ import annotations

import argparse
import http.server
import os
import posixpath
import socket
import ssl
import sys
import urllib.parse
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent

#: Gửi kèm mọi response — củng cố những gì `<meta http-equiv>` không làm được.
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": (
        "accelerometer=(), camera=(), geolocation=(), gyroscope=(), "
        "magnetometer=(), microphone=(), payment=(), usb=()"
    ),
    # `frame-ancestors` KHÔNG có tác dụng trong thẻ <meta>, phải set ở đây.
    "Content-Security-Policy": (
        "default-src 'self'; base-uri 'none'; object-src 'none'; "
        "form-action 'self'; frame-src 'none'; frame-ancestors 'none'; "
        "img-src 'self' data:; font-src 'self'; style-src 'self'; "
        "script-src 'self'; connect-src 'self' http://127.0.0.1:8000 http://localhost:8000"
    ),
}

#: File tĩnh nén/gzip-sẵn -> cache dài hạn an toàn (tên có version trong URL nếu deploy CDN).
LONG_CACHE_SUFFIXES = (".woff", ".woff2", ".png", ".jpg", ".svg", ".ico", ".map")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    # ------------------------------------------------------- headers + cache
    def _send_security_headers(self):
        for key, value in SECURITY_HEADERS.items():
            self.send_header(key, value)

    def end_headers(self):
        """Gửi security headers + policy cache rồi mới kết thúc header block."""
        self._send_security_headers()
        path = urllib.parse.urlparse(self.path).path.lower()
        if path.endswith(".html") or path in ("", "/"):
            # HTML chứa đường dẫn tới asset -> không cache để deploy an toàn.
            self.send_header("Cache-Control", "no-store, max-age=0")
        elif path.endswith(LONG_CACHE_SUFFIXES):
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        else:
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def send_header(self, keyword, value):
        # Không để lộ đường dẫn hệ thống qua header Server.
        if keyword.lower() == "server":
            value = "denso-frontend"
        super().send_header(keyword, value)

    # ------------------------------------------------------------- điều hướng
    def do_GET(self):
        if self._is_directory_request():
            self.send_error(404, "Not Found")
            return
        super().do_GET()

    def do_HEAD(self):
        if self._is_directory_request():
            self.send_error(404, "Not Found")
            return
        super().do_HEAD()

    def _is_directory_request(self) -> bool:
        """Chặn lộ cấu trúc thư mục (ví dụ ``/assets/``)."""
        path = urllib.parse.urlparse(self.path).path
        if path in ("", "/"):
            return True
        resolved = (BASE_DIR / path.lstrip("/")).resolve()
        try:
            resolved.relative_to(BASE_DIR)
        except ValueError:
            return True  # path traversal -> coi như không hợp lệ
        return resolved.is_dir()

    # ----------------------------------------------------------------- types
    def guess_type(self, path):
        if str(path).endswith(".js"):
            return "text/javascript"
        if str(path).endswith(".css"):
            return "text/css"
        if str(path).endswith(".woff2"):
            return "font/woff2"
        if str(path).endswith(".woff"):
            return "font/woff"
        if str(path).endswith(".md"):
            return "text/markdown"
        if str(path).endswith(".html"):
            return "text/html"
        if str(path).endswith(".json"):
            return "application/json"
        return super().guess_type(path)

    # ------------------------------------------------------------ đường dẫn
    def translate_path(self, path):
        # SimpleHTTPRequestHandler đã chặn traversal, nhưng ta siết lại để
        # chắc chắn không phục vụ file ngoài thư mục frontend.
        resolved = super().translate_path(path)
        try:
            Path(resolved).resolve().relative_to(BASE_DIR)
        except ValueError:
            return str(BASE_DIR / "__forbidden__")
        return resolved

    def log_message(self, fmt, *args):
        sys.stderr.write("[frontend] %s - %s\n" % (self.address_string(), fmt % args))


def build_ssl_context(certfile: str, keyfile: str) -> ssl.SSLContext:
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    ctx.load_cert_chain(certfile=certfile, keyfile=keyfile)
    return ctx


def main() -> int:
    # Console Windows mặc định dùng cp1252, không in được tiếng Việt có dấu.
    # Reconfigure để script chạy được trên mọi OS mà không cần đặt PYTHONIOENCODING.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):  # pragma: no cover - stream đặc biệt
            pass

    parser = argparse.ArgumentParser(description="Dev/preview static server cho frontend.")
    parser.add_argument("--host", default="127.0.0.1", help="mặc định chỉ bind localhost")
    parser.add_argument("--port", type=int, default=5173)
    parser.add_argument("--certfile", help="chứng thư (bật HTTPS)")
    parser.add_argument("--keyfile", help="khoá (bật HTTPS)")
    args = parser.parse_args()

    if not BASE_DIR.joinpath("index.html").is_file():
        print("Không tìm thấy index.html trong", BASE_DIR, file=sys.stderr)
        return 1

    if bool(args.certfile) != bool(args.keyfile):
        print("Cần cả --certfile và --keyfile để bật HTTPS.", file=sys.stderr)
        return 2

    # Cảnh báo rõ ràng khi bind 0.0.0.0: mọi người trong mạng đều truy cập được.
    if args.host not in ("127.0.0.1", "localhost", "::1"):
        print(
            "⚠  Đang bind %s — mọi máy trong mạng đều truy cập được.\n"
            "   Dùng cho demo nội bộ; production phải đặt sau reverse proxy + HTTPS + WAF."
            % args.host,
            file=sys.stderr,
        )

    socketserver = __import__("socketserver")
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.ThreadingTCPServer((args.host, args.port), Handler)

    if args.certfile:
        httpd.socket = build_ssl_context(args.certfile, args.keyfile).wrap_socket(
            httpd.socket, server_side=True
        )
        scheme = "https"
    else:
        scheme = "http"

    print("DENSO RAG frontend: %s://%s:%d" % (scheme, args.host, args.port))
    print("  Trang chat      : %s://%s:%d/index.html" % (scheme, args.host, args.port))
    print("  Đăng nhập       : %s://%s:%d/login.html" % (scheme, args.host, args.port))
    print("  Tài liệu tri thức: %s://%s:%d/knowledge.html" % (scheme, args.host, args.port))
    print("\nNhấn Ctrl+C để dừng.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nĐã dừng.")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
