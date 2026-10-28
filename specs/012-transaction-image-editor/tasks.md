# Tasks

- [x] Implement DUI InputRange and contrast-popover Storybook example.
- [x] Verify range binding, keyboard bounds/steps, disabled state, FormData/reset, and popover keyboard use in focused browser tests.
- [x] Implement geometry, pixel rendering, and imageEditorMachine.
- [x] Review the processing core before adding tests or presentation.
- [x] Add and run isolated geometry, pixel, platform, and machine unit coverage after review: 50 tests passed, including late bitmap/canvas acquisition, encoding cancellation, codec failure, and cleanup.
- [x] Implement pure editor presentation with movable handles, keyboard controls, grayscale toggle, contrast popover, and preview, plus an actor integration that drains on destruction.
- [ ] Review the editor presentation; then cover its capabilities, display failures, focus/keyboard behavior, preview and cleanup with tests.
- [x] Integrate a consumer-owned transaction image editor modal.
- [x] Integrate editing of new transaction image selections without modifying originals before Apply.
- [ ] After integration review, cover selection-owner cancellation/permission races and the real info-popover -> editor -> apply/cancel -> save browser flow.
- [x] Implement saved-attachment editing with preserved attachment identity, complete local-content checks, and an atomic metadata/parts/link replacement owner.
- [ ] Review saved-image editing; then verify writer/viewer/cross-account permissions, actual Jazz byte staging, rollback/uncertain settlement, offline edits, and persisted download contents.
- [ ] After presentation/integration approval, update and run relevant attachment/avatar Playwright scenarios and editor accessibility coverage.
