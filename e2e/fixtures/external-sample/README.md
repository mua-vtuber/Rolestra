# External Sample Fixture

Fixture folder consumed by `e2e/external-project-flow.spec.ts` when it
exercises the `kind='external'` project-creation path. The spec copies
this folder into a fresh temp directory per run (so the ArenaRoot
junction resolves to a location that is guaranteed to be removable) and
then feeds that path into the renderer through a stubbed
`project:pick-folder` IPC handler.

The contents are intentionally minimal — the spec only verifies that the
external folder exists and that a junction/symlink lands at
`<ArenaRoot>/projects/<slug>/link`. Nothing else reads these files.
