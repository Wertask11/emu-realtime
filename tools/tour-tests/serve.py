"""Serve the static app plus a generated LOCAL DUMMY fixture; never proxy production."""
import http.server
import pathlib
import subprocess
import urllib.parse

repo=pathlib.Path(__file__).resolve().parents[2]
fixture=pathlib.Path('/tmp/reizo-tour-fixture.html')
subprocess.run(['node',str(repo/'tools/tour-tests/make-fixture.cjs'),str(fixture)],check=True)
class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs): super().__init__(*args,directory=str(repo/'frontend/public'),**kwargs)
    def do_GET(self):
        if urllib.parse.urlparse(self.path).path=='/__tour-core.html':
            body=b'''<!doctype html><html lang="ja"><head><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/tour/reizo-tour.css"></head><body style="font:16px system-ui"><p>LOCAL DUMMY - core regression</p><button id="launch">Launch</button><div data-tour="native" style="padding:30px;margin:40px;background:#d0e2be"><button id="native" onclick="window.nativeCalls++;window.selection=!window.selection">Native filter</button></div><div data-tour="second" style="padding:24px;margin:40px">Second target</div><script>window.nativeCalls=0;window.selection=false;</script><script src="/tour/reizo-tour.js"></script><script>ReizoTour.register('sp-test',[{target:'[data-tour="native"]',label:'First',text:'LOCAL DUMMY',advanceOn:{read:()=>window.selection}},{target:'[data-tour="second"]',label:'Second',text:'LOCAL DUMMY'}]);document.getElementById('launch').onclick=()=>ReizoTour.start('sp-test');</script></body></html>'''
            self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.end_headers();self.wfile.write(body);return
        if urllib.parse.urlparse(self.path).path=='/__tour-fixture.html':
            body=fixture.read_bytes();self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.end_headers();self.wfile.write(body)
        else: super().do_GET()
    def log_message(self,*args): pass
print('LOCAL DUMMY test server on 127.0.0.1:4180',flush=True)
http.server.ThreadingHTTPServer(('127.0.0.1',4180),Handler).serve_forever()
