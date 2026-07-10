# JanitorAI Importer for TauriTavern

Import character cards directly from JanitorAI URLs into TauriTavern — no browser extension needed.

## Features

- **URL or UUID input** — paste a JanitorAI character link or character ID
- **Preview before import** — see character name, avatar, creator, and tags
- **PNG with embedded card data** — exports as SillyTavern V2 spec PNG (with fallback to JSON)
- **No authentication required** — uses JanitorAI's public character API

## How It Works

1. Click **"JanitorAI Import"** in the left navigation panel
2. Paste a JanitorAI character URL (e.g. `https://janitorai.com/characters/abc123-...`)
3. Click **Import** to fetch and preview the character
4. Click **"Import to TauriTavern"** to add the character card

The extension fetches character data from JanitorAI's public API, converts it to the [Character Card V2](https://github.com/malfoyslastname/character-card-spec-v2) spec, embeds it into a PNG file (or falls back to JSON), and imports it directly into TauriTavern.

## Installation

1. Download or clone this repo
2. Copy the `janitor-importer-extension` folder into TauriTavern's `public/scripts/extensions/third-party/` directory
3. Restart TauriTavern

## File Structure

```
janitor-importer-extension/
├── manifest.json   # Extension manifest
├── index.js        # Main logic (fetch, parse, import)
└── style.css       # UI styles
```

## Credits

- Card data normalization based on [JanitorAI Character Card Scraper](https://sleazyfork.org/en/scripts/537206-janitorai-character-card-scraper) by the original authors
- [Character Card V2 Spec](https://github.com/malfoyslastname/character-card-spec-v2)

## License

MIT