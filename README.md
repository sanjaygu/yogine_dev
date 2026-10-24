# yogine_dev

The yogine.dev website. See [intent.md](intent.md) for what it must do and [BUILD_PLAN.md](BUILD_PLAN.md) for how it is being built.

## Layout

- `site/` — the new static site (Astro). Work happens here.
- `public_html/` — the current live site (single `index.html` plus PHP in `api/`). Kept untouched as the rollback copy until cutover.
- `design-system/yogine-dev/` — UI/UX Pro Max design system (`MASTER.md` holds the project decisions).

## Run the site locally

From `site/` (Node 22.23 or newer; Astro 7):

```
npm install
npm run dev            # http://localhost:4321, live reload
npm run build          # production build (live Stripe links) into site/dist
npm run build:staging  # staging build (test-mode Stripe links) into site/dist
npm run preview        # serve the built output
npm run dev:fixture    # dev server with sample future sessions, to see the "dates published" state
```

Courses and sessions live in `site/src/data/catalog.json`. A session disappears from the site once its end date has passed; with no sessions left, pages show the waitlist call to action instead.

## Forms, backend and analytics

- `site/public/api/` — PHP endpoints (`lead`, `register`, `waitlist`, `contact`, `stripe-webhook`). They need `config.secrets.php` on the server; copy `config.secrets.example.php`. Runtime data is written to `api/data/`.
- `apps-script/Code.gs` — the Google Apps Script that writes the Leads and Waitlist tabs.
- Analytics is off unless the site is built with `PUBLIC_POSTHOG_KEY` (and `PUBLIC_POSTHOG_HOST` for a non-US project). Without a key there is no banner and nothing is loaded. `PUBLIC_POSTHOG_DEBUG=1` turns on PostHog's console logging.

## Tests

From `site/`, with a PHP 8 executable available (`PHP_BIN`, or `php` on the path):

```
npm test               # builds the fixture site, then runs all 82 tests
```

They cover the PHP endpoints (file mode and against fake Resend and Apps Script servers), real browser journeys with accessibility audits, and consent and analytics behaviour against a stand-in for PostHog. See section 12 of BUILD_PLAN.md for what they prove and what they do not.
