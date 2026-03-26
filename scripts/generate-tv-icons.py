"""Generate Apple TV icon and Top Shelf assets from applelogo.png."""

from PIL import Image, ImageColor

SRC = "applelogo.png"
OUT = "apps/mobile/assets/tv"
BG = "#27262c"

# Apple TV required assets: (filename, width, height, logo_scale)
# Icons: logo centered, scaled to ~70% of the shorter dimension
# Top Shelf: logo centered, scaled to ~50% of height (wider format)
ASSETS = [
    ("icon-1280x768.png",            1280,  768, 0.65),
    ("icon-small-400x240.png",        400,  240, 0.65),
    ("icon-small-2x-800x480.png",     800,  480, 0.65),
    ("topshelf-1920x720.png",        1920,  720, 0.45),
    ("topshelf-2x-3840x1440.png",    3840, 1440, 0.45),
    ("topshelf-wide-2320x720.png",   2320,  720, 0.40),
    ("topshelf-wide-2x-4640x1440.png", 4640, 1440, 0.40),
]

def generate():
    logo = Image.open(SRC).convert("RGBA")
    bg_color = ImageColor.getrgb(BG)

    for filename, w, h, scale in ASSETS:
        # Create background
        canvas = Image.new("RGB", (w, h), bg_color)

        # Scale logo to fit
        logo_h = int(h * scale)
        logo_w = int(logo.width * (logo_h / logo.height))

        # If logo is too wide, scale by width instead
        if logo_w > int(w * 0.85):
            logo_w = int(w * 0.85)
            logo_h = int(logo.height * (logo_w / logo.width))

        resized = logo.resize((logo_w, logo_h), Image.LANCZOS)

        # Center on canvas
        x = (w - logo_w) // 2
        y = (h - logo_h) // 2

        canvas.paste(resized, (x, y), resized)
        path = f"{OUT}/{filename}"
        canvas.save(path, "PNG")
        print(f"  {filename} ({w}x{h})")

    print(f"\nAll assets saved to {OUT}/")

if __name__ == "__main__":
    generate()
