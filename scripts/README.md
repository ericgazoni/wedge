# Scripts

## Version sync

Use `version-sync.mjs` to read, validate, and update versions across:

- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`
- `src-tauri/tauri.conf.json`

### Get current version

```bash
npm run version:get
```

### Check consistency only

```bash
npm run version:check
```

### Set a new version

```bash
npm run version:set -- 0.2.2
```

## Doorstop itemformat bulk fix

Use `fix-doorstop-itemformat.mjs` to normalize all Doorstop item files in a repository to match each document's `.doorstop.yml` `settings.itemformat`.

- `yaml` => item files are saved as `.yml`
- `markdown` => item files are saved as `.md` with YAML frontmatter

### Dry run

```bash
npm run doorstop:fix-itemformat:dry
```

### Apply changes

```bash
npm run doorstop:fix-itemformat
```

### Custom path

```bash
node scripts/fix-doorstop-itemformat.mjs /path/to/repo --apply
```

If both source and destination files already exist for the same UID and differ, the script reports a conflict and skips that item.
