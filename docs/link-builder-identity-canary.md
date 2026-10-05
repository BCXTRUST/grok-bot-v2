# Identity live canary

Coordinator-run only. Do not run it from CI, and do not put a real gateway host, username or password in this repo.

Two real boards, a staging brand, default `undisclosed_persona`. The boards should sit in two different markets when the point is to show two exit countries.

## Vendor row

`LINK_BUILDER_PROXY=template`. Pick a preset with `LINK_BUILDER_PROXY_PRESET=iproyal` or `oxylabs`. Override the placeholders:

- `LINK_BUILDER_PROXY_HOST` — the vendor gateway host. The preset ships `proxy.example`.
- `LINK_BUILDER_PROXY_PORT` — the vendor port. The preset ships `8080`.
- `LINK_BUILDER_PROXY_PROTOCOL` — `http` or `socks5`.
- `LINK_BUILDER_PROXY_USERNAME_TEMPLATE` — optional. Oxylabs reads country and session from the username (`customer-USERNAME-cc-{country}-sessid-{session}-sesstime-{ttlMinutes}`). Replace `USERNAME` with the account username.
- `LINK_BUILDER_PROXY_PASSWORD_SUFFIX_TEMPLATE` — optional. IPRoyal reads `_country-{country}_session-{session}_lifetime-{ttlMinutes}m` from the password. The preset already sets that suffix. The secret itself stays the bare account password.

Store the password as a workspace secret of kind `lb_proxy` (or set `LINK_BUILDER_PROXY_SECRET_ID` to that row's id). The value is encrypted. It is not an env var.

`LINK_BUILDER_DRIVER=real`. Leave the fake driver for the offline demo.

## Lease

After the first session on a host:

```sql
select country, kind, provider, "stickyKey", "renewsAt", status
from lb_proxy_leases
where "projectId" = '<staging-project-id>'
  and status = 'active';
```

One active row per country. `kind` is `static_isp` where the preset lists that country, otherwise `residential`. The row has no password and no gateway. `endpointSecretId` points at the rendered username, not the password.

## Exit country

Probe once, from a shell that can read the secret store, through the leased endpoint to an IP-echo URL. Compare the echoed country with the host market. A mismatch is a failed canary. Do not paste the proxy URL or the password into the log; the probe error path redacts `user:pass@host`.

## Coherence refusal

A host whose `locale` or `timezoneId` is outside its country (for example `country = DE` and `locale = en-US`) does not open a browser. The run step is:

```text
kind: coherence_refused
lastAction: Coherence refused
```

The host becomes `parked_operator` with `statusReason = coherence_refused`. The project stays `active`. The Runs tab shows `coherence_refused`.

## Success

Two placements, counted, from two boards. If the boards are in different markets, the two active leases are different countries and the two probes show those exit countries. The Settings tab lists each lease as country, kind, expiry and provider id, and does not show a credential. Logged-out verification still uses the worker's own fetch, not the persona proxy.
