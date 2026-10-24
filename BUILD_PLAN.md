# yogine.dev — Build Plan

Implements [intent.md](intent.md) (v4 and later). Last updated 2026-10-25.

Size key: S = under a day, M = 1–3 days, L = more than 3 days. These are rough and unvalidated.

## Status snapshot (2026-10-24)

The site and backend are built and tested locally (Phases 1 to 4, 62 automated tests passing). Nothing is deployed. The next real milestone is a staging site on Hostinger, which every remaining end-to-end check depends on.

| Phase | Status |
|---|---|
| 0. Prerequisites | Partly done: local tools checked, most third-party accounts created. Hostinger staging, repo cleanup and the privacy reviewer are open. |
| 1. Static site | Done locally |
| 2. Backend and email | Done locally, against stand-ins for Resend, Apps Script and Stripe |
| 3. Visitor flows | Done locally |
| 4. Analytics and consent | Done locally. PostHog is also confirmed working against the real project (banner, accept, events arriving). Funnels and some project settings remain. |
| 5. Solutions content and polish | Not started. Waiting on content. |
| 6. QA, review gate, cutover | Not started |

**Secrets in the template file (owner's decision).** `site/public/api/config.secrets.example.php` holds real values, and the owner has chosen to leave it as it is and keep them out of uploads. To make that reliable, every build now runs `scripts/strip-private.mjs`: it deletes `config.secrets.php` and the template from `dist/api/`, and **fails the build** if any built file contains a value from either secrets file or anything shaped like a Stripe webhook secret, a Resend key or an Apps Script URL (it never prints the value). Still true: the file is not ignored by git, sits in a OneDrive-synced folder, and its values appeared in a working session, so replacing the Resend key, the Stripe webhook secret and the sheet secret before first use is still recommended. The real values belong on Hostinger in `config.secrets.php`, and a copy in a password manager.

**Next steps, in order**
1. Hostinger: confirm the plan, create a staging address with HTTPS, set PHP to 8.1 or newer, back up the live site. (Postponed by the owner.)
2. Fill in test-mode payment links (`paymentLinkTest` in `catalog.json`), run `npm run build:staging`, upload `site/dist/`, and create `config.secrets.php` on the server.
3. Stripe: add the live Professional link; point the test webhook at the staging address.
4. Run the first real end-to-end test (`INTEGRATIONS.md`, section 8).
5. In parallel: PostHog funnels and settings, name the privacy reviewer, gather the Solutions content, replace the placeholder November dates with the real schedule.

## 1. Approach in one paragraph

Replace the single `public_html/index.html` with a pre-rendered static site (Astro), built on a developer machine and uploaded to Hostinger. Keep the PHP endpoints on Hostinger and extend them to handle leads, the waitlist and contact. Google Apps Script writes to two tabs (Leads, Waitlist) in the existing spreadsheet. Resend sends all visitor emails. Stripe Payment Links stay. PostHog (behind a consent banner) provides analytics and heatmaps. One catalog file (courses and sessions) feeds the site, the confirmation emails and the sheet.

## 2. Target architecture

```
Visitor browser
  ├─ static pages (Astro build output) ............ Hostinger public_html/
  ├─ forms ──► PHP endpoints (public_html/api/)
  │             ├─ lead.php      → Apps Script → "Leads" tab    + notify hello@
  │             ├─ register.php  → Resend (free sessions)       + notify hello@
  │             ├─ waitlist.php  → Apps Script → "Waitlist" tab + Resend (visitor) + notify hello@
  │             ├─ contact.php   → Resend (visitor) + notify hello@
  │             └─ stripe-webhook.php → Resend (visitor) + Apps Script (status = paid)
  ├─ payment ──► Stripe Payment Link (email pre-filled)
  └─ analytics ► PostHog Cloud (only after consent)
```

### Repository layout (proposed)

```
site/                     Astro source
  src/pages/              one file per route
  src/data/catalog.json   courses and sessions: the single source of truth
  src/components/ src/layouts/ src/styles/
  public/api/             PHP endpoints (copied into the build output)
  tests/                  end-to-end and PHP tests
intent.md  BUILD_PLAN.md  DEPLOY.md
```

The existing `public_html/` is kept untouched until cutover, as the rollback copy.

### Routes

| Route | Purpose |
|---|---|
| `/` | Two front doors (Training, Solutions), next sessions |
| `/training/` | Courses, agenda, FAQ |
| `/solutions/` | Solutions (existing content now; new content TBD) |
| `/sessions/` | Schedule, or the waitlist when empty |
| `/enroll/` | Course and session, details form, then payment or registration |
| `/waitlist/` | Waitlist form (also embedded where no session exists) |
| `/contact/` | Contact form |
| `/thanks/` | After payment or registration; reads `?type=` |
| `/refund-policy/`, `/privacy/` | Policies |

Legacy links keep working: `/#/…` and `/?registered=1` (used by Stripe after-payment redirects today) map to the new routes by a small script on the home page.

## 3. Key design decisions

1. **One catalog file.** `catalog.json` holds courses, prices, payment-link keys, sessions (id, dates, times, venue, format, capacity note). Astro reads it to render pages; the build copies a server-only version to `api/` for PHP, so `config.php` and `index.html` no longer drift.
2. **Secrets stay on the server.** Move secrets out of `config.php` into a server-only `config.secrets.php` that deploys never overwrite. The deploy package contains no secrets.
3. **Past sessions.** Static pages freeze "upcoming" at build time, so the client also hides past sessions and swaps in the waitlist once none remain; sessions are also removed from `catalog.json` and the site rebuilt when the schedule changes.
4. **Lead identity.** Each details-form submit gets a lead ID. It is sent to Stripe as part of `client_reference_id` (for example `professional_e1_L8f3k2`; allowed characters and length to be checked) so the webhook can mark that lead paid. The webhook's current `explode('_', $ref, 2)` parsing must change accordingly.
5. **No secrets in the browser.** The Apps Script URL moves from the page into PHP, and PHP calls it with a shared secret. Today the URL is exposed in the page ([index.html:538](public_html/index.html#L538)).
6. **Shared PHP helpers.** `respond`, `clean`, `csv_safe`, `rate_limited` currently live in `register.php`; move them into `lib.php` so the new endpoints reuse them. Same abuse guards on every endpoint: same-site check, honeypot, per-visitor and global hourly limits.

## 4. Data contracts

### Sheet tabs (same spreadsheet)

| Tab | Columns |
|---|---|
| Leads | lead_id, timestamp, name, email, phone, course, session, status (`lead` → `payment_started` → `paid` / `registered`), source, landing_page, device, country, ph_visitor_id, notes (manual) |
| Waitlist | timestamp, email, phone, name, courses_of_interest, note, page, source, ph_visitor_id, notified (manual) |

### Endpoints (JSON in, JSON out `{ok, error?}`)

| Endpoint | Required | Behavior |
|---|---|---|
| `lead.php` | name, email, course, session; phone optional | Create lead, return `lead_id`; later call with `lead_id` and status `payment_started` |
| `register.php` | as today plus `lead_id` | Free registration; email visitor; set lead status to `registered` |
| `waitlist.php` | email or phone (at least one), courses | Row to Waitlist tab; notify hello@; confirmation email if email given |
| `contact.php` | name, message, email or phone, interest | Notify hello@; confirmation email if email given |
| `stripe-webhook.php` | Stripe signature | Email visitor as today; set lead status to `paid` |

Source details (referrer, campaign tags, landing page, device, country) are captured on the page and sent with each submit.

## 5. Phases

### Phase 0 — Prerequisites and decisions (S)

Status as of 2026-10-24. Backend language decided: **PHP stays** (section 9).

**Local tools (done)**
- [x] Found: Python 3.14.2, Node v25.7.0, npm 11.10.1, git 2.49.0, winget. The build and all tests run on Node 25.7.0, so an LTS Node is not required (22 or 24 are also supported by Hostinger).
- [x] PHP: not installed on the machine. The tests use a portable PHP 8.2.35 (checksum-verified official Windows build) kept outside the project; set `PHP_BIN` to run them. Nothing was installed system-wide.
- [x] Repository reviewed. The new site is in `site/`; `public_html/` is untouched and stays as the rollback copy.

**Third-party accounts (see `INTEGRATIONS.md`)**
- [x] **Stripe:** payment links created and the after-payment redirect set; a test-mode webhook destination exists and its signing secret was obtained. Still to do: add the Professional link to `catalog.json` (it is empty there), and change the destination's URL to the staging address once it exists.
- [x] **Resend:** domain set up and an API key created. Not confirmed: that the domain shows as verified and that the key passes the test in `INTEGRATIONS.md` section 5.
- [x] **Google Sheet and Apps Script:** deployed as a web app and tested from the command line (the Waitlist tab was written to).
- [x] **PostHog:** project created, project key obtained, a local build with the key shows the banner, and events arrive in the project after Accept. Not yet done: confirm recordings and heatmaps are switched on, add authorized domains, build the funnels.
- [ ] **Hostinger:** nothing done yet. Needed: the plan name, a staging address with HTTPS, PHP 8.1 or newer with `curl` and `mbstring`, and a backup of the live site and `api/`.

**Decisions and owners**
- [ ] Name who reviews the consent banner, privacy notice and lead follow-up wording. It blocks launch, not development.
- [ ] Decide when to commit. Nothing has been committed; changes are untracked or modified, plus the staged removal of `public_html/api/config.php`.

**Repository housekeeping (need your go-ahead)**
- [x] The root ignore file `gitignore` (no leading dot) was not being used by git. A copy named `.gitignore` now exists; the original is left in place.
- [x] `public_html/api/config.php` was tracked although listed as ignored. It is no longer tracked (`git rm --cached`; the file is still on disk). This is staged in git's index and not committed.
- [x] `site/` has its own `.gitignore` (build folders, `.env`, real `config.secrets.php`, runtime data), and the new `api/.htaccess` blocks `.json`, `.csv`, `.log`, `.txt`, `.jsonl` and the secrets files.
- [x] `site/public/api/config.secrets.example.php` is left as the owner wishes; builds strip it and scan for secrets (see the snapshot above).

**Exit:** staging reachable; Stripe test webhook pointing at it; owners named; the secrets issue closed.

### Phase 1 — Static site foundation (L)

Status: **built and tested locally (2026-10-23).** Staging deploy is deferred; the plan is to build and test locally first, then move to Hostinger.

- [x] **UI/UX Pro Max design system first**: generated and persisted to `design-system/yogine-dev/MASTER.md`; project decisions (what was kept and what was not adopted) are recorded at the top of that file. Page override files were not needed; no page departs from the master.
- [x] Astro 7 project in `site/`; layout, header, footer, skip link, per-page title, description and canonical URL. A preview image (`og:image`) is not done; it moves to Phase 5.
- [x] Design tokens carried over from the current look, with the UX-review fixes: error-text and field-border contrast raised (measured, see `MASTER.md`), 13px minimum text, responsive heading sizes, 44px tap targets, SVG menu icon, `color-scheme: dark`, scroll padding for the sticky header, complete reduced-motion handling.
- [x] `site/src/data/catalog.json` with the four courses and five sessions; `catalog.fixture.json` supplies future sample sessions (`npm run dev:fixture`).
- [x] Pages: Home, Training, Solutions (existing content), Sessions, Refund policy, Privacy, Thanks, 404, plus placeholder pages for Enroll, Waitlist and Contact that say they are not connected until Phase 3. Training fixes done: "next session" is separate from the heading, repeated "Reserve a seat" links carry the course name for screen readers, Foundation is the primary course action.
- [x] Legacy hash-URL and `?registered=1` redirects.
- [x] Fonts self-hosted (moved here from Phase 5); the built site makes no third-party requests.
- [x] Sitemap and `robots.txt`.
- [ ] Deploy to staging by a documented command: deferred until local testing is finished.

**Exit (local):** met. Results are in section 11.

### Phase 2 — Backend and email (L)

Status: **built and tested locally (2026-10-24).** Real Resend, Google Apps Script and Stripe were not touched; see section 12.

- [x] Shared helpers moved from `register.php` into `site/public/api/lib.php` (request guards, rate limits, CSV storage, Sheet and email senders). Every endpoint uses them.
- [x] Secrets split out: `config.php` holds no secrets; `config.secrets.php` is created on the server only (template: `config.secrets.example.php`), ignored by git and never uploaded by a deploy. Courses and sessions come from `catalog.json`, the same file the site is built from (`npm run sync` copies it into the API folder on every build).
- [x] Endpoints: `lead.php` (create, `payment_started`, optional profile), `register.php` (free sessions, marks the lead registered), `waitlist.php`, `contact.php`, and `stripe-webhook.php` (reads `course_session_lead` from `client_reference_id`, marks the lead paid).
- [x] `apps-script/Code.gs` writes the Leads and Waitlist tabs (creates tabs and columns, updates a lead by id, rejects calls without the shared secret). Syntax checked only; it cannot be run outside Google.
- [x] Emails: waitlist and contact confirmations (no promised call or timing; none for phone-only), team notices to hello@yogine.dev with replies going to the visitor.
- [x] Runtime data (`leads.csv`, `waitlist.csv`, `contacts.csv`, `registrations.csv`, logs) lives in `api/data/`, which writes its own deny-all `.htaccess`; `api/.htaccess` also blocks `.json`, `.csv`, `.log`, `.txt`, `.jsonl` and the secrets files.
- [x] Failure policy: a lead is never lost or blocked by a Sheet or email problem; a waitlist entry fails only if every route failed; a free registration fails loudly if its confirmation email cannot be sent, so the visitor can retry.

**Exit:** met locally. 28 file-mode tests and 4 live-mode tests pass.

### Phase 3 — Visitor flows (L)

Status: **built and tested locally (2026-10-24).**

- [x] **Enroll** (`/enroll/`): course, session, then name, email and optional phone in one short form. Free: lead, then registration, then `/thanks/?type=free`. Paid: lead, `payment_started`, then Stripe with the lead id in `client_reference_id` and the email pre-filled. A course with no dates, or a paid course with no payment link, shows the waitlist in place of the form. The in-progress form survives a refresh (browser session storage only) and a Back from Stripe.
- [x] **Optional questions** (experience, expectations) on `/thanks/`, saved to the lead.
- [x] **Waitlist** (`/waitlist/`, also embedded in Enroll): course checkboxes, email and/or phone, optional name and note.
- [x] **Contact** (`/contact/`): interest (from the link), email and/or phone, message; company and team size appear only for organisation enquiries. All `mailto:` call-to-action links on the site now go to it.
- [x] Real `<form method="post">` elements with labels, inline errors tied to fields, a focused error summary, busy and failure states, and the fallback address. Submit buttons stay disabled until the form's script is ready, and the forms say how to reach us if JavaScript is off.

**Exit:** met locally. 21 browser tests pass, and every page and state passes axe.

### Phase 4 — Analytics and consent (M)

Status: **built and tested locally (2026-10-24)** against a stand-in for PostHog. A local build with the real project key was then checked by hand: the banner appears and events arrive in the PostHog project after Accept.

- [x] Consent banner: nothing is loaded, stored or sent before the visitor chooses; Accept and Decline are visually identical; the choice is remembered and can be changed from "Analytics choices" in the footer. Declining after accepting stops capture and removes the stored first-touch details.
- [x] PostHog (`posthog-js`) loads only after Accept, with form fields masked in recordings, heatmaps on, anonymous visitors kept out of person profiles until identified, Do Not Track respected, surveys off. With no `PUBLIC_POSTHOG_KEY` at build time, analytics and the banner are absent (local work).
- [x] Events: page views, `cta_click`, `form_started`, `form_error`, `course_selected`, `session_selected`, `details_submitted`, `payment_started`, `registered`, `registration_confirmed`, `waitlist_joined`, `contact_submitted`.
- [x] A visitor is identified by lower-cased email as soon as they give one in a form; PostHog merges their earlier anonymous visits. The anonymous visitor id is sent with each form and appears in the Leads and Waitlist records and the team emails.
- [x] First-touch details (landing page, referrer, campaign tags) are kept only after Accept.
- [x] Privacy notice rewritten as a **draft** for what the site now does (fonts and QR statements removed; PostHog, Google Sheets, Hostinger, Resend and Stripe listed; form-level source details and analytics described). It needs review before launch.
- [ ] In the PostHog project: confirm session recordings and heatmaps are switched on, add `https://yogine.dev`, the staging address and (for local checks) `http://localhost:4321` as authorized domains, filter out your own visits, and build the four funnels in `INTEGRATIONS.md` section 7. Funnels can only use events PostHog has already seen. Identification by email can only be checked on staging, because it needs the backend.

**Exit:** met locally. 9 analytics tests pass.

### Phase 5 — Solutions content and polish (M, depends on content)

Status: the polish that needs no content is done (2026-10-25). Content-dependent items remain.

- [ ] Replace the placeholder Solutions content with the new material when supplied.
- [ ] Add credibility content as available (about, delivery team, outcomes, sample governance artifact).
- [ ] **Replace the placeholder November sessions** (`n1` to `n5` in `catalog.json`: Nov 10, 14, 17/19/24, 21 and 24, 2026) with the real schedule, and add in-person start times.
- [x] Link-preview image (`public/og-image.png`, 1200 by 630) with matching `og:` and Twitter tags.
- [x] Course comparison table on the Training page; on a phone it becomes stacked cards with no sideways scrolling.
- [x] "Add to calendar" links (one `.ics` file per single-day session, generated at build time) and map links for in-person venues. A run of separate dates has no calendar link.
- [x] Test and live payment links kept side by side (`paymentLink`, `paymentLinkTest`); `npm run build:staging` uses the test links, `npm run build` the live ones, and an empty link means the waitlist.
- [x] Self-hosted fonts and removal of the payment QR image were done in Phase 1 and Phase 3.

**Exit:** content signed off by you.

### Phase 6 — QA, review gate, cutover (M)

Done earlier: end-to-end tests with PHP and axe audits (section 12). They used stand-ins for the real services.

- [ ] First real end-to-end test on staging with test-mode Stripe, real Resend and the real Sheet (`INTEGRATIONS.md` section 8).
- [ ] Confirm the private files are blocked on the real server (`.htaccess` was not covered by the local tests).
- [ ] Lighthouse on mobile, a manual keyboard and screen-reader pass, and a check on at least one real phone and a second browser.
- [ ] **Gate:** privacy and consent review complete.
- [ ] Live-mode Stripe destination and links, live secrets on the production server, and a production build with the live payment links. One small real payment, then a refund.
- [ ] Cutover by uploading the build to `public_html`, keeping the old `index.html` as a one-step rollback; purge Hostinger's cache and CDN; test the rollback once.
- [ ] Update Stripe after-payment redirect URLs to `/thanks/`; submit the sitemap.
- [ ] Post-launch week: watch webhook deliveries, Resend logs, sheet rows and PostHog events daily.

**Exit:** live; rollback tested once.

## 6. Requirement coverage

(Section 8 covers the UI/UX Pro Max process; section 9 covers the PHP versus Python decision.)

| Intent | Phase |
|---|---|
| Two audiences and offerings (2) | 1, 5 |
| Enroll with leads before payment (3.1, 3.6) | 2, 3 |
| Waitlist (3.2) | 2, 3 |
| Contact (3.3) | 2, 3 |
| Confirmation emails (3.4) | 2 |
| Analytics, heatmaps, identification (3.5) | 4 |
| Manual follow-up and sheet ownership (3.7) | none (process; document in `DEPLOY.md`) |
| Experience principles (4) | 1, 5, 6 |

## 7. Risks and unverified assumptions

- **Secrets handling:** real values were placed in a template file in a synced folder (open issue above). Treat them as exposed and replace them.
- **PostHog:** free-tier limits, replay masking in the cloud, and the exact settings for recordings and heatmaps are not verified. Events are confirmed arriving. Ad blockers will block some visitors, so counts will be low, and visitors who decline are mostly invisible.
- **Stripe:** `client_reference_id` with the lead ID appended is untested against real Stripe; the first test payment confirms it. Whether the buyer's name reaches the confirmation email is also unconfirmed.
- **Apps Script:** the web app answers a real call from the command line. It has not yet been called by the PHP backend; the first staging test covers that, including the redirect handling.
- **Hostinger:** plan, staging subdomain support, PHP version and `.htaccess` behaviour are unknown or untested.
- **Past sessions:** all existing sessions have ended, so every page shows the waitlist until new dates are added. The site must be rebuilt and re-uploaded to add dates.
- **Test and live payment links:** `catalog.json` holds one link per course. Staging needs test links and production live ones, swapped by hand before each build.
- **Privacy review** may change banner, notice or follow-up wording late in the plan.
- **Account context:** this project's files sit in a Gap OneDrive folder and the Claude Code session runs under a Gap work account. The project is described as personal; whether that is acceptable is a Gap policy question for you.

## 8. UI/UX process: UI/UX Pro Max is mandatory for every UI task

The project skill is in `.claude/skills/ui-ux-pro-max`. Its scripts need Python 3 (present here). Every phase that touches UI uses it as follows:

1. **Phase 1, once:** run the design-system search for this product (for example "AI coding training and enterprise SaaS, developer audience, dark editorial") and persist it with `--persist` to `design-system/yogine-dev/MASTER.md`. Use the density, variance and motion dials deliberately (marketing pages: spacious, low motion). Check the result against the current brand direction before accepting it; the skill's output is a recommendation, not an instruction.
2. **Per page:** create a page override in `design-system/yogine-dev/pages/` for Home, Training, Solutions, Sessions, Enroll, Waitlist, Contact and Thanks. Build each page by reading `MASTER.md`, then the page file if present.
3. **Targeted searches** with `--domain ux` for forms (error summary, inline validation, focus management, accessible authentication-style autofill), navigation, loading and consent banner; `--domain color` and `typography` to confirm the palette and type scale; `--stack astro` for implementation.
4. **Review gate on every UI phase (1, 3, 4, 5):** walk the skill's Quick Reference sections 1–3 (accessibility, touch and interaction, performance), then 5 (layout) and 8 (forms). Findings are fixed before the phase's exit criteria are met.
5. **Skill scope:** its "App UI" checklists (safe areas, haptics, bottom nav) do not apply to this website; use only the web-relevant checks.
6. If the skill returns nothing relevant after one retry, record that and fall back to general WCAG 2.2 guidance, labelled as such.

## 9. Backend language: PHP versus Python

**Decision (2026-10-23): keep PHP.**

**Finding (from Hostinger's own support pages, not yet confirmed for your plan):** Hostinger lists Python, Django and Flask as supported on **VPS only**, because they need root access. Shared and Business web hosting runs PHP; Node.js apps are supported on Business and Cloud plans through hPanel. Astro static output works on any plan with hPanel. I have not checked which Hostinger plan you are on.

| Option | What it takes | Verdict |
|---|---|---|
| **Keep PHP** | Nothing new on the host; existing `register.php` and `stripe-webhook.php` are reused and extended | **Recommended** |
| **Python on a Hostinger VPS** | Move to a VPS; install and secure Python, a web server and TLS; process management; OS updates; rewrite the endpoints; rework the static-site hosting | Only if you want a server you control; adds ongoing operations work |
| **Python elsewhere** (a separate serverless or app host) with the static site on Hostinger | A second vendor, CORS between domains, secrets in a second place | Possible, but more moving parts than PHP |
| **Python for tooling only** | Build-time scripts, the design-system scripts, test helpers | Fine and no hosting change |

If Python is required, the rewrite covers five small endpoints (lead, register, waitlist, contact, Stripe webhook) plus the shared helpers; the logic is not complex, but a VPS is a separate decision about cost and upkeep.

## 10. Not in the first release

User accounts, automated follow-up and waitlist notifications, a blog or CMS, multi-language, and self-serve Solutions purchase (see `intent.md` section 5).

## 11. Phase 1 test results (2026-10-23, local)

Run with Node v25.7.0 and Astro 7. Headless Chrome drove the checks; an automated axe-core audit covered accessibility. Results are from one run on one machine, not a full test of every browser or device.

| Check | Result |
|---|---|
| Build | 11 pages, about 1.2 s, output about 475 KB |
| All routes (and 404 for an unknown path) | Correct status codes |
| Horizontal overflow at 390 px and 1280 px | None |
| Buttons and link-buttons under 44 px tall | None |
| axe-core (WCAG 2.0, 2.1, 2.2 AA and best practice rules) on all 10 pages | No violations after one fix (a heading-order issue on Sessions) |
| One `h1` per page, canonical URL correct, images have alt text | Pass on all 10 pages |
| Skip link is the first Tab stop | Pass |
| Mobile menu: hidden by default, opens, Escape closes and returns focus to the toggle | Pass |
| Legacy links `/#/registered`, `/#/events`, `/?registered=1`, `/#/signup?course=…` | Redirect correctly |
| Sessions with future dates (fixture build): 3 shown, event structured data present | Pass |
| Same page with the date faked to after the sessions: rows hide, waitlist call to action shows | Pass |
| Third-party requests, secrets or payment links in the built pages | None found (the privacy notice text names services, as written) |

Not tested: real screen readers, Safari, Firefox, Lighthouse scores, a physical phone, or any form (forms arrive in Phase 3).

Findings to carry forward:
- **All five existing sessions ended on or before Oct 20, 2026**, so the real build shows the "no sessions" state everywhere. Add new sessions to `catalog.json` to see the published state.
- **The privacy notice was ported unchanged.** It still says fonts come from Google, mentions the payment QR code, and describes saving details at "Your details". Those statements are now out of date; update them in Phase 4 with the privacy reviewer.
- **In-person sessions have no start time** in the data, so none is shown.
- **The Professional payment link is still empty** (`paymentLink` in `catalog.json`).

## 12. Phase 2–4 test results (2026-10-24, local)

82 automated tests (62 from Phases 2 to 4 plus 20 from the Phase 5 polish and the build safety net), all passing, run from `site/` with `npm test` (it builds the fixture site first; set `PHP_BIN` to a PHP 8.2 executable). One machine: PHP 8.2.35 (official Windows build), Node v25.7.0, headless Chrome and axe-core.

| Area | Tests | What they prove |
|---|---|---|
| `api.test.mjs` | 28 | Each endpoint validates input and records to the Sheet outbox, the team email and local files; leads are reused within a day; honeypots, same-site checks, rate limits and formula neutralisation work; the Stripe webhook verifies signatures, emails the right course and date, marks the lead paid, and ignores retries |
| `live.test.mjs` | 4 | Real HTTP to fake Resend and Apps Script servers: the Resend key and the Sheet secret are sent, Apps Script's redirect is followed, a Sheet failure never blocks a lead, and a failed confirmation email fails registration so it can be retried |
| `e2e.test.mjs` | 21 | Waitlist, contact and enroll journeys in a real browser (free, paid to Stripe, waitlist fallback, refresh); forms are inert without JavaScript; no script errors; axe finds no WCAG 2.2 AA or best-practice violations on every page, with errors showing, on the thank-you questions and at 390 px |
| `analytics.test.mjs` | 9 | Before consent: banner shown, nothing stored, nothing sent. Declined: remembered, nothing sent. Accepted: page views and clicks sent, first touch stored, a contact submission identifies the visitor by email and carries the merged visitor id into the team email. Declining again stops capture |

Not tested, and what that means:
- **Real services.** Resend, Google Apps Script, Stripe and PostHog were all stood in. The Apps Script was only syntax-checked. The first real run needs the steps in section 13.
- **Browsers beyond Chrome**, real screen readers, a physical phone, Lighthouse.
- **PostHog in the cloud**: free-tier limits, heatmap and recording settings (these must be switched on in the PostHog project), and event volume.
- **Hostinger specifics**: `.htaccess` rules, PHP version, file permissions for `api/data/`. The tests used PHP's built-in server, which ignores `.htaccess`.

Findings fixed along the way:
- Clicking Submit before the page's script had loaded submitted the form natively and reloaded the page. Submit buttons are now disabled until ready, and forms use POST so details can never land in the address bar.
- Astro's HTML compression dropped the space before inline links ("See our<a>"); compression is off.
- PostHog discards events from bot-like browsers. That is correct in production; the tests present a normal browser identity.

## 13. Setup status and what is left (2026-10-24)

| Service | Done | Left |
|---|---|---|
| **Stripe** | Payment links, redirect, test webhook destination and secret | Professional link into `catalog.json`; point the destination at staging; later the live equivalents |
| **Resend** | Domain and key created | Confirm the domain is verified; test the key; replace the key (it was exposed) |
| **Google Sheet / Apps Script** | Deployed and tested from the command line | Replace the sheet secret (it was exposed); first call from the PHP backend |
| **PostHog** | Project, key, local build working, events arriving | Recordings, heatmaps, authorized domains, funnels |
| **Hostinger** | Nothing | Everything in `INTEGRATIONS.md` section 3 |
| **Privacy review** | Draft notice and banner wording written | Owner named; review done |

Full step-by-step instructions for every service are in `INTEGRATIONS.md`.

## 14. Phase 5 polish: results (2026-10-25, local)

**New tests (20, all passing):** `catalog.test.mjs` (9) covers live and test payment links and the November placeholder sessions; `strip.test.mjs` (7) covers the build safety net; four more browser tests cover calendar and map links, the `.ics` files, the comparison table (including its phone layout) and the link-preview image. The `npm test` total is 82. The suite runs one file at a time (`--test-concurrency=1`) and takes about 90 seconds. Running the browser-based files in parallel on one machine caused timing failures that did not happen when the files ran singly, so parallel runs are not used.

**Build safety net.** `npm run build` ends by deleting `config.secrets.php` and `config.secrets.example.php` from `dist/api/` and failing if any built file contains a value from either secrets file or anything shaped like a Stripe webhook secret, a Resend key or an Apps Script URL. Checked against the real example file (which holds real values): the file was removed and the build passed. A planted fake secret made it fail with exit code 1 and without printing the value.

**Test and live payment links.** `npm run build:staging` uses `paymentLinkTest`; `npm run build` uses `paymentLink`. `dist/api/catalog.json` records `"stripeMode"`. Until test links are filled in, a staging build shows the waitlist for paid courses.

**Lighthouse** (Lighthouse run through `npx`, headless Chrome, local production build, one run per page, so scores vary a little between runs):

| Page | Device | Performance | Accessibility | Best practices | SEO | Largest paint | Layout shift |
|---|---|---|---|---|---|---|---|
| Home | Phone | 100 | 100 | 100 | 100 | 1.5 s | 0 |
| Training | Phone | 100 | 100 | 100 | 100 | 1.1 s | 0.03 |
| Sessions | Phone | 98 | 100 | 100 | 100 | 1.8 s | 0 |
| Enroll | Phone | 98 (was 81) | 100 | 100 | 100 | 2.0 s | 0 (was 0.37) |
| Contact | Phone | 98 | 100 | 100 | 100 | 2.0 s | 0 |
| Home | Desktop | 100 | 100 | 100 | 100 | 0.5 s | 0 |
| Training | Desktop | 100 | 100 | 100 | 100 | 0.6 s | 0.03 |

The enroll page first scored 81 because the footer jumped when the script filled in the form. Reserving a screen of height on pages filled in by script (`.tall-page`, also used on the thank-you page) fixed it. Total transfer is 127 to 180 KB per page. This is a fast local server, not Hostinger, so real-world timing will differ.

**Not covered:** the live Hostinger site, a real phone, other browsers, and screen readers.

**Placeholder data to replace before launch:** the five November sessions (`n1` to `n5`), the empty live Professional payment link, and the empty test links.
