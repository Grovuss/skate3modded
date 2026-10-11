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
- Adding new clothing as a separate item: a new item can be made to load, but it takes the place of
  the item it was copied from in the menu. The cause has not been found.
- New item names: the game's text table is keyed by a hash that has not been worked out.
