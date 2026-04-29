# Licence — rendered artworks

The painted outputs produced by Panorama (the PNG and JPEG files in
`exhibition/`, `exhibition/process/`, `exhibition/web/`, and the
`.iterations/*/` directories) are licensed under the **Creative Commons
Attribution-NonCommercial-ShareAlike 4.0 International License**
(CC BY-NC-SA 4.0).

Full licence text: <https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode>
Human-readable summary: <https://creativecommons.org/licenses/by-nc-sa/4.0/>

In short: you are free to share and adapt the rendered images, **for
non-commercial purposes**, **provided you credit the work**, and **provided
any derivative work is shared under the same license**.

---

## Why split licences

The software (MIT, see `LICENSE`) and the rendered artworks (CC BY-NC-SA 4.0)
are two different kinds of thing:

- The **software** is open infrastructure. MIT keeps it useful to anyone
  building generative-art tools, gives them the freedom to repurpose the
  algorithms (especially the to-pointillism port and the curated palette
  set), and matches the licensing of the upstream
  [`guillaume-gomez/to-pointillism`](https://github.com/guillaume-gomez/to-pointillism)
  algorithm reference.

- The **rendered artworks** are exhibition objects. CC BY-NC-SA 4.0 is the
  standard for fine-art generative work. Non-commercial restriction means
  galleries, museums, students, and journalists may freely use them
  (with credit) without commercial republication; ShareAlike ensures any
  remix stays in the open-art commons rather than being absorbed into
  a closed product.

If you want to use a rendered work commercially (e.g. for a book cover, a
product, or a paid exhibition), please contact the author for a separate
commercial licence — the answer is usually yes, and the per-image fee
generally helps fund continued work on the project.

## Painter palette references

The nine curated palettes (`src/style/palettes.json`) are colour-value
approximations derived from public-domain reference works by Edvard Munch,
E. L. Kirchner, Chaïm Soutine, J. M. Whistler, J. M. W. Turner, Franz Marc,
Emil Nolde, Gustav Klimt, and August Macke — all painters whose works are
in the public domain. The palette JSON itself is curatorial work by the
project author and is licensed under CC0 1.0 (public domain dedication)
for maximum reusability. See `src/style/palettes.json` and
[CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).

## OpenStreetMap data (when present)

When real OpenStreetMap data is incorporated into renders (Phase 2 buildings,
Phase 3 vegetation, etc.), the render carries an additional attribution
obligation: "© OpenStreetMap contributors, available under the [Open
Database License](https://opendatacommons.org/licenses/odbl/)". This applies
to any rendered output that includes OSM-derived geometry; pure-pointillism
renders from synthetic sources (e.g. the current six exhibition plates) do
not have this requirement.

## Attribution example

When sharing a rendered image:

> *Sturm* (storm seascape, after Nolde) by Eva Bonaccorsi / Panorama,
> CC BY-NC-SA 4.0.
> Source code: <https://github.com/evaplots/Panorama>

For social media, a short form is acceptable:

> by Eva Bonaccorsi / Panorama (CC BY-NC-SA)
