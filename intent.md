# yogine.dev — Intent

Status: DRAFT v4. Captures requirements and decisions only; nothing here is built yet. Solutions detail will follow and is marked TBD. The consent banner, privacy notice and lead follow-up wording need review by counsel or the privacy owner before launch.

## 1. Purpose

yogine.dev helps developers and organizations adopt AI in how software and business work gets done. The site exists to:

1. Explain what we offer, to two different audiences.
2. Convert visitors into one of three outcomes: **enroll** in a bootcamp, **join a waitlist** when no date is published, or **contact us**.
3. Tell us who visits and what they do, so we can improve the site and the offer and increase conversion: sign-ups when a date is published, and waitlist entries when no date is published.

## 2. Offerings and audiences

| Offering | Primary audience | How it is bought | Primary conversion |
|---|---|---|---|
| **Training / Bootcamps** (levels 01–03) | Individual developers | Self-serve: pick a session, pay (or register free) | Enroll |
| **Training level 04, Enterprise "Governed Agentic SDLC"** | Engineering leads and organizations | Custom scope and price | Contact us |
| **Solutions** | Enterprises | Consultative; no checkout | Contact us |

### A. Training / Bootcamps

Content is taken from the current site and remains the source of truth until revised.

- 01 Foundation (free, 90 min), 02 Professional ($199), 03 Advanced ($495), 04 Enterprise (custom).
- In-person (ICC, Milpitas, CA) and virtual sessions; 2 months of virtual support with paid courses.
- Levels 01–03 are written and priced for individuals. Team and bulk enquiries go to Contact us.
- Level 04 has no price or checkout on the site. Its only action is Contact us.

### B. Solutions

AI tools, frameworks, skills and agents that make AI easy to adopt across the SDLC and in business processes, delivered to enterprises.

- Scope: SDLC first (code review, test generation, documentation, onboarding), then wider business processes.
- Buyer: engineering leaders, security and compliance leads, transformation or operations leaders.
- Detailed offering content: **TBD** (to be supplied). Until then the existing Solutions page content stands.
- Primary conversion: Contact us.

## 3. Required capabilities

### 3.1 Enroll

The path to payment is short, and shortens further when dates are published.

**When sessions are published for the chosen course:**
1. The visitor picks a course and session (deep links from a "Reserve a seat" button pre-select both).
2. The visitor enters a short **details form**: name and email required, phone optional. On submit, the details are saved as a **lead** (see 3.6) before anything else happens.
3. Paid course: the visitor goes straight on to the payment step (Stripe), with their email pre-filled.
4. Free course: the same submit also registers them through our own endpoint.
5. After payment or free registration, the visitor lands on a confirmation page and **receives a confirmation email** with the course, session and what to prepare. This exists today (Stripe webhook plus Resend) and stays.
6. Stripe also sends its own payment receipt.

**When no session is published for the chosen course:** see 3.2 (waitlist). The visitor is never sent to a dead end.

Also required:
- A refund and cancellation policy visible before payment.
- Every paid course must have a working payment link before it is shown as bookable; otherwise it behaves as "no date published".
- Progress survives a refresh; the browser Back button behaves predictably.
- The experience and expectations questions that exist today move off the critical path to an optional step after payment or registration (decided). Only name, email and optional phone are asked before payment, so that interested visitors who abandon checkout are still captured as leads.

### 3.2 Waitlist ("notify me when scheduled")

Shown whenever a course has no published session, on the course, schedule and enroll pages.

- **Inputs:** email and/or phone (at least one required, both allowed), the course(s) of interest, optional name, optional note.
- **Result:** an email with all details goes to **hello@yogine.dev**, and the entry is added to a **"Waitlist" tab** in the existing Google spreadsheet (one row per entry, with course of interest, date, the page it came from and the analytics visitor ID).
- **Visitor feedback:** on-screen confirmation of what happens next, plus a **confirmation email to the visitor** when an email was given. A phone-only entry gets the on-screen confirmation only, and the message must not promise a call-back. Clear failure state with the fallback address.
- **Phone-only entries:** allowed; recorded and sent to hello@yogine.dev. No call-back commitment is made to the visitor (see 3.7).
- **When a session is later published:** the team notifies everyone waiting on that course, working from the Waitlist sheet. First release: manual. Automating this is a later step.
- **Abuse protection:** spam protection that does not burden real visitors.

### 3.3 Contact us

A visitor can ask a question or start a conversation without enrolling.

- **Inputs:** name, email and/or phone (at least one required, both allowed), message, interest (Solutions, Training for a team or Enterprise level, Other). For Solutions, optional company and team size.
- **Result:** an email goes to **hello@yogine.dev** with everything submitted, the page the visitor came from and the analytics visitor ID.
- **Visitor feedback:** on-screen confirmation of what happens next, plus a **confirmation email to the visitor** when an email was given; clear failure state with the fallback address. A phone-only entry gets the on-screen confirmation only, and the message must not promise a call-back.
- **Reachable from:** the header on every page, both service pages, the footer, and the Enterprise course row.
- **Replaces:** the current `mailto:` links, which fail for visitors without a configured mail client.

### 3.4 Confirmation emails

- **After payment or free registration:** confirmation email to the visitor (exists today).
- **After joining the waitlist:** confirmation email to the visitor when an email was given.
- **After a Contact submission:** on-screen confirmation, plus a confirmation email to the visitor when an email was given.
- Internal notifications for all three go to hello@yogine.dev. All visitor emails come from and are answered at hello@yogine.dev.

### 3.5 Analytics and heatmaps

Understand who comes to the site and what they do.

- **Traffic:** visits, sources and referrers, campaign tags, device and country, new vs. returning.
- **Behavior:** pages and sections viewed, scroll depth, time on page, clicks on key actions.
- **Funnels:** Enroll (landing → session chosen → payment started → registered) and Waitlist / Contact (page → form started → submitted), with drop-off per step.
- **Heatmaps and session replay:** click and scroll maps per page, with form fields and personal data masked.
- **Events to track:** each CTA click, session selected, redirect to Stripe, registration completed, waitlist joined, contact submitted, form error.
- **Identification (goal: know as much as we can about who is interested):**
  - Visitors are identified in analytics as soon as they give an email (details form, waitlist, contact), so their earlier anonymous activity on the site joins their identity.
  - Each lead, waitlist and contact record carries the analytics visitor ID, first source (referrer and campaign tags), first landing page and device and country, so the team can open that person's journey in PostHog.
  - Visitors who do not give an email, or who decline consent, stay anonymous.
- **Privacy:** consent approach, masking, retention, and the third parties receiving visitor data must be settled before launch and added to the privacy notice. Compliance decisions belong to counsel and the privacy owner.
- **Reporting:** someone on the team can answer "what did visitors do this week and where did they drop off" without engineering help.
- **Cost:** free at expected volume.
- **Tool: PostHog Cloud (decided).** Consent approach: see 6.1.

### 3.6 Leads (captured before payment)

- **When:** the moment a visitor submits the details form in 3.1, before payment or free registration.
- **Where:** a "Leads" tab in the existing Google spreadsheet, separate from the Waitlist tab, and an internal notification to hello@yogine.dev.
- **Fields:** name, email, phone, course, session, date and time, source details and analytics visitor ID (as in 3.5), and a **status**: lead → payment started → paid / registered.
- **Status updates:** payment started is recorded when the visitor is sent to Stripe; paid is recorded by the existing Stripe webhook. Leads that stay at "lead" or "payment started" are the interested parties who did not finish, and the team can follow up with them.
- **Notice:** the details form tells the visitor plainly that their details are saved and may be used to follow up if they do not finish. Whether that wording and any follow-up practice are acceptable is for counsel and the privacy owner.

### 3.7 Follow-up and spreadsheet ownership (manual for now)

- The team manages the Leads and Waitlist tabs by hand: access, reviewing new rows, and marking what was done.
- Follow-up with unfinished leads, waitlisted visitors and contact enquiries, including by phone, is done manually by the team. There is no automated follow-up in the first release.
- The "a date is scheduled" notice to the waitlist is also sent manually.
- The site never promises a call or a reply time to a visitor. Phone-only entries are allowed and the site makes no call-back commitment; whether a given phone-only entry is called is the team's choice.
- Automating follow-up is a possible later step and is out of scope for the first release.

## 4. Experience principles

- Two clear front doors from the home page, Training and Solutions, each with its own message and call to action.
- One primary action per screen. The free Foundation session is the lowest-friction entry to Training.
- Plain, specific language; no AI hype. Credibility through concrete deliverables, who delivers, and outcomes.
- Accessible (WCAG 2.2 AA target) and usable on a phone.
- Fast to load; content visible without waiting on scripts.
- Each page has its own URL, title and link preview so pages can be shared and found.
- No dead ends: any state with nothing to buy offers a waitlist or contact.

## 5. Out of scope for the first release

- User accounts, a learner portal, course content delivery.
- Self-serve purchase of Solutions or of the Enterprise training level.
- Automated waitlist notifications (manual first).
- Blog or CMS; multi-language support.

## 6. Decisions

### 6.1 Analytics: PostHog Cloud, free tier, with consent and visitor identification

This replaces the earlier cookie-less choice, because the goal is to identify visitors as far as possible.

- **Why PostHog:** one free tool covers traffic, funnels, events, heatmaps and session replay, and it can merge a visitor's earlier anonymous activity into their identity once they give an email. If the free replay quota runs out at higher traffic, Microsoft Clarity (free) can be added for heatmaps and replay.
- **Consent banner:** tracking that sets a persistent identifier, replay, and identification run only after the visitor opts in. Before opt-in, nothing is stored on the device. A visitor who declines still gets the full site, and their form submissions still work (the form data is submitted by them, not collected by tracking).
- **Identification:** after consent, an email given in any form identifies the visitor in PostHog. The analytics visitor ID is written to each lead, waitlist and contact record (3.5, 3.6).
- **Masking:** replay masks form fields, in particular name, email and phone.
- **Trade-offs to accept:** visitors who decline consent are invisible beyond coarse counts, so the identified view over-represents people who accept. Lead records still capture everyone who submits a form.
- **To verify before building:** PostHog's current free-tier limits and how it merges anonymous and identified activity. I have not checked either against PostHog's own documentation.
- **Required before launch:** counsel or the privacy owner reviews the banner, the privacy notice (PostHog and Google Sheets listed, retention stated), and the lead follow-up wording in 3.6.

### 6.2 Platform: pre-rendered static site (for example Astro), deployed to Hostinger; PHP endpoints kept

- Hosting does not change: the build output is plain files uploaded to `public_html`, and `api/*.php` stays.
- **Gains:** a real URL per page (automatic analytics page views, per-page titles and link previews), content visible without JavaScript, and one session data file used by both the site and the confirmation emails (today it lives in two files).
- **Costs:** a build step (laptop or CI), a one-time migration, and updates to the Stripe return URLs and `.htaccess` for clean URLs.

## 7. Success measures

Targets to be set once a baseline exists.

- Conversion: share of visitors to a course page who sign up (when a date is published) or join the waitlist (when none is), tracked separately and together.
- Enrollments completed per month, split by course and free vs. paid.
- Enroll funnel completion rate and the step with the largest drop-off.
- Waitlist signups per month by course, and the share later converted to enrollments.
- Contact submissions per month by interest, and share answered within one business day.
- Share of Solutions visitors who reach the contact form.
- Page load time and accessibility score on mobile.

## 8. Constraints and existing stack

- Hosted on Hostinger shared hosting; PHP endpoints in `public_html/api/` (`register.php`, `stripe-webhook.php`, `lib.php`, `config.php`).
- Stripe Payment Links for payments; Resend sends email from hello@yogine.dev; Google Apps Script writes to a Google Sheet with separate tabs for Leads (3.6) and Waitlist (3.2) in the existing spreadsheet.
- PostHog Cloud for analytics. The build step runs on a developer machine or CI, not on Hostinger.
- Google Fonts and a third-party QR image service are in use today; any tool that receives visitor data must be listed in the privacy notice.

## 9. Open questions

1. **Solutions content (TBD):** named tools, frameworks and agents, demos, case studies, sample artifacts, pricing signals.
2. **Privacy review:** who reviews the consent banner, privacy notice and lead follow-up wording (6.1, 3.6), and by when?
3. **Launch timing:** is there a date or event that sets the order of work?

Resolved: spreadsheet ownership and all follow-up with leads, waitlist and contact entries, including by phone, are manual for now (see 3.7). Phone-only entries are allowed.
