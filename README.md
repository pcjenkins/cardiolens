# CardioLens

A small case-analytics app for cardiac surgery data, built on Next.js (App Router), React and SQLite. Everything in it is made up: the surgeons, the hospitals and the 256 cases. I built it to work through the App Router end to end on a realistic problem, not a to-do list.

It does four things. It logs you in. It shows clinical case data from a SQL database. It runs a simple trend model over bypass times and charts it. It keeps a record of the test run behind every release, which admins can view from inside the app.

## Running it

You need Node.js 22 or newer. That's it; no database server, no Visual Studio, no Python.

On Windows:

1. `setup.bat` once. It installs packages, creates the database and builds a release.
2. `start.bat` to run it. It opens http://localhost:3000.

Logins:

* `demo@cardiolens.test` / `Demo123!` (clinician)
* `admin@cardiolens.test` / `Admin123!` (admin; also sees the Admin menu)

Day to day I use `dev.bat` while editing, `release.bat` to cut a build and `start.bat` to run it. Don't re-run `setup.bat` to rebuild; it re-seeds the database and wipes whatever was in it.

On anything else, the same steps are `npm install`, `npm run seed`, `npm run build` and `npm start`.

With Docker, put `SESSION\_SECRET=<64 hex chars>` in a `.env` file and run `docker compose up --build`. The database lives on a named volume, so it survives rebuilds.

## Layout

If you know ASP.NET MVC, most of this maps directly:

|Here|MVC equivalent|
|-|-|
|`app/(app)/layout.tsx`|`\_Layout.cshtml` with `\[Authorize]` on it|
|`app/(app)/\*/page.tsx`|Controller action + view; the page loads its own data|
|`app/login/actions.ts`|`\[HttpPost]` actions (server actions)|
|`app/api/cases/route.ts`|Web API controller|
|`proxy.ts`|Middleware pipeline|
|`lib/queries.ts`|Repository; all the SQL is here|

Pages are server components by default. They query SQLite directly, and none of that code reaches the browser. Only three components run client-side: the login form, the chart and the procedure filter.

## Security

These were the decisions I cared most about.

* **Sessions** are a signed JWT in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production). Page scripts can't read it.
* **Auth is checked twice.** `proxy.ts` turns away anonymous requests early, but it is not the real gate. Every page, the API route and the admin pages re-verify the session, and admin pages also check the role. A clinician who types `/admin` gets a 404.
* **Passwords** are bcrypt hashes. A bad email and a bad password return the same message.
* **Input** is validated with zod on login. Filters are checked against an allow-list, and case IDs must be integers.
* **SQL** uses `?` placeholders only, never string building.
* **Redirects** after login only go to local paths. `//evil.com`, `https://...` and `/\\...` all fall back to the dashboard; the tests cover each one.

## The analytics

The dashboard plots weekly mean bypass time with a 4-week moving average and an ordinary least-squares trend line. The slope reads directly as minutes per week; R² tells you how much of the movement the trend explains (not much, on this data, which is honest).

Outliers are cases more than 2.5 standard deviations from the mean, judged within each procedure. A long valve repair and a long bypass graft aren't comparable, so pooling them would flag the wrong cases.

The model is plain TypeScript in `lib/analytics.ts`, with no database or React dependency. That is why it is easy to test.

## Tests and releases

Jest and React Testing Library, 18 tests:

* the analytics functions, including edge cases (a single point, identical values)
* the redirect guard, with every bypass I could think of
* the procedure filter component, with the Next.js router mocked

`npm run build` runs the test suite first (`prebuild`). If any test fails, the build never starts and the previous release stays in place. Each run writes its results and a coverage summary to `data/release/`, and **Admin → Release test results** displays them. The app reads those files; it never runs tests itself, because a web app shouldn't be able to start processes on its own server.

## Known gaps

* No end-to-end tests yet. Playwright against the running build is next.
* No tests for the server actions or the SQL layer; those need a throwaway database.
* The chart component isn't covered. Recharts needs a real browser to measure, so it belongs in the E2E suite.
* Role changes don't affect existing sessions until the user signs in again. That is acceptable for a demo; a real system would shorten session lifetimes or re-check roles server-side.
* SQLite comes from Node's built-in `node:sqlite` driver, which still prints an experimental warning on Node 22. Moving to SQL Server means swapping `lib/db.ts` for `mssql`; the queries are standard SQL apart from the date grouping.

## 

