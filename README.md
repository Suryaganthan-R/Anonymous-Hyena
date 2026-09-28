# Anonymous Hyena

## OAuth setup

1. Create a Google OAuth client ID for a web application. Add `http://localhost:5173/auth/google/callback` as an authorized redirect URI.
2. Copy `.env.example` to `.env`.
3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env` for Google sign-in.
4. To enable GitHub account linking, create a GitHub OAuth App with callback URL `http://localhost:5173/auth/github/callback` and set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in `.env`.
5. Start the frontend and auth server together with `npm run dev`.

Users sign in to Anonymous Hyena with Google, then connect GitHub separately while signed in. Provider secrets and OAuth tokens stay server-side; GitHub account details are stored with the local application database. For deployment, replace `APP_URL` and register the matching HTTPS callback URLs with each provider.

## Frontend

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:


## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.
## Contributions and Staff Access

Signed-in users can submit public GitHub repositories owned by their connected GitHub account. Submissions remain private to staff while pending and are listed publicly only after approval. Review notes on approvals or rejections are delivered to the submitter in the navbar notifications. Staff can hide or restore approved projects without deleting them, or permanently delete an approved project.

Open `/admin` for the separate staff sign-in and workspace. The first verified Google sign-in for `mistermanuniq@gmail.com` receives the protected `superadmin` role. Managers can review and approve or reject submissions. Admins can review submissions and manage user, manager, and admin roles. Admins cannot change the superadmin account or their own role.

Signed-in users can edit their display name, contact email, and profile bio. The verified Google sign-in email is read-only.

User roles and submissions persist in SQLite at `server/data/anonymous-hyena.sqlite`; this file is excluded from Git. Back up that file when deploying with persistent storage. The server uses Node's built-in `node:sqlite` module and requires Node.js 22.5 or newer.
