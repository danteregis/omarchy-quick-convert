# Convert — Omarchy bar widget

Type a conversion, get the answer. One input box, result updates as you type,
Enter copies it to the clipboard.

```
100 EUR in BRL        $250 to JPY         100 euros in reais
10 km to mi           72 F                80 kg
1 GiB in MB           3 cups in ml        120 km/h in mph
```

## Install

```bash
omarchy plugin add https://github.com/danteregis/omarchy-convert.git --enable --yes
```

Then bind a key in `~/.config/hypr/bindings.lua`:

```lua
o.bind("SUPER + U", "Convert units and currency", "omarchy-shell shell toggle dante.convert")
```

Clicking the `⇄` icon in the bar opens the panel too. Right-click refreshes the
exchange rates.

## What it understands

- **Amount**: `100`, `1,000.50`, `1.000,50`, `1 000`, `-40`, `.5`. Optional; a
  bare `eur brl` means 1.
- **Currency**: any ISO 4217 code (`EUR`, `brl`), symbols glued to the number
  (`€100`, `$250`, `R$ 100`, `100€`), and common names (`euros`, `reais`,
  `dollars`, `pounds`, `quid`, `yen`, `yuan`, `rupees`, ...).
- **Units**: length, mass, volume, temperature, speed, area, data (decimal and
  binary), time. Abbreviations and full names, singular and plural.
- **Connector**: `to`, `in`, `into`, `as`, `->`, `→`, `=`, or nothing.
- **No target**: `100 EUR` converts to your default currency; `10 km` picks the
  obvious partner unit (`mi`), `72 F` gives `°C`, `80 kg` gives `lb`.

Ambiguous words resolve by context: `100 pounds to usd` is GBP, `100 pounds to
kg` is lb.

## Keys

| Key | Action |
|---|---|
| Enter | Copy result (plain number, `.` decimal) and close |
| Esc | Close |
| ↑ / ↓ | Recall earlier queries |
| Tab / Shift+Tab | Jump to the neighbouring bar panel |
| Ctrl+R | Force a rate refresh |

## Exchange rates

Rates come from [open.er-api.com](https://www.exchangerate-api.com/docs/free),
which is keyless and updates once a day. The raw response is cached at
`~/.cache/omarchy-convert/rates.json` and only refetched after the
`time_next_update` the API announces, so the panel works offline between
updates. The header shows the rate age and turns red when rates are more than
three days old or the last fetch failed.

The fetch runs `curl` with a 10 s timeout and a 64 KiB size cap, `jq` checks
the document shape before it replaces the cache, and the QML side validates
every rate again before use.

## Settings

Set these on the widget's entry in `~/.config/omarchy/shell.json`:

| Key | Default | Meaning |
|---|---|---|
| `defaultCurrency` | `USD` | Target when you type an amount and a currency but no target |
| `secondaryCurrency` | `EUR` | Used when the source already is the default currency |
| `copyOnEnter` | `true` | Enter copies the result |
| `closeOnEnter` | `true` | Enter closes the panel |

```json
{ "id": "dante.convert", "defaultCurrency": "BRL", "secondaryCurrency": "USD" }
```

## IPC

```bash
omarchy-shell shell toggle dante.convert
omarchy-shell dante.convert query "100 eur in brl"   # open with a query prefilled
omarchy-shell dante.convert refresh                   # refetch rates
```

## Development

`Model.js` holds the parser, unit tables and formatting and has no Qt
dependencies, so it is tested with plain node:

```bash
node tests/model-test.js
```

Saving `BarWidget.qml` or `manifest.json` hot-reloads the plugin. Edits to
`Panel.qml` and `Model.js` are loaded through a `Loader` and stay cached by
the QML engine, so apply them with `omarchy restart shell`. Shell logs:
`qs log --pid $(pgrep -f 'quickshell -n -p') -t 100`.

## Requirements

Omarchy 4.x shell, `curl`, `jq`, `wl-copy`. MIT license.
