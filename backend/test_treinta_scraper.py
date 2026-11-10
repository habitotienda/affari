import json, sys
sys.path.insert(0, '.')
import treinta_scraper as T
from unittest import mock

# 1) parse_price
cases = {"$12.500":12500, "12,500.50":12500.5, "1.250,75":1250.75, "COP 15.000":15000, 15000:15000, "1,250":1250, "9,99":9.99, "abc":None, None:None, True:None, "-5":None}
for k,v in cases.items():
    got = T.parse_price(k); print("price", repr(k), "->", got, "OK" if got==v else f"!! esperado {v}")

# 2) Next.js __NEXT_DATA__ anidado, claves en español, categoría dict, imagen relativa
nd = {"props":{"pageProps":{"store":{"name":"Local Pepe"},"categories":[
  {"name":"Bebidas","products":[
    {"nombre":"Gaseosa 1.5L","precioVenta":"$4.500","imagenes":["/img/a.jpg","https://cdn.x.com/b.png"],"descripcion":"<p>Bien <b>fría</b></p>","stock":12,"categoria":{"name":"Bebidas"}},
    {"nombre":"Agua","precioVenta":1500,"imagen":None}]},
  {"name":"Snacks","products":[{"title":"Papas","price":2300.0,"image":{"url":"//cdn.x.com/p.jpg"},"quantity":"7"},
    {"title":"Papas","price":2300.0}]}]}}}
html1 = f'<html><head><title>Local Pepe | Treinta</title></head><body><script id="__NEXT_DATA__" type="application/json">{json.dumps(nd)}</script></body></html>'
store, prods = T.extract_products(html1, "https://treinta.co/tienda/pepe")
print("\nnext:", store, len(prods))
for p in prods: print(" ", p["name"], p["price"], p["image"], p["stock"], repr(p["category"]), repr(p["description"]), p["cost"])
assert len(prods)==3 and prods[0]["price"]==4500 and prods[0]["description"]=="Bien fría" and prods[0]["image"]=="https://treinta.co/img/a.jpg" and prods[2]["image"]=="https://cdn.x.com/p.jpg" and prods[2]["stock"]==7

# 3) JSON-LD con offers
ld = {"@context":"https://schema.org","@type":"ItemList","itemListElement":[{"@type":"ListItem","item":{"@type":"Product","name":"Zapatillas","image":"https://c/z.jpg","offers":{"@type":"Offer","price":"89990","priceCurrency":"COP"}}}]}
_, p2 = T.extract_products(f'<script type="application/ld+json">{json.dumps(ld)}</script>', "https://treinta.co/x")
print("\nld+json:", p2); assert p2 and p2[0]["price"]==89990

# 4) window.__STATE__ = {...};
st = 'window.__INITIAL_STATE__ = ' + json.dumps({"catalog":{"items":[{"name":"Torta","price":25000,"photos":[{"src":"https://c/t.jpg"}]}]}}) + ';'
_, p3 = T.extract_products(f'<script>{st}</script>', "https://treinta.co/x"); print("\nwindow state:", p3); assert p3 and p3[0]["image"]=="https://c/t.jpg"

# 5) microdatos
md = '<div itemscope itemtype="https://schema.org/Product"><span itemprop="name">Mate</span><meta itemprop="price" content="3200"><img itemprop="image" src="/m.jpg"></div>'
_, p4 = T.extract_products(md, "https://treinta.co/x"); print("\nmicrodata:", p4); assert p4 and p4[0]["price"]==3200

# 6) SPA vacía → no_products
try:
    with mock.patch.object(T, "_get", return_value=(b"<html><div id=root></div><script>var a=1</script></html>", mock.Mock(encoding="utf-8", url="https://treinta.co/x"))):
        T.scrape_store("treinta.co/x")
except T.ScrapeError as e: print("\nspa vacía →", e.code, e.status)

# 7) validate_url / SSRF
for u in ["", "ftp://treinta.co/x", "https://evil.com/treinta.co", "https://treinta.co.evil.com/x", "http://127.0.0.1/x", "https://user:pw@treinta.co/x", "https://treinta.co:8080/x", "https://tienda.treinta.co/mi-local#x", "treinta.co/tienda/x"]:
    try: print(f"{u!r:45} OK  ->", T.validate_url(u))
    except T.ScrapeError as e: print(f"{u!r:45} RECHAZADA ({e.code})")

# 8) anti-SSRF en imágenes: IP privada / metadata
with mock.patch("socket.getaddrinfo", return_value=[(2,1,6,"",("169.254.169.254",0))]):
    try: T.fetch_image_as_data_uri("http://metadata.evil/x.jpg")
    except T.ScrapeError as e: print("\nSSRF img →", e.code)
with mock.patch("socket.getaddrinfo", return_value=[(2,1,6,"",("10.0.0.5",0))]):
    try: T.scrape_store("https://treinta.co/x")
    except T.ScrapeError as e: print("SSRF host privado →", e.code)

# 9) imagen real → data URI (PNG con alpha, grande)
from PIL import Image; from io import BytesIO
im = Image.new("RGBA",(2000,1000),(255,0,0,128)); b=BytesIO(); im.save(b,"PNG")
resp = mock.Mock(headers={"Content-Type":"image/png"})
with mock.patch.object(T,"_get",return_value=(b.getvalue(),resp)):
    d = T.fetch_image_as_data_uri("https://cdn.x/a.png")
im2 = Image.open(BytesIO(__import__("base64").b64decode(d.split(",",1)[1]))); print("\nimg →", d[:30], im2.size, f"{len(d)//1024} KB"); assert max(im2.size)==800

# 10) errores HTTP / red
for code in (404, 403, 500):
    r = mock.Mock(status_code=code, is_redirect=False, headers={}); r.iter_content=lambda n: iter([b""])
    with mock.patch("socket.getaddrinfo", return_value=[(2,1,6,"",("93.184.216.34",0))]), mock.patch("requests.get", return_value=r):
        try: T.scrape_store("https://treinta.co/x")
        except T.ScrapeError as e: print(f"HTTP {code} →", e.code, e.status)
import requests
with mock.patch("socket.getaddrinfo", return_value=[(2,1,6,"",("93.184.216.34",0))]):
    for exc in (requests.Timeout, requests.ConnectionError):
        with mock.patch("requests.get", side_effect=exc):
            try: T.scrape_store("https://treinta.co/x")
            except T.ScrapeError as e: print(exc.__name__, "→", e.code, e.status)

# 11) catalogo.treinta.co (Next.js App Router): tarjetas <a href=".../product/id"> como las que se ven en la página real
base = "https://catalogo.treinta.co/fiveroots-productosenprecios"
cards = f"""<html><head><title>FIVeROOTS | Catálogo Online</title><meta property="og:site_name" content="Treinta"><meta property="og:title" content="FIVeROOTS | Catálogo Online"></head><body>
<a href="{base}/product/1f6e2e8f"><img src="https://imgproxy.treinta.co/sig/size:3840:::/plain/https%3A%2F%2Fcdn.treinta.co%2Fa.jpg" alt="Adaptadores"><h3>Adaptadores</h3><p>$ 9.000</p></a>
<a href="{base}/product/2c55c955"><h3>ACKILISS Anafe doble</h3><span>ACKILISS Anafe doble</span><p>Metal y plastico negro, doble hornalla</p><p>$ 45.000</p></a>
<a href="{base}/product/zzz"><h3>Sin precio</h3></a></body></html>"""
store, pc = T.extract_products(cards, base)
print("\ncards:", store, [(p["name"], p["price"], p["description"], p["image"][:40]) for p in pc])
assert store == "FIVeROOTS" and len(pc) == 2 and pc[0]["price"] == 9000 and pc[0]["image"].startswith("https://imgproxy.treinta.co/")
assert pc[1]["price"] == 45000 and pc[1]["description"] == "Metal y plastico negro, doble hornalla"

# 12) flight data self.__next_f.push (incluye agotados, que no son link) + fusión con tarjetas sin duplicar
tree = ["$", "div", None, {"children": [["$", "section", None, {"products": [
    {"name": "Bandoleras carteras 3 cierres", "price": 10000, "soldOut": True, "images": ["https://cdn.treinta.co/x/e049.jpg"], "description": "Cartera 3 cierres"},
    {"name": "Adaptadores", "price": 9000, "images": ["https://cdn.treinta.co/a.jpg"]}]}]]}]
chunk = "5:" + json.dumps(tree) + "\n1a:I[\"mod\",[],\"X\"]\n"
fl = "<script>self.__next_f.push(" + json.dumps([1, chunk]) + ")</script>"
_, pf = T.extract_products(f"<html><body>{fl}{cards}</body></html>", base)
print("flight+cards:", [(p["name"], p["price"]) for p in pf])
assert {p["name"] for p in pf} == {"Bandoleras carteras 3 cierres", "Adaptadores", "ACKILISS Anafe doble"} and len(pf) == 3

# 13) validate_url acepta el subdominio del catálogo
print("validate:", T.validate_url("https://catalogo.treinta.co/fiveroots-productosenprecios"))

print("\nTODO OK")
