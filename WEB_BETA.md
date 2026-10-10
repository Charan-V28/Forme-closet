# Forme private web beta: first setup

## Current status

The app is now wired for Supabase Auth, per-account profile/closet/outfit data, and private image storage. The local try-on server is still designed for a local computer. **Do not publish this version as a public multi-user app yet.** The cloud integration needs end-to-end review and account deletion still does not delete the sign-in account.

## Foundation prepared

`supabase/schema.sql` is the initial database and private image-storage setup for a Supabase project. It creates:

- Per-account profile, closet-item, and saved-outfit records.
- Row-level security rules that scope records to the signed-in account.
- Private image buckets with file-size and image-type limits, plus per-account storage policies.

The frontend reads the Supabase Project URL and Publishable key from the local `.env` file through `/api/config`. The Publishable key is intended for browser use; it is not a secret. A secret/service-role key must never be sent to `/api/config` or exposed in frontend code.

## First setup steps

1. In Supabase **Authentication → URL Configuration**, allow `http://127.0.0.1:4175` and `http://localhost:4175` for local sign-in and email links.
2. Use the updated app at `http://127.0.0.1:4175` (or start it with `npm start`), create an account, and verify the confirmation email redirects back to the app.
3. Add a closet item and a profile photo, refresh, and sign in again to check cloud persistence. Sign in with a second account and confirm it cannot see the first account's data.
4. Existing browser-local data is offered for import when a new account has no cloud data. Review this carefully before importing.
5. Before a beta, configure the actual HTTPS domain in Supabase Auth URL settings and hosting, then review backups, access policies, account deletion, and incident handling.

## Work still required before inviting users

- Verify sign-up, sign-in, sign-out, password recovery, and session handling against the configured Supabase project.
- Verify private image upload/download, short-lived signed URLs, image replacement, and deletion behavior; do not make personal photos public.
- Add secure **account deletion** that deletes the Auth user and all stored files. The current delete-data control removes personal rows/files but deliberately leaves the sign-in account. Storage cleanup for account deletion needs a trusted server-side function; do not expose a service-role secret in the app.
- Add a privacy notice and explicit opt-in before any external try-on provider receives personal or clothing photos. The current local CPU try-on is not suitable for a fast hosted beta.
- Configure production hosting, HTTPS, allowed origins, backups, error reporting, and a private beta access policy.
- Verify that one account cannot read, change, or delete another account's data and images before launch.

## Photo handling note

Profile photos, body measurements, and closet photos are sensitive personal data. Explain where they are stored, who can access them, how long they are retained, and how deletion works before requesting users to upload them. Obtain a user's clear consent before sending any photo to a third-party processing service.
