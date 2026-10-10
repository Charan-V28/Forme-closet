import base64
import io
import json
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from PIL import Image
from fashn_vton import TryOnPipeline

ROOT = Path(__file__).resolve().parent
os.environ.setdefault("HF_HOME", str(ROOT / "local-model" / "hf-cache"))
WEIGHTS = ROOT / "local-model" / "weights"
DATA_IMAGE = re.compile(r"^data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$")
print("Loading local try-on model on CPU. The first load can take a few minutes.", flush=True)
PIPELINE = TryOnPipeline(weights_dir=str(WEIGHTS), device="cpu")
print("Local try-on model is ready.", flush=True)


def decode_image(value):
    match = DATA_IMAGE.match(value or "")
    if not match:
        raise ValueError("Unsupported image format. Use a JPEG, PNG, or WebP photo.")
    raw = base64.b64decode(match.group(2), validate=True)
    return Image.open(io.BytesIO(raw)).convert("RGB")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        return

    def reply(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            return self.reply(200, {"ready": True, "mode": "local-cpu"})
        return self.reply(404, {"error": "Not found"})

    def do_POST(self):
        if self.path != "/try-on":
            return self.reply(404, {"error": "Not found"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 24_000_000:
                return self.reply(413, {"error": "Images too large. Use smaller photos."})
            payload = json.loads(self.rfile.read(length))
            person = decode_image(payload["personImage"])
            garments = payload.get("garments", [])
            if not 1 <= len(garments) <= 2:
                return self.reply(400, {"error": "Choose one or two clothing pieces."})
            current = person
            category_map = {"Tops": "tops", "Outerwear": "tops", "Bottoms": "bottoms", "Dresses & one-pieces": "one-pieces"}
            for garment in garments:
                category = category_map.get(garment.get("category"))
                if not category:
                    return self.reply(400, {"error": "This local model supports tops, outerwear, bottoms, and one-pieces."})
                cloth = decode_image(garment.get("image"))
                result = PIPELINE(person_image=current, garment_image=cloth, category=category, garment_photo_type="flat-lay", num_samples=1, num_timesteps=20)
                current = result.images[0].convert("RGB")
            out = io.BytesIO()
            current.save(out, format="JPEG", quality=90, optimize=True)
            image_url = "data:image/jpeg;base64," + base64.b64encode(out.getvalue()).decode("ascii")
            return self.reply(200, {"image": image_url})
        except ValueError as error:
            return self.reply(400, {"error": str(error)})
        except Exception as error:
            print(f"Local model error: {type(error).__name__}", flush=True)
            return self.reply(500, {"error": "The local model could not process these photos. Try clearer, front-facing images."})


ThreadingHTTPServer(("127.0.0.1", 4174), Handler).serve_forever()
