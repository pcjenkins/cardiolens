# CardioLens

A hobby project I built to get hands-on with a full-stack JavaScript setup before an interview: Next.js and React on the front, a GraphQL API in the middle, and PostgreSQL underneath. I wanted a realistic problem rather than a to-do list, so it's a small analytics app for cardiac surgery perfusion data (the heart-lung machine readings recorded during bypass surgery).

Everything in it is made up: the hospitals, staff, patients, devices and data. Nothing here is medical advice or a real clinical tool.

## What it does

* Logs you in and shows a dashboard of bypass times, with a simple trend line and outlier cases.
* Shows each case's perfusion record as charts. Click a chart to zoom from one-minute averages down to the raw one-second readings.
* Tracks devices: where each machine is, its maintenance schedule, and whether its maintenance was current when it recorded a case.
* Answers a few report-style questions, such as "which cases used this disposable lot?"

## How it's put together

```
Browser ──► Next.js  ──GraphQL──►  Express + Apollo  ──SQL──►  PostgreSQL
```

* **Next.js** renders the pages on the server and handles login. It never talks to the database directly; it asks the API.
* **The API** (Express with Apollo Server) holds the business rules and checks permissions on every request.
* **PostgreSQL** holds the data, plus some of the logic that's easier to do next to the data: rolling raw readings up into minute, hour and day summaries, and finding stretches where a reading stayed below a target.

The pieces I spent the most time on:

* **Lots of small readings.** About 7 million one-second samples across 40 cases. Raw data goes into a table split by month, and summaries are kept up to date as data comes in, so charts read the summaries and only fall back to raw data when you zoom in.
* **Hierarchies.** Hospital › building › floor › room › device, with a history of where each device has been. The database itself prevents a device from being in two rooms at once.
* **The API boundary.** Logins, permission checks, and limits on how much a single GraphQL query can ask for.

There's an entity-relationship diagram of the database in [docs/ERD.md](docs/ERD.md).

## Running it (Mac)

You need **Node.js 22 or newer** and **PostgreSQL 16 or newer**. [Postgres.app](https://postgresapp.com) is the easiest way to get Postgres. Put its command-line tools on your PATH once:

```bash
sudo mkdir -p /etc/paths.d && echo /Applications/Postgres.app/Contents/Versions/latest/bin | sudo tee /etc/paths.d/postgresapp
```

Then, in a new terminal, from this folder:

```bash
psql -c "CREATE ROLE cardiolens LOGIN PASSWORD 'cardiolens';"
createdb -O cardiolens cardiolens

npm install          # installs the web app and the API
npm run db:reset     # creates the tables and generates the demo data (about 2 minutes)
npm run stack        # starts the API and the web app together
```

Open http://localhost:3000 and sign in with:

* `demo@cardiolens.test` / `Demo123!`
* `admin@cardiolens.test` / `Admin123!` (also sees the Admin page)

Other commands:

| Command | What it does |
| --- | --- |
| `npm run test:all` | Runs the API tests (against the database) and the web tests |
| `npm run build` then `npm run start:stack` | Production build (runs the tests first) and starts it |
| `npm run db:erd` | Regenerates the ERD from the database |

Windows users can use `setup.bat`, `dev.bat` and `start.bat`. There's also a `docker-compose.yml`, but I haven't run it yet; the steps above are the tested path.

## Where to look

| File | What's there |
| --- | --- |
| `api/db/schema.sql` | The tables |
| `api/db/functions.sql` | Data loading, summary rollups, "time below target" detection |
| `api/db/views.sql` | Case summaries and maintenance status |
| `api/src/schema.graphql` | The API contract |
| `api/src/resolvers.ts` | How each API field gets its data |
| `app/(app)/` | The pages |

## Tests

About 50 tests between the two halves. The API tests check the calculations and run against the real database inside transactions that get rolled back, so they don't change the demo data. The web tests use Jest and React Testing Library.

## Things I'd do next

* End-to-end browser tests (Playwright).
* Generate the TypeScript types from the GraphQL schema instead of writing them by hand.
* Use a real single sign-on provider instead of the built-in demo logins.
* Try the Docker setup end to end.
