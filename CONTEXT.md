# Gitlane domain

**File-change tree** — the grouped view of a commit’s (or compare’s) `FileChange` list: folders, basenames, rename labels (`old → new`), and depth. The module interface is `buildFileChangeTree`; HTML for the details pane is an adapter over those nodes.

**Uncommitted node** — the working-tree row (`hash` `*`) prepended when the worktree is dirty.

**Stash base** — the commit a stash was created from; stash rows sit immediately above that base in the newest-first list.

**Commit graph** — newest-first commits plus lane layout (`vertices`, `branches`) served to the UI. The module interface is `assembleCommitGraph` (stash insert, ref attach, lanes); `getCommits` is the git subprocess adapter.
