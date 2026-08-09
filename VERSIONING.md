# HollowRun versioning

The product version in the root `package.json` is the single source of truth. The packaged filename and Electron metadata use it directly, while the backend exposes it to the interface at runtime.

Use Semantic Versioning when preparing a distributable release:

- `npm run version:patch` for compatible bug fixes.
- `npm run version:minor` for compatible user-facing features.
- `npm run version:major` for breaking behavior, data, or API changes.

Each command changes the root version without requiring a clean Git working tree and without creating a commit or tag. It then synchronizes the backend, frontend, worker, splash helper, and lockfiles. `npm run build` also synchronizes versions before packaging, which protects builds made after a manual root-version edit.

Do not bump the version for every commit or TODO item. Bump it when the accumulated changes are ready to identify a new distributed build.
