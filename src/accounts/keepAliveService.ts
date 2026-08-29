import { AccountRepository } from "./accountRepository.js";
import { resolveProfilePaths } from "../config/paths.js";
import { ProcessRunner } from "../infra/process.js";
import { QuotaService, type AccountQuota } from "../usage/quotaService.js";

const KEEP_ALIVE_INTERVAL_MS = 30 * 60 * 1000;
const KEEP_ALIVE_CHECK_INTERVAL_MS = 60 * 1000;
const KEEP_ALIVE_RESET_MINUTES = 4 * 60 + 58;
const KEEP_ALIVE_RESET_MAX_MINUTES = 5 * 60;
export const KEEP_ALIVE_STATE_KEY = "cma.keepAlive.lastRefreshAt";
const KEEP_ALIVE_PROMPT =
  'Repeat the word "Hi" exactly 1000 times, separated by spaces. Do not add anything else.';
const KEEP_ALIVE_MODEL = "gpt-5.6-luna";
const KEEP_ALIVE_TIMEOUT_MS = 5 * 60 * 1000;

type KeepAliveState = {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
};
type QuotaReader = () => Promise<AccountQuota[]>;

export class KeepAliveService {
  private timer?: ReturnType<typeof setInterval>;
  private controller?: AbortController;
  private running = false;

  constructor(
    private readonly repository = new AccountRepository(),
    private readonly process: Pick<ProcessRunner, "discover" | "run"> = new ProcessRunner(),
    private readonly binaryPath?: string,
    private readonly state?: KeepAliveState,
    private readonly now = () => Date.now(),
    private readonly readQuotas: QuotaReader = () =>
      new QuotaService(this.repository, fetch, { policy: "all" }).current(),
  ) {}

  async start(): Promise<void> {
    if (this.timer) return;
    this.controller = new AbortController();
    // ponytail: one-minute quota polling keeps the two-minute window observable; use reset-timed scheduling if request volume matters.
    this.timer = setInterval(() => void this.run(), KEEP_ALIVE_CHECK_INTERVAL_MS);
    this.timer.unref?.();
    await this.run();
  }

  runNow(): Promise<void> {
    return this.run(true);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.controller?.abort();
    this.controller = undefined;
  }

  private async run(force = false): Promise<void> {
    const controller = this.controller;
    if (this.running || !controller || controller.signal.aborted) return;
    this.running = true;
    try {
      const binary = await this.process.discover(this.binaryPath);
      if (!binary) return;
      const lastRefreshAt =
        this.state?.get<Record<string, number>>(KEEP_ALIVE_STATE_KEY) ?? Object.create(null);
      const dueProfiles = [];
      for (const profile of await this.repository.listProfiles()) {
        if (controller.signal.aborted) return;
        if (!(await this.repository.profileAuthExists(profile.id))) continue;
        const lastRefresh = lastRefreshAt[profile.id];
        if (
          !force &&
          typeof lastRefresh === "number" &&
          this.now() - lastRefresh < KEEP_ALIVE_INTERVAL_MS
        )
          continue;
        dueProfiles.push(profile);
      }
      if (!dueProfiles.length) return;

      let quotas: AccountQuota[];
      try {
        quotas = await this.readQuotas();
      } catch {
        return;
      }
      const dailyResetByProfile = new Map(
        quotas
          .filter((quota): quota is AccountQuota & { profileId: string } => !!quota.profileId)
          .map((quota) => [quota.profileId, quota.windows?.[0]?.resetsAt ?? quota.resetsAt]),
      );
      for (const profile of dueProfiles) {
        if (!isKeepAliveReset(dailyResetByProfile.get(profile.id), this.now())) continue;
        try {
          const result = await this.process.run(
            binary,
            [
              "exec",
              "--ephemeral",
              "--sandbox",
              "read-only",
              "--skip-git-repo-check",
              "--config",
              'cli_auth_credentials_store="file"',
              "--model",
              KEEP_ALIVE_MODEL,
              "--config",
              'model_reasoning_effort="low"',
              KEEP_ALIVE_PROMPT,
            ],
            {
              env: {
                CODEX_HOME: resolveProfilePaths(this.repository.paths, profile.slug).directory,
              },
              signal: controller.signal,
              timeoutMs: KEEP_ALIVE_TIMEOUT_MS,
            },
          );
          if (result.code !== 0 || controller.signal.aborted) continue;
          lastRefreshAt[profile.id] = this.now();
          if (this.state) await this.state.update(KEEP_ALIVE_STATE_KEY, lastRefreshAt);
        } catch {
          // One unavailable account must not prevent the other accounts from running.
        }
      }
    } catch {
      // Keep-alive is best effort and must not interrupt VS Code activation.
    } finally {
      this.running = false;
    }
  }
}

function isKeepAliveReset(value: string | null | undefined, now: number): boolean {
  const reset = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(reset)) return false;
  const minutes = Math.round((reset - now) / 60_000);
  return minutes >= KEEP_ALIVE_RESET_MINUTES && minutes <= KEEP_ALIVE_RESET_MAX_MINUTES;
}
