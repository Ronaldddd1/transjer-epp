"""
Un Nominatim y un OSRM de mentira, para probar las rutas sin salir a internet.

  python3 tests/mock-mapas.py 3999

  /search?q=...            como Nominatim: un punto cerca del centro del distrito que diga
                           la consulta (con un corrimiento según el texto, para que dos
                           direcciones no caigan en el mismo sitio).
  /table/v1/driving/...    como OSRM: distancias en línea recta ×1.3 y 25 km/h.
  /route/v1/driving/...    como OSRM: un trazo "por las calles" (cada tramo en escuadra, con
                           puntos intermedios, como un camino real).
  /__fallar-servidor?on=1  desde ahí, los pedidos a OSRM del SERVIDOR (User-Agent
                           TransjerGestion) fallan con 503; los del navegador, no. Sirve
                           para probar que el navegador redibuja la ruta. on=0 lo apaga.

Trampas a propósito:
  - "Tomas Marsano" devuelve primero una calle en San Isidro (otro distrito): el sistema
    tiene que descartarla y quedarse con la de Surquillo.
  - "Villa Sol Naciente" no existe: tiene que caer al distrito y quedar "por revisar".
"""
import hashlib, json, math, sys, unicodedata
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlsplit

DISTRITOS = {
    "SAN JUAN DE LURIGANCHO": (-11.98, -77.00), "LA MOLINA": (-12.08, -76.94), "PACHACAMAC": (-12.23, -76.86),
    "SURQUILLO": (-12.113, -77.02), "SANTIAGO DE SURCO": (-12.14, -76.99), "LA VICTORIA": (-12.07, -77.02),
    "SAN ISIDRO": (-12.10, -77.035), "MAGDALENA DEL MAR": (-12.09, -77.07), "SAN MARTIN DE PORRES": (-12.00, -77.06),
    "LIMA": (-12.05, -77.04), "SAN BORJA": (-12.10, -77.00), "SAN JUAN DE MIRAFLORES": (-12.16, -76.97),
    "LURIN": (-12.27, -76.87),
}


def norm(t):
    return unicodedata.normalize("NFD", t).encode("ascii", "ignore").decode().upper()


def corrimiento(q):
    h = hashlib.md5(q.encode()).digest()
    return (h[0] - 128) / 128 * 0.012, (h[1] - 128) / 128 * 0.012


def buscar(q):
    nq = norm(q)
    partes = [p.strip() for p in nq.split(",")]
    if "VILLA SOL NACIENTE" in nq:
        return []
    # El distrito es la parte antes de "LIMA, PERU" (o "LIMA" mismo).
    distrito = partes[-3] if len(partes) >= 3 else partes[0]
    if distrito not in DISTRITOS:
        return []
    lat, lng = DISTRITOS[distrito]
    resultados = []
    if "TOMAS MARSANO" in nq:
        la, lo = -12.095, -77.05  # en San Isidro: fuera del recuadro de Surquillo
        resultados.append({"lat": str(la), "lon": str(lo), "display_name": "Avenida Tomás Marsano, San Isidro, Lima, Perú",
                           "boundingbox": [str(la - .01), str(la + .01), str(lo - .01), str(lo + .01)],
                           "address": {"road": "Avenida Tomás Marsano", "city_district": "San Isidro", "city": "Lima"}})
    es_distrito = len(partes) == 3
    dla, dlo = (0, 0) if es_distrito else corrimiento(nq)
    tiene_numero = any(ch.isdigit() for ch in partes[0])
    direccion = {"city_district": distrito.title(), "city": "Lima", "country": "Perú"}
    if not es_distrito:
        direccion["road"] = partes[0].title()
        if tiene_numero:
            direccion["house_number"] = "".join(ch for ch in partes[0] if ch.isdigit())
    resultados.append({"lat": str(lat + dla), "lon": str(lng + dlo), "display_name": f"{partes[0].title()}, {distrito.title()}, Lima, Perú",
                       "boundingbox": [str(lat - .015), str(lat + .015), str(lng - .015), str(lng + .015)], "address": direccion})
    return resultados


def hav(a, b):
    R = 6371000
    la1, lo1, la2, lo2 = map(math.radians, (a[1], a[0], b[1], b[0]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


FALLAR = {"servidor": False}


def escuadra(pts):
    """Cada tramo va primero en una dirección y luego en la otra, con puntos intermedios."""
    out = [list(pts[0])]
    for a, b in zip(pts, pts[1:]):
        esquina = (b[0], a[1])
        for t in (0.5, 1):
            out.append([a[0] + (esquina[0] - a[0]) * t, a[1]])
        for t in (0.5, 1):
            out.append([b[0], esquina[1] + (b[1] - esquina[1]) * t])
    return out


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def responder(self, obj):
        b = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        u = urlsplit(self.path)
        if u.path == "/search":
            return self.responder(buscar(parse_qs(u.query).get("q", [""])[0]))
        if u.path == "/__fallar-servidor":
            FALLAR["servidor"] = parse_qs(u.query).get("on", ["1"])[0] == "1"
            return self.responder({"code": "Ok", "fallar": FALLAR["servidor"]})
        if u.path.startswith("/table/v1/driving/") or u.path.startswith("/route/v1/driving/"):
            if FALLAR["servidor"] and "TransjerGestion" in (self.headers.get("User-Agent") or ""):
                self.send_response(503)
                self.end_headers()
                return
            pts = [tuple(map(float, p.split(","))) for p in unquote(u.path.split("/")[-1]).split(";")]
            if u.path.startswith("/table"):
                d = [[hav(a, b) * 1.3 for b in pts] for a in pts]
                return self.responder({"code": "Ok", "distances": d, "durations": [[x / (25000 / 3600) for x in f] for f in d]})
            dist = sum(hav(pts[i - 1], pts[i]) * 1.3 for i in range(1, len(pts)))
            return self.responder({"code": "Ok", "routes": [{"distance": dist, "duration": dist / (25000 / 3600),
                                                             "geometry": {"coordinates": escuadra(pts)}}]})
        self.send_response(404)
        self.end_headers()


if __name__ == "__main__":
    puerto = int(sys.argv[1]) if len(sys.argv) > 1 else 3999
    ThreadingHTTPServer(("127.0.0.1", puerto), H).serve_forever()
