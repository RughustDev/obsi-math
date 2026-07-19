# 1.1.5

## Maintenance

Maintenance release with **no user-facing feature changes**. This release
fixes a review error introduced in 1.1.4:

- Removed the `eslint-disable no-console` comments added in 1.1.4. Obsidian's
  automated review does not allow disabling that rule, so the comments were
  reported as an error. The intentional developer console (`lmath.*` in
  DevTools) and the terminal tracer CLI output are left in place and unchanged.

No changes were made to graphing, equation solving, or existing feature behavior.
