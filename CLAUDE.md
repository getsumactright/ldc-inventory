# LDC Inventory

Equipment inventory app for LDC volunteers and Kingdom Halls. It stores everything on the
device it runs on (laptop, iPad or phone). There is no server, no account and no sync: devices
pass changes to each other as CSV files, and "Email CSV" hands the file to the device's share
sheet or mail app. Barcode/QR scanning is out of scope by the owner's decision.

- Repo: `getsumactright/ldc-inventory` (public). This folder is the git root.
- Live: https://getsumactright.github.io/ldc-inventory/
- Deploy: every push to `main` runs `.github/workflows/pages.yml`, which publishes `app/` to
  GitHub Pages. There is nothing else to deploy.

## Never commit real data

The repo is public.

- `Cedar Ravine Inventory List.xlsx` holds the real inventory and has plaintext passwords in
  cells B3 and D3. It is git-ignored (`*.xlsx`). Never commit it, quote those cells, or copy
  its rows into the repo.
- `app/sample/Sample Inventory List.csv` is made-up data on purpose. Do not replace it with the
  real list.
- `design/` (superseded August mockups) is git-ignored too.
- The Stitch screenshots in `.stitch/designs/` show the real hall name and item names. The owner
  chose to publish them; they contain no serial numbers, address or passwords.

## Layout

```
app/                  the whole app, plain HTML/CSS/ES modules, no build step, no dependencies
  index.html          shell; loads styles.css and js/ui.js
  js/db.js            IndexedDB wrapper (database "ldc-inventory")
  js/csv.js           CSV reader and writer
  js/model.js         data, status logic, CSV export/import, spreadsheet import
  js/ui.js            hash router and every screen
  sw.js               service worker (network first, cache fallback) for offline use
  sample/             made-up sample list used by the setup screen
.stitch/DESIGN.md     design brief, colour tokens, Stitch screen IDs
.stitch/designs/      the eleven screen designs the app was built from
```

## Run it

From the umbrella folder (`Claude Projects/`), the preview server is named `ldc-inventory`
(port 4173) in the umbrella's `.claude/launch.json`. That is the file the preview launcher
reads; a `launch.json` inside this folder is ignored. By hand:

```bash
python3 -m http.server 4173 --directory app
```

There are no automated tests. Check changes in the browser preview at phone width (375) and
laptop width (1100 and up, where Assets becomes a list with a detail panel).

## How the data works

- Five linked tables: halls, rooms, assets, projects, movements. Plus `shares` (send/receive
  history) and `meta`.
- **Movements are append-only.** Nothing edits or deletes one. To correct a mistake, log
  another movement. Keep it that way: the log is the point of the app.
- An item's status is never stored. `assetState()` works it out from its movements (out,
  back, move), and `projectStats()` answers "did everything come back?" the same way.
- Every record written on this device gets an increasing `seq`. "Changes since last send"
  exports records whose `seq` is above the last sent one. Imported records get `seq` 0 so
  they are not counted as unsent.
- Reference photos stay on the device and are not part of the CSV.

## CSV exchange format

One file carries every record type. The first column, `record`, is `hall`, `room`, `asset`,
`project` or `movement`; the header is `HEADER` in `js/model.js`. Devices in the field hold
files in this format, so add columns at the end and never rename or remove one.

Import (`analyzeImport` then `applyImport`) always previews before saving: new movements are
added, ones already present are skipped by `id`, other records are updated only when the
incoming `updated` time is newer.

A CSV whose first header cell is not `record` is treated as a spreadsheet list for first-run
setup: a row with only its first cell filled starts a new room, and any item whose location
is not the hall starts as "out".

## Conventions

- Asset IDs are `LDC-<hall code>-<4 digits>`, e.g. `LDC-CDR-0042`. This format is a
  placeholder; LDC may have its own convention.
- UI copy is plain and short. There is no online mode, so never add "offline" badges, sync
  wording, or bin/zone/tray labels. Status is always a word plus an icon, never colour alone.
- Tap targets are at least 48px. Colours and radii are the CSS variables at the top of
  `app/styles.css`; they match `.stitch/DESIGN.md`.
- All paths in `app/` are relative, because the site is served from `/ldc-inventory/`.
- When adding or renaming a file in `app/`, update the `SHELL` list in `app/sw.js`.

## Known gaps

- Not yet tested on a real iPhone or iPad: installing to the home screen, Email CSV through
  the share sheet, photo capture, and offline use.
- Where a browser cannot share files, Email CSV saves the file and opens a blank email for
  the user to attach it to.
- No way to delete an item or a hall, and no CSV export of photos.
