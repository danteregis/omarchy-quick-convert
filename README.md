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
o.bind("SUPER + U", "Convert units and currency", "omarchy-shell shell toggle danteregis.convert")
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
| Ctrl+, | Open settings |

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

Click the gear in the panel (or press Ctrl+, in the input) for the settings
page. Changes are written to the widget's entry in `~/.config/omarchy/shell.json`
and apply immediately; you can also edit that file by hand.

| Key | Default | Meaning |
|---|---|---|
| `defaultCurrency` | `auto` | Target when you type an amount and a currency but no target. `auto` follows the system locale |
| `secondaryCurrency` | `USD` | Used when the source already is the default currency |
| `unitSystem` | `auto` | `metric` or `imperial`. Decides the partner for units outside both systems: `10 nmi` gives km or mi, `20 kn` gives km/h or mph, `300 K` gives °C or °F. `auto` follows the system locale |
| `numberFormat` | `auto` | `point` 1,234.56 · `comma` 1.234,56 · `space` 1 234,56 · `plain` 1234.56. Also decides how a lone separator in your input is read: with a comma decimal, `1.000` is a thousand |
| `ratesRefresh` | `provider` | `provider` refetches right after the provider's daily update; `6`, `12`, `24` re-download on a fixed interval of hours |
| `historyLength` | `20` | How many earlier queries Up/Down recall (0 disables) |
| `copyOnEnter` | `true` | Enter copies the result |
| `closeOnEnter` | `true` | Enter closes the panel |

`auto` reads Qt's locale, which comes from `LANG`. A machine set to `en_US`
reports imperial units and USD even when it sits in Brazil, so pin the values
you want:

```json
{ "id": "danteregis.convert", "defaultCurrency": "BRL", "secondaryCurrency": "USD", "unitSystem": "metric" }
```

The keyboard shortcut is Hyprland's, not the plugin's. The settings page
shows the current binding and copies the `o.bind` line for
`~/.config/hypr/bindings.lua`.

## IPC

```bash
omarchy-shell shell toggle danteregis.convert
omarchy-shell danteregis.convert query "100 eur in brl"   # open with a query prefilled
omarchy-shell danteregis.convert refresh                   # refetch rates
omarchy-shell danteregis.convert settings                  # open on the settings page
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
