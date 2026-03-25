"""tests for dashboard/server.py route handling"""
import json, pathlib, sys, threading, time
from http.client import HTTPConnection

# Add project paths
ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'dashboard'))
sys.path.insert(0, str(ROOT / 'scripts'))


def test_healthz(tmp_path):
    """GET /healthz returns 200 with status ok."""
    # Create minimal data dir
    data_dir = tmp_path / 'data'
    data_dir.mkdir()
    (data_dir / 'live_status.json').write_text('{}')
    (data_dir / 'agent_config.json').write_text('{}')

    # Import and patch server
    import server as srv
    srv.DATA = data_dir

    from http.server import HTTPServer
    port = 18971

    httpd = HTTPServer(('127.0.0.1', port), srv.Handler)
    t = threading.Thread(target=httpd.handle_request, daemon=True)
    t.start()

    time.sleep(0.1)
    conn = HTTPConnection('127.0.0.1', port, timeout=5)
    conn.request('GET', '/healthz')
    resp = conn.getresponse()
    body = json.loads(resp.read())
    conn.close()

    assert resp.status == 200
    assert body['status'] in ('ok', 'degraded')

    httpd.server_close()


def test_cors_headers_fallback_uses_runtime_dashboard_port():
    """cors fallback should respect the dashboard port configured at runtime."""
    import server as srv

    class DummyHandler:
        def __init__(self):
            self.headers = {}
            self.sent = {}

        def send_header(self, key, value):
            self.sent[key] = value

    original_allowed_origin = srv.ALLOWED_ORIGIN
    original_dashboard_port = srv._DASHBOARD_PORT
    try:
        srv.ALLOWED_ORIGIN = None
        srv._DASHBOARD_PORT = 19091
        handler = DummyHandler()
        srv.cors_headers(handler)
        assert handler.sent["Access-Control-Allow-Origin"] == "http://127.0.0.1:19091"
    finally:
        srv.ALLOWED_ORIGIN = original_allowed_origin
        srv._DASHBOARD_PORT = original_dashboard_port
