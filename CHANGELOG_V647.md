# SLE v6.4.8
- Fixed `syncOfflineSnapshot is not defined`.
- Rebuilt `syncOfflineSnapshot()` and `syncStoredOfflineDrafts()` at true global scope.
- Verified critical offline helper functions are top-level.
- Added guarded calls so offline sync cannot crash the questionnaire UI.
- Bumped cache version to 6.4.8.
