# LDC Inventory

A small equipment inventory app for Kingdom Halls. Everything is stored on the device it runs
on (laptop, iPad or phone); there is no server, no account and no sync. Devices pass changes to
each other as CSV files, usually by email.

- `app/` is the whole app: plain HTML, CSS and JavaScript, no build step.
- `.stitch/` holds the design brief and the screen designs it was built from.

## Run it locally

```bash
python3 -m http.server 4173 --directory app
```

Then open http://localhost:4173.

## How it works

Five linked tables: halls, rooms, assets, projects and movements. Movements are append-only;
an item's status ("in place" or "out") is worked out from them, which is how a project can
answer "did everything come back?".

Share → Email CSV exports either everything or only the changes since the last send. Opening
that file on another device shows what it would change before anything is saved.
