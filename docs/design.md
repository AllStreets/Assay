# Assay: design

Assay accounts for every piece of software on a Mac, down to the open-source libraries inside it, checks each piece against what is publicly known to be broken or malicious, and lets you act on what it finds. AI models are the centerpiece, because they are the newest and least examined supply chain on a modern machine.

## Why

In September 2023 a heap overflow in libwebp (CVE-2023-4863) affected Chrome and every Electron app that bundled it. Almost nobody could tell which apps on their own machine carried it. In 2024 researchers found models on Hugging Face that run code the moment they are loaded. Both questions have the same shape: is this on my machine, where, and how do I get it out? Assay answers that in seconds, for a person, on their own Mac.

## Goals

- One inventory of everything: apps, AI models, browser and VS Code extensions, Homebrew/npm/pip global packages, Docker images.
- Each item read down to its parts: npm packages inside Electron apps, the Electron and Chromium versions they carry, Python packages, model formats and metadata.
- A vulnerability check against OSV.dev, and a malware check for models that never loads them.
- A trace from any flaw up to the thing the person actually uses.
- Actions on every finding, each undoable: update, roll back, quarantine, move to Trash.
- An interface with its own identity and a README as strong as Teardown's.

## Non-goals

- Real-time protection or blocking network traffic (needs Apple-signed extensions).
- Judging code quality or licenses beyond reporting them.
- Any AI-generated conclusion. Every claim comes from a file, a header, a version string, or a published advisory.

## Anti-goals (it fails even if it works)

- A wall of CVEs nobody can act on.
- A finding without evidence the reader can check.
- Anything that loads, runs or modifies a model or app without a button press.
- A copy of Teardown's look.

## The bar

From the Teardown work: a tool, not information; one deep capability; real, checkable data; undo on every action; its own visual identity; open source and built from source; extremely high, professional quality.

## How it is built (decided)

- Engine: TypeScript on Node, local only, bound to 127.0.0.1. Uses system tools (plutil, codesign, otool, brew, npm, pip, docker) and parses formats directly (asar, GGUF, safetensors, pickle).
- Interface: React, served by the engine; works in a browser.
- Mac app: Tauri shell, engine as a single-file sidecar, signed with the local "Teardown Local Signing" certificate so permissions survive rebuilds.
- Repository: github.com/AllStreets/Assay. Push after every major task.

## The parts

1. Collectors, one per layer. Each returns items with a stable id, name, version, kind, path, source evidence, and the parts inside it.
2. Model reader. GGUF: header and metadata (architecture, parameters, quantization, context length, license, chat template, tensor list). Safetensors: JSON header (dtypes, shapes, total parameters). Pickle and PyTorch zip files: a static opcode walker that lists every imported global; anything outside a small allowlist (torch rebuild helpers, collections.OrderedDict, numpy reconstruction) is a finding, and imports such as os, posix, subprocess, builtins.exec/eval, runpy, socket are critical.
3. Vulnerability check. Batches of (ecosystem, name, version) sent to the OSV.dev query API, cached on disk. Electron apps are checked as the npm package "electron" at their framework version. The first run says exactly what is sent (package names and versions, nothing else), and Settings can turn it off.
4. Trace. A graph from part to item to app, so a finding reads as a chain.
5. Actions. Quarantine moves an item into Assay's quarantine folder with a record of where it came from, and release puts it back. Updates run the owning package manager after confirmation. Removal goes to the Trash.

## The interface

- Identity: an assay lab. Basalt ground, bone text, assay gold for verified, oxide red for flagged, verdigris for clean. Spectral for verdicts, Inter Tight for the interface, Geist Mono for evidence.
- First screen: the core sample. Layers fill as they are found, AI models run through them as a gold vein, counts climb, then one verdict sentence, then flagged marks glow. Clicking a mark opens its trace.
- Pages: Assay (the core sample), Inventory (every item by layer), Models (the centerpiece: a model X-ray with its tensor map), Findings (every vulnerability and malware finding, grouped by what you can do), Quarantine, Settings and privacy.
- Every item has an assay certificate: what it is, what it contains, how it was identified, what was found, and the actions.

## Left to the builder

Exact page layouts, the order collectors run in, cache formats, and which actions each item type supports beyond the ones above.

## Mock

docs/mocks/first-ten-seconds.html shows the first ten seconds with example data.
