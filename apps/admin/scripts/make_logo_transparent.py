from PIL import Image

src = r"C:\Users\Gedion\.cursor\projects\c-Users-Gedion-Documents-lony\assets\c__Users_Gedion_AppData_Roaming_Cursor_User_workspaceStorage_eae29316f0aa5e75629cc271abb4cccd_images_lony_logo-25f7ab0f-b01c-425a-be2d-c0b2f5fcea12.png"
outs = [
    r"C:\Users\Gedion\Documents\lony\apps\admin\src\assets\lony-logo.png",
    r"C:\Users\Gedion\Documents\lony\apps\admin\public\lony-logo.png",
]

im = Image.open(src).convert("RGBA")
pixels = im.load()
w, h = im.size
for y in range(h):
    for x in range(w):
        r, g, b, a = pixels[x, y]
        if r < 28 and g < 28 and b < 28:
            pixels[x, y] = (0, 0, 0, 0)
            continue
        darkness = min(r, g, b)
        if darkness < 55 and (r + g + b) < 120:
            strength = max(r, g, b)
            na = int(min(255, (strength / 55.0) * 255))
            pixels[x, y] = (r, g, b, na)

for path in outs:
    im.save(path, "PNG")

print("mode", im.mode, "size", im.size)
print("corner", im.getpixel((2, 2)))
print("center", im.getpixel((w // 2, h // 2)))
