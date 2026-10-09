#!/usr/bin/env python3
"""Render a drawn band (the JSON tree tests/render.test.ts prints) as a self-contained SVG.

    python3 tools/tree-to-svg.py < tree.json > docs/band.svg

Why SVG rather than a screenshot: crisp at any zoom, a few KB, regenerable by anyone with no image tools,
and drawn from the band's real render code, so the README cannot drift from what the mod draws.

The frame's box-drawing characters and the bars' blocks are drawn as shapes, not glyphs: fonts disagree
on their weight and on whether they join, and a reader's font should not decide how the band looks.
"""

import json
import sys
from html import escape

CW = 8.4  # advance width of one cell
LH = 20.0  # line height
FONT_SIZE = 14
PAD = 16.0
BG = "#1e1e1e"
FG = "#e6e6e6"
DIM_OPACITY = 0.55
# Claude Code's dark theme, for the named colours the band uses.
THEME = {
    "claude": "#d77757",
    "success": "#4eba65",
    "error": "#ff6b80",
    "warning": "#ffc107",
    "subtle": "#999999",
    "text": "#ffffff",
}
STROKE = 2.2  # the frame's heavy lines


def color(c):
    if c is None:
        return None
    return THEME.get(c, c)


def runs(node, style):
    """The text runs of an inline Text subtree: (text, colour, bold, dim)."""
    if isinstance(node, str):
        return [(node, style["color"], style["bold"], style["dim"])]
    props = node.get("props", {})
    s = {
        "color": color(props.get("color")) or style["color"],
        "bold": props.get("bold", style["bold"]),
        "dim": props.get("dimColor", style["dim"]),
    }
    out = []
    for child in node.get("children", []):
        out += runs(child, s)
    return out


def cells(line_runs):
    out = []
    for text, c, bold, dim in line_runs:
        for ch in text:
            out.append((ch, c, bold, dim))
    return out


BASE = {"color": None, "bold": False, "dim": False}


def lines(node):
    """A Box's lines, each a list of cells; a Text is one line."""
    if isinstance(node, str) or node["type"] == "Text":
        return [cells(runs(node, BASE))]
    props = node.get("props", {})
    kids = node.get("children", [])
    if props.get("flexDirection", "row") == "column":
        out = []
        for k in kids:
            out += lines(k)
        return out
    row = []
    for k in kids:
        ls = lines(k)
        row += ls[0] if ls else []
    width = props.get("width")
    if width is not None:
        row = row[:width] + [(" ", None, False, False)] * max(0, width - len(row))
    return [row]


def shape(ch, x, y, fill):
    """Box-drawing and block characters as shapes; None for anything else."""
    cx, cy = x + CW / 2, y + LH / 2
    h, v = f'stroke="{fill}" stroke-width="{STROKE}"', f'stroke="{fill}" stroke-width="{STROKE}"'
    if ch == "▆":
        top = y + LH * 0.22
        return f'<rect x="{x:.1f}" y="{top:.1f}" width="{CW + 0.05:.2f}" height="{y + LH - top - 1:.1f}" fill="{fill}"/>'
    if ch == "━":
        return f'<line x1="{x:.1f}" y1="{cy:.1f}" x2="{x + CW:.1f}" y2="{cy:.1f}" {h}/>'
    if ch == "┃":
        return f'<line x1="{cx:.1f}" y1="{y:.1f}" x2="{cx:.1f}" y2="{y + LH:.1f}" {v}/>'
    corners = {"┏": (1, 1), "┓": (-1, 1), "┗": (1, -1), "┛": (-1, -1)}
    if ch in corners:
        dx, dy = corners[ch]
        ex = x + CW if dx > 0 else x
        ey = y + LH if dy > 0 else y
        return f'<path d="M{ex:.1f},{cy:.1f} H{cx:.1f} V{ey:.1f}" fill="none" {h} stroke-linecap="square"/>'
    return None


def main():
    tree = json.load(sys.stdin)
    rows = lines(tree)
    # The prompt beneath the band, as it sits in Claude Code.
    rows.append([])
    rows.append(cells([("❯ ", "#999999", False, False)]) + [("█", "#999999", False, False)])
    width = max(len(r) for r in rows)
    W = PAD * 2 + width * CW
    H = PAD * 2 + len(rows) * LH
    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W:.0f}" height="{H:.0f}" viewBox="0 0 {W:.0f} {H:.0f}" '
        f'font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="{FONT_SIZE}">',
        f'<rect width="100%" height="100%" rx="8" fill="{BG}"/>',
    ]
    for r, row in enumerate(rows):
        y = PAD + r * LH
        text_parts = []
        i = 0
        while i < len(row):
            ch, c, bold, dim = row[i]
            x = PAD + i * CW
            fill = c or FG
            if ch == "▆":
                # One rect per run of same-coloured blocks: per-cell rects leave anti-aliased seams.
                j = i
                while j < len(row) and row[j][0] == "▆" and (row[j][1] or FG) == fill:
                    j += 1
                top = y + LH * 0.22
                out.append(
                    f'<rect x="{x:.1f}" y="{top:.1f}" width="{(j - i) * CW:.1f}" height="{y + LH - top - 1:.1f}" fill="{fill}"/>'
                )
                i = j
                continue
            i += 1
            s = shape(ch, x, y, fill)
            if s is not None:
                out.append(s)
            elif ch != " ":
                attrs = f'x="{x:.1f}" y="{y + LH * 0.72:.1f}" fill="{fill}"'
                if bold:
                    attrs += ' font-weight="bold"'
                if dim:
                    attrs += f' fill-opacity="{DIM_OPACITY}"'
                text_parts.append(f"<text {attrs}>{escape(ch)}</text>")
        out += text_parts
    out.append("</svg>")
    sys.stdout.write("\n".join(out) + "\n")


if __name__ == "__main__":
    main()
