"""One-off: draw the social preview (og.png), touch icon and favicon for each site into static/SITE/.
Re-run after changing a title or tagline: python3 scripts/make-images.py"""
import json, pathlib
from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_R = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

SAMPLE = {
    "speedrundle": (("Super Mario 64", "16 Star", "14:32"), ("Celeste", "Any%", "24:44")),
    "peakdle": (("Counter-Strike 2", "Action · Free", "1,071,403"), ("Stardew Valley", "Simulation · Paid", "71,940")),
}


def og(site):
    # Daily-game look: white page, bold uppercase title, a row of result tiles, two cards.
    W, H = 1200, 630
    bg, ink, quiet, line, good, gray = "#ffffff", "#1a1a1b", "#787c7e", "#d3d6da", "#6aaa64", "#787c7e"
    im = Image.new("RGB", (W, H), bg)
    d = ImageDraw.Draw(im)
    f = ImageFont.truetype(FONT, 92)
    t = site["title"].upper()
    tw = d.textlength(t, font=f) + 6 * (len(t) - 1)
    x = (W - tw) / 2
    for ch in t:
        d.text((x, 54), ch, font=f, fill=ink)
        x += d.textlength(ch, font=f) + 6
    tiles = [good, good, gray, good, good, good, gray, good, None, None]
    s_, g_ = 52, 10
    x0 = (W - (10 * s_ + 9 * g_)) / 2
    for i, c in enumerate(tiles):
        x = x0 + i * (s_ + g_)
        if c: d.rectangle((x, 186, x + s_, 186 + s_), fill=c)
        else: d.rectangle((x, 186, x + s_, 186 + s_), outline=line, width=3)
    (a, b) = SAMPLE[site["name"]]
    for i, (name, sub, val) in enumerate((a, b)):
        x = 150 + i * 470
        fill, txt, sub_c = (good, "#ffffff", "#e8f3e6") if i == 0 else ("#ffffff", ink, quiet)
        d.rectangle((x, 290, x + 430, 560), fill=fill, outline=good if i == 0 else line, width=4)
        fn = ImageFont.truetype(FONT, 38)
        nw = d.textlength(name, font=fn)
        d.text((x + (430 - nw) / 2, 320), name, font=fn, fill=txt)
        fs = ImageFont.truetype(FONT_R, 28)
        sw = d.textlength(sub, font=fs)
        d.text((x + (430 - sw) / 2, 372), sub, font=fs, fill=sub_c)
        v = val if i == 0 else "?"
        fv = ImageFont.truetype(FONT, 60)
        vw = d.textlength(v, font=fv)
        d.text((x + (430 - vw) / 2, 455), v, font=fv, fill=txt)
    d.ellipse((W / 2 - 30, 395, W / 2 + 30, 455), fill=bg, outline=line, width=3)
    fo = ImageFont.truetype(FONT, 20)
    d.text((W / 2 - d.textlength("OR", font=fo) / 2, 413), "OR", font=fo, fill=quiet)
    return im


def icon(site, size):
    im = Image.new("RGB", (size, size), "#6aaa64")
    d = ImageDraw.Draw(im)
    f = ImageFont.truetype(FONT, int(size * 0.62))
    ch = site["title"][0]
    box = d.textbbox((0, 0), ch, font=f)
    d.text(((size - (box[2] - box[0])) / 2 - box[0], (size - (box[3] - box[1])) / 2 - box[1]), ch, font=f, fill="#ffffff")
    return im


for name in ("speedrundle", "peakdle"):
    site = json.loads((ROOT / "sites" / name / "site.json").read_text())
    out = ROOT / "static" / name
    out.mkdir(parents=True, exist_ok=True)
    og(site).save(out / "og.png", optimize=True)
    icon(site, 180).save(out / "apple-touch-icon.png", optimize=True)
    icon(site, 32).save(out / "favicon-32.png", optimize=True)
    (out / "favicon.svg").write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="6" fill="#6aaa64"/>'
        f'<text x="32" y="45" font-family="system-ui,Segoe UI,Arial,sans-serif" font-weight="700" font-size="40" text-anchor="middle" fill="#fff">{site["title"][0]}</text></svg>\n')
    print(out)
