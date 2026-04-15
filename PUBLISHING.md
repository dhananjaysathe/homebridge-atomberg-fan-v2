# Publishing checklist

This document captures the manual steps to publish `homebridge-atomberg-fan-v2` to npm and then submit it to the [Homebridge verified plugins registry](https://github.com/homebridge/verified) so it shows up with a green tick in the Homebridge UI search.

## 1. Rename the GitHub repository (optional but recommended)

The local git remote still points at `dhananjaysathe/homebridge-atomberg-fan`, but `package.json` assumes `homebridge-atomberg-fan-v2`. On github.com:

1. **Settings → General → Repository name** → `homebridge-atomberg-fan-v2`.
2. GitHub auto-redirects the old URL, but update the local remote anyway:

   ```bash
   git -C /home/dsathe/dev/homebridge-atomberg-fan remote set-url origin \
       git@github.com:dhananjaysathe/homebridge-atomberg-fan-v2.git
   ```

If you'd rather keep the existing repo name, edit `package.json` (`repository`, `bugs`, `homepage`) and `README.md` to match.

## 2. Commit the fork changes and push

```bash
cd /home/dsathe/dev/homebridge-atomberg-fan
git checkout -b v2
git add .
git commit -m "Fork as homebridge-atomberg-fan-v2 2.0.0"
git push -u origin v2
```

Merge `v2` into `main` (or your default branch) via PR or directly. Tag the release:

```bash
git tag -a v2.0.0 -m "v2.0.0"
git push origin v2.0.0
```

## 3. Sanity check the build locally

```bash
npm ci
npm run build
npm run lint
npm pack --dry-run     # inspect the file list
```

The dry-run tarball should be ~28 kB and include `LICENSE`, `README.md`, `CHANGELOG.md`, `config.schema.json`, and `dist/*.js`/`*.d.ts`. No `src/`, no `.eslintrc`, no `node_modules`.

## 4. Publish to npm

```bash
npm login           # 2FA flow
npm whoami          # verify
npm publish --access public
```

`prepublishOnly` runs lint + build automatically; `postpublish` wipes `dist/`.

Verify:

```bash
npm view homebridge-atomberg-fan-v2
```

Within a few minutes the plugin is discoverable in the Homebridge UI plugin search (any package with both `homebridge` and `homebridge-plugin` in its `keywords` is auto-indexed).

## 5. Smoke test on a real Homebridge install

Before requesting verified status, run the plugin in a real environment for at least a few days. Confirm:

- [ ] Plugin loads under Homebridge v1.8.x **and** Homebridge v2.0 beta.
- [ ] All your Atomberg fans show up with the correct model/name.
- [ ] HomeKit Active toggle works.
- [ ] HomeKit rotation-speed slider hits speeds 1 through 6 (Boost).
- [ ] LED on/off works on every fan.
- [ ] LED brightness works on I1/M1.
- [ ] LED colour temperature works on I1.
- [ ] Physical remote / Atomberg app changes reflect in the Home app.
- [ ] Unplugging a fan is reflected as offline in HomeKit within ~5 minutes.
- [ ] `config.schema.json` renders correctly in the Homebridge UI config editor.

## 6. Submit to `homebridge/verified`

Eligibility ([policy](https://github.com/homebridge/verified/blob/master/README.md)):

- [x] Plugin published on npm with `homebridge-` name prefix.
- [x] `homebridge` and `homebridge-plugin` in `package.json` keywords.
- [x] Valid `config.schema.json`.
- [x] Public GitHub repository with README, LICENSE.
- [x] Uses the Dynamic Platform API (we do).
- [x] No exec of arbitrary scripts.
- [x] MIT, Apache-2.0, or similar OSS licence (we're Apache-2.0).

### Draft PR

Fork [`homebridge/verified`](https://github.com/homebridge/verified) and edit `verified-plugins.json` to add:

```json
"homebridge-atomberg-fan-v2"
```

(Keep the file alphabetically sorted.)

Open the PR with a body like:

> ### Plugin: `homebridge-atomberg-fan-v2`
>
> **npm**: https://www.npmjs.com/package/homebridge-atomberg-fan-v2
> **GitHub**: https://github.com/dhananjaysathe/homebridge-atomberg-fan-v2
>
> Maintained fork of `homebridge-atomberg-fan` adding Homebridge v2.0 compatibility, the 6th (Boost) fan speed, working LED / brightness / colour-temperature control, UDP state-sync hardening, and offline detection.
>
> - Published to npm with required keywords.
> - `config.schema.json` validated via the Homebridge UI.
> - Uses the Dynamic Platform API.
> - Apache-2.0 licensed.
> - Tested on Homebridge v1.8.x and v2.0 beta against my own Atomberg fan fleet.

The maintainers occasionally ask for tweaks before merging — be responsive.

## 7. After verification

Once merged, the plugin gets the purple "verified-by-homebridge" badge automatically. The README already includes a slot for it — add the badge back in when verified:

```markdown
[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
```

## 8. Ongoing releases

For subsequent releases:

```bash
npm version patch   # or minor / major
git push && git push --tags
npm publish
```

Update `CHANGELOG.md` first, following the existing format.
