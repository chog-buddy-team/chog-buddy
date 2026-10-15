---
name: Chog Buddy
description: A kiss-cut sticker sheet in the four Chog inks; every Chog is a sticker you peel onto your desktop.
colors:
  hood: "#6c4ab6"
  hood-deep: "#563a98"
  cream: "#f6e9c7"
  pink: "#f48caa"
  ink: "#2a1842"
  ink-soft: "#4a3570"
  vinyl: "#ffffff"
  on-sheet: "#fffaf0"
  on-sheet-soft: "#e7dcff"
  on-sheet-soft-night: "#cfc0f0"
  letter-night: "#9b78e6"
  bar-track: "#efe6fb"
typography:
  display:
    fontFamily: "Bagel Fat One, system-ui, sans-serif"
    fontSize: "clamp(4.2rem, 12vw, 9rem)"
    fontWeight: 400
    lineHeight: 0.95
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Bagel Fat One, system-ui, sans-serif"
    fontSize: "clamp(1.5rem, 3.5vw, 2rem)"
    fontWeight: 400
    lineHeight: 1.1
  title:
    fontFamily: "Bagel Fat One, system-ui, sans-serif"
    fontSize: "1.3rem"
    fontWeight: 400
    lineHeight: 1.1
  hook:
    fontFamily: "Rubik, system-ui, sans-serif"
    fontSize: "clamp(1.4rem, 2.6vw, 1.9rem)"
    fontWeight: 700
    lineHeight: 1.2
  body:
    fontFamily: "Rubik, system-ui, sans-serif"
    fontSize: "1.05rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.72rem"
    fontWeight: 400
    letterSpacing: "0.06em"
    fontFeature: "tnum"
rounded:
  art: "14px"
  sticker: "22px"
  pill: "999px"
spacing:
  sticker-pad: "12px"
  sheet-grid: "28px"
  page-top: "40px"
  page-bottom: "72px"
  section: "48px"
components:
  button-primary:
    backgroundColor: "{colors.pink}"
    textColor: "{colors.ink}"
    typography: "{typography.title}"
    rounded: "{rounded.pill}"
    padding: "0 24px"
    height: "52px"
  button-quiet:
    backgroundColor: "{colors.vinyl}"
    textColor: "{colors.ink}"
    typography: "{typography.title}"
    rounded: "{rounded.pill}"
    padding: "0 24px"
    height: "52px"
  sticker:
    backgroundColor: "{colors.vinyl}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sticker}"
    padding: "12px"
  sticker-note:
    backgroundColor: "{colors.cream}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sticker}"
    padding: "14px 18px"
  chip-demo:
    backgroundColor: "{colors.pink}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "3px 8px"
  soul-bar:
    backgroundColor: "{colors.bar-track}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "14px"
---

# Design System: Chog Buddy

## Overview

**Creative North Star: "The Kiss-Cut Sticker Sheet"**

The page is a vinyl backing sheet printed with a fine liner grid, and everything on it is a die-cut sticker: white vinyl border, soft lift off the sheet, slightly tilted as if pressed on by hand. The pixel Chog is the hero sticker, cut out along its own pixels with a thick white border. Lettering is fat, rounded and outlined in white like a sticker title; small mono caps act as the sheet's print codes (token ids, levels, platforms).

The palette is the official Chog art, nothing else: hood purple, cream, blush pink and ink, plus the white of the vinyl. State is shown as a mark, not a hue: a peeled corner means waiting or unfinished, flat means done. The single exception to the four-ink sheet is holo foil, reserved for the one leaderboard strip, where the sheen turns as the page scrolls.

Density is loose and playful. Large rotations stay small (roughly -5deg to +8deg on scattered stickers, -3deg to +3deg in grids), and hover straightens a sticker rather than tilting it further.

**Key Characteristics:**
- Gridded hood-purple backing sheet (ink at night), 28px liner grid.
- White vinyl stickers with a soft two-layer lift shadow and 22px corners.
- Pixel sprites cut out with a 5px white outline that follows the pixels.
- Bagel Fat One lettering, white-stroked via paint-order, ink drop shadow.
- JetBrains Mono uppercase print codes.
- Peeled corner = waiting; flat = done.
- Holo foil on exactly one surface: the leaderboard.

## Colors

Four Chog inks and white vinyl, with a few tints that exist only to make text legible on those inks.

### Primary
- **Chog Hood Purple** (hood): the backing sheet in light mode and the fill of Soul bars. Brand-bound to the official art.
- **Deep Hood** (hood-deep): headings and names printed on white or cream vinyl (sticker titles, rank numbers, label-sticker text, emphasis in notes).

### Secondary
- **Blush Pink** (pink): the primary action sticker, the Demo chip, focus rings, text selection and scrollbar thumb. Never a background for paragraphs.

### Tertiary
- **Chog Cream** (cream): note stickers (privacy promises), step numerals, and the art backing behind sprites in the album.

### Neutral
- **Chog Ink** (ink): text on vinyl, display lettering fill in light mode, and the backing sheet at night.
- **Soft Ink** (ink-soft): secondary text on vinyl and foil (print codes under names, leaderboard note).
- **Vinyl White** (vinyl): every sticker body, kiss-cut border, lettering outline and sprite outline.
- **Sheet Paper** (on-sheet): body text printed directly on the sheet.
- **Sheet Lilac** (on-sheet-soft, on-sheet-soft-night): supporting copy and labels on the sheet, light and night values.
- **Night Lettering** (letter-night): display lettering fill on the night sheet, where ink would vanish.
- **Bar Track** (bar-track): the empty track behind Soul bars.

### Named Rules
**The Four Inks Rule.** New color comes from hood, cream, pink or ink, or a tint of them made for legibility. No blue, green or gradient accents on the sheet.

**The One Foil Rule.** The holo foil gradient (pink, lilac, sky, butter, turning with `--sheen`, plus a soft-light grain) lives on the leaderboard strip only. A second foil surface cheapens the first.

## Typography

**Display Font:** Bagel Fat One (with system-ui)
**Body Font:** Rubik (with system-ui)
**Label/Mono Font:** JetBrains Mono (with ui-monospace)

**Character:** a fat, bubbly sticker face over a friendly geometric sans; the mono is the fine print on the sheet's edge.

### Hierarchy
- **Display** (400, clamp(4.2rem, 12vw, 9rem) landing, clamp(3.4rem, 11vw, 7rem) park, 0.95): page titles as sticker lettering. On the sheet it carries a 0.16em white stroke painted under the fill and a soft ink shadow; on white vinyl the stroke and shadow are dropped and the fill turns hood-deep.
- **Headline** (400, clamp(1.5rem, 3.5vw, 2rem), 1.1): the leaderboard title on foil.
- **Title** (400, 1.3rem, 1.1): Chog names in the album, button text (1.15rem), label stickers (0.95rem), rank numerals (1.4rem).
- **Hook** (Rubik 700, clamp(1.4rem, 2.6vw, 1.9rem), 1.2): the one-line promise under the hero lettering.
- **Body** (Rubik 400, 1–1.1rem, 1.5): paragraphs capped at 44–62ch. Bold 600–700 for mood bubbles, steps and status lines.
- **Label** (JetBrains Mono, 0.72rem, 0.06em, uppercase, tabular numerals): token ids, levels, archetypes, minutes, platform lines, the back link.

### Named Rules
**The Outline Needs a Sheet Rule.** The white lettering outline only appears where it cuts against the purple or ink sheet. On white vinyl, lettering goes flat hood-deep.

**The Print Code Rule.** Numbers and identifiers (token id, level, minutes, Soul values) are set in the mono label; prose is never set in mono.

## Layout

Single centred column, max 1120px, with side padding `max(16px, …)` and 40px top / 72px bottom. Sections stack with 48–56px gaps. The landing hero is a two-column grid (copy 1.1fr, sticker stage 1fr), min-height min(82vh, 720px); the Park top row pairs header (1.3fr) and leaderboard (min 280px). Both collapse to one column at 860px, with the landing sticker stage moving above the copy.

The Park album is an auto-fill grid of 230px minimum stickers with 40px row and 28px column gaps; two columns at 600px, one at 380px. The connect page centres one 460px sticker card on the sheet with the Chog sprite overlapping its top edge by 96px.

Stickers are placed by hand: per-item tilt from a stable seed (`(id*37)%7 - 3` deg), halved on mobile. The backing grid is 28px everywhere.

## Elevation & Depth

Depth is physical: stickers sit on a sheet. Each sticker casts a short contact line plus a long soft drop below it; hover lifts it further. Sprite cutouts carry a larger soft drop under their white outline. There are no hard offset shadows; the zero-blur drop-shadows on sprites are the white kiss-cut border, not shadow.

### Shadow Vocabulary
- **Lift** (`box-shadow: 0 1px 0 rgb(42 24 66 / 0.18), 0 14px 28px -12px rgb(20 8 40 / 0.55)`): every sticker and button at rest.
- **Lift hover** (`box-shadow: 0 1px 0 rgb(42 24 66 / 0.18), 0 22px 36px -14px rgb(20 8 40 / 0.6)`): button hover.
- **Cutout drop** (`drop-shadow(0 16px 18px rgb(20 8 40 / 0.45))`): pixel sprites, after the four 5px white outline passes.
- **Bubble** (`box-shadow: 0 6px 14px -6px rgb(20 8 40 / 0.35)`): small speech bubbles tucked over art inside a sticker.
- **Lettering shadow** (`text-shadow: 0 0.09em 0.12em rgb(20 8 40 / 0.35)`): display lettering on the sheet.

### Named Rules
**The Peel Means Waiting Rule.** The peeled corner (a 46px curled flap showing the sheet through) marks something unfinished or in progress. On /connect the flap animates while the wallet is open and disappears when done. Use it for state, not decoration on every card.

## Shapes

Rounded, die-cut forms. Stickers use 22px corners, art windows inside them 14px, buttons and chips are full pills, step numerals are circles. Borders are white vinyl: 4px on buttons, 6px on the foil strip, 5px outlines on sprites. Empty states are a dashed 3px translucent white outline on the sheet, the shape of a sticker not yet placed. Leaderboard rows divide with a 1px dashed ink line.

## Components

### Buttons
Stickers you can press.
- **Shape:** full pill (999px), 52px min height, 4px white vinyl border.
- **Primary:** blush pink with ink display text (1.15rem), padding 0 24px, Lift shadow.
- **Hover / Focus:** lifts 2px and turns -1deg with Lift hover, 0.35s on the shared ease; press drops 1px; focus is a 3px pink outline offset 3px.
- **Quiet:** same sticker in white vinyl, for the secondary action.
- **Disabled:** 0.75 opacity, progress cursor, no motion.

### Chips
- **Demo chip:** pink pill, ink mono label, sits inline after a Chog name to mark demo data.

### Cards / Containers
- **Corner Style:** 22px.
- **Background:** white vinyl; cream for promise notes.
- **Shadow Strategy:** Lift.
- **Border:** none; the white body is the border against the sheet.
- **Internal Padding:** 12px base; 12px 12px 16px for album stickers; generous (120px top) where a sprite overlaps the card.

### Navigation
- **Back link:** mono label in sheet lilac with a drawn 14px stroke arrow, brightens to sheet paper on hover. Arrows are inline SVG at one stroke weight (2px, round caps), never Unicode glyphs.

### Chog Album Sticker (signature)
White sticker holding a square cream art window (pixel sprites rendered pixelated and contained), a white mood speech bubble overlapping the art's bottom edge by 34px, the name in hood-deep display, a mono print code line with dot separators, and four Soul bars. Tilted by seed; hover straightens and lifts 4px.

### Soul Bar
14px pill track in bar-track, hood fill at the exact percentage, mono value pinned right inside the track. Label column 5.5em, stacking above the bar on mobile.

### Holo Leaderboard (signature)
The one foil surface: 6px white border, 22px corners, 1.2deg tilt, pastel foil gradient whose angle is driven by root scroll, with a soft-light fractal grain. Ranks in hood-deep display numerals, names in Rubik 600, minutes in mono. Static under reduced motion.

### Cutout Sprite
Pixel Chog PNG rendered `pixelated`, outlined by four 5px white drop-shadows then a soft drop. Only real sprite-kit renders, never redrawn.

## Do's and Don'ts

### Do:
- **Do** put every piece of content on a sticker or directly on the sheet; stickers get white vinyl, 22px corners and the Lift shadow.
- **Do** tilt hand-placed stickers by small amounts (within about ±8deg) and straighten them on hover.
- **Do** use the peeled corner only for waiting or unfinished state, and remove it when done.
- **Do** set identifiers and numbers in the uppercase mono label.
- **Do** draw icons as inline SVG strokes at 2px with round caps.
- **Do** keep the one authored motion moment per page short and on the shared ease `cubic-bezier(0.16, 1, 0.3, 1)`, and collapse motion under reduced-motion.

### Don't:
- **Don't** add colors outside the four Chog inks and their legibility tints.
- **Don't** use holo foil anywhere except the leaderboard strip.
- **Don't** use the white lettering outline on white vinyl.
- **Don't** use Unicode glyphs as icons.
- **Don't** redraw or vectorise the Chog; use sprite-kit renders.
- **Don't** set prose in mono or numbers in the display face outside ranks and names.
