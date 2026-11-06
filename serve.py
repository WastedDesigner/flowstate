#!/usr/bin/env python3
"""Tiny static server for local development."""
import functools, http.server, os, socketserver, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5191


class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    with Server(('127.0.0.1', PORT), functools.partial(Handler, directory=ROOT)) as httpd:
        print(f'serving {ROOT} on http://127.0.0.1:{PORT}', flush=True)
        httpd.serve_forever()
