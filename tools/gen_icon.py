#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AlphaSun 声波分析仪 · 统一图标生成器 (v2.6.0)
单一视觉源：频谱环抱的「太阳」——表达「声波 / 频谱 / 智能分析」。
输出：
  assets/icon.png           1024 主图(满幅, 桌面 Linux/macOS 共用)
  assets/icon.ico           圆角磁贴多尺寸(Windows EXE)
  assets/icon.svg           矢量(PWA webmanifest)
  android/.../mipmap-*/ic_launcher.png       (满幅)
  android/.../mipmap-*/ic_launcher_round.png (满幅, 圆形安全区)
  android/.../mipmap-*/ic_launcher_foreground.png (透明前景, 自适应图标)
  ios/App/App/Assets.xcassets/AppIcon.appiconset/* + Contents.json
依赖：Pillow
"""
import math, os
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")

# ---- 配色（与 App 主题一致）----
BG_TOP = (13, 20, 40)      # #0d1428
BG_BOT = (6, 10, 22)       # #060a16
GLOW   = (55, 224, 255)    # 青
SUN_IN = (205, 250, 255)   # 太阳核心近白青
SUN_OUT= (155, 107, 255)   # 紫
BG_ADAPT = "#0a0f1e"       # 安卓自适应背景实心色（与图标底色协调）

def hsl_to_rgb(h, s, l):
    h = h % 360.0
    c = (1 - abs(2 * l - 1)) * s
    x = c * (1 - abs((h / 60.0) % 2 - 1))
    m = l - c / 2.0
    if   h < 60:  r, g, b = c, x, 0
    elif h < 120: r, g, b = x, c, 0
    elif h < 180: r, g, b = 0, c, x
    elif h < 240: r, g, b = 0, x, c
    elif h < 300: r, g, b = x, 0, c
    else:         r, g, b = c, 0, x
    return (int((r + m) * 255), int((g + m) * 255), int((b + m) * 255))

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def radial_gradient(size, c0, c1, r1=0.5, r0=0.0):
    """整幅径向渐变 RGBA（alpha=255）。"""
    img = Image.new("RGBA", (size, size))
    px = img.load()
    cx = cy = size / 2.0
    maxd = size * r1
    for y in range(size):
        for x in range(size):
            d = math.hypot(x - cx, y - cy) / maxd if maxd else 0
            if d <= r0: t = 0.0
            elif d >= 1.0: t = 1.0
            else: t = (d - r0) / (1.0 - r0)
            px[x, y] = lerp(c0, c1, min(1.0, max(0.0, t))) + (255,)
    return img

def draw_artwork(img, S):
    """在已存在的 RGBA 画布上绘制居中标志（太阳 + 射线 + 频谱环）。背景由调用方决定。"""
    d = ImageDraw.Draw(img)
    cx = cy = S / 2.0
    sun_r = 0.215 * S
    ring_r = 0.295 * S          # 频谱条内端
    bar_max = 0.135 * S         # 频谱条最大长度
    bar_w = max(2, 0.020 * S)   # 条宽
    N = 48

    # 频谱条高度（确定性「类频谱」形状，视觉稳定）
    def hgt(i):
        a = 0.5 + 0.5 * math.sin(i * 0.62)
        b = 0.6 + 0.4 * math.cos(i * 0.27 + 1.1)
        v = 0.22 + 0.62 * a * b
        return max(0.12, min(1.0, v))

    # 1) 频谱发光层：先画宽而淡的模糊层，再画清晰层
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for i in range(N):
        ang = i / N * 2 * math.pi - math.pi / 2
        L = bar_max * hgt(i)
        x0 = cx + math.cos(ang) * ring_r
        y0 = cy + math.sin(ang) * ring_r
        x1 = cx + math.cos(ang) * (ring_r + L)
        y1 = cy + math.sin(ang) * (ring_r + L)
        col = hsl_to_rgb(190 + i / N * 210, 0.92, 0.62)
        gd.line([(x0, y0), (x1, y1)], fill=col + (90,), width=int(bar_w * 2.6), joint="curve")
    glow = glow.filter(ImageFilter.GaussianBlur(S * 0.012))
    img.alpha_composite(glow)

    # 2) 清晰频谱条
    for i in range(N):
        ang = i / N * 2 * math.pi - math.pi / 2
        L = bar_max * hgt(i)
        x0 = cx + math.cos(ang) * ring_r
        y0 = cy + math.sin(ang) * ring_r
        x1 = cx + math.cos(ang) * (ring_r + L)
        y1 = cy + math.sin(ang) * (ring_r + L)
        col = hsl_to_rgb(190 + i / N * 210, 0.92, 0.6 + 0.12 * hgt(i))
        d.line([(x0, y0), (x1, y1)], fill=col + (255,), width=int(bar_w), joint="curve")

    # 3) 太阳射线（细）
    M = 24
    for i in range(M):
        ang = i / M * 2 * math.pi
        r0 = sun_r * 1.08
        r1 = ring_r * 0.92
        x0 = cx + math.cos(ang) * r0
        y0 = cy + math.sin(ang) * r0
        x1 = cx + math.cos(ang) * r1
        y1 = cy + math.sin(ang) * r1
        d.line([(x0, y0), (x1, y1)], fill=GLOW + (120,), width=max(1, int(0.006 * S)))

    # 4) 太阳光晕
    halo = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    hd = ImageDraw.Draw(halo)
    hd.ellipse([cx - sun_r * 1.5, cy - sun_r * 1.5, cx + sun_r * 1.5, cy + sun_r * 1.5],
               fill=GLOW + (55,))
    halo = halo.filter(ImageFilter.GaussianBlur(S * 0.045))
    img.alpha_composite(halo)

    # 5) 太阳本体（圆形径向渐变，边缘抗锯齿）
    s2 = int(round(sun_r * 2))
    sun = Image.new("RGBA", (s2, s2), (0, 0, 0, 0))
    sp = sun.load()
    sc = s2 / 2.0
    for y in range(s2):
        for x in range(s2):
            dist = math.hypot(x - sc, y - sc)
            if dist >= sun_r:
                continue
            t = dist / sun_r
            a = 255 if dist <= sun_r - 1.5 else int(255 * max(0.0, (sun_r - dist) / 1.5))
            sp[x, y] = lerp(SUN_IN, SUN_OUT, t) + (a,)
    img.alpha_composite(sun, (int(cx - s2 / 2), int(cy - s2 / 2)))

    # 6) 太阳描边
    d.ellipse([cx - sun_r, cy - sun_r, cx + sun_r, cy + sun_r],
              outline=(235, 245, 255, 220), width=max(1, int(0.006 * S)))
    return img

def background_gradient(S):
    """竖直渐变 + 中心青色微光，作为满幅底色。"""
    img = Image.new("RGBA", (S, S))
    px = img.load()
    for y in range(S):
        t = y / (S - 1)
        px_row = lerp(BG_TOP, BG_BOT, t)
        for x in range(S):
            px[x, y] = px_row + (255,)
    # 中心微光
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([S*0.18, S*0.18, S*0.82, S*0.82], fill=GLOW + (28,))
    glow = glow.filter(ImageFilter.GaussianBlur(S * 0.12))
    img.alpha_composite(glow)
    return img

def rounded_tile_mask(S, margin, radius):
    m = Image.new("L", (S, S), 0)
    md = ImageDraw.Draw(m)
    md.rounded_rectangle([margin, margin, S - 1 - margin, S - 1 - margin],
                         radius=radius, fill=255)
    return m

def make_full(S, tile=True):
    img = background_gradient(S)
    draw_artwork(img, S)
    if tile:
        margin = int(S * 0.035)
        mask = rounded_tile_mask(S, margin, int(S * 0.16))
        out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        out.paste(img, (0, 0), mask)
        return out
    # 满幅：强制完全不透明（App Store 市场图标 / 安卓旧版启动图要求无 alpha）
    return img.convert("RGB").convert("RGBA")

def make_foreground(S):
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw_artwork(img, S)
    return img

def save_png(img, path):
    img.save(path, "PNG")
    print("  ✓", os.path.relpath(path, ROOT), img.size)

def main():
    os.makedirs(ASSETS, exist_ok=True)
    # 主图 & 磁贴
    full_master = make_full(1024, tile=False)      # 满幅（Linux/mac/Android 旧版/iOS）
    tile_master = make_full(1024, tile=True)       # 圆角磁贴（Windows ICO）
    fg_master = make_foreground(1024)              # 透明前景（Android 自适应）

    # 1) assets/icon.png（满幅）
    save_png(full_master, os.path.join(ASSETS, "icon.png"))

    # 2) assets/icon.ico（圆角磁贴，多尺寸）
    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    ico_path = os.path.join(ASSETS, "icon.ico")
    # PIL 生成多尺寸 ICO：必须以「最大尺寸源图 + sizes 列表」保存，否则只写出源图那一个尺寸
    tile_master.resize((256, 256), Image.LANCZOS).save(ico_path, "ICO", sizes=ico_sizes)
    print("  ✓", os.path.relpath(ico_path, ROOT))

    # 3) 安卓 mipmap
    dpis = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
    for dpi, sz in dpis.items():
        base = os.path.join(ROOT, "android", "app", "src", "main", "res", "mipmap-" + dpi)
        if not os.path.isdir(base):
            os.makedirs(base, exist_ok=True)
        save_png(full_master.resize((sz, sz), Image.LANCZOS), os.path.join(base, "ic_launcher.png"))
        save_png(full_master.resize((sz, sz), Image.LANCZOS), os.path.join(base, "ic_launcher_round.png"))
        save_png(fg_master.resize((sz, sz), Image.LANCZOS), os.path.join(base, "ic_launcher_foreground.png"))

    # 4) iOS AppIcon 全集
    ios_dir = os.path.join(ROOT, "ios", "App", "App", "Assets.xcassets", "AppIcon.appiconset")
    os.makedirs(ios_dir, exist_ok=True)
    ios_set = [
        (20, 2, 40, "AppIcon-20@2x"), (20, 3, 60, "AppIcon-20@3x"),
        (29, 2, 58, "AppIcon-29@2x"), (29, 3, 87, "AppIcon-29@3x"),
        (40, 2, 80, "AppIcon-40@2x"), (40, 3, 120, "AppIcon-40@3x"),
        (60, 2, 120, "AppIcon-60@2x"), (60, 3, 180, "AppIcon-60@3x"),
        (76, 1, 76, "AppIcon-76"), (76, 2, 152, "AppIcon-76@2x"),
        (83.5, 2, 167, "AppIcon-83.5@2x"), (1024, 1, 1024, "AppIcon-512@2x"),
    ]
    images_json = []
    for pt, scale, px, name in ios_set:
        fname = name + ".png"
        save_png(full_master.resize((px, px), Image.LANCZOS), os.path.join(ios_dir, fname))
        idi = "ipad" if (pt in (76, 83.5) or (pt == 20 and scale == 2)) else "iphone"
        if pt == 1024 or pt == 83.5:
            idi = "ios" if pt == 1024 else "ipad"
        images_json.append({
            "filename": fname, "idiom": idi, "scale": "%dx" % scale,
            "size": "%.0fx%.0f" % (pt, pt) if pt != 83.5 else "83.5x83.5"
        })
    # 写 Contents.json
    import json
    contents = {"images": images_json,
                "info": {"author": "AlphaSun", "version": 1}}
    with open(os.path.join(ios_dir, "Contents.json"), "w", encoding="utf-8") as f:
        json.dump(contents, f, indent=2, ensure_ascii=False)
    print("  ✓", os.path.relpath(os.path.join(ios_dir, "Contents.json"), ROOT))

    # 5) 矢量 SVG（PWA）——手工编写，与位图同源
    write_svg(os.path.join(ASSETS, "icon.svg"))

    # 6) 安卓自适应背景色协调
    bg_path = os.path.join(ROOT, "android", "app", "src", "main", "res", "values", "ic_launcher_background.xml")
    if os.path.exists(bg_path):
        with open(bg_path, "w", encoding="utf-8") as f:
            f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
                    '    <color name="ic_launcher_background">' + BG_ADAPT + '</color>\n</resources>\n')
        print("  ✓", os.path.relpath(bg_path, ROOT))

    print("\n图标生成完成。")

def write_svg(path):
    S = 1024
    cx = cy = S // 2
    sun_r = 0.215 * S
    ring_r = 0.295 * S
    bar_max = 0.135 * S
    N = 48
    parts = []
    parts.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="{S}" height="{S}" viewBox="0 0 {S} {S}">')
    # 渐变定义
    parts.append('<defs>')
    parts.append('<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">'
                f'<stop offset="0" stop-color="#0d1428"/><stop offset="1" stop-color="#060a16"/></linearGradient>')
    parts.append('<radialGradient id="sun" cx="50%" cy="50%" r="50%">'
                f'<stop offset="0" stop-color="#cdfaff"/><stop offset="1" stop-color="#9b6bff"/></radialGradient>')
    parts.append('</defs>')
    parts.append(f'<rect width="{S}" height="{S}" rx="{int(S*0.16)}" fill="url(#bg)"/>')
    # 频谱条
    for i in range(N):
        ang = i / N * 2 * math.pi - math.pi / 2
        a = 0.5 + 0.5 * math.sin(i * 0.62)
        b = 0.6 + 0.4 * math.cos(i * 0.27 + 1.1)
        v = max(0.12, min(1.0, 0.22 + 0.62 * a * b))
        L = bar_max * v
        x0 = cx + math.cos(ang) * ring_r
        y0 = cy + math.sin(ang) * ring_r
        x1 = cx + math.cos(ang) * (ring_r + L)
        y1 = cy + math.sin(ang) * (ring_r + L)
        hue = 190 + i / N * 210
        col = "hsl(%d,92%%,62%%)" % hue
        parts.append(f'<line x1="{x0:.1f}" y1="{y0:.1f}" x2="{x1:.1f}" y2="{y1:.1f}" '
                     f'stroke="{col}" stroke-width="{0.020*S:.1f}" stroke-linecap="round"/>')
    # 射线
    M = 24
    for i in range(M):
        ang = i / M * 2 * math.pi
        r0 = sun_r * 1.08; r1 = ring_r * 0.92
        x0 = cx + math.cos(ang) * r0; y0 = cy + math.sin(ang) * r0
        x1 = cx + math.cos(ang) * r1; y1 = cy + math.sin(ang) * r1
        parts.append(f'<line x1="{x0:.1f}" y1="{y0:.1f}" x2="{x1:.1f}" y2="{y1:.1f}" '
                     f'stroke="#37e0ff" stroke-opacity="0.47" stroke-width="{0.006*S:.1f}"/>')
    # 太阳光晕 + 本体
    parts.append(f'<circle cx="{cx}" cy="{cy}" r="{sun_r*1.5:.1f}" fill="#37e0ff" opacity="0.22"/>')
    parts.append(f'<circle cx="{cx}" cy="{cy}" r="{sun_r:.1f}" fill="url(#sun)"/>')
    parts.append(f'<circle cx="{cx}" cy="{cy}" r="{sun_r:.1f}" fill="none" stroke="#ebf5ff" stroke-opacity="0.86" stroke-width="{0.006*S:.1f}"/>')
    parts.append('</svg>')
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(parts))
    print("  ✓", os.path.relpath(path, ROOT))

if __name__ == "__main__":
    main()
