## [ERR-20260711-001] npm-run-lint

**Logged**: 2026-07-11T00:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: config

### Summary
The TypeScript lint command could not start because project dependencies are not installed.

### Error
```
> obsidian-plugin@1.0.7 lint
> tsc --noEmit

sh: tsc: command not found
```

### Context
- Command attempted: `npm run lint`
- The repository contains `package-lock.json`, but no usable local `node_modules/.bin/tsc`.

### Suggested Fix
Run `npm ci` before linting or building the plugin.

### Metadata
- Reproducible: yes
- Related Files: package.json, package-lock.json

### Resolution
- **Resolved**: 2026-07-11T15:10:00+08:00
- **Notes**: `npm ci` exposed an out-of-sync lock file; `npm install` repaired it and installed dependencies. TypeScript lint and the production build then passed.

---

## [ERR-20260711-005] curl-github-tree

**Logged**: 2026-07-11T17:30:00+08:00
**Priority**: low
**Status**: resolved
**Area**: infra

### Summary
A GitHub API URL containing `?recursive=1` was interpreted as a zsh glob.

### Error
```
zsh: no matches found: https://api.github.com/.../trees/master?recursive=1
```

### Context
- The URL was passed to curl without shell quoting.

### Suggested Fix
Quote URLs containing shell glob characters such as `?` and `&`.

### Metadata
- Reproducible: yes
- Related Files: none

### Resolution
- **Resolved**: 2026-07-11T17:30:00+08:00
- **Notes**: Continued with a quoted URL.

---

## [ERR-20260711-004] macos-finder-clipboard

**Logged**: 2026-07-11T16:25:00+08:00
**Priority**: high
**Status**: resolved
**Area**: backend

### Summary
Finder file URLs could not be read because a JavaScript array was passed where AppKit required an NSArray of pasteboard reading classes.

### Error
```
The class {} does not implement the NSPasteboardReading protocol and cannot be used with NSPasteboard -readObjectsForClasses:options:.
```

### Context
- The plugin passed `[$.NSURL]` to `readObjectsForClassesOptions` from JXA.
- JXA bridged that value as an invalid class object and returned an empty file list.

### Suggested Fix
Construct native bridge values explicitly with `$.NSArray.arrayWithObject($.NSURL)` and `$.NSDictionary.dictionary`.

### Metadata
- Reproducible: yes
- Related Files: src/main.ts, main.js

### Resolution
- **Resolved**: 2026-07-11T16:25:00+08:00
- **Notes**: The corrected script successfully returned the Finder clipboard file path, and lint/build passed.

---

## [ERR-20260711-003] git-ls-remote

**Logged**: 2026-07-11T15:30:00+08:00
**Priority**: low
**Status**: pending
**Area**: infra

### Summary
Remote GitHub refs could not be queried from the network-restricted sandbox.

### Error
```
fatal: unable to access 'https://github.com/EdgerHao/Obsidian-Natural-Move-Export.git/': Could not resolve host: github.com
```

### Context
- Command attempted: `git ls-remote --heads --tags origin`
- Network access is restricted inside the default shell sandbox.

### Suggested Fix
Retry the read-only remote query with approved network access.

### Metadata
- Reproducible: yes
- Related Files: .git/config

---

## [ERR-20260711-002] git-add

**Logged**: 2026-07-11T15:20:00+08:00
**Priority**: low
**Status**: resolved
**Area**: config

### Summary
Git staging could not create `.git/index.lock` inside the filesystem sandbox.

### Error
```
fatal: Unable to create '.git/index.lock': Operation not permitted
```

### Context
- Command attempted: `git add ...`
- Workspace source files are writable, while `.git` is read-only in the sandbox profile.

### Suggested Fix
Run the scoped Git staging command with approved elevated filesystem access.

### Metadata
- Reproducible: yes
- Related Files: .git/index

### Resolution
- **Resolved**: 2026-07-11T15:20:00+08:00
- **Notes**: Continued with an approval-scoped Git operation; no source files were changed by the failure.

---
