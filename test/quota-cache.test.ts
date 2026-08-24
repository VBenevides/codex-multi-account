import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { AccountRepository } from "../src/accounts/accountRepository.js";
import { writeStateFile } from "../src/accounts/accountService.js";
import { resolvePaths } from "../src/config/paths.js";
import { QuotaService } from "../src/usage/quotaService.js";

const auth = (token: string) =>
  Buffer.from(
    JSON.stringify({ tokens: { access_token: token, refresh_token: `refresh-${token}` } }),
  );

test("quota cache keeps last checks for accounts queried over time", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-quota-cache-"));
  try {
    const paths = resolvePaths(home);
    const repository = new AccountRepository(paths);
    const first = await repository.createProfile("First");
    const second = await repository.createProfile("Second");
    await repository.writeProfileAuth(first.id, auth("first"));
    await repository.writeProfileAuth(second.id, auth("second"));
    let requests = 0;
    const request: typeof fetch = async (_url, init) =>
      ({
        ok: true,
        json: async () => ({
          rate_limit: {
            primary_window: {
              used_percent:
                new Headers(init?.headers).get("authorization") === "Bearer first" ? 20 : 40,
            },
          },
        }),
      }) as Response;
    await writeStateFile(paths.statePath, {
      version: 1,
      selectedProfileId: first.id,
      selectedProfileSlug: first.slug,
    });
    const all = new QuotaService(
      repository,
      async (url, init) => {
        requests += 1;
        return request(url, init);
      },
      { policy: "all" },
    );
    await all.list();
    assert.equal(requests, 2);
    await writeStateFile(paths.statePath, {
      version: 1,
      selectedProfileId: second.id,
      selectedProfileSlug: second.slug,
    });
    await new QuotaService(repository, request, { policy: "all" }).list();

    const cached = await new QuotaService(repository, request, { policy: "disabled" }).list();
    assert.deepEqual(
      cached.map((quota) => quota.name),
      ["First", "Second"],
    );
    assert.equal(
      cached.every((quota) => typeof quota.lastCheckedAt === "string"),
      true,
    );
    const stored = await readFile(path.join(paths.cmaHome, "quota-cache.json"), "utf8");
    assert.doesNotMatch(stored, /access_token|refresh_token/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
