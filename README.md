# Converto

Drop a file on it, click the format you want, get the result next to the original. No terminal, no Python, no ffmpeg, no accounts, no internet.

**Status: version 0.1 covers tiers 1 and 2** (images, images ↔ PDF, notebooks). Documents, audio/video, data files and the rest come next; see [What works](#what-works).

---

## Getting Converto (for everyone)

Go to the **download page** and click the big button. It picks Windows or Mac for you.

`https://zagreusjc.github.io/converto/`

(Direct links that always give the newest version: `.../releases/latest/download/Converto-Setup.exe`, `Converto-Portable.exe` for Windows, and `Converto-Mac.dmg` for Mac, all under `https://github.com/Zagreusjc/converto`.)

## Publishing a new version (owner only)

The website and downloads update themselves. You only do this:

1. One-time setup: on GitHub open **Settings → Pages** and set **Source** to **GitHub Actions**.
2. To release: in the **Releases** area create a new release with a new tag such as `v0.1.0` (or run `git tag v0.1.0 && git push origin v0.1.0`).
3. Wait about 15 minutes. GitHub builds the Windows and Mac installers and attaches them to that release. The download page's buttons point to the latest release, so they start working as soon as it appears.

To just test a build without releasing: **Actions → Build installers → Run workflow**, then download the files from the bottom of the finished run.

## Installing, and the warning screens

The app is **not code-signed** (that costs money every year), so both systems show a warning the first time. This is normal and only happens once.

### Windows: "Windows protected your PC" (SmartScreen)

1. Double-click the `.exe`.
2. A blue box says **Windows protected your PC**. Click the small **More info** link.
3. A **Run anyway** button appears. Click it.
4. The installer finishes in a few seconds and Converto opens. (The portable `.exe` simply opens.)

### macOS: "Apple could not verify…" (Gatekeeper)

1. Open the `.dmg` and drag **Converto** onto **Applications**.
2. Open **Applications** and double-click **Converto**. macOS says it can't verify the app. Click **Done** (not *Move to Trash*).
3. Open **System Settings → Privacy & Security**, scroll down to the **Security** section. You'll see *"Converto" was blocked…*. Click **Open Anyway**, then enter your password or use Touch ID, then click **Open Anyway** once more.
4. From now on it opens normally.

On older macOS (Ventura 13 or Sonoma 14) you can instead **right-click → Open → Open** in step 2.

If a Mac ever says the app is *"damaged and can't be opened"*, use **System Settings → Privacy & Security → Open Anyway** as above. If that button doesn't show, that's the one case that needs a terminal command; tell me and I'll make a fix rather than have you do that.

## Using it

1. Open Converto and drop files on the big area (or click **Browse…**). You can also drop files onto the Converto icon in the Dock/taskbar.
2. Click one of the big format buttons. Only formats that make sense for your files are shown.
3. The result is saved next to the original, never replacing anything. If the name exists you get `photo (1).png`, `photo (2).png`, …
4. Click **Show in folder**.

The checkbox **Remove metadata and dates** is remembered between launches. When ticked, results have no photo locations or camera info, no PDF title/author/dates, no hidden text chunks in PNGs, and notebooks lose their execution counts and metadata.

If one file in a batch can't be converted, the rest still go through and the damaged one gets a short plain-English explanation.

## What works

| Tier | Status | Notes |
|---|---|---|
| 1. Images | ✅ in 0.1 | JPG, PNG, WebP, HEIC, GIF, BMP, TIFF, ICO convert between each other and to PDF. **HEIC can be opened but not created** (see below). PDFs convert to PNG/JPG/WebP/TIFF; multi-page PDFs go into their own folder, one image per page. Animated GIF ↔ WebP keeps its frames. |
| 2. Notebooks | ✅ in 0.1 | `.ipynb` → PDF, HTML, PY, MD. The PDF shows code, printed output, plots, tables, maths and error messages; long lines wrap instead of being cut off. MD puts plots in a `<name>_files` folder. |
| 3. Documents | ⏳ next | md, html, txt, docx, epub ↔ pdf and each other (adds the bundled pandoc). `.ipynb` → DOCX arrives with it. |
| 4. Audio & video | ⏳ | adds the bundled ffmpeg. |
| 5. Data | ⏳ | csv, xlsx, json, yaml. |
| 6. Office files, archives | ⏳ | docx/pptx/xlsx → PDF only if it can be done without a huge bundle; I'll tell you honestly then. |

**Things this version deliberately can't do**

- **Create HEIC files.** Writing HEIC needs a video-codec (HEVC) encoder that can't be bundled legally or practically. HEIC photos can be turned into JPG, PNG, WebP, PDF, etc.
- **Interactive notebook output** (Plotly, widgets) can't run offline in a PDF, so those show their text fallback instead.
- **EXIF from HEIC photos** (date, camera) isn't carried over when you turn them into JPG/PNG with the box unticked. (Ticked, nothing is carried over anyway.)
- **Windows has not been run on a Windows machine yet by me**: see [Testing](#how-it-was-tested).

## Privacy

Everything happens on your computer. The app makes no network requests (they're blocked inside the app), has no accounts and no analytics, and doesn't upload anything.

## How it was tested

Tested on macOS (Apple Silicon) with real files: photos with EXIF/GPS and rotation tags, a real HEIC made by macOS, PNGs with embedded text, animated GIF, BMP, TIFF, ICO, a 3-page PDF, a password-protected PDF, damaged files, and a notebook that was actually executed (plots, a pandas table, maths, coloured error trace, stderr). 72 automated checks run against them (`npm test`), plus 16 checks that drive the real window (`node test/run-ui.js`), plus a self-test of the *packaged* app.

**Not tested** (I only have one Mac): the Windows build (it's built by GitHub; the code has no OS-specific paths except where noted in the code, but it hasn't been run), the Intel half of the Mac app (no Rosetta here), and a real human drag from Finder/Explorer (automated drags can't carry file paths; the Browse button uses the standard system dialog, and the drop code uses Electron's documented `webUtils.getPathForFile`). Please try drop *and* Browse the first time, on both systems, and tell me what you see.

## For developers

```
npm install        # once
npm start          # run the app
npm test           # converters, against real sample files (runs inside Electron)
node test/run-ui.js
npm run dist:dir   # unpacked app for your own OS, quick check
npm run dist:mac   # universal .dmg (macOS only; run `node scripts/add-mac-intel-libs.js` first)
npm run dist:win   # Windows installer + portable (Windows only; use the GitHub workflow)
```

Layout: `src/main/registry.js` is the one place that says what can become what; each family of formats has a module in `src/main/converters/`. Sample files are in `test/fixtures` (regenerate with `test/make-fixtures.py`; only developers need Python for that).
