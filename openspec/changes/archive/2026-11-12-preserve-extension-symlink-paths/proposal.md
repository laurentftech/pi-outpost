# Preserve extension directory aliases

## Why
Adding a symlink in Manage agent resources currently saves its real target, breaking the stable
alias when an extension update moves that target. Inventory normalization also replaces the root
used by Remove, so preserving persistence alone would leave removal broken.

## What changes
- Validate extension directories through their targets while storing the chosen absolute alias.
- Keep canonical inventory identities and repository checks, but retain the configured removal root.
- Show the configured extension folder alongside the loaded file when they differ.
- Verify persistence, repointing/restart, removal, rejected invalid paths and the running browser UI.

## Impact
Existing directory picker already preserves symlink spelling. Skill-path normalization, Git preview
confinement, extension locks and sandbox enforcement remain unchanged. OpenLore was unavailable
locally; targeted inspection found update_config validation and normalizeResources as the two
canonicalization boundaries, confirming the user's report and the implementation scope.
