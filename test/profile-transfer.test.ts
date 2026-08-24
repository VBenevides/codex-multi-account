import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";
import { AccountRepository } from "../src/accounts/accountRepository.js";
import { ProfileTransferService } from "../src/accounts/profileTransferService.js";
import { resolvePaths } from "../src/config/paths.js";

test("exports metadata without reading or including auth bytes and imports a new profile", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-transfer-"));
  try {
    const repository = new AccountRepository(resolvePaths(home));
    const original = await repository.createProfile("Personal");
    await repository.updateProfileIdentity(original.id, { email: "user@example.com" });
    await repository.writeProfileAuth(
      original.id,
      Buffer.from(JSON.stringify({ tokens: { access_token: "must-not-export" } })),
    );
    const service = new ProfileTransferService(repository);

    const document = await service.exportMetadata(original.id);
    assert.equal(document.includes("must-not-export"), false);
    assert.deepEqual(JSON.parse(document).profile.identity, { email: "user@example.com" });
    const imported = await service.importMetadata(document);

    assert.notEqual(imported.id, original.id);
    assert.equal(imported.name, "Personal");
    assert.deepEqual(imported.identity, { email: "user@example.com" });
    assert.equal(await repository.profileAuthExists(imported.id), false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("rejects invalid transfer schemas and unsafe imported slugs", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cma-transfer-invalid-"));
  try {
    const repository = new AccountRepository(resolvePaths(home));
    const service = new ProfileTransferService(repository);
    const base = {
      format: "cma-profile-metadata",
      version: 1,
      profile: {
        version: 1,
        id: "profile-id",
        name: "Imported",
        slug: "imported",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    };

    await assert.rejects(
      () => service.importMetadata(JSON.stringify({ ...base, version: 2 })),
      /invalid/i,
    );
    await assert.rejects(
      () =>
        service.importMetadata(
          JSON.stringify({ ...base, profile: { ...base.profile, slug: "../escape" } }),
        ),
      /invalid|slug|unsafe/i,
    );
    await assert.rejects(
      () =>
        service.importMetadata(
          JSON.stringify({ ...base, profile: { ...base.profile, name: "bad/name" } }),
        ),
      /invalid/i,
    );
    assert.deepEqual(await repository.listProfiles(), []);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
