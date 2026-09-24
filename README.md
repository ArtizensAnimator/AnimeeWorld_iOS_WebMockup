# AnimeeWorld Web Mockup

This repository contains the browser source for the AnimeeWorld mockup. The same files are used by the Capacitor/Xcode project on the Mac and by a normal browser on Windows.

## How the Mac and Windows copies stay in sync

The canonical Mac web source is:

```text
/Users/khufu/Animee/animee-world-ios-webMockup/www
```

Make web changes there, test them, commit them, and push them to GitHub. On Windows, pull the commits and restart or refresh the browser.

```text
Mac edit -> git commit -> git push -> Windows git pull -> browser refresh
```

Git synchronization is deliberate rather than live. Uncommitted Mac changes do not appear on Windows.

## Run on macOS

Install a current Node.js LTS release, then run from this repository directory:

```sh
npm run dev
```

Open <http://127.0.0.1:8080/>. The development server has no third-party package dependencies, so `npm install` is not required just to run the mockup.

Before committing, run the syntax and background-asset checks:

```sh
npm run check
```

After changing the web source, update the iOS copy from the parent Capacitor project:

```sh
cd ..
npm run ios:sync
```

Do not edit `ios/App/App/public` directly. Capacitor regenerates it from this `www` directory.

## First setup on Windows

Install Git and a current Node.js LTS release. In PowerShell:

```powershell
git clone --depth 1 https://github.com/ArtizensAnimator/AnimeeWorld_iOS_WebMockup.git
cd AnimeeWorld_iOS_WebMockup
npm run dev
```

The shallow clone downloads the current mockup without also downloading superseded asset versions from older Git history. It can still pull, commit, and push normally.

Open <http://127.0.0.1:8080/>.

To receive later Mac changes:

```powershell
git pull --ff-only
```

Refresh the browser after the pull. If `npm run dev` is already running, the static server can remain running.

## Normal Mac development workflow

From the `www` directory:

```sh
git status
git add -A
git commit -m "Describe the AnimeeWorld change"
git push
```

If you also edit the web mockup on Windows, commit and push those changes from Windows. Before resuming on the Mac, run:

```sh
git pull --ff-only
```

Avoid editing the same file independently on both computers before synchronizing, because that can create a merge conflict.

## Asset policy

The active background tile pyramid under `img_assets/0000 BIG BACKGROUND STUFF/tiles/` is required at runtime and remains versioned. Although it contains many files, the individual tiles are reasonably sized and let the mockup stream only the visible part of the world.

The following local-only content is intentionally ignored:

- Full-resolution background authoring images under `images/`.
- The obsolete background tile copy under `tiles old/`.
- Operating-system metadata, editor backups, dependencies, and build caches.

Do not add ignored artwork with `git add --force`. If the active tile pyramid is regenerated, confirm that the mockup works before committing it.

## Important runtime notes

- Always use the local HTTP server; opening `index.html` through `file://` will break module and `fetch` requests.
- The local Spine runtime is versioned under `vendor/`, so the basic mockup does not rely on a CDN.
- Talking automatically discovers pose-compatible animations named `talk_<start>_<end>_<iteration>` from the loaded Spine skeleton. Tune category weights in `TALK_TRANSITION_DISCOVERY_OPTIONS` in `gameCode.js`; discovery and the reusable graph/runtime adapter live in `talkingStateMachine.js`.
- Never commit an OpenAI API key or place one directly in the browser application. A chatbot that needs a secret must call a secure server-side proxy.
