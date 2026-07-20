# 1.1.9

## Maintenance

Maintenance release with **no user-facing feature changes**. It clears the
settings-related item from Obsidian's automated plugin review by adopting the
declarative settings API introduced in Obsidian 1.13. No graphing,
equation-solving, derivative, integral, or parsing behavior was changed, and the
settings panel looks and behaves the same.

- **Declarative settings API.** The settings tab now implements
  `getSettingDefinitions()`, so on Obsidian 1.13 or later the plugin's settings
  are indexed by the built-in settings search. The imperative `display()` render
  is kept as a fallback for older versions, so the panel continues to work
  exactly as before on the currently supported releases.
- **Minimum app version.** `minAppVersion` is now `1.12.7`.

Existing behavior is unchanged: the full test suite passes exactly as before.
