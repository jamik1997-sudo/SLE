# SLE v6.5.3
- Fixed `normalizeShopCode is not defined`.
- `normalizeShopCode()` is now a verified top-level helper and accepts only A-Z / 0-9.
- Reworked GPS acquisition with a dedicated top-level `requestVisitLocation()`.
- GPS uses high accuracy, 15-second timeout and clear error messages.
- GPS coordinates are persisted locally for Offline Mode and synced when online.
- Added delegated GPS button binding so render timing cannot break the location button.
- Reverified critical Offline Mode helpers are top-level.
- Bumped cache version to 6.5.3.
