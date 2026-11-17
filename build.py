"""Package Tisina tamo for Chrome and Firefox into dist/.

Usage: python build.py
Each zip contains the browser's manifest renamed to manifest.json plus src/, vendor/ and icons/.
The root manifest.json is a Firefox dev copy and is never packaged.
"""
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).parent
DIST = ROOT / "dist"
DIRS = ["src", "vendor", "icons"]
TARGETS = {"chrome": "manifest.chrome.json", "firefox": "manifest.firefox.json"}
# Chrome-only files (Firefox has no offscreen API)
SKIP = {"firefox": {"src/ocr/offscreen.html", "src/ocr/offscreen.js"}}


def build(name, manifest_file):
    manifest = json.loads((ROOT / manifest_file).read_text(encoding="utf-8"))
    out = DIST / f"tisina-tamo-{name}-{manifest['version']}.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", json.dumps(manifest, indent=4, ensure_ascii=False))
        for d in DIRS:
            for p in sorted((ROOT / d).rglob("*")):
                rel = p.relative_to(ROOT).as_posix()
                if p.is_file() and rel not in SKIP.get(name, ()) and not (d == "icons" and p.suffix != ".png"):
                    z.write(p, rel)
    print(f"built {out.relative_to(ROOT)}")


if __name__ == "__main__":
    DIST.mkdir(exist_ok=True)
    for old in DIST.glob("tisina-tamo-*.zip"):
        old.unlink()
    for name, manifest_file in TARGETS.items():
        build(name, manifest_file)
