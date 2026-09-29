# Updating yogine.dev on Hostinger

This package contains the revamped site (Training + Solutions), free-session registration, and automatic confirmation emails. Follow the steps in order. Budget about 60–90 minutes, plus DNS wait time for email.

## 1. What's in the package

```
public_html/
├── index.html              The whole website (one file)
└── api/
    ├── .htaccess           Blocks web access to logs and sign-up data
    ├── config.php          Your two secrets + course/session details for emails
    ├── lib.php             Builds and sends the confirmation email
    ├── register.php        Handles free-session sign-ups
    └── stripe-webhook.php  Emails people after they pay on Stripe
```

Everything inside `public_html/` goes into the `public_html` folder on Hostinger, keeping the same structure.

## 2. Before you start

- [ ] **Back up.** In hPanel go to **Websites → your site → File Manager**, open `public_html`, and download the current `index.html`. If anything goes wrong, re-uploading it restores the old site.
- [ ] **Check PHP.** In hPanel go to **Websites → Dashboard → PHP Configuration**. Use PHP 7.4 or newer (8.x is fine). Under **PHP Extensions**, make sure `curl` and `mbstring` are enabled. They normally are.
- [ ] **Accounts you need:** Hostinger (you have it), [Stripe](https://dashboard.stripe.com) (you have it), and a free [Resend](https://resend.com) account for sending email.
- [ ] **HTTPS is on** for yogine.dev (it already is, since the site is live).

## 3. Set up email sending (Resend)

Resend sends the confirmation emails from `hello@yogine.dev`.

1. Sign up at resend.com. Go to **Domains → Add Domain**, enter `yogine.dev`.
2. Resend shows a list of DNS records. Add them exactly as shown in Hostinger: **Domains → yogine.dev → DNS / Nameservers → DNS records**. (If your domain's nameservers point somewhere other than Hostinger, add the records wherever your DNS is managed.)
3. Back in Resend, click **Verify**. This can take a few minutes up to a few hours. Wait until the domain shows as verified.
4. Go to **API Keys → Create API Key**. Give it sending access only (restrict it to `yogine.dev` if offered). Copy the key (starts with `re_`). You can only see it once.

> If you already have a `hello@yogine.dev` mailbox on Hostinger, that's fine. Resend's records are separate and should not affect receiving mail. Add them exactly as Resend lists them.

## 4. Fill in the three placeholders

| File | Find | Replace with |
|---|---|---|
| `api/config.php` | `whsec_PASTE_FROM_STRIPE` | Stripe webhook signing secret (step 6) |
| `api/config.php` | `re_PASTE_FROM_RESEND` | The Resend API key from step 3 |
| `index.html` | `professional: '', // paste the $199 Payment Link URL here` | `professional: 'https://buy.stripe.com/...',` (the new $199 link, step 5) |

You can edit these directly in Hostinger's File Manager after uploading (right-click the file → **Edit**), or before uploading using any text editor.

**Never put the two secrets anywhere except `config.php`.** Do not paste them into `index.html`.

## 5. Stripe Payment Links

1. **Professional at $199.** In Stripe go to **Payment links → New**, add a one-time price of **$199** for the Professional course. As far as I know, an existing link's price can't be edited, so make a new one. Then **deactivate the old $99 link** so nobody can still use it.
2. **After-payment redirect.** On the Professional link and on the Advanced link, open the link's settings and set **After payment → Don't show confirmation page → redirect customers to your website**, with this URL:
   `https://yogine.dev/#/registered`
   If Stripe rejects the `#`, use `https://yogine.dev/?registered=1` instead. The site handles both.
3. **Payment methods.** Turn on Apple Pay, Google Pay, PayPal and Venmo if you want them offered.
4. **Receipts.** In Stripe's settings under **Customer emails**, turn on emails for **successful payments** so buyers also get a Stripe receipt. (Stripe doesn't send receipts in test mode.)
5. Paste the new Professional link into `index.html` (step 4). The Advanced link is already in the file.

## 6. Stripe webhook (sends the confirmation email after payment)

1. In Stripe go to **Developers → Webhooks** (newer dashboards may call it *Event destinations*) and **Add endpoint**.
2. Endpoint URL: `https://yogine.dev/api/stripe-webhook.php`
3. Select these two events:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
4. Save, then reveal and copy the **signing secret** (starts with `whsec_`). Paste it into `config.php` (step 4).

> **Test mode and live mode have separate webhooks and separate secrets.** While testing in test mode, use the test-mode secret. Before going live, create the webhook again in live mode and swap in the live secret.

## 7. Upload to Hostinger

1. In File Manager open `public_html`.
2. Upload `index.html`, replacing the old one (you already backed it up).
3. Create a folder named `api` inside `public_html`. Upload the five files from the package's `api/` folder into it.
4. `.htaccess` is a hidden file. In File Manager's settings, turn on **Show hidden files** to confirm it uploaded.
5. Leave folder permissions at the defaults (folders 755, files 644). The `api` folder must stay writable by PHP so it can create `sent-sessions.txt`, `registrations.csv` and `rate-limit.log`.
6. **Purge the cache.** In hPanel open **Cache Manager** and purge the cache. If Hostinger's CDN is on, purge that too. Otherwise visitors may keep seeing the old site.

## 8. Test, in this order

1. **Site loads.** Open https://yogine.dev in a private window. Check Home, Training, Solutions and Upcoming sessions on desktop and on your phone. Try the mobile menu.
2. **Data is protected.** Visit each of these. Each should be refused or show "not found", never download or display anything:
   - `https://yogine.dev/api/registrations.csv`
   - `https://yogine.dev/api/sent-sessions.txt`
   - `https://yogine.dev/api/rate-limit.log`
   - `https://yogine.dev/api/config.php` (should show a blank page, not your secrets)
3. **Free registration (no Stripe involved).** Sign up for the Foundation session (Oct 6) with your own email. Expect: the "You're registered" page, then a confirmation email within a minute (check spam). You should also get a copy at `hello@yogine.dev`.
4. **Duplicate protection.** Register again with the same email and session. You should see success but receive no second email.
5. **Paid flow in test mode.** Use a *test-mode* Payment Link and the test-mode webhook secret. Pay with card `4242 4242 4242 4242`, any future expiry, any CVC. Expect: redirect to your "Watch your inbox" page and a confirmation email that shows the correct course and date. In Stripe's webhook page, the delivery should show as succeeded.
6. **Go live.** Swap in the live-mode webhook secret and live Payment Link URLs, and re-upload `config.php` and `index.html`. Make one small real payment (you can refund it in Stripe) and confirm the email arrives.

## 9. Go-live checklist

- [ ] Professional shows **$199** and its new Stripe link charges **$199**
- [ ] Old $99 link deactivated
- [ ] Both Payment Links redirect to `https://yogine.dev/#/registered` (or the `?registered=1` version)
- [ ] Webhook secret in `config.php` is the **live** one
- [ ] Resend domain verified; a real email arrived in a real inbox, not spam
- [ ] Protected files (step 8.2) are not downloadable
- [ ] Refund policy and privacy notice read correctly. The privacy notice is a plain-language draft, so have someone qualified review it.
- [ ] Copy signed off by you: Foundation description, Solutions page, the "How we work with you" steps

## 10. Day-to-day changes

**Add a session.** Edit two places and re-upload both files, using the same ID in each:
1. `index.html`, the `EVENTS` list near the top of the script. Copy an existing entry and change `id` (for example `e6`), `courseSlug`, `date` (the label people see), `start` and `end` (`YYYY-MM-DD`), and the venue or `locationLabel`.
2. `api/config.php`, the `events` list, with the same ID, plus `course`, `date`, `where`, and an optional `note` (start time, joining link, parking).

Past sessions hide themselves automatically. If a course has no upcoming sessions, the signup form says so.

**Change a price.** Change `price` in `index.html`, create a new Stripe Payment Link at the new price, put its URL in `STRIPE_PAYMENT_LINKS`, and deactivate the old link. The site and Stripe must always agree.

**Add a new course.** Add it to `COURSES` in `index.html`, and to `courses` in `config.php` with the same short name (slug). For a free course, set `free: true` in both files. For a paid one, add a Payment Link.

**See free registrations.** Download `api/registrations.csv` from File Manager. Each registration is also emailed to `hello@yogine.dev`, and the first form step still records a lead in your Google Sheet.

**Change email wording.** Edit `api/lib.php` (the message) and the `note` and `checklist` fields in `config.php`.

## 11. Troubleshooting

| Symptom | Likely cause |
|---|---|
| Free sign-up shows "We couldn't complete your registration" | `api/` files missing or in the wrong folder; wrong Resend key; Resend domain not verified yet. Check that `https://yogine.dev/api/register.php` opens (it should say "POST only" as JSON). |
| No confirmation email | Look at Resend's **Logs** page. Check spam. Confirm the domain is verified and `from` in `config.php` uses `@yogine.dev`. |
| Stripe shows webhook failing with 400 | Wrong signing secret. Check you are not mixing test and live secrets. |
| Stripe shows webhook failing with 500 | Email sending failed. Check the Resend key and domain verification. Stripe retries automatically once fixed. |
| Email says "we'll email your course and session details separately" | The payment came without a course/session reference (for example a link used directly). Check that the event ID exists in `config.php`. |
| "Too many attempts" on sign-up | Rate limit (7 per visitor per hour, 50 overall per hour). Adjust in `register.php` if you expect a burst. |
| Old site still showing | Purge Hostinger's cache (and CDN), then hard-refresh the browser. |
| Site broke after an edit | A typo in `index.html` or a PHP file. Restore your backup, or re-upload the package copy. |

## 12. Known limits

- The PHP files were checked for structure but I could not run PHP where they were built, so the test steps above matter. Do them before promoting the site.
- The site is a single page with `#` addresses, so search engines see limited detail. Separate pre-built pages would help later.
- Session details live in two files (`index.html` and `config.php`). Keep them in step.
- Google Fonts still load from Google. Your privacy notice mentions this.
