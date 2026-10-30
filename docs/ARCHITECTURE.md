# Stravall architecture

Stravall follows the eurofish design: one self-contained, stateless Go
binary that serves the API and the embedded web UI, runs its own migrations
and scales from a laptop (SQLite + in-process cache) to many replicas
(MariaDB + Valkey) by changing environment variables only.

## Layout

    cmd/stravall/          entry point: serve | migrate | healthcheck | version
    internal/config/       environment configuration (port 8082, Maps key, upload limit)
    internal/db/           connection handling + embedded, versioned migrations per dialect
    internal/store/        data access (portable SQL for SQLite and MariaDB)
    internal/track/        pure parsers (GPX, TCX, FIT, CSV, XML, .gz, .zip) and statistics engine (unit tested)
    internal/cache/        Cache interface: memory and Valkey/Redis backends (sessions)
    internal/auth/         password hashing, session tokens, identity-provider interface
    internal/server/       Fiber app, middleware, HTTP handlers
    web/static/            single-page UI (map, statistics, upload), embedded with go:embed
    deploy/                nginx, systemd, Kubernetes

## Import pipeline

1. The browser sends every chosen file as the raw request body of
   `POST /api/activities/upload?filename=…` (one request per file, with upload
   progress). `activities.csv` is sent first.
2. `track.Parse` detects the format from the content, not the extension:
   ZIP (`PK\x03\x04`), gzip (`1f 8b`), FIT (`.FIT` signature), XML (root
   `<gpx>` or `<TrainingCenterDatabase>`), otherwise CSV.
   - **FIT**: a small decoder for definition/data messages (little and big
     endian, compressed timestamps, developer fields, chained files). It reads
     `record` (position, altitude, heart rate, cadence, distance, speed,
     power, temperature), `session` totals and the sport.
   - **GPX / TCX**: `encoding/xml` with namespace-agnostic element names,
     including Garmin's TrackPointExtension / TPX extensions.
   - **CSV**: Strava's `activities.csv` (summary rows, repeated columns with
     different units are handled) or any table with lat/lon columns.
   - **ZIP**: every activity file is parsed; rows of `activities.csv` are
     matched with their files by file name, supplying Strava's name, sport and
     totals. Rows without a file become statistics-only activities.
3. `track.Compute` derives the statistics; `track.Simplify` (Douglas–Peucker
   with a growing tolerance) keeps ≤ 3000 points for the detail route and
   ≤ 250 points for the overview map.
4. `store.InsertActivity` de-duplicates within one transaction: the same
   source (SHA-256 of the file, or `csv:<activity id>`) is skipped; another
   activity starting within ±60 s is treated as the same activity, except that
   a statistics-only row is *upgraded* with the route of the newly uploaded file.

## Statistics

Per activity (`internal/track/stats.go`):

- distance: device distance when ≥ 90 % of the samples carry one, otherwise
  haversine between GPS fixes (jumps faster than 120 m/s are dropped);
- moving time: samples faster than 0.5 m/s; elapsed time: first to last sample;
- max speed: device speed, else the best ≥ 5 s window;
- elevation gain/loss with a 2.5 m hysteresis, min/max elevation;
- heart rate, cadence, power (avg/max), temperature, calories;
- start/finish coordinates and bounding box;
- splits per km and per mile (time, elevation change, heart rate) and an
  elevation profile of ≤ 400 points.

Totals reported by the file (FIT session, TCX laps, `activities.csv`) win
over computed values. Combined statistics are aggregated in the browser over
the current filter, so they update instantly while filtering.

## Data model

- `users`, `auth_identities`, `sessions` — as in eurofish
- `activities` — owner, name, sport, source format and file name, source hash
  (unique per user), start time, `has_track`, and four JSON documents:
  `stats` (compact summary, listed for every activity), `detail` (splits,
  profile), `track` (route) and `preview` (coarse route)

## Map

With `STRAVALL_GOOGLE_MAPS_KEY` the UI loads the Maps JavaScript API and draws
one polyline per activity (start/finish as polyline symbols), a highlighted
full-resolution route for the selected activity, and info windows on click.
The Content-Security-Policy allows exactly the Google Maps origins. Without a
key (or if the key is rejected) a canvas "pixel map" in Web Mercator draws the
same data with pan, zoom and click-to-select.

## Security

- bcrypt password hashes, opaque session tokens (only their SHA-256 is stored)
  in HttpOnly SameSite=Lax cookies
- State-changing requests must be JSON or carry `X-Requested-With`, which a
  cross-site form cannot send
- Uploads are limited (`STRAVALL_MAX_UPLOAD_MB`, 256 MB per decompressed file,
  100 000 archive entries); text from files is sanitised before storing
- Every query is scoped to the signed-in user

## HTTP API

All endpoints are JSON under `/api`. Errors are `{"error": "message"}`.

| Method | Path | Notes |
|---|---|---|
| GET | `/config` | `{signup_enabled, version, maps_key, max_upload_mb}` |
| POST | `/auth/signup`, `/auth/login`, `/auth/logout` | as in eurofish |
| GET | `/me` | current user |
| GET | `/activities?preview=1` | all activities with `stats` (and the coarse `preview` route) |
| POST | `/activities/upload?filename=` | raw file body → `{imported, updated, duplicates, failed, results[]}` |
| GET | `/activities/:id` | one activity with `stats`, `detail` and `track` |
| PATCH | `/activities/:id` | `{name, sport}` |
| DELETE | `/activities/:id` | delete one |
| POST | `/activities/delete` | `{ids: [...]}` or `{all: true}` |
| GET | `/healthz`, `/readyz` | liveness / readiness (outside `/api`) |
