# Using Wedge with an Existing Doorstop Repository

This short manual is for end users who already have a project repository and want to work with it in Wedge.

## Before you start

- Your project should already be in Git.
- The repository should contain Doorstop documents (`.doorstop.yml` or `.doorstop.yaml`).
- Only HTTPS git remote is supported for now, not SSH.

## Option A: Open a local repository

1. Start Wedge.
2. Click **Open a project on this computer**.
3. Select your repository folder.
4. Wedge scans the folder and loads Doorstop documents and items.

If nothing loads, verify that the repository contains at least one Doorstop document config file.

## Option B: Join a shared repository

1. Start Wedge.
2. Click **Join a shared project**.
3. Paste the HTTPS project link (for example, `https://github.com/team/specs.git`).
4. Choose where to save the project locally.
5. Click **Download**.

If login is required, enter your username/email and password or access token.

## Sync your changes

- Edit requirements in Wedge.
- Click **Sync now** to sync changes.
- Check the sync status in the footer (`All synced`, `Updates available`, `Sync failed`, etc.).

## If a sync conflict appears

Open the Git view and choose one action:

- **Keep my version**
- **Keep their version**
- **Ask for help** (abort current sync attempt)

## Quick troubleshooting

- **Authentication failed**: re-enter credentials or update them in `Git` > `Configure Git Settings` menu.
- **Cannot reach server**: check internet connection and repository URL.
- **Project opens but no items appear**: confirm Doorstop config files exist in the repository.


