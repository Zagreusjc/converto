"""Regenerates the sample files in test/fixtures (needs Python with matplotlib, pandas, Pillow,
nbformat, nbconvert, ipykernel, pypdf). Only developers ever need this; the app itself needs none of it."""
import os, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
import nbformat
from nbformat.v4 import new_notebook, new_markdown_cell, new_code_cell
from nbconvert.preprocessors import ExecutePreprocessor

OUT = os.path.join(os.path.dirname(__file__), "fixtures")
os.makedirs(OUT, exist_ok=True)
p = lambda n: os.path.join(OUT, n)

# ---------- images ----------
w, h = 640, 400
img = Image.new("RGB", (w, h))
px = img.load()
for y in range(h):
    for x in range(w):
        px[x, y] = (x * 255 // w, y * 255 // h, 160)
d = ImageDraw.Draw(img)
d.rectangle([20, 20, 220, 120], outline="white", width=5)
d.text((40, 60), "Converto test photo", fill="white")

exif = Image.Exif()
exif[0x010F] = "TestCam Inc"          # Make
exif[0x0110] = "TC-1000"              # Model
exif[0x0132] = "2023:07:04 12:34:56"  # DateTime
exif[0x0112] = 6                      # Orientation: rotate 90 CW when displayed
exif[0x013B] = "Secret Author"        # Artist
gps = exif.get_ifd(0x8825)
gps[1] = "N"; gps[2] = (37.0, 46.0, 29.7); gps[3] = "W"; gps[4] = (122.0, 25.0, 9.8)
img.save(p("photo-exif.jpg"), quality=90, exif=exif)

exif[0x0112] = 1
img.save(p("photo-exif-upright.jpg"), quality=90, exif=exif)
plain = img.copy()
plain.save(p("plain.jpg"), quality=90)

rgba = Image.new("RGBA", (300, 200), (0, 0, 0, 0))
ImageDraw.Draw(rgba).ellipse([20, 20, 280, 180], fill=(220, 50, 50, 200))
from PIL import PngImagePlugin
info = PngImagePlugin.PngInfo()
info.add_text("Author", "Secret Author"); info.add_text("Creation Time", "2020-01-01"); info.add_text("Software", "TestSoft 1.0")
rgba.save(p("transparent.png"), pnginfo=info)
img.save(p("sample.bmp"))
img.save(p("sample.tiff"))
img.save(p("sample.webp"), quality=85)
rgba.resize((64, 64)).save(p("tiny.ico"), sizes=[(16, 16), (32, 32), (64, 64)])
frames = [Image.new("RGB", (120, 80), c) for c in [(255, 0, 0), (0, 255, 0), (0, 0, 255)]]
frames[0].save(p("anim.gif"), save_all=True, append_images=frames[1:], duration=300, loop=0)
# a 32-bit BMP with alpha channel header via PIL isn't supported; plain 24-bit covers the common case.
subprocess.run(["sips", "-s", "format", "heic", p("plain.jpg"), "--out", p("sample.heic")], check=True, capture_output=True)

# ---------- PDFs ----------
with PdfPages(p("multipage.pdf"), metadata={"Title": "Secret Title", "Author": "Secret Author"}) as pdf:
    for i in range(3):
        fig, ax = plt.subplots(figsize=(6, 4))
        ax.plot(np.linspace(0, 10, 100), np.sin(np.linspace(0, 10, 100) + i))
        ax.set_title(f"Page {i + 1}")
        pdf.savefig(fig); plt.close(fig)
from pypdf import PdfReader, PdfWriter
wr = PdfWriter(); [wr.add_page(pg) for pg in PdfReader(p("multipage.pdf")).pages[:1]]
wr.encrypt("hunter2"); wr.write(p("locked.pdf"))
open(p("broken.pdf"), "wb").write(b"%PDF-1.4\nthis is not really a pdf")
open(p("broken.png"), "wb").write(b"\x89PNG\r\n\x1a\nnot a real image at all")

# ---------- notebook (really executed, so it has real outputs) ----------
LONG = "x" * 20 + " this is a very long line that would run off the page if it were not wrapped " * 4
nb = new_notebook()
nb.metadata["kernelspec"] = {"name": "python3", "display_name": "Python 3", "language": "python"}
nb.metadata["authors"] = [{"name": "Secret Author"}]
nb.cells = [
    new_markdown_cell("# Sales analysis\n\nThis notebook tests **markdown**, `inline code`, a [link](https://example.com), and math: $E = mc^2$.\n\n$$\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}$$\n\n- item one\n- item two\n\n| a | b |\n|---|---|\n| 1 | 2 |"),
    new_code_cell("import numpy as np\nimport matplotlib.pyplot as plt\nimport pandas as pd\n%matplotlib inline\nprint('hello from the kernel')"),
    new_code_cell(f"long_text = '{LONG}'\nprint(long_text)\nlong_text"),
    new_code_cell("x = np.linspace(0, 2*np.pi, 200)\nplt.figure(figsize=(6,3))\nplt.plot(x, np.sin(x), label='sin')\nplt.plot(x, np.cos(x), label='cos')\nplt.title('Waves'); plt.legend(); plt.show()"),
    new_code_cell("df = pd.DataFrame({'name': ['Ada','Grace','Linus'], 'score': [91.5, 99.0, 87.25], 'notes': ['first programmer', 'compiler pioneer', 'kernel hacker']})\ndf"),
    new_code_cell("from IPython.display import Markdown, Latex, display\ndisplay(Markdown('**rich markdown output**'))\ndisplay(Latex(r'$\\alpha^2 + \\beta^2 = \\gamma^2$'))"),
    new_code_cell("import sys\nprint('warning on stderr', file=sys.stderr)\nfor i in range(3):\n    print('\\x1b[31mred text\\x1b[0m line', i)"),
    new_code_cell("def boom():\n    return 1/0\nboom()"),
]
ExecutePreprocessor(timeout=120, kernel_name="python3", allow_errors=True).preprocess(nb, {"metadata": {"path": OUT}})
nbformat.write(nb, p("analysis.ipynb"))
open(p("empty.ipynb"), "w").write('{"cells": [], "metadata": {}, "nbformat": 4, "nbformat_minor": 5}')
open(p("broken.ipynb"), "w").write("{ this is not json")
print("fixtures written to", OUT)
