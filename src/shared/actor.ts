import { execFileSync } from "node:child_process";

/**
 * Best-effort identity of the human running the CLI/MCP command.
 *
 * The API key authenticates the project (org+project_id), but it's
 * commonly shared across a team (in `i1n.config.json` or a CI secret).
 * To improve attribution in the dashboard's Audit Log (Phase 2), we
 * read the dev's git config and forward it as request headers.
 *
 * IMPORTANT: this is a *hint*, not authentication. Anyone can
 * override their git config to spoof someone else. The server stores
 * these as `actor_email_hint` / `actor_name_hint` (clearly marked as
 * unverified). For cryptographically verified per-dev attribution
 * we'd need SSO + per-dev tokens — not in scope yet.
 *
 * Order of precedence:
 *   1. Recognised CI environment (deterministic, well-known)
 *   2. Local `git config` user.email / user.name
 *   3. Fall back to source='unknown' (no identification)
 *
 * On any failure (no git installed, not in a repo, etc.) we silently
 * return source='unknown'. The CLI must keep working even when
 * actor detection fails.
 */
export interface ActorIdentity {
  email?: string;
  name?: string;
  source: string;
}

export function getActorIdentity(): ActorIdentity {
  // CI environments — deterministic, prefer over git.
  if (process.env.GITHUB_ACTIONS === "true") {
    return {
      email: process.env.GITHUB_ACTOR
        ? `${process.env.GITHUB_ACTOR}@users.noreply.github.com`
        : "actions@github.com",
      name: process.env.GITHUB_ACTOR ?? "github-actions[bot]",
      source: "ci/github",
    };
  }
  if (process.env.GITLAB_CI === "true") {
    return {
      email: process.env.GITLAB_USER_EMAIL,
      name: process.env.GITLAB_USER_NAME ?? process.env.GITLAB_USER_LOGIN,
      source: "ci/gitlab",
    };
  }
  if (process.env.CIRCLECI === "true") {
    return {
      email: process.env.CIRCLE_USERNAME
        ? `${process.env.CIRCLE_USERNAME}@circleci`
        : undefined,
      name: process.env.CIRCLE_USERNAME ?? "circleci",
      source: "ci/circle",
    };
  }
  if (process.env.BUILDKITE === "true") {
    return {
      email: process.env.BUILDKITE_BUILD_AUTHOR_EMAIL,
      name: process.env.BUILDKITE_BUILD_AUTHOR,
      source: "ci/buildkite",
    };
  }
  if (process.env.CI === "true") {
    // Generic CI — known to be CI but vendor unknown
    return { source: "ci/unknown" };
  }

  // Local: try git config. Both reads are best-effort.
  const email = safeGitConfig("user.email");
  const name = safeGitConfig("user.name");

  if (email || name) {
    return { email, name, source: "git" };
  }

  return { source: "unknown" };
}

function safeGitConfig(key: string): string | undefined {
  try {
    // execFileSync avoids spawning a shell — eliminates the
    // (currently theoretical) shell-injection surface and is faster
    // since there's no PATH/quoting layer. Argument is passed
    // verbatim to git which validates the key format itself.
    const result = execFileSync("git", ["config", "--get", key], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"], // mute stderr noise
      timeout: 500,
    }).trim();
    return result || undefined;
  } catch {
    return undefined;
  }
}
