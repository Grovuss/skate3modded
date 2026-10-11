# Making mods for Skate³

A mod is a folder (or a zip of it) that the launcher adds on the **Mods** page:

```
My Mod/
  mod.json          optional: name, version, author, description
  files/            mirrors the game folder
    data/...
```

```json
{ "name": "My Mod", "version": "1.0", "author": "you", "description": "What it does." }
```

Without a `mod.json`, the launcher looks for a `data` folder and uses the folder or zip name.

## Two kinds of file

**Whole game files.** A file at `files/data/movies/intro.vp6` replaces the game's
`data/movies/intro.vp6`.

**Files inside an archive.** Most of the game lives in `.big` archives. To change one file inside
an archive, put it in a folder *named after the archive*, at its path inside the archive:

```
files/data/content/createacharacter.big/data/content/createacharacter/texture/0x2c7f381800171878.rx2
      └────────── the archive ─────────┘└──────────────── path inside the archive ───────────────┘
```

When the mod is switched on, the launcher rebuilds that archive from the original plus the files
from every enabled mod. A file that is not in the archive yet is added to it. Mods that touch
different files in the same archive work together; when two mods provide the same file, the one
higher in the list wins.

Mods built this way are small, and contain only your own changes rather than a copy of the game's
archive.

The original game files are always kept (in `.skate3cubed/originals` beside the game) and put back
when a mod is switched off or removed.

## Changing a texture with an image

Textures are stored in `.rx2` files, often several to a file. You do not need to build those
yourself: put a PNG where the texture file would go, named like the texture file plus `.png`.

```
files/data/big/fetexture.big/data/fe/source/screens/main/webkit.rx2_4.png
                                                         └ texture 4 of webkit.rx2
```

- `name.rx2.png` replaces the texture of a file that holds one texture.
- `name.rx2_3.png` replaces texture number 3 of a file that holds several.

These are exactly the names *Extract* gives the PNGs it saves, so the usual way to work is: extract
with *Also save textures as PNG*, edit the PNG you want, and copy only that PNG into your mod.

The image must be the same size as the texture and saved as an 8-bit PNG. Transparency is kept.
Only the parts of the picture you changed are re-encoded, so the rest of the texture stays exactly
as the game shipped it. A mod made this way contains nothing but your own images.

If an image is the wrong size, the launcher says so and switches the mod back off.

## Changing text

The game's text lives in tables, one per language, in `data/big/miscboot.big`
(`LANGUAGE_English_Global_skate3ng.BIN` and so on). To change lines of text, add a file named like
the table plus `.strings.json`:

```
files/data/big/miscboot.big/LANGUAGE_English_Global_skate3ng.BIN.strings.json
```

```json
{
  "ID_PLAY_SKATE_3": "Play Skate³!",
  "ID_PATH_NAME_THRASHER": "Magazine Photos"
}
```

Each key is the line's label and each value is its new text. Only list the lines you change.
*Extract* on a text table also writes its `.strings.json` with every label and its current text, so
you can search it for the words you see in-game and copy those lines into your mod.

- Several mods can change text in the same table; when two change the same line, the one higher in
  the list wins.
- A label the table does not have yet is added as a new line. That only matters if something in the
  game asks for that label: clothing names, for example, use
  `ID_CAC_PART_<MODEL NAME>_<MATERIAL NAME>` in capitals.
- Save the file as UTF-8. Western languages can show the characters of Windows-1252 (accents, ™, ®,
  ³ and so on); the launcher says so if a character cannot be shown.
- Markers such as `{0:points}` and `«` are filled in or drawn by the game: keep them as they are.
- `^` starts a new line, so it cannot be used as an ordinary character.
- The game's fonts do not have every character the table can hold: `³`, for one, is missing and
  shows as nothing. Check new characters in-game, or add them to the fonts (below).

## Fonts

Menu text is drawn from bitmap fonts in `data/big/miscboot.big`: a sheet of characters
(`futuraheavy.rx2`, `futuraglow.rx2`, `futurashadow.rx2`, `futuraoverprint.rx2`) and a plain-text
description of each (`futuraheavy.bmpFont` and so on).

- `GlyphMetricsMap: <count>` lists the characters on the sheet, each as
  `index page x y width height bearingX bearingY advance`. `x, y` is the character's origin on the
  baseline, not a corner: its picture sits at `(x + bearingX, y - bearingY)`.
- `CharMapSet: <count>` pairs Unicode code points with those indices, in ascending order.

To add a character: draw it in an empty part of the sheet (replace the sheet with an image, as for
any texture), add a line for it to `GlyphMetricsMap`, pair its code point with it in `CharMapSet`,
and raise both counts.

## Getting the original files

The **Game files** page lists every archive and what is in it. *Extract* writes the files to the
launcher's `extracted` folder using the same layout a mod needs, so an extracted file can be edited
and copied straight into your mod's `files` folder. With *Also save textures as PNG*, each texture
file (`.rx2`) is also saved as an image so you can see what it is.

## What is known about the formats

- **Textures** are `.rx2` files (RenderWare 4 arenas) holding Xbox 360 textures, mostly DXT1/DXT5.
  For clothing, the colour channels are the print and the alpha channel is the gloss map. Images can
  replace DXT1, DXT3, DXT5, DXT5A, 8888 and L8 textures; DXN (normal maps) cannot be replaced yet.
- Square textures with smaller copies for viewing at a distance get those copies rebuilt from your
  image. For other shapes only the full-size picture is replaced, and the launcher tells you.
- A texture file carries its own identity: its id, the text `0x<id>.Texture`, and a hash of that
  text in three places. A copy saved under a new id must update all of them, or the game treats the
  two files as the same texture.
- **Create-a-character items** are described by `cas_db_*.recipe` in `createacharacter.big`. Its
  string table must start on a 32-byte boundary; a recipe that grows without keeping that alignment
  crashes the game when the character editor opens.
- Archives without file names list their entries as `#<hash>`; those can be replaced but new files
  cannot be added to them.

## Not possible yet

- Changing a texture's size or format.
- Adding new clothing with the launcher alone. It has been done by hand (see below), but there is
  no tool for it yet.

## Adding a new clothing item (what it takes)

A new short-sleeve tee has been added next to the existing ones by editing `cas_db_*.recipe`. The
rules found on the way:

- The texture is a new `.rx2` file with its own id, name and hash (see above), plus a row for it in
  `cas_db_*.toc`.
- Each model's list of materials in the recipe gains an entry (at both detail levels) pointing at
  the new texture. The lists are in order of the materials' names, so a material added at the end
  needs a name that sorts last.
- An item record is added per model, with the new material id and string-table entries of its own:
  - a **name**, or the game treats it as the item it was copied from;
  - a **style** string (the artwork path at offset 0xBA of the record). Items of one model sharing
    a style string appear as one tile with several "options", so reusing another item's style
    makes the new item show up inside that item's tile.
- The unlock fields (offsets 0xB8 and 0xC2) set to 0xFFFF make the item available from the start.
- Its display name is the text line `ID_CAC_PART_<MODEL NAME>_<MATERIAL NAME>` in capitals.
- Growing the recipe must keep the string table on a 32-byte boundary (see above).

The menu pictures that go with an item are in `data/big/fedynamic.big`:

- **Tile thumbnail:** `data/fe/cas/<male|female>/<body part>/<model name>_<material name>.rx2`,
  128×128.
- **Brand logo:** `data/fe/source/images/sponsor_logos/<logo name>.rx2`, 64×64 or 128×128.

These files state their own name inside: the text `<name>.Texture`, a 32-bit FNV-1 hash of the name
(in three places) and a 64-bit FNV-1 hash of `<name>.Texture`. A copy under a new name must update
all of them; keeping the new name the same length as the old one avoids moving anything else.

Brands are slots defined in `data/big/db.big` (`skatercollections.bin`), each with a logo file and
a name label (`ID_CAC_BRAND_<NAME>`). That file is not understood well enough to add a slot. An
item whose brand is not a slot gets no logo and is listed right after the brandless items. The
list follows the slots' own order: brandless first, then the brands by internal name. Twelve
slots are used by no item (ambiguous, bandshirts, bigblack, diamond, fillmore, fkd, icecream,
luxirie, lost, macbeth, mystery, neweracap), so a new brand can take one over by replacing its
logo image and label text. To be listed first, take the first slot (adidas) and move its items to
an unused slot, swapping the two slots' logos and labels.
- Text tables other than the per-language "Global" ones (the small "HISTOGRAM" files) are not
  understood.
