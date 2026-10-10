# Forme — virtual closet MVP

The app adapts to desktop and phone-sized screens. Run it through its local server with `npm start` and open `http://127.0.0.1:4173` (or the port printed by the server if `PORT` is configured).

## Supabase setup

The app reads `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from an ignored `.env` file. See `.env.example` for the names. The publishable key is intended for browser use; never put a Supabase secret/service-role key in `.env` values served to the browser. The app uses Supabase Auth, row-level security, and private Storage buckets for signed-in user data and photos. Run `supabase/schema.sql` in the Supabase SQL Editor before signing in.

Email confirmation and password recovery links need the app URL allowed in Supabase Authentication URL settings. For local work, add `http://127.0.0.1:4173` and `http://localhost:4173` to the allowed redirect URLs (or use the configured port).

## Optional local try-on

For free, private try-on on this Windows computer:

1. Install Node.js 22 or newer and Python 3.10–3.12.
2. Double-click `setup-local-model.bat` once. It installs a CPU-only runtime and downloads about 2.6 GB of model weights, plus Python dependencies. This can take a while and needs several GB of free disk space.
3. Start the app with `npm start` and open `http://127.0.0.1:4173` (or the port printed by the server if `PORT` is configured).

In this Codex environment the bundled Python 3.12 can be used by the setup script. No fal.ai key or subscription is used. The model runs on the computer; no person or clothing photos are sent to a cloud try-on provider.

## Included

- First-run onboarding with optional profile photo and body details
- Closet catalog with item photos, categories, search, editing, and deletion
- Outfit builder with one to three selected garment/accessory photos and saved looks
- Optional FASHN VTON local CPU try-on, including a local-processing notice
- Sample closet option, profile editing, and delete-all-data control
- Supabase account, cloud data, and private image storage when configured; browser-local storage when not configured

## Demo limitations

This remains an MVP and has no native iOS/Android package. Supabase configuration enables sign-in, account-scoped profile/closet/outfit records, and private image uploads. The app removes unreferenced stored photos after closet/profile/outfit changes. Before public beta, verify email redirects and cross-account isolation. Cloud account deletion is not yet implemented; the profile's “Delete all my data” action removes closet/profile/outfit data and stored images but keeps the sign-in account. The Render deployment disables try-on generation. Try-on runs only through the optional local CPU service; it is not a hosted generation service and is too slow for practical use on this computer. A local sample reached only 1 of 20 generation steps in 5 minutes 24 seconds. The model supports tops/jackets, bottoms, and one-pieces, but not shoes/accessories. It creates a visual estimate, not guaranteed fit. Review model/dependency licenses before commercial use.

Before a public release, complete and verify account deletion, image cleanup, privacy disclosures, and per-account access controls. Review all model and dependency licenses before commercial distribution.

## Preparing a private web beta

See [WEB_BETA.md](./WEB_BETA.md) for backend setup and launch work that remains.
