from PIL import Image

path = r"C:\Users\Gedion\Documents\lony\apps\mobile\assets\logo.png"
img = Image.open(path).convert("RGBA")
pixels = img.load()
w, h = img.size
thresh = 245
changed = 0
for y in range(h):
    for x in range(w):
        r, g, b, a = pixels[x, y]
        if r >= thresh and g >= thresh and b >= thresh:
            pixels[x, y] = (r, g, b, 0)
            changed += 1
img.save(path, "PNG")
print(f"saved {path} cleared {changed} of {w * h}")
