# Captell live canary

Coordinator-run only. CI stays on the emulator. Do not put a real token, inbox or customer URL in this repo.

## Before the run

1. Staging workspace, staging brand, one board you control.
2. Page Helper `2026.10.4.16`, extension id `kaddlbmbmgfolcpajhnfpcbekblekifn`, loaded by the persona browser (`LINK_BUILDER_HELPER_DIR` locally, or `LINK_BUILDER_SANDBOX_HELPER_DIR` in the sandbox image).
3. `LINK_BUILDER_DRIVER=real`. Leave `LINK_BUILDER_DRIVER=fake` for the offline demo.
4. `BETTER_AUTH_SECRET` and `ENCRYPTION_KEY` are long random strings. The Captell token is pasted in the wizard and stored as secret kind `lb_captcha`. It is never an env var in git.
5. Check balance in the wizard. The response is `{ credits, helperVersion }` and must not contain `ct_live_`.

## Connect and version

The worker does not open `captell.run`. In the persona browser, open `https://captell.run/extension/connect?token=…` yourself and confirm the page says Connected. The popup version must be `2026.10.4.16`.

Confirm the in-page control matches `[data-page-helper]`. If the real helper uses another control, set the runner's `pageHelperButtonSelector` before the run. A version other than `2026.10.4.16`, or no version at all, parks the host. The run step `helper_connected` records `{ helperVersion, extensionId }`.

Do not open `captell.run/login` or `hcaptcha.com` in that browser.

## What `placed_submitted` looks like

After the helper reaches `Placed. Submit the form.` and the form is submitted:

```sql
select outcome, door, type, "buttonTextObserved", "helperVersion",
       "taskId", "creditsCharged", "balanceAfter"
from lb_captcha_events
where "projectId" = '<staging-project-id>'
order by "createdAt" desc;
```

A helper success is `outcome = placed_submitted`, `door = page_helper`, `helperVersion = 2026.10.4.16`, `buttonTextObserved = Placed. Submit the form.` The helper door has a null `taskId`. An HTTPS image or widget solve has a `taskId` and no image bytes. The row must not contain the token or the answer.

## Sandbox label

If Captell's upstream solver key is unset, solve and balance responses carry `sandbox`. That is a failure:

- a solve parks the host with `outcome = sandbox`
- a balance check pauses the project
- the Captchas tab shows "Sandbox answer. The Captell desk is not production-configured."

Do not count a sandbox `placed_submitted` as the canary. The desk has to be production-configured first.

## Low balance

Set `captchaLowBalanceCredits` above the live balance, tick once, and confirm the project is `paused` with exactly one `outcome = credits` row. A second tick must not add another row.
