# Changelog

All notable changes to the **brandreport** skill are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-11

### Added

- First release. Give it just a name; it blind-searches the open web for that person's presence, keeps only what it can prove is them, and renders what it found as a press-styled brand report.
- `add --id sN` refreshes a snapshot in place — new content and provenance under the same citation key, so a re-run updates what it already found instead of filing duplicates. A refresh may never flip `status`: re-deciding identity is a new judgment, filed as a new snapshot.
- The handle sweep (`references/discovery.md`): every handle the anchor uses is probed by URL on each major platform, mandatory before discovery may stop. The first dogfood run missed the subject's own LinkedIn and X accounts by relying on search alone — walled platforms are indexed badly, and an account whose existence is proven but whose content is unreadable is now recorded as an existence-only snapshot instead of reported absent.
