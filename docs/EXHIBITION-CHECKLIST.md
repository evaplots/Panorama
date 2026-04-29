# Exhibition submission checklist

A practical, opinionated checklist for submitting the Panorama portfolio
to a digital-art museum, gallery, or open call. Distinct from the
artistic statement (`EXHIBITION.md`) and the press kit
(`exhibition/PRESS-KIT.md`) — this file is operational: things to do, in
order, before sending.

---

## 1. The package the user is sending

A typical digital-art submission asks for **3–5 work samples + artist
statement + bio + CV**. The Panorama bundle covers:

- [x] **Work samples** — 6 print plates in `exhibition/` and 6 web JPEGs
      in `exhibition/web/` (most submissions want JPEG; some ask for PNG)
- [x] **Artist statement** — `EXHIBITION.md` (plate descriptions can be
      excerpted into a single-page statement if a strict word count is
      imposed)
- [x] **Press kit** — `exhibition/PRESS-KIT.md` (technical context if
      the application has a "describe the work technically" field)
- [x] **Contact sheet** — `exhibition/exhibition-contact-sheet.png` for
      a single-page visual summary
- [ ] **Bio** — *not yet written*; ~200 words on the artist's
      background, prior work, intent
- [ ] **CV / portfolio link** — *user-supplied*; should include the
      GitHub URL to demonstrate the work's open / reproducible nature
- [ ] **Headshot / artist photo** — *user-supplied*

## 2. Pre-submission technical checks

For each plate to be submitted:

- [ ] Open the file at 100 % zoom (no upscale interpolation) and verify
      no banding, no compression artefacts, no cropping mistakes
- [ ] Confirm dimensions are 4961 × 3508 px (A3 @ 300 DPI). Use file
      properties or `identify <file.png>` (ImageMagick) to verify
- [ ] Confirm sRGB colour profile is embedded (some museums require it
      explicitly; default Node-canvas output is sRGB but the profile
      tag may be absent — re-save through an image editor that embeds
      sRGB if so)
- [ ] If JPEG, quality should be ≥ 90; the existing `exhibition/web/`
      JPEGs are q85 (good for screen, but submit-quality JPEGs would
      regenerate with `--quality=95` in the build-thumbnails script)

## 3. Print preparation (if accepted for physical exhibition)

- [ ] Choose paper — recommended: heavyweight matte fine-art paper
      (e.g. Hahnemühle Photo Rag 308 gsm, or Canson Infinity Rag
      Photographique 310). The painterly textures do NOT suit gloss
- [ ] Discuss print bleed with the printer: A3 with full-bleed adds
      3 mm (~36 px at 300 DPI) per side; the current files are at-page
      size with no bleed, so either reprint with extension or accept
      a small white border
- [ ] Frame conservation: UV-protective museum glass + acid-free mat
      + linen tape hinge mounting. Float-mount works particularly
      well for these because the paper edge is part of the artefact
- [ ] Spec sheet for printer/framer: edition (single edition / open
      edition / limited), size (paper + image), paper, frame style.
      Each plate should have a matching spec to keep the series
      coherent

## 4. Reproducibility & provenance

The project's superpower is determinism — anyone can re-render any
plate. Include in the submission:

- [ ] Git commit hash of the renders included (`git log --oneline -1`
      at submission time, archived alongside the files)
- [ ] The exact command for each plate: `node scripts/pointillism-test.js
      v1.4-reproduce --filter=<scene> --curated --no-median
      --width-mm=1.2 --brush-stroke=2.0 --density=0.03`
- [ ] Source-image generation note: synthetic, not from real Three.js
      scene yet (this is honest and important — represents Phase 2.5,
      not the full vision)

## 5. Archive backup (before sending anything)

The 3-2-1 rule: **3 copies, 2 different storage media, 1 offsite**.

- [ ] Local: original repo on the working machine (already there)
- [ ] Offsite cloud: GitHub at <https://github.com/evaplots/Panorama>
      (PNG files are committed; the repo is the canonical archive)
- [ ] Second offsite: an external drive OR a second cloud (Google
      Drive, Dropbox, Backblaze B2). At ~80 MB for `exhibition/`
      and ~410 MB for the full `.iterations/` history, this fits
      easily on any modern external drive
- [ ] Optional: print one of each plate physically on archival paper
      and store flat in a print box — analogue backup, museum-grade

## 6. Rights, licensing, attribution

- [x] Software licensed MIT — `LICENSE` at project root
- [x] Rendered artworks licensed CC BY-NC-SA 4.0 — `LICENSE-ART.md` at
      project root, with explanation of the split-licence rationale and
      a sample attribution string
- [x] Painter palettes JSON dedicated to public domain (CC0) — declared
      in `LICENSE-ART.md`
- [ ] If submitting physical prints, decide edition size and signing
      protocol — most digital-art museums prefer either a small
      signed/numbered edition (e.g. 1/8) or a clear "open edition,
      not numbered" statement
- [ ] Painter palette references — Munch, Whistler, Kirchner, Turner,
      Marc, Nolde, Klimt, Macke, Soutine — all are public domain. The
      colour values in `palettes.json` are derived approximations, not
      reproductions of any specific painting. Note this if asked
- [ ] OpenStreetMap data (when used in future Three.js renders) is
      ODbL — attribution required

## 7. Submission tracker (template)

Copy this into a private document and fill out per submission:

```
Museum/gallery/open call:
  Name:
  URL:
  Deadline:
  Format required (PNG/JPEG/PDF/print):
  Word counts (statement / bio / description):
  Notification date:
  Submitted on:
  Confirmed receipt: [ ]
  Outcome: pending / accepted / declined
  Follow-up needed: [ ]
```

A common rookie mistake is submitting the same package to ten venues
with the same wording. Tailor the statement excerpt to each call's
themes; reference works in the venue's recent programming. The press
kit's "What's next" section gives natural hooks for venues focused on
climate-as-data or generative-art.

---

## Last item: ship it

A perfect package never sent is worse than a good-enough package sent.
The bundle in this repo is good. Pick three open calls from the next
60 days. Submit to all three this week.
