#!/usr/bin/env python3
"""Builds the digits-only "tabular" companion fonts used by css/style.css (the "Tabular digits" block).

Fraunces and Playfair Display ship no tabular figures, so font-variant-numeric can't equalise their digits.
This takes the real font, cuts one static weight out of it, keeps only 0-9, gives every digit the advance of the
widest one (glyphs centred, outlines untouched) and prints a base64 woff2 @font-face for family "<Name> Tabular".
The stack lists that family before the real one, so only digits come from it.

Usage:  pip install fonttools brotli
        npm pack @fontsource-variable/fraunces && tar xzf fontsource-variable-fraunces-*.tgz
        python3 tools/tabular-digits.py "Fraunces" package/files/fraunces-latin-wght-normal.woff2 500 600 700
"""
import base64, io, sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset

def build(name, path, weight):
    font = instancer.instantiateVariableFont(TTFont(path), {'wght': weight})
    opts = subset.Options(layout_features=[], name_IDs=[], notdef_outline=False, glyph_names=False, hinting=False)
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=range(0x30, 0x3A))
    sub.subset(font)
    cmap, hmtx, glyf = font.getBestCmap(), font['hmtx'], font['glyf']
    digits = [cmap[c] for c in range(0x30, 0x3A)]
    width = max(hmtx[g][0] for g in digits)
    for g in digits:
        advance, lsb = hmtx[g]
        dx = (width - advance) // 2
        glyph = glyf[g]
        if glyph.numberOfContours > 0:
            glyph.coordinates.translate((dx, 0))
        elif glyph.isComposite():
            for comp in glyph.components: comp.x += dx
        glyph.recalcBounds(glyf)
        hmtx[g] = (width, getattr(glyph, 'xMin', 0))
    font.flavor = 'woff2'
    buf = io.BytesIO(); font.save(buf)
    return base64.b64encode(buf.getvalue()).decode(), width / font['head'].unitsPerEm

if __name__ == '__main__':
    name, path, weights = sys.argv[1], sys.argv[2], [int(w) for w in sys.argv[3:]]
    for w in weights:
        data, em = build(name, path, w)
        print(f"@font-face {{ font-family: '{name} Tabular'; font-weight: {w}; font-display: swap; unicode-range: U+0030-0039; src: url(data:font/woff2;base64,{data}) format('woff2'); }}   /* digit advance {em:.3f}em */")
