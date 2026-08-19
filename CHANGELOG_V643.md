# SLE v6.5.5
- Fixed Home refresh crash when `state.me` is temporarily `null`.
- `mainNav()` now uses optional chaining and a safe role value.
- `renderHome()` waits for an authenticated user object.
- `home()` reloads `/auth/me` before rendering if needed.
- All v6.4.2 fixes are preserved.
