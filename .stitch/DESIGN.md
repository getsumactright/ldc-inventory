# LDC Inventory — design brief

Stitch project: `15826962902611717525` ("LDC Inventory App")

## What the app is

A small local-first inventory app for LDC volunteers. All data lives on the device (laptop,
iPad or phone); nothing needs a server or a signal. Changes travel between devices as CSV
files, and "Email CSV" hands the file to the device's default mail app. No barcode scanning.

Five linked tables: Halls, Rooms, Assets, Projects, Movements. Movements is append-only and
answers the one question the spreadsheet could not: did everything come back?

## Who uses it, and where

Volunteers standing in a Kingdom Hall or at a storage container (the "Connex"), often one
handed, sometimes in poor light, not necessarily technical. So: large tap targets (48px
minimum), plain words, one primary action per screen, status readable without colour alone.

## Visual system

Calm, utilitarian, "well-kept toolroom". Carried over from the August mockups.

| Role | Colour |
|---|---|
| Primary action | Burnt amber `#C2610B` |
| Primary pressed / emphasis text | Deep amber `#8F470A` |
| Amber tint (out / needs attention) | `#FBEEE1` |
| Returned / in place | Forest green `#14603C` on `#E4F1E9` |
| App background | Warm off-white `#F6F7F5` |
| Surface | White `#FFFFFF` |
| Hairlines | `#C9CCC7` |
| Body text | Near-black `#1F2124` |
| Secondary text | Slate `#5C6066` |

- Type: Inter. Tabular numerals for quantities and asset IDs. Asset IDs in a monospace face.
- Shape: 12px corners on cards, 10px on buttons and inputs, fully rounded status chips.
- Elevation: flat. 1px hairline borders, no drop shadows except the bottom action bar.
- Light theme only for now.

## Navigation

Bottom tab bar on phone, left rail on iPad and laptop: Home, Assets, Movements, Projects, Share.

## Screens

1. Home — hall summary, what is out right now, quick actions
2. Assets — searchable list grouped by room
3. Asset detail — facts, photo, movement history
4. Log a movement — take out / bring back form
5. Project check — did everything come back?
6. Share — export, email and import CSV
7. Assets on iPad / laptop — table with a detail panel
8. Movements — the full append-only log, filterable
9. Projects — list with an everything-back indicator per project
10. Add / edit item — one form
11. First-run setup — hall, rooms, import a CSV or start empty

Screenshots are in `.stitch/designs/`. Current Stitch screen IDs (design system
`assets/5e5700cb0f5f4272b6253a1e1785507c`):

| Screen | Stitch screen ID |
|---|---|
| 01 Home | `0b6ff7be370e404182ae9fec9f14ecc2` (regenerated; the first Home, with a wrong 41-units figure, is still in the project) |
| 02 Assets | `9fc00a6f582143fbb3080868188d93f5` |
| 03 Asset detail | `42ba4c2d28524e0e83ea2414f140a59c` |
| 04 Log a movement | `137d3e381a1845ae8ec577399d011fb3` |
| 05 Project check | `8f930edd1cb54ca1a215bfe0f6ebb4a9` |
| 06 Share | `a611f37b9b75446a9ede95b3e18132f7` |
| 07 Assets, laptop/iPad | `deff56d2e60d4258bb205322f37e82b8` |
| 08 Movements | `820ffc81152242c5b68c80117644fbc7` |
| 09 Projects | `60c5247ba07c45c39e7905b39bc868e1` |
| 10 Add / edit item | `3be971d7daec457daf382cc6481d173b` |
| 11 First-run setup | `fd68c3c397c34c5785ddde97bf4ca7da` |

Everything else in the Stitch project is a superseded version or a duplicate from timed-out
calls and can be deleted there (Movements `b60405f2…` and `b8f969f9…`, Projects `d5f241eb…`,
the first Home `af907ec5…`, and the pre-fix versions of Assets, Take Items Out, Project Check,
Share and the laptop layout). `list_screens` sometimes returns nothing for minutes; generation
calls can time out and still succeed, so check the listing before resubmitting.

Stitch keeps inventing things this app does not have. Strip them on sight: barcode/QR icons,
"Offline" badges or banners (there is no online mode), "Central Toolroom", bin/zone/tray labels.

Known flaws still in the mockups: on the laptop table the Status chips sit flush against the
right edge, long item names are truncated, and the Serial column was dropped to make room
(serials show in the detail panel). The Movements log shows clock times that are not in
sensible order (sample data only). The HTML for the screens has not been saved locally.

## Sample content

Cedar Ravine Kingdom Hall: 36 line items, 62 units, four rooms (Sound Console, Stage,
Auditorium, Foyer). Asset ID placeholder format `LDC-CDR-0042` (LDC's own convention unknown).
