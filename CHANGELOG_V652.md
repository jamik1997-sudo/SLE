# SLE v6.5.5

- Fixed required `analysis_2` comment persistence.
- Changing 1/0 no longer clears an existing comment.
- Autosave now sends the actual answer comment instead of `comment: null`.
- Required comment is synchronized while typing and on change.
- Backend validates the comment from a fresh Answer query, avoiding stale relationship data.
- Admin can force-complete an audit with missing required fields.
- Force-complete requires an explicit confirmation in the UI.
- Backend rejects `force=true` for every role except Admin.
- Forced completion is marked in ActivityLog.
