# yogine.dev — Third-party setup and integration guide

For whoever is setting up the accounts behind the site. Covers Stripe, Resend, Google Sheets with Apps Script, PostHog and Hostinger, and how they connect. Written 2026-10-24 against the site in `site/`.

Menu names in these services change often. Where this guide gives a path, treat it as a guide and match the names loosely. Anything not checked against the live service is marked **(unverified)**.

## 1. How it fits together

```
Visitor ──► static pages (Hostinger)
   │
   ├─ forms ──► PHP endpoints on Hostinger (site/public/api/)
   │              ├─ lead.php, waitlist.php ─► Google Apps Script ─► Leads / Waitlist tabs
   │              ├─ every endpoint ─────────► Resend ─► emails (visitor, and hello@yogine.dev)
   │              └─ stripe-webhook.php ◄───── Stripe (after a payment)
   │
   ├─ paid courses ──► Stripe Payment Link (card entry happens on Stripe, never on our site)
   └─ analytics (only after the visitor accepts) ──► PostHog
```

| Service | What it does for us | What we need from it | Where it goes |
|---|---|---|---|
| **Stripe** | Takes payment; tells our server when someone has paid | Payment link URLs; webhook signing secret (`whsec_…`) | Links in `catalog.json`; secret in `config.secrets.php` |
| **Resend** | Sends every email from hello@yogine.dev | Verified domain; API key (`re_…`) | `config.secrets.php` |
| **Google Sheets + Apps Script** | Stores leads and waitlist entries | Web app URL (`…/exec`); a shared secret we invent | `config.secrets.php`; the secret also in Apps Script |
| **PostHog** | Analytics, heatmaps, recordings | Project key (`phc_…`); host (US or EU) | Build-time setting, not on the server |
| **Hostinger** | Hosts the site and PHP | Staging address; PHP 8.1+; File Manager access | Where everything above is uploaded |

## 2. Secrets: the rules

| Value | Secret? | Lives in |
|---|---|---|
| Stripe webhook signing secret | **Yes** | `config.secrets.php` on the server only |
| Resend API key | **Yes** | `config.secrets.php` on the server only |
| Sheet URL and Sheet shared secret | **Yes** | `config.secrets.php`; the shared secret also as `SHEET_SECRET` in Apps Script |
| `rate_salt` | Yes (any long random string) | `config.secrets.php` |
| Stripe payment link URLs | No (public) | `site/src/data/catalog.json` |
| PostHog project key | No (public by design) | Build setting `PUBLIC_POSTHOG_KEY` |

- `config.secrets.php` is created **on the server**, by copying `config.secrets.example.php` and filling it in. It is ignored by git and never part of an upload.
- **Never** put a real secret in `config.secrets.example.php`, in `catalog.json`, in the website code, or in a chat or email. The example file is committed and is copied into every build.
- Keep real values in a password manager. Resend shows a key only once; Stripe lets you reveal the webhook secret again.
- If a secret is exposed, replace it: Stripe (roll the destination's signing secret), Resend (create a new key, delete the old), Apps Script (change `SHEET_SECRET` and `sheet_secret` together).
- Test mode and live mode use **separate** Stripe links and webhook secrets. Staging uses test values; production uses live values.

`config.secrets.php`, filled in (values are placeholders):

```php
<?php
return [
    'stripe_webhook_secret' => 'whsec_…',
    'resend_api_key'        => 're_…',
    'sheet_url'             => 'https://script.google.com/macros/s/…/exec',
    'sheet_secret'          => 'a long random string',
    'rate_salt'             => 'another long random string',
];
```

A quick way to make a random string in PowerShell: `-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 40 | % {[char]$_})`

## 3. Hostinger

**Needed first**, because Stripe cannot call your computer and a real end-to-end test needs a public address.

1. Confirm the plan (Premium, Business or Cloud). Static files and PHP run on all of them. Python does not run on shared plans (VPS only), which is why the backend is PHP.
2. In hPanel, create a **staging address**, for example `staging.yogine.dev` **(unverified: how the plan handles subdomains)**. Turn on HTTPS for it.
3. Under **PHP Configuration**, choose PHP 8.1 or newer and make sure the `curl` and `mbstring` extensions are on.
4. **Back up** the live site and `api/` folder from File Manager before changing production.
5. Build the site on your computer, from `site/`:
   - **Staging:** `npm run build:staging`. It uses the **test-mode** Stripe links (see 4.1).
   - **Production:** `npm run build`. It uses the **live** links.

   Upload the **contents of `site/dist/`** into the staging address's folder in File Manager. This includes the `api/` folder. Every build removes `config.secrets.php` and `config.secrets.example.php` from `dist/` and **stops with an error** if any built file contains a secret (a value from either secrets file, a `whsec_…` secret, a Resend key or an Apps Script URL). It never prints the secret, only which file matched.
6. In `api/` on the server, create `config.secrets.php` with the contents shown in section 2. The template is deliberately left out of builds; its source is `site/public/api/config.secrets.example.php`.
7. Make sure PHP can write to `api/` so it can create `api/data/`. The code creates that folder and its own deny-all `.htaccess`.
8. Make sure **hello@yogine.dev actually receives mail**. Team notices and copies go there. If you already have a mailbox on Hostinger, Resend's DNS records do not interfere with it.

**Check that private files are blocked.** Each of these should be refused or "not found", never show contents:
- `/api/config.secrets.php` and `/api/config.secrets.example.php`
- `/api/catalog.json`
- `/api/data/leads.csv` and `/api/data/`

PHP's own test server ignores `.htaccess`, so this has **not** been tested yet. Do it on staging.

**Redeploying:** upload a fresh `dist/` over the old one, but do not delete `api/config.secrets.php` or `api/data/`. A normal upload that only replaces files is safe.

**Production later:** the same steps against the real domain. The old `public_html/index.html` stays as the rollback copy until cutover.

## 4. Stripe

### 4.1 Payment Links (done)
- One link per paid course, kept in `site/src/data/catalog.json` as `paymentLink` (`advanced` has one; `professional` needs yours).
- A link's price cannot be edited. To change a price, create a new link, put its URL in `catalog.json`, and deactivate the old one.
- On each link, set **After payment → redirect to your website** with `https://yogine.dev/thanks/` (use the staging address while testing).
- The site sends `client_reference_id` (`course_session_lead`, for example `advanced_t4_LABCDEFGHJK`) and `prefilled_email` to the link. Payment Links accept both.
- **Test and live links are kept side by side.** In `site/src/data/catalog.json` each paid course has `paymentLink` (live) and `paymentLinkTest` (test mode, empty until you fill it in). `npm run build:staging` uses the test links; `npm run build` uses the live ones. The other link never reaches the built files. A course with no link for the chosen mode shows the waitlist instead of the payment form.
- **Check before uploading.** `dist/api/catalog.json` has a `"stripeMode"` line that says `test` or `live`. A production upload should say `live`.

### 4.2 Webhook (sends the confirmation email, marks the lead paid)
1. Switch to **test mode**.
2. Open **Workbench** and its **Webhooks** tab (or go to `https://dashboard.stripe.com/test/webhooks`). Click **Create an event destination**.
3. Events from **your account**; payload style **snapshot** (not thin).
4. Select exactly: `checkout.session.completed` and `checkout.session.async_payment_succeeded`.
5. Destination type **Webhook endpoint**; URL `https://<staging address>/api/stripe-webhook.php`. It must be public.
6. Create it, open it, and reveal the **signing secret** (`whsec_…`). Put it in the staging `config.secrets.php`.
7. If you can't see a Webhooks tab, your login may lack developer permissions. Ask the account owner for the Developer or Administrator role.

What the endpoint does: verifies the signature, ignores unpaid or other events, sends the buyer a confirmation (course, date, location, what to bring) with a copy to hello@yogine.dev, marks the lead `paid` with the amount, and ignores Stripe's retries of an event it already handled.

### 4.3 Stripe's own receipts
**Settings → Customer emails → Successful payments** on. Receipts are **not sent in test mode**; you will see the first real one with your first live payment, which you can refund.

### 4.4 Test a payment
1. Open the staging site, choose Advanced, fill the form, continue to Stripe.
2. Pay with card `4242 4242 4242 4242`, any future date, any CVC.
3. You land on `/thanks/`.
4. In Stripe, open the destination's recent deliveries: expect **200** with body `OK`.
5. Check: confirmation email received with the right course and date; the Leads row moved from `lead` through `payment_started` to `paid`; copy at hello@yogine.dev.
6. Check the buyer's **name** in the email greeting. If Stripe doesn't send a name, the greeting reads "Hi," **(unverified)**.

| Delivery shows | Likely cause |
|---|---|
| 400 Invalid signature | Wrong secret, or test and live mixed |
| 500 Email failed | Resend key wrong, or domain not verified; Stripe retries once fixed |
| 404 | `api/` not uploaded, or wrong path |
| 403 or an HTML page | Hosting security is blocking Stripe's request |

### 4.5 Going live
Repeat 4.2 in **live mode** against the real domain, put the live secret in the **production** `config.secrets.php`, build production with the **live** payment links, make one small real payment, confirm the receipt and email, then refund it.

## 5. Resend

1. Add the domain `yogine.dev` (Domains → Add Domain). Add the DNS records Resend lists, in the place your DNS is managed (Hostinger, if it hosts your nameservers). Click **Verify** and wait until it shows verified.
2. Create an **API key with sending access only**, restricted to `yogine.dev` if offered. Copy it once (`re_…`).
3. Put it in `config.secrets.php` as `resend_api_key`.
4. Emails go out from `yogine.dev <hello@yogine.dev>`; replies go to hello@yogine.dev. Team notices set the visitor as the reply-to, so you can reply straight to them.

**Test the key from your computer** (sends one real email; use your own address; paste the key only into your terminal):

```powershell
$env:RESEND_KEY = "re_…"
Invoke-RestMethod -Method Post -Uri "https://api.resend.com/emails" `
  -Headers @{ Authorization = "Bearer $env:RESEND_KEY" } -ContentType "application/json" `
  -Body (@{ from = "yogine.dev <hello@yogine.dev>"; to = @("you@example.com"); subject = "Resend test"; text = "It works." } | ConvertTo-Json)
Remove-Item Env:RESEND_KEY
```

Success returns an `id`. 403 or "domain not verified": the domain isn't verified, or the key is limited to another domain. 401: wrong key.

Emails the site sends: course confirmation (paid and free), waitlist confirmation, contact confirmation, and team notices for new leads, waitlist entries and contact messages. Phone-only submissions send no visitor email.

## 6. Google Sheet and Apps Script

The script writes two tabs, **Leads** and **Waitlist**, in the spreadsheet you attach it to. Existing tabs are not touched; missing tabs and columns are created on first use.

1. Open the spreadsheet → **Extensions → Apps Script**.
2. Replace the file's contents with [apps-script/Code.gs](apps-script/Code.gs).
3. **Project Settings → Script properties** → add `SHEET_SECRET` with a long random string. The same string goes in `config.secrets.php` as `sheet_secret`.
4. **Deploy → New deployment**, type **Web app**: execute as **Me**, access **Anyone**. Authorize when asked. Copy the URL that ends in `/exec` into `config.secrets.php` as `sheet_url`.
5. After any later change to the script, use **Manage deployments → edit → new version**. The URL stays the same.

"Anyone" means the URL is reachable by anyone who has it, but every call is rejected unless it carries the secret. Keep both private.

**Test it** (adds one test row; delete it afterwards). Run in PowerShell with your own values:

```powershell
$body = @{ secret = "<sheet secret>"; type = "waitlist"; created = (Get-Date).ToString("o"); email = "test@example.com"; courses = "Test"; page = "/test/" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "<your /exec URL>" -ContentType "text/plain" -Body $body
```

Expect `ok = True` and a new row in the Waitlist tab. With a wrong secret it returns `forbidden`.

**What the tabs contain**

| Leads | Waitlist |
|---|---|
| lead_id, created, name, email, phone, course, session, status, status_updated, amount, page, landing_page, referrer, utm, device, language, timezone, country, ph_visitor_id, coding_experience, ai_experience, expectations, notes | created, name, email, phone, courses, note, page, landing_page, referrer, utm, device, language, timezone, country, ph_visitor_id, notified, notes |

`status` moves `lead` → `payment_started` → `paid` (paid courses) or `registered` (free). Rows still at `lead` or `payment_started` are people who started but did not finish. `notes` and `notified` are for the team; follow-up with leads, the waitlist and phone numbers is manual.

If the sheet is ever down, nothing is lost: each lead and waitlist entry is also written to `api/data/leads.csv` and `waitlist.csv` and emailed to hello@yogine.dev.

## 7. PostHog

1. Create a project. Choose **US or EU** hosting. US is the default; for EU build with `PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com`.
2. Copy the **project key** (`phc_…`). It is public by design.
3. In the project's settings, turn on **heatmaps** and **session recordings**. Nothing is recorded or mapped until you do.
4. Build the site with the key set (PowerShell, from `site/`):

```powershell
$env:PUBLIC_POSTHOG_KEY = "phc_…"
npm run build
```

   For a non-US project also set `$env:PUBLIC_POSTHOG_HOST`. You can instead put both in `site/.env`, which is ignored by git. With **no key**, the site has no banner and loads nothing, which is how local work runs. `PUBLIC_POSTHOG_DEBUG=1` adds PostHog's console logging for troubleshooting.
5. PostHog loads only after a visitor clicks Accept. Visitors are identified by their (lower-cased) email as soon as they give one in a form; their earlier anonymous visits merge into that person. Form fields are masked in recordings. Do Not Track is respected and bot-like browsers are ignored.

**Events the site sends**

| Event | When | Useful properties |
|---|---|---|
| `$pageview` | Each page | automatic |
| `cta_click` | A button or button-link clicked | `label`, `href`, `page` |
| `form_started` / `form_error` | First field focused / a form failed | `form`, `fields` or `status` |
| `course_selected`, `session_selected` | In the enroll form | `course`, `session` |
| `details_submitted` | Enroll details saved as a lead | `course`, `session`, `free` |
| `payment_started` | Sent to Stripe | `course`, `session`, `price` |
| `registered` | Free registration done | `course`, `session` |
| `registration_confirmed` | Thank-you page shown | `course`, `session`, `free` |
| `waitlist_joined` / `contact_submitted` | Those forms succeed | `courses` or `interest`, `has_email`, `has_phone` |

**Funnels to build in PostHog** (Product analytics → New insight → Funnel)
- **Enroll (paid):** `$pageview` on `/enroll/` → `details_submitted` → `payment_started` → `registration_confirmed`
- **Enroll (free):** `$pageview` on `/enroll/` → `details_submitted` → `registered`
- **Waitlist:** `form_started` (form = waitlist) → `waitlist_joined`
- **Contact:** `form_started` (form = contact) → `contact_submitted`

The visitor ID in each Leads, Waitlist and team email row is the id PostHog merged, so you can paste it into PostHog's person search to see that person's whole journey.

**Unverified:** PostHog's current free-tier limits, and exactly how the merge appears in the person view. Check both against your expected traffic. Visitors who decline analytics, and visitors with ad blockers, will not appear, so counts will be lower than real traffic.

## 8. First end-to-end test (staging, test mode)

In this order. Each step depends on the one before it.

1. Hostinger staging exists, HTTPS on, PHP 8.1+ (section 3).
2. Site built with test payment links, uploaded; `config.secrets.php` filled in.
3. Private files are blocked (section 3 checks).
4. Resend key tested (section 5).
5. Apps Script deployed and tested (section 6).
6. Stripe test destination points at staging; its secret is in `config.secrets.php` (section 4).
7. Walk through each journey on staging and check the result:
   - **Waitlist**, with email: on-screen message, confirmation email, team notice, Waitlist row.
   - **Waitlist**, with phone only: on-screen message with no promise of a call, no visitor email, team notice, row.
   - **Contact**: confirmation, copy to the visitor, team notice that replies to the visitor.
   - **Free session** (needs a future Foundation session in `catalog.json`): registration, email, Leads row `registered`.
   - **Paid session**: Leads row `lead` → `payment_started` → `paid`; confirmation email; Stripe delivery 200.
   - **Analytics** (if built with a key): banner appears, nothing is sent before Accept, events appear after Accept.
8. Delete test rows from the sheet and remove test data from `api/data/`.

## 9. Before launch

- [ ] Live Stripe destination, live secret on production, live payment links in the production build
- [ ] One small real payment made and refunded; receipt and confirmation both arrived
- [ ] Privacy owner or counsel has reviewed the consent banner, the privacy notice and the lead follow-up wording
- [ ] Production `config.secrets.php` uses live values only
- [ ] Old site backed up, rollback tested once
- [ ] PostHog funnels built; heatmaps and recordings on
- [ ] Sessions in `catalog.json` are current. **The five November 2026 sessions (`n1` to `n5`) are placeholders** and must be replaced with the real schedule. Past sessions disappear on their own, but the site must be rebuilt and uploaded to add new ones

## 10. Troubleshooting

| Symptom | Likely cause |
|---|---|
| Any page of `/api/` says "Server is not configured" | `config.secrets.php` missing or misnamed, or `catalog.json` missing |
| Forms say "We couldn't send that" | `api/` not uploaded, PHP error, or the endpoint blocked; check the hosting error log |
| No emails | Resend key wrong, domain not verified, or sending from an address outside the verified domain; check Resend's Logs page and spam |
| Emails sent but no sheet rows | Sheet URL or secret wrong, or the script was not redeployed after a change; check Apps Script's Executions page. The data is still in `api/data/` and your inbox. |
| Stripe delivery 400 | Wrong or mixed-up webhook secret |
| "Too many attempts" | Rate limit (per visitor per hour); wait, or raise the limit in the endpoint |
| Banner never appears | The site was built without `PUBLIC_POSTHOG_KEY`, or consent was already chosen in that browser (clear site data, or use "Analytics choices" in the footer) |
| No events in PostHog after Accept | Ad blocker, wrong key or host, or a bot-like browser; try a normal browser window |
| Old content still showing | Purge Hostinger's cache and CDN, then hard-refresh |
