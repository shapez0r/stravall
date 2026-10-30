# Stravall

**Stravall** is an open-source, self-hosted viewer for your Strava activities.
Upload what Strava lets you export — the complete bulk-export archive or single
GPX, TCX, FIT, CSV or XML files — and see **all your routes on one Google Map**,
with start and finish points, plus statistics for every single activity and
for any combination of them.

It is a sister project of eurofish and shares its architecture and its pixel
look: one static Go binary with the web UI embedded, SQLite on a laptop or
MariaDB + Valkey when scaled out, and the same colour themes. It listens on
port **8082**.

- 🗺️ All routes on Google Maps (or on the built-in offline pixel map when no API key is set), coloured by sport, with start ■ and finish ● markers you can switch off
- 🔎 Click a route on the map, in the list or in the table to highlight it and open its details; everything else is dimmed
- 📊 Per activity: distance, moving and elapsed time, average pace or speed, max speed, elevation gain/loss, min/max elevation, heart rate, cadence, power, temperature, calories, start/finish coordinates (loop detection), elevation profile and splits per km or mile
- 📈 Combined, for whatever is filtered (sport, date range, name search): totals, averages, per-week figures, active days and longest streak, records (longest, longest time, fastest, top speed, most climbing, highest point), breakdowns by sport, by year, distance per month and per weekday, and a sortable table of all activities
- 📥 Formats: **GPX**, **TCX**, **FIT** (Garmin binary), **CSV** (Strava's `activities.csv` or any table with lat/lon columns), **XML** (GPX/TCX content), each also as **.gz**, and **.zip** archives such as the full Strava export
- 🧩 With the full export, every activity file is matched with its row in `activities.csv`: Strava's name, sport type and its own totals (moving time, elevation gain, …) are used; activities without a GPS file are kept as statistics-only entries and get their route as soon as you upload the file
- ♻️ Duplicate detection: the same file, or the same activity in another format (same start time), is skipped
- ✏️ Rename activities, change the sport, delete one, all filtered, or all activities
- 🖱️ Upload with the button or by dropping files anywhere on the page, with per-file progress and results
- 🎨 The eurofish themes (Cyber light/night, Paper, Pink, Lavender, Terminal, Purple, Rose night or System) — the Google map follows dark themes
- 🌐 English, Russian and Spanish UI; metric or imperial units
- 🔐 Self-service accounts (e-mail + password), optionally limited to your home network; each user only sees their own activities

## Quick start

### Option A — Docker (recommended)

```sh
cp .env.example .env        # set STRAVALL_GOOGLE_MAPS_KEY, restrict sign-up to your LAN, ...
docker compose up -d --build
```

Open `http://<ip-of-this-machine>:8082`, click **Create account**, then
**+ Upload**. Data lives in the `stravall-data` volume (a single SQLite file).

### Option B — plain binary (Go 1.23+)

```sh
make build                  # -> bin/stravall (static, CGO-free)
STRAVALL_GOOGLE_MAPS_KEY=... ./bin/stravall   # listens on :8082, stores data in ./data
```

Install it as a hardened systemd service on any Linux machine or VM:

```sh
sudo ./scripts/install.sh   # binary -> /usr/local/bin, data -> /var/lib/stravall
```

Allow TCP 8082 in the machine's firewall to reach it from other devices.

## Getting your data out of Strava

On strava.com open **Settings → My Account → Download or Delete Your Account →
Request your archive**. Strava e-mails you a link to a `.zip`; upload that file
as it is. It contains `activities.csv` and an `activities/` folder with one
`.fit.gz`, `.gpx(.gz)` or `.tcx(.gz)` file per activity. You can also upload
single activity files exported from Strava's activity page (⋯ → Export GPX /
Export Original).

The default upload limit is 512 MB per file (`STRAVALL_MAX_UPLOAD_MB`). For a
larger export, unpack it and upload the `activities` folder's files together
with `activities.csv` (select them all at once) — or raise the limit.

## Google Maps

Without a key the routes are drawn on the built-in offline pixel map (drag to
pan, wheel or pinch to zoom, click a route to select it). For Google Maps:

1. In the Google Cloud console create a project and enable the **Maps JavaScript API**.
2. Create an **API key** and restrict it to *Websites* with your Stravall address
   (e.g. `http://192.168.1.10:8082/*`) and to the Maps JavaScript API.
3. Set `STRAVALL_GOOGLE_MAPS_KEY` and restart Stravall.

The key is handed to the browser (that is how the Maps JavaScript API works),
so always restrict it by referrer. If Google rejects the key, the UI falls
back to the pixel map and says so.

## Updating

Your data is kept across updates (Docker volume, `./data` or
`/var/lib/stravall`); database migrations run automatically on start.

- **Docker:** `docker compose up -d --build`
- **Scaled-out stack:** `docker compose -f compose.scale.yaml up -d --build`
- **Plain binary:** stop it, then `make build && ./bin/stravall`
- **systemd:** `make build && sudo install -m 0755 bin/stravall /usr/local/bin/stravall && sudo systemctl restart stravall`

Reload the page with **Ctrl+F5** afterwards. `./bin/stravall version` or
`http://<server>:8082/healthz` shows the running version.

## Deployment options

| Target | How | Storage / cache |
|---|---|---|
| Laptop, home lab | `docker compose up -d --build` or `make run` | SQLite file + in-process cache |
| Any Linux VM / bare metal | `sudo ./scripts/install.sh` (systemd) | SQLite file + in-process cache |
| Scaled-out containers | `docker compose -f compose.scale.yaml up -d --build` | MariaDB + Valkey, nginx load balancer, 3 replicas |
| Kubernetes / cloud | `deploy/k8s/stravall.yaml` | Managed MariaDB/MySQL + Valkey/Redis |

The container image is built `FROM scratch`: only the binary and CA
certificates, running as a non-root user with a built-in `HEALTHCHECK`.

## Configuration

Everything is configured through environment variables; all are optional.

| Variable | Default | Description |
|---|---|---|
| `STRAVALL_ADDR` | `:8082` | Listen address (all interfaces → reachable from the LAN) |
| `STRAVALL_GOOGLE_MAPS_KEY` | *(empty)* | Browser key for the Maps JavaScript API; empty = offline pixel map |
| `STRAVALL_MAX_UPLOAD_MB` | `512` | Largest upload (one file, e.g. the export .zip), 1–4096 |
| `STRAVALL_DATA_DIR` | `./data` (`/data` in the container) | Directory for the SQLite database |
| `STRAVALL_DB_DRIVER` | `sqlite` | `sqlite` or `mariadb` (alias `mysql`) |
| `STRAVALL_DB_DSN` | `file:<data dir>/stravall.db` | e.g. `user:pass@tcp(host:3306)/stravall?charset=utf8mb4` for MariaDB |
| `STRAVALL_CACHE_URL` | `memory` | `memory` or `redis://host:6379/0` (Valkey or Redis) |
| `STRAVALL_ALLOW_SIGNUP` | `true` | Allow self-service account creation |
| `STRAVALL_SIGNUP_CIDRS` | *(empty = anyone)* | Networks allowed to sign up, e.g. `192.168.0.0/16,10.0.0.0/8` |
| `STRAVALL_SESSION_TTL` | `720h` | Login session lifetime |
| `STRAVALL_COOKIE_SECURE` | `false` | Set `true` when served over HTTPS |
| `STRAVALL_PROXY_HEADER` | *(empty)* | Client-IP header behind a trusted reverse proxy, e.g. `X-Forwarded-For` |
| `STRAVALL_LOG_REQUESTS` | `true` | Access log on stdout |

Behind your own reverse proxy, allow request bodies as large as
`STRAVALL_MAX_UPLOAD_MB` (nginx: `client_max_body_size`) and generous timeouts.

## Commands

```sh
stravall serve        # default: migrate the database and start the server
stravall migrate      # only apply database migrations, then exit
stravall healthcheck  # exit 0 if the local server answers /healthz
stravall version
```

## Development

```sh
make run      # build and start on :8082
make test     # unit tests (parsers for GPX/TCX/FIT/CSV/zip and the statistics engine)
```

The web UI is plain HTML/CSS/JavaScript in `web/static/` (no build step),
embedded into the binary with `go:embed`. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and the API.

## License

MIT — see [LICENSE](LICENSE). Stravall is not affiliated with Strava, Inc.
