# Статика для превью: порт берём из переменной окружения PORT.
# Кеширование отключено, иначе браузер держит старые css/js.
# POST /__save/<имя>.webp|png — служебное сохранение картинки-заглушки в assets/img
# (только для локальной разработки; на хостинг этот файл не нужен).
# python serve.py       — исходники;  python serve.py dist — чистовая сборка (build/release.mjs)
import os, re, sys, gzip, functools, http.server, socketserver

ROOT = os.path.dirname(os.path.abspath(__file__))
if len(sys.argv) > 1:
    ROOT = os.path.join(ROOT, sys.argv[1])


# текстовые файлы сжимаем, как это делает любой хостинг (Netlify, GitHub Pages)
COMPRESSIBLE = (".html", ".css", ".js", ".json", ".svg")


class Handler(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            path = os.path.join(path, "index.html")
        # как GitHub Pages: на несуществующий адрес — наша страница 404.html с кодом 404
        if not os.path.exists(path):
            with open(os.path.join(ROOT, "404.html"), "rb") as f:
                body = f.read()
            self.send_response(404)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            from io import BytesIO
            return BytesIO(body)
        if (path.endswith(COMPRESSIBLE) and os.path.isfile(path)
                and "gzip" in self.headers.get("Accept-Encoding", "")):
            with open(path, "rb") as f:
                body = gzip.compress(f.read(), 6)
            self.send_response(200)
            self.send_header("Content-Type", self.guess_type(path))
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Vary", "Accept-Encoding")
            self.end_headers()
            from io import BytesIO
            return BytesIO(body)
        return super().send_head()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def do_POST(self):
        m = re.fullmatch(r"/__save/([a-z0-9-]+\.(?:webp|png))", self.path)
        if not m or self.client_address[0] not in ("127.0.0.1", "::1"):
            self.send_error(403)
            return
        length = int(self.headers.get("Content-Length", 0))
        if not 0 < length <= 5_000_000:
            self.send_error(413)
            return
        with open(os.path.join(ROOT, "assets", "img", m.group(1)), "wb") as f:
            f.write(self.rfile.read(length))
        self.send_response(204)
        self.end_headers()


port = int(os.environ.get("PORT", "5173"))
handler = functools.partial(Handler, directory=ROOT)
socketserver.ThreadingTCPServer.allow_reuse_address = True
socketserver.ThreadingTCPServer.daemon_threads = True
with socketserver.ThreadingTCPServer(("127.0.0.1", port), handler) as httpd:
    print(f"serving http://127.0.0.1:{port}", flush=True)
    httpd.serve_forever()
