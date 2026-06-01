# Release Checklist

Use this before publishing a public tag or npm package.

1. Confirm the branch is `main`.
2. Confirm the public GitHub repository exists and `origin` points at it.
3. Confirm the npm package name and README install commands match the release plan.
4. Confirm one-time npm trusted publishing setup:

   - the npm package is owned by the publishing account or organization;
   - the GitHub repository is configured as a trusted publisher for the package;
   - the protected GitHub environment is named `npm`, matching `.github/workflows/release.yml`;
   - the release workflow has `id-token: write` and publishes with provenance.

5. Remove local graph artifacts:

   ```bash
   npm run clean
   ```

6. Run the full source gate:

   ```bash
   npx playwright install chromium
   npm run validate
   npm audit --audit-level=moderate
   ```

7. Commit with a public-safe author identity.
8. Push `main` to `origin`.
9. Create and check out a `vX.Y.Z` tag that matches `package.json` and points at `origin/main`.
10. Prove the package path from that exact tag:

   ```bash
   npm pack --dry-run
   npm run smoke:package
   npm run check:release
   ```

11. Review package contents for accidental graph data, private paths, or local-only files.
12. Push the tag.
13. Let the protected `Release` workflow publish through npm trusted publishing.

The Release workflow enforces exact tag publishing before it calls `npm publish`.

For a first-release bootstrap or emergency manual publish from a clean `main` checkout, complete the same checks and publish without GitHub OIDC provenance:

```bash
npm run check:release
npm publish --access public
```

After a manual publish, push the matching tag. The Release workflow is idempotent and exits cleanly when the exact package version already exists on npm.

Do not publish from a dirty worktree. Do not publish a package that requires a private Logseq graph to start; `living-atlas --demo` must work from the installed package.
