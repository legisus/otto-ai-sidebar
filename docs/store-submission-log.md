# Chrome Web Store — submission log

## 2026-07-10 — first submission (pending review)

- **Version submitted:** 0.2.x (`npm run package` zip)
- **Visibility:** Unlisted («Доступ по ссылке»)
- **Price / regions:** Free, all regions
- **Category / language:** Productivity → Tools, English
- **Store icon:** `extension/icons/128.png`
- **Promo tile:** `docs/store-assets/otto-promo-440x280.png`
- **Privacy form:** single purpose + per-permission justifications from
  `docs/store-listing.md` (all ≤1000 chars); remote code = No;
  data collected = PII + Website content; all three certifications checked;
  privacy policy URL = `PRIVACY.md` on GitHub main.
- **Expected:** in-depth review (days–2 weeks) due to `debugger` + `<all_urls>`;
  the pre-submit "Publishing will be delayed / Broad Host Permissions" warning is
  normal for this class of extension.
- **While pending:** do not upload new packages or edit the listing — edits restart
  the review queue.
- **If rejected:** appeal with the same justification text (see
  `docs/store-listing.md` → permission justifications); don't resubmit unchanged.

### Fixes that came out of submission prep

- Manifest description must be ≤132 chars (165-char one was rejected at upload) — fixed.
- Unused `scripting` permission and redundant explicit provider hosts removed.
- Debugger now detaches when a task finishes (banner is transient).
- v0.2.2: settings card no longer demands re-pasting a saved key.

### Next update checklist

1. Bump version in `extension/manifest.json` + `package.json` (must match).
2. `npm test` → `npm run package`.
3. Upload zip in the dashboard, keep permission justifications accurate.
4. Better screenshots: `scripts/capture-screenshot.sh <name>` in a fresh
   single-tab window (no personal tabs), panel showing a clean chat mid-task.
