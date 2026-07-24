# Chrome Web Store — submission log

## 2026-07-15 — REJECTED: Keyword Spam (metadata only)

- **Violation:** "Keyword Spam" (reference ID "Yellow Argon", routing ID FZSL) —
  the provider brand list in the listing description:
  *"Anthropic (Claude), Google (Gemini), OpenAI, DeepSeek, Mistral, or Groq"*.
- **Remedy per Google:** remove the excessive/irrelevant keywords.
- **Not flagged:** `debugger`, `<all_urls>`, screenshots, privacy forms — the
  permission justifications passed as written.
- **Note:** the rejection email landed in Gmail **Trash** — check Trash/spam for
  `chromewebstore-noreply@google.com` while any review is pending.

## 2026-07-23 — resubmission (v0.2.3) — SUBMITTED, Pending review

Dashboard confirms: Otto v0.2.3, status **Pending review** (submitted 2026-07-23).
Expect the in-depth track (days to ~2 weeks) again due to `debugger` + host
permissions. Gmail filter fixed so CWS mail no longer auto-trashes (see below);
the outcome email will reach the inbox this time.

### What was in this resubmission

- Description rewritten with **zero provider brand names** (see updated
  `docs/store-listing.md`); the same brand list was also removed from the
  data-use free-text disclosure. Supported providers now referenced via the
  GitHub README instead of enumerated in the listing.
- Version bumped 0.2.2 → 0.2.3 (uploads must be strictly increasing and it was
  unclear whether the rejected zip was 0.2.1 or 0.2.2); includes the v0.2.2
  settings-card fix. `npm test` 19/19, `otto-0.2.3.zip` built.
- Dashboard steps: upload `otto-0.2.3.zip`, replace the **description** and the
  **data-use disclosure** text with the new versions, leave permission
  justifications unchanged, submit for review.

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
