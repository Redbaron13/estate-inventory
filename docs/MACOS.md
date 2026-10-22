# Mac application

Estate Inventory includes a macOS 13 or later app for Apple silicon and Intel Macs. It presents the live inventory in a native WebKit window, with photo selection, camera permission prompts, text dialogs and export saving. It shares the existing database, family choices and reports.

The first launch needs internet. The app keeps a persistent website data store, separate from Safari and Chrome. Sign in inside the app. Before switching devices or browsers, wait for pending changes to sync. The website's offline support depends on WebKit; offline capture and export must be checked on a physical Mac before relying on them for irreplaceable records. Mobile, Windows and Linux installation uses the responsive PWA described in `USER-GUIDE.md`.

## Run on a Mac

Install Node 22 or later and Xcode command line tools. In the repository root:

```sh
./script/build_and_run.sh
```

The command builds a Swift package, stages `dist/macos/<architecture>/Estate Inventory.app`, applies a local ad hoc signature, and opens the bundle. The Codex Run action invokes the same command. No npm install is needed to build the native host.

Options: `--build-only`, `--release`, `--arch arm64`, `--arch x86_64`, `--verify`, `--debug` and `--logs`. Verification opens the real bundle, checks its rendered inventory and records a screenshot plus JSON result in `test-results/macos`. Development bundles use a separate bundle identifier and a `ZYMC…` release ID.

The About menu shows the native host's version and ID. Family and settings inside the inventory shows the web release version and ID. Website updates arrive through the existing web pipeline; native host changes require a new Mac download.

## CI and distribution

Every pull request runs the Swift navigation tests, builds both architectures and launches the host architecture on a Mac runner. CI saves ZIP previews and a screenshot as a workflow artifact. ZIPs preserve the executable permission. Previews use development IDs and ad hoc signing. They are for local testing, and are not notarized public releases.

After a successful production web deployment, the Mac release job checks the six Apple secrets documented in `../textfile/README.md`. If any are absent, it reports that signing is unavailable and publishes no Mac release. With all six configured, it reserves distinct `MCx1…` and `MCx6…` IDs in the shared registry, builds, signs with Developer ID, notarizes, staples, checks Gatekeeper and publishes ZIP downloads with SHA-256 checksums on GitHub Releases. Failed reservations stay in the registry and are not reused. Release tags include the version and a reserved Mac deployment ID. Assets are uploaded to a draft before publication; retries replace the same named assets only after checking the source commit. Download the ZIP and SHA256SUMS.txt into one folder, then run `shasum -a 256 -c SHA256SUMS.txt`.

The certificate is imported into an ephemeral keychain and removed after the job. Never put Apple credentials, deployment tokens or service-role keys in the app bundle.

Navigation stays inside this inventory's HTTPS path. External links open in the default browser after a user click. The app has no JavaScript-to-native command bridge. File and camera access remains subject to system dialogs.

## Physical device release check

Before family use, check password sign-in, opening an estate, importing several photos in Batch inventory, save and sync, quitting and reopening, a PDF and ZIP export, camera permission denial and retry, and capturing after disconnecting the network. CI's initial-window check does not cover those signed-in device flows.
