import type { AdapterContext, ProxyEndpoint, ProxyProvider, SecretRef } from "@rakazo/adapter-kit";
import type { EncryptedSecretStore } from "@rakazo/adapters";
import { EndpointTemplateProxyProvider } from "@rakazo/adapters";
import type { PrismaClient } from "@rakazo/db";
import {
  nextProxyStickyKey,
  PROXY_RENEW_LEAD_MS,
  proxyRenewalDue,
  proxyStickyKey,
} from "@rakazo/linkbuilder-core";
import { recordCost } from "./link-builder-costs.js";

export { PROXY_RENEW_LEAD_MS };

const USERNAME_SECRET_KIND = "lb_proxy_username";

function isUnique(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

export interface LeaseDeps {
  prisma: PrismaClient;
  provider: ProxyProvider;
  secrets: EncryptedSecretStore;
  now: Date;
  context: AdapterContext;
  renewLeadMs?: number;
}

async function activeLease(prisma: PrismaClient, projectId: string, country: string) {
  return prisma.lbProxyLease.findFirst({
    where: { projectId, country, status: "active" },
  });
}

function catalog(
  provider: ProxyProvider,
  row: {
    providerLeaseId: string;
    country: string;
    stickyKey: string;
    kind: string;
    endpointSecretId: string | null;
    renewsAt: Date | null;
  },
): ProxyEndpoint | null {
  if (!(provider instanceof EndpointTemplateProxyProvider)) return null;
  return provider.catalogEndpoint({
    id: row.providerLeaseId,
    country: row.country,
    stickyKey: row.stickyKey,
    kind: row.kind,
    usernameSecretId: row.endpointSecretId,
    renewsAt: row.renewsAt,
  });
}

/**
 * One active lease per project and country. Renewal keeps the session. A missing row
 * leases with `proxyStickyKey(project, country)`.
 */
export async function ensureProxyLease(
  deps: LeaseDeps,
  input: { projectId: string; workspaceId: string; country: string; stickyKey?: string },
): Promise<ProxyEndpoint> {
  const lead = deps.renewLeadMs ?? PROXY_RENEW_LEAD_MS;
  const stickyKey = input.stickyKey ?? proxyStickyKey(input.projectId, input.country);
  const existing = await activeLease(deps.prisma, input.projectId, input.country);
  if (existing) {
    const renewsAt = existing.renewsAt?.getTime() ?? 0;
    if (renewsAt - deps.now.getTime() > lead) {
      const rebuilt = catalog(deps.provider, existing);
      if (rebuilt) return rebuilt;
      return deps.provider.lease(
        {
          country: input.country,
          stickyKey: existing.stickyKey,
          kinds: ["static_isp", "residential"],
        },
        deps.context,
      );
    }
    const renewed = await deps.provider.renew(existing.providerLeaseId, deps.context);
    const renewsAtDate = renewed.renewsAt ? new Date(renewed.renewsAt) : existing.renewsAt;
    await deps.prisma.lbProxyLease.update({
      where: { id: existing.id },
      data: { renewsAt: renewsAtDate },
    });
    const rebuilt = catalog(deps.provider, { ...existing, renewsAt: renewsAtDate });
    if (rebuilt) return rebuilt;
    return {
      ...renewed,
      username: existing.endpointSecretId
        ? { secretId: existing.endpointSecretId }
        : renewed.username,
    };
  }
  const endpoint = await deps.provider.lease(
    { country: input.country, stickyKey, kinds: ["static_isp", "residential"] },
    deps.context,
  );
  try {
    await deps.prisma.lbProxyLease.create({
      data: {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        provider: deps.provider.describe().id,
        providerLeaseId: endpoint.id,
        country: endpoint.country,
        stickyKey: endpoint.stickyKey,
        kind: endpoint.kind,
        // Username secret only. The password secret id is never stored on the lease.
        endpointSecretId: endpoint.username?.secretId ?? null,
        status: "active",
        leasedAt: deps.now,
        renewsAt: endpoint.renewsAt ? new Date(endpoint.renewsAt) : null,
      },
    });
  } catch (error) {
    if (!isUnique(error)) throw error;
    const raced = await activeLease(deps.prisma, input.projectId, input.country);
    if (!raced) throw error;
    return (
      catalog(deps.provider, raced) ??
      deps.provider.lease(
        {
          country: input.country,
          stickyKey: raced.stickyKey,
          kinds: ["static_isp", "residential"],
        },
        deps.context,
      )
    );
  }
  return endpoint;
}

/** Extends every active lease that is inside the renewal window. */
export async function renewDueLeases(deps: LeaseDeps): Promise<number> {
  const lead = deps.renewLeadMs ?? PROXY_RENEW_LEAD_MS;
  const active = await deps.prisma.lbProxyLease.findMany({ where: { status: "active" } });
  const due = active.filter((row) => proxyRenewalDue(row.renewsAt, deps.now, lead));
  let renewed = 0;
  for (const row of due) {
    try {
      const next = await deps.provider.renew(row.providerLeaseId, deps.context);
      const renewsAt = next.renewsAt ? new Date(next.renewsAt) : row.renewsAt;
      await deps.prisma.lbProxyLease.update({
        where: { id: row.id },
        data: { renewsAt },
      });
      await recordCost(deps.prisma, {
        workspaceId: row.workspaceId,
        projectId: row.projectId,
        kind: "proxy_lease_day",
        quantity: 1,
        sourceKey: `proxy:${row.id}:${(renewsAt ?? deps.now).toISOString()}`,
        occurredAt: deps.now,
      });
      renewed += 1;
    } catch {
      // One bad lease must not stop the tick. The next session lease reports it.
    }
  }
  return renewed;
}

/**
 * Blacklisted exit: release the lease, flag hosts in that country, keep every account row,
 * and lease a new session.
 */
export async function replaceBlacklistedLease(
  deps: LeaseDeps,
  input: { projectId: string; workspaceId: string; country: string },
): Promise<ProxyEndpoint> {
  const existing = await activeLease(deps.prisma, input.projectId, input.country);
  if (!existing) {
    return ensureProxyLease(deps, input);
  }
  const marker = deps.provider as ProxyProvider & {
    markBlacklisted?: (id: string, context: AdapterContext) => Promise<void>;
  };
  if (marker.markBlacklisted) await marker.markBlacklisted(existing.providerLeaseId, deps.context);
  await deps.provider.release(existing.providerLeaseId, deps.context);
  await deps.prisma.lbProxyLease.update({
    where: { id: existing.id },
    data: { status: "released", releasedAt: deps.now },
  });
  const hosts = await deps.prisma.lbHost.findMany({
    where: { projectId: input.projectId, workspaceId: input.workspaceId, country: input.country },
    select: { id: true, notes: true },
  });
  for (const host of hosts) {
    if (host.notes?.includes("ip_blacklisted")) continue;
    await deps.prisma.lbHost.update({
      where: { id: host.id },
      data: { notes: host.notes ? `${host.notes}\nip_blacklisted` : "ip_blacklisted" },
    });
  }
  return ensureProxyLease(deps, {
    ...input,
    stickyKey: nextProxyStickyKey(existing.stickyKey),
  });
}

/** Persists a rendered proxy username. The password secret is never written here. */
export async function sealProxyUsername(
  deps: { prisma: PrismaClient; secrets: EncryptedSecretStore },
  plaintext: string,
  context: AdapterContext,
): Promise<SecretRef> {
  const stored = await deps.secrets.put(plaintext, context);
  const row = await deps.prisma.secret.create({
    data: {
      id: stored.id,
      userId: context.userId,
      workspaceId: context.workspaceId,
      kind: USERNAME_SECRET_KIND,
      ciphertext: stored.ciphertext,
    },
    select: { id: true },
  });
  return { secretId: row.id };
}
