# 1.2.0

## Supply chain

Maintenance release with **no user-facing feature changes**. It clears the
artifact-attestation item from Obsidian's automated plugin review by publishing
build provenance for the release assets. No graphing, equation-solving,
derivative, integral, or parsing behavior was changed.

- **Artifact attestations.** Releases now publish GitHub Artifact Attestations
  (SLSA build provenance) for `main.js` and `styles.css`, so anyone can
  cryptographically verify that the distributed assets were produced from this
  repository. A GitHub Actions workflow generates the attestations automatically
  when a release is published.
- **No plugin code changes.** Only release tooling was added; the plugin build is
  identical to 1.1.9.
- **Pinned `obsidian` dev dependency.** The `obsidian` devDependency was changed
  from `latest` to an exact `1.13.1` for reproducible builds. This is a
  development-only change: it does not affect the shipped bundle (the types
  already resolved to 1.13.1), so `main.js` remains identical to 1.1.9.

Existing behavior is unchanged: the full test suite passes exactly as before.
