CREATE TABLE "lb_projects" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "brandName" TEXT NOT NULL,
    "allowedDomains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "persona" JSONB,
    "mailboxId" TEXT,
    "mailboxAddress" TEXT,
    "captchaSecretId" TEXT,
    "captchaLowBalanceCredits" INTEGER NOT NULL DEFAULT 500,
    "quotas" JSONB,
    "schedule" JSONB NOT NULL DEFAULT '{"timezone":"Europe/Berlin","weekdaysOnly":true,"window":{"start":"09:00","end":"22:00"},"overtimeUntilLiveMet":false,"hardStopHour":24}',
    "topicLanes" JSONB NOT NULL DEFAULT '[]',
    "geoPolicy" TEXT NOT NULL DEFAULT 'dach_first',
    "disclosureMode" TEXT NOT NULL DEFAULT 'undisclosed_persona',
    "responsibilityAck" JSONB,
    "linkRatio" JSONB NOT NULL DEFAULT '{"links":1,"posts":3}',
    "proxyPolicy" TEXT NOT NULL DEFAULT 'static_isp_per_persona',
    "countNofollow" BOOLEAN NOT NULL DEFAULT true,
    "targets" JSONB NOT NULL DEFAULT '[]',
    "facts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "denyHosts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preferHosts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "warmup" JSONB NOT NULL DEFAULT '{"minPostsBeforeLink":2,"minAccountAgeHours":24}',
    "spamRetry" JSONB NOT NULL DEFAULT '{"maxRetries":1,"sentences":["Die Registrierung ist wegen Spamschutzmaßnahmen fehlgeschlagen.","No soup for you!"]}',
    "content" JSONB NOT NULL DEFAULT '{"toneNotes":"","bannedClaims":[],"maxReplyChars":1200}',
    "operator" JSONB NOT NULL DEFAULT '{"parkedHostTtlHours":48,"channels":["push","email"]}',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lb_projects_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "lb_projects" ADD CONSTRAINT "lb_projects_status_check" CHECK ("status" IN ('draft', 'active', 'paused', 'stopped', 'archived'));

ALTER TABLE "lb_projects" ADD CONSTRAINT "lb_projects_geoPolicy_check" CHECK ("geoPolicy" IN ('dach_first', 'en_fallback', 'en_only'));

ALTER TABLE "lb_projects" ADD CONSTRAINT "lb_projects_disclosureMode_check" CHECK ("disclosureMode" IN ('undisclosed_persona', 'disclosed_persona', 'disclosed_brand', 'drafts_only'));

ALTER TABLE "lb_projects" ADD CONSTRAINT "lb_projects_proxyPolicy_check" CHECK ("proxyPolicy" IN ('static_isp_per_persona', 'none'));

ALTER TABLE "lb_projects" ADD CONSTRAINT "lb_projects_captchaLowBalanceCredits_check" CHECK ("captchaLowBalanceCredits" >= 0);

ALTER TABLE "lb_projects" ADD CONSTRAINT "lb_projects_json_shape_check" CHECK (
    jsonb_typeof("schedule") = 'object'
    AND jsonb_typeof("topicLanes") = 'array'
    AND jsonb_typeof("linkRatio") = 'object'
    AND jsonb_typeof("targets") = 'array'
    AND jsonb_typeof("warmup") = 'object'
    AND jsonb_typeof("spamRetry") = 'object'
    AND jsonb_typeof("content") = 'object'
    AND jsonb_typeof("operator") = 'object'
    AND ("persona" IS NULL OR jsonb_typeof("persona") = 'object')
    AND ("quotas" IS NULL OR jsonb_typeof("quotas") = 'object')
    AND ("responsibilityAck" IS NULL OR jsonb_typeof("responsibilityAck") = 'object')
);

CREATE UNIQUE INDEX "lb_projects_workspaceId_slug_key" ON "lb_projects"("workspaceId", "slug");

CREATE INDEX "lb_projects_workspaceId_status_idx" ON "lb_projects"("workspaceId", "status");

CREATE INDEX "lb_projects_captchaSecretId_idx" ON "lb_projects"("captchaSecretId");

ALTER TABLE "lb_projects" ADD CONSTRAINT "lb_projects_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lb_projects" ADD CONSTRAINT "lb_projects_captchaSecretId_fkey" FOREIGN KEY ("captchaSecretId") REFERENCES "secrets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "lb_proxy_leases" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerLeaseId" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'static_isp',
    "endpointSecretId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "leasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "renewsAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lb_proxy_leases_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "lb_proxy_leases" ADD CONSTRAINT "lb_proxy_leases_kind_check" CHECK ("kind" IN ('static_isp', 'residential', 'datacenter'));

ALTER TABLE "lb_proxy_leases" ADD CONSTRAINT "lb_proxy_leases_status_check" CHECK ("status" IN ('active', 'released', 'expired'));

ALTER TABLE "lb_proxy_leases" ADD CONSTRAINT "lb_proxy_leases_country_check" CHECK ("country" ~ '^[A-Z]{2}$');

CREATE UNIQUE INDEX "lb_proxy_leases_one_active_per_project" ON "lb_proxy_leases"("projectId") WHERE "status" = 'active';

CREATE INDEX "lb_proxy_leases_workspaceId_projectId_status_idx" ON "lb_proxy_leases"("workspaceId", "projectId", "status");

CREATE INDEX "lb_proxy_leases_status_renewsAt_idx" ON "lb_proxy_leases"("status", "renewsAt");

CREATE INDEX "lb_proxy_leases_endpointSecretId_idx" ON "lb_proxy_leases"("endpointSecretId");

ALTER TABLE "lb_proxy_leases" ADD CONSTRAINT "lb_proxy_leases_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lb_proxy_leases" ADD CONSTRAINT "lb_proxy_leases_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "lb_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lb_proxy_leases" ADD CONSTRAINT "lb_proxy_leases_endpointSecretId_fkey" FOREIGN KEY ("endpointSecretId") REFERENCES "secrets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "lb_hosts" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "registrableDomain" TEXT NOT NULL,
    "homepageUrl" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'unknown',
    "platformVersionHint" TEXT,
    "language" TEXT,
    "country" TEXT,
    "topicTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "qualityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hrefForNewMembers" TEXT NOT NULL DEFAULT 'unknown',
    "relDefault" TEXT NOT NULL DEFAULT 'unknown',
    "signatureLinks" BOOLEAN NOT NULL DEFAULT false,
    "minPostsForLinks" INTEGER,
    "registerUrl" TEXT,
    "captchaType" TEXT,
    "engineHint" TEXT,
    "status" TEXT NOT NULL DEFAULT 'discovered',
    "parkedFrom" TEXT,
    "statusReason" TEXT,
    "lastProbeAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lb_hosts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "lb_hosts" ADD CONSTRAINT "lb_hosts_platform_check" CHECK ("platform" IN ('phpbb', 'woltlab', 'xenforo', 'ips', 'vbulletin', 'mybb', 'discourse', 'flarum', 'nodebb', 'vanilla', 'qa_other', 'unknown'));

ALTER TABLE "lb_hosts" ADD CONSTRAINT "lb_hosts_hrefForNewMembers_check" CHECK ("hrefForNewMembers" IN ('yes', 'after_n_posts', 'no', 'unknown'));

ALTER TABLE "lb_hosts" ADD CONSTRAINT "lb_hosts_relDefault_check" CHECK ("relDefault" IN ('follow', 'nofollow', 'ugc', 'unknown'));

ALTER TABLE "lb_hosts" ADD CONSTRAINT "lb_hosts_status_check" CHECK ("status" IN ('discovered', 'probed', 'qualified', 'registering', 'pending_email', 'pending_admin', 'warming', 'ready', 'used', 'denied', 'spam_blocked', 'unsupported_captcha', 'parked_operator', 'dead'));

ALTER TABLE "lb_hosts" ADD CONSTRAINT "lb_hosts_parkedFrom_check" CHECK (
    ("status" = 'parked_operator' AND "parkedFrom" IS NOT NULL AND "parkedFrom" IN ('qualified', 'registering', 'pending_email', 'pending_admin', 'warming', 'ready'))
    OR ("status" <> 'parked_operator' AND "parkedFrom" IS NULL)
);

ALTER TABLE "lb_hosts" ADD CONSTRAINT "lb_hosts_captchaType_check" CHECK ("captchaType" IN ('recaptcha_v2', 'recaptcha_v3', 'recaptcha_enterprise', 'turnstile', 'hcaptcha', 'image_letters', 'knowledge_question', 'security_check_label', 'unsupported'));

ALTER TABLE "lb_hosts" ADD CONSTRAINT "lb_hosts_minPostsForLinks_check" CHECK ("minPostsForLinks" IS NULL OR "minPostsForLinks" >= 0);

CREATE UNIQUE INDEX "lb_hosts_workspaceId_projectId_registrableDomain_key" ON "lb_hosts"("workspaceId", "projectId", "registrableDomain");

CREATE INDEX "lb_hosts_workspaceId_projectId_status_idx" ON "lb_hosts"("workspaceId", "projectId", "status");

ALTER TABLE "lb_hosts" ADD CONSTRAINT "lb_hosts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lb_hosts" ADD CONSTRAINT "lb_hosts_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "lb_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "lb_host_accounts" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "siteLoginId" TEXT,
    "emailVerifiedAt" TIMESTAMP(3),
    "adminApprovedAt" TIMESTAMP(3),
    "postCount" INTEGER NOT NULL DEFAULT 0,
    "linkPostCount" INTEGER NOT NULL DEFAULT 0,
    "firstPostAt" TIMESTAMP(3),
    "lastPostAt" TIMESTAMP(3),
    "signatureSetAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lb_host_accounts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "lb_host_accounts" ADD CONSTRAINT "lb_host_accounts_post_counts_check" CHECK ("postCount" >= 0 AND "linkPostCount" >= 0 AND "linkPostCount" <= "postCount");

CREATE UNIQUE INDEX "lb_host_accounts_hostId_key" ON "lb_host_accounts"("hostId");

CREATE INDEX "lb_host_accounts_workspaceId_projectId_idx" ON "lb_host_accounts"("workspaceId", "projectId");

CREATE INDEX "lb_host_accounts_siteLoginId_idx" ON "lb_host_accounts"("siteLoginId");

ALTER TABLE "lb_host_accounts" ADD CONSTRAINT "lb_host_accounts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lb_host_accounts" ADD CONSTRAINT "lb_host_accounts_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "lb_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lb_host_accounts" ADD CONSTRAINT "lb_host_accounts_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "lb_hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lb_host_accounts" ADD CONSTRAINT "lb_host_accounts_siteLoginId_fkey" FOREIGN KEY ("siteLoginId") REFERENCES "site_logins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "lb_thread_candidates" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL DEFAULT '',
    "lastActivityAt" TIMESTAMP(3),
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "relevance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "laneId" TEXT,
    "openQuestion" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'candidate',
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lb_thread_candidates_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "lb_thread_candidates" ADD CONSTRAINT "lb_thread_candidates_status_check" CHECK ("status" IN ('candidate', 'selected', 'posted', 'rejected'));

ALTER TABLE "lb_thread_candidates" ADD CONSTRAINT "lb_thread_candidates_relevance_check" CHECK ("relevance" >= 0 AND "relevance" <= 1);

ALTER TABLE "lb_thread_candidates" ADD CONSTRAINT "lb_thread_candidates_replyCount_check" CHECK ("replyCount" >= 0);

CREATE UNIQUE INDEX "lb_thread_candidates_hostId_url_key" ON "lb_thread_candidates"("hostId", "url");

CREATE INDEX "lb_thread_candidates_workspaceId_projectId_status_idx" ON "lb_thread_candidates"("workspaceId", "projectId", "status");

ALTER TABLE "lb_thread_candidates" ADD CONSTRAINT "lb_thread_candidates_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lb_thread_candidates" ADD CONSTRAINT "lb_thread_candidates_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "lb_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lb_thread_candidates" ADD CONSTRAINT "lb_thread_candidates_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "lb_hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "lb_drafts" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "threadCandidateId" TEXT NOT NULL,
    "modelLane" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "linkSlot" TEXT NOT NULL DEFAULT 'none',
    "targetUrl" TEXT,
    "anchorText" TEXT,
    "confidence" DOUBLE PRECISION,
    "qualityChecks" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'drafted',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lb_drafts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "lb_drafts" ADD CONSTRAINT "lb_drafts_modelLane_check" CHECK ("modelLane" IN ('draft', 'classify', 'fallback'));

ALTER TABLE "lb_drafts" ADD CONSTRAINT "lb_drafts_linkSlot_check" CHECK ("linkSlot" IN ('none', 'inline', 'signature'));

ALTER TABLE "lb_drafts" ADD CONSTRAINT "lb_drafts_status_check" CHECK ("status" IN ('drafted', 'approved', 'posted', 'discarded'));

ALTER TABLE "lb_drafts" ADD CONSTRAINT "lb_drafts_confidence_check" CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1));

ALTER TABLE "lb_drafts" ADD CONSTRAINT "lb_drafts_inline_link_check" CHECK ("linkSlot" <> 'inline' OR ("targetUrl" IS NOT NULL AND "anchorText" IS NOT NULL));

ALTER TABLE "lb_drafts" ADD CONSTRAINT "lb_drafts_anchorText_check" CHECK ("anchorText" IS NULL OR char_length("anchorText") <= 60);

CREATE INDEX "lb_drafts_threadCandidateId_idx" ON "lb_drafts"("threadCandidateId");

CREATE INDEX "lb_drafts_workspaceId_projectId_status_idx" ON "lb_drafts"("workspaceId", "projectId", "status");

ALTER TABLE "lb_drafts" ADD CONSTRAINT "lb_drafts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lb_drafts" ADD CONSTRAINT "lb_drafts_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "lb_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lb_drafts" ADD CONSTRAINT "lb_drafts_threadCandidateId_fkey" FOREIGN KEY ("threadCandidateId") REFERENCES "lb_thread_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "lb_placements" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "hostAccountId" TEXT NOT NULL,
    "draftId" TEXT,
    "threadUrl" TEXT NOT NULL,
    "postUrl" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "anchorText" TEXT NOT NULL,
    "rel" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "indexable" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "counted" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "verifyMethod" TEXT,
    "snapshotArtifactId" TEXT,
    "nextVerifyAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lb_placements_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "lb_placements" ADD CONSTRAINT "lb_placements_status_check" CHECK ("status" IN ('pending', 'live', 'nofollow_live', 'dead', 'removed'));

ALTER TABLE "lb_placements" ADD CONSTRAINT "lb_placements_verifyMethod_check" CHECK ("verifyMethod" IN ('logged_out_fetch', 'logged_out_browser'));

ALTER TABLE "lb_placements" ADD CONSTRAINT "lb_placements_anchorText_check" CHECK (char_length("anchorText") BETWEEN 1 AND 60);

-- One counted LIVE link per host and project, forever. Prisma cannot express partial indexes.
CREATE UNIQUE INDEX "lb_placements_one_counted_per_host" ON "lb_placements"("workspaceId", "projectId", "hostId") WHERE "counted" = true;

CREATE INDEX "lb_placements_workspaceId_projectId_status_idx" ON "lb_placements"("workspaceId", "projectId", "status");

CREATE INDEX "lb_placements_hostId_idx" ON "lb_placements"("hostId");

CREATE INDEX "lb_placements_hostAccountId_idx" ON "lb_placements"("hostAccountId");

CREATE INDEX "lb_placements_draftId_idx" ON "lb_placements"("draftId");

CREATE INDEX "lb_placements_status_nextVerifyAt_idx" ON "lb_placements"("status", "nextVerifyAt");

ALTER TABLE "lb_placements" ADD CONSTRAINT "lb_placements_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lb_placements" ADD CONSTRAINT "lb_placements_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "lb_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lb_placements" ADD CONSTRAINT "lb_placements_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "lb_hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lb_placements" ADD CONSTRAINT "lb_placements_hostAccountId_fkey" FOREIGN KEY ("hostAccountId") REFERENCES "lb_host_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lb_placements" ADD CONSTRAINT "lb_placements_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "lb_drafts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "lb_runs" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "newToday" INTEGER NOT NULL DEFAULT 0,
    "liveToday" INTEGER NOT NULL DEFAULT 0,
    "liveWeek" INTEGER NOT NULL DEFAULT 0,
    "uniqueHosts" INTEGER NOT NULL DEFAULT 0,
    "currentHostId" TEXT,
    "currentUrl" TEXT,
    "lastAction" TEXT,
    "lastError" TEXT,
    "whyNot" JSONB,
    "leaseOwner" TEXT,
    "leaseFence" INTEGER NOT NULL DEFAULT 0,
    "leaseExpiresAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lb_runs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "lb_runs" ADD CONSTRAINT "lb_runs_status_check" CHECK ("status" IN ('queued', 'running', 'paused', 'overtime', 'succeeded', 'partial', 'failed', 'cancelled'));

ALTER TABLE "lb_runs" ADD CONSTRAINT "lb_runs_date_check" CHECK ("date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');

ALTER TABLE "lb_runs" ADD CONSTRAINT "lb_runs_counters_check" CHECK ("newToday" >= 0 AND "liveToday" >= 0 AND "liveWeek" >= 0 AND "uniqueHosts" >= 0 AND "leaseFence" >= 0);

CREATE UNIQUE INDEX "lb_runs_projectId_date_key" ON "lb_runs"("projectId", "date");

CREATE INDEX "lb_runs_workspaceId_projectId_idx" ON "lb_runs"("workspaceId", "projectId");

CREATE INDEX "lb_runs_status_leaseExpiresAt_idx" ON "lb_runs"("status", "leaseExpiresAt");

CREATE INDEX "lb_runs_currentHostId_idx" ON "lb_runs"("currentHostId");

ALTER TABLE "lb_runs" ADD CONSTRAINT "lb_runs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lb_runs" ADD CONSTRAINT "lb_runs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "lb_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lb_runs" ADD CONSTRAINT "lb_runs_currentHostId_fkey" FOREIGN KEY ("currentHostId") REFERENCES "lb_hosts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "lb_run_steps" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "hostId" TEXT,
    "input" JSONB NOT NULL DEFAULT '{}',
    "outcome" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "artifactIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "costs" JSONB NOT NULL DEFAULT '{"credits":0,"tokens":0,"bytes":0,"ms":0}',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lb_run_steps_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "lb_run_steps" ADD CONSTRAINT "lb_run_steps_stepIndex_check" CHECK ("stepIndex" >= 0);

ALTER TABLE "lb_run_steps" ADD CONSTRAINT "lb_run_steps_costs_check" CHECK (jsonb_typeof("costs") = 'object');

CREATE UNIQUE INDEX "lb_run_steps_runId_stepIndex_key" ON "lb_run_steps"("runId", "stepIndex");

CREATE INDEX "lb_run_steps_workspaceId_runId_idx" ON "lb_run_steps"("workspaceId", "runId");

ALTER TABLE "lb_run_steps" ADD CONSTRAINT "lb_run_steps_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lb_run_steps" ADD CONSTRAINT "lb_run_steps_runId_fkey" FOREIGN KEY ("runId") REFERENCES "lb_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "lb_captcha_events" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "hostId" TEXT,
    "runId" TEXT,
    "type" TEXT NOT NULL,
    "door" TEXT NOT NULL,
    "buttonTextObserved" TEXT,
    "humanCheckboxState" TEXT,
    "imageGridOpen" BOOLEAN NOT NULL DEFAULT false,
    "siteKeyFound" BOOLEAN NOT NULL DEFAULT false,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "creditsCharged" INTEGER NOT NULL DEFAULT 0,
    "balanceAfter" INTEGER,
    "outcome" TEXT NOT NULL,
    "helperVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lb_captcha_events_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "lb_captcha_events" ADD CONSTRAINT "lb_captcha_events_type_check" CHECK ("type" IN ('recaptcha_v2', 'recaptcha_v3', 'recaptcha_enterprise', 'turnstile', 'hcaptcha', 'image_letters', 'knowledge_question', 'security_check_label', 'unsupported'));

ALTER TABLE "lb_captcha_events" ADD CONSTRAINT "lb_captcha_events_door_check" CHECK ("door" IN ('https_api', 'page_helper', 'userscript', 'operator'));

ALTER TABLE "lb_captcha_events" ADD CONSTRAINT "lb_captcha_events_humanCheckboxState_check" CHECK ("humanCheckboxState" IN ('checked', 'empty', 'none'));

ALTER TABLE "lb_captcha_events" ADD CONSTRAINT "lb_captcha_events_outcome_check" CHECK ("outcome" IN ('placed_submitted', 'no_token', 'missing_site_key', 'unsupported', 'credits', 'operator_parked', 'operator_solved', 'expired', 'sandbox'));

ALTER TABLE "lb_captcha_events" ADD CONSTRAINT "lb_captcha_events_attempt_check" CHECK ("attempt" BETWEEN 1 AND 4);

ALTER TABLE "lb_captcha_events" ADD CONSTRAINT "lb_captcha_events_creditsCharged_check" CHECK ("creditsCharged" >= 0);

CREATE INDEX "lb_captcha_events_workspaceId_projectId_createdAt_idx" ON "lb_captcha_events"("workspaceId", "projectId", "createdAt");

CREATE INDEX "lb_captcha_events_hostId_idx" ON "lb_captcha_events"("hostId");

CREATE INDEX "lb_captcha_events_runId_idx" ON "lb_captcha_events"("runId");

ALTER TABLE "lb_captcha_events" ADD CONSTRAINT "lb_captcha_events_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lb_captcha_events" ADD CONSTRAINT "lb_captcha_events_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "lb_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lb_captcha_events" ADD CONSTRAINT "lb_captcha_events_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "lb_hosts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "lb_captcha_events" ADD CONSTRAINT "lb_captcha_events_runId_fkey" FOREIGN KEY ("runId") REFERENCES "lb_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "lb_operator_tickets" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "runId" TEXT,
    "reason" TEXT NOT NULL,
    "screenUrl" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lb_operator_tickets_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "lb_operator_tickets" ADD CONSTRAINT "lb_operator_tickets_reason_check" CHECK ("reason" IN ('captcha_unsolved', 'two_factor', 'missing_password', 'admin_approval', 'unknown_page_state'));

ALTER TABLE "lb_operator_tickets" ADD CONSTRAINT "lb_operator_tickets_status_check" CHECK ("status" IN ('open', 'resolved', 'expired', 'skipped'));

CREATE UNIQUE INDEX "lb_operator_tickets_one_open_per_host" ON "lb_operator_tickets"("hostId") WHERE "status" = 'open';

CREATE INDEX "lb_operator_tickets_workspaceId_projectId_status_idx" ON "lb_operator_tickets"("workspaceId", "projectId", "status");

CREATE INDEX "lb_operator_tickets_hostId_idx" ON "lb_operator_tickets"("hostId");

CREATE INDEX "lb_operator_tickets_runId_idx" ON "lb_operator_tickets"("runId");

CREATE INDEX "lb_operator_tickets_status_expiresAt_idx" ON "lb_operator_tickets"("status", "expiresAt");

ALTER TABLE "lb_operator_tickets" ADD CONSTRAINT "lb_operator_tickets_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lb_operator_tickets" ADD CONSTRAINT "lb_operator_tickets_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "lb_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lb_operator_tickets" ADD CONSTRAINT "lb_operator_tickets_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "lb_hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lb_operator_tickets" ADD CONSTRAINT "lb_operator_tickets_runId_fkey" FOREIGN KEY ("runId") REFERENCES "lb_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
