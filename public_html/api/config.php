<?php
/**
 * Settings for stripe-webhook.php and register.php.
 *
 * Fill in the two secrets below. This file is PHP, so if someone opens its URL
 * the server runs it and shows nothing; the secrets are not exposed.
 * Never paste these values into the website's index.html.
 *
 * Keep `courses` and `events` in step with COURSES and EVENTS in index.html:
 * every course and session that can be booked on the site needs an entry here
 * with the same slug / id.
 */
return [
    'stripe_webhook_secret' => 'whsec_PASTE_FROM_STRIPE',
    'resend_api_key'        => 're_PASTE_FROM_RESEND',

    'site_url'      => 'https://yogine.dev/',
    'allowed_hosts' => ['yogine.dev', 'www.yogine.dev'],
    'from'          => 'yogine.dev <hello@yogine.dev>',
    'reply_to'      => 'hello@yogine.dev',
    'notify'        => 'hello@yogine.dev', // gets a copy of every confirmation; '' to turn off

    // 'free' => true lets register.php accept sign-ups without payment.
    // 'checklist' is shown in the email as "Before you arrive" (leave [] for none).
    'courses' => [
        'foundation' => [
            'name'      => 'Coding with AI Agents and Skills',
            'free'      => true,
            'checklist' => [],
        ],
        'professional' => [
            'name'      => 'AI Agentic Coding & Skills for Developers — Professional',
            'checklist' => [
                'A laptop with your normal development environment set up',
                'VS Code or Cursor installed',
                'A model connected (Claude or GPT)',
                'A repo of your own to work on',
            ],
        ],
        'advanced' => [
            'name'      => 'AI Agentic Coding & Skills for Developers — Advanced',
            'checklist' => [
                'A laptop with your normal development environment set up',
                'VS Code or Cursor installed',
                'A model connected (Claude or GPT)',
                'A repo of your own to work on',
            ],
        ],
    ],

    // 'note' is optional extra text for that session (start time, parking, joining link...).
    'events' => [
        'e1' => [
            'course' => 'professional',
            'date'   => 'Oct 3, 2026',
            'where'  => 'India Community Center (ICC), 525 Los Coches St, Milpitas, CA 95035',
            'note'   => '',
        ],
        'e2' => [
            'course' => 'professional',
            'date'   => 'Oct 10, 2026',
            'where'  => 'India Community Center (ICC), 525 Los Coches St, Milpitas, CA 95035',
            'note'   => '',
        ],
        'e3' => [
            'course' => 'professional',
            'date'   => 'Oct 13, 15 & 20, 2026',
            'where'  => 'Virtual, 3 sessions',
            'note'   => 'We will email the joining link before the first session.',
        ],
        'e4' => [
            'course' => 'advanced',
            'date'   => 'Oct 17, 2026',
            'where'  => 'India Community Center (ICC), 525 Los Coches St, Milpitas, CA 95035',
            'note'   => '',
        ],
        'e5' => [
            'course' => 'foundation',
            'date'   => 'Oct 6, 2026 · 4:00 PM PT',
            'where'  => 'Virtual, 90 minutes',
            'note'   => 'We will email the joining link before the session.',
        ],
    ],
];
