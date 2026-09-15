import QtQuick
import QtQuick.Controls
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model

// Keyboard-first converter. One text field; the result updates as you type.
// Enter copies the result (wl-copy) and closes, Escape closes, Up/Down walk
// through earlier queries, Tab moves to the neighbouring bar panel. The gear
// flips the card to a settings page whose values persist on this widget's
// entry in shell.json.
Panel {
  id: root
  moduleName: "dante.convert"
  ipcTarget: "dante.convert"
  manageIpc: false

  property var anchorItem: null
  property bool openedFromHotkey: false

  // The bar identifies this panel by the widget mounted in its slot, not by
  // this nested item (popout coordination, open-dot, Tab switching).
  property var hostWidget: null
  readonly property var barIdentity: hostWidget || root

  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property color urgent: bar ? bar.urgent : Color.urgent
  readonly property color dim: Qt.darker(foreground, 1.5)
  readonly property color faint: Qt.darker(foreground, 2.0)
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

  // ---- settings -----------------------------------------------------------
  // "auto" values resolve from Qt's locale. LANG=en_US on a machine in Brazil
  // would pick imperial and USD, so the settings page lets the user pin them.
  readonly property var systemLocale: Qt.locale()
  readonly property string localeCurrency: {
    var code = String(systemLocale.currencySymbol(Locale.CurrencyIsoCode) || "").toUpperCase()
    return Model.isCurrencyCode(code) ? code : "USD"
  }
  readonly property string localeUnitSystem: systemLocale.measurementSystem === Locale.MetricSystem ? "metric" : "imperial"
  readonly property var localeSeparators: ({ decimal: systemLocale.decimalPoint, group: systemLocale.groupSeparator })

  readonly property string defaultCurrencySetting: String(setting("defaultCurrency", "auto"))
  readonly property string defaultCurrency: {
    var v = defaultCurrencySetting.toUpperCase()
    return v === "AUTO" || !Model.isCurrencyCode(v) ? localeCurrency : v
  }
  readonly property string secondaryCurrencySetting: String(setting("secondaryCurrency", "USD"))
  readonly property string secondaryCurrency: {
    var v = secondaryCurrencySetting.toUpperCase()
    if (v === "AUTO") v = localeCurrency
    if (!Model.isCurrencyCode(v) || v === defaultCurrency) v = defaultCurrency === "USD" ? "EUR" : "USD"
    return v
  }
  readonly property string unitSystemSetting: String(setting("unitSystem", "auto"))
  readonly property string unitSystem: unitSystemSetting === "auto" ? localeUnitSystem : unitSystemSetting
  readonly property string numberFormat: String(setting("numberFormat", "auto"))
  readonly property var separators: Model.separatorsFor(numberFormat, localeSeparators)
  readonly property string ratesRefresh: String(setting("ratesRefresh", "provider"))
  readonly property int historyLength: Math.max(0, Math.min(100, parseInt(setting("historyLength", 20), 10) || 0))
  readonly property bool copyOnEnter: setting("copyOnEnter", true) === true
  readonly property bool closeOnEnter: setting("closeOnEnter", true) === true

  // Settings live on this widget's entry in shell.json; the shell hot-reloads
  // the file and every bar instance sees the new value. Applied locally first
  // so the control moves on the click. updateEntryInline replaces the entry
  // whole, so the current settings are merged in.
  function persistSettings(values) {
    var entry = { id: root.moduleName }
    for (var existing in root.settings) if (existing !== "id") entry[existing] = root.settings[existing]
    for (var key in values) {
      if (values[key] === undefined) delete entry[key]
      else entry[key] = values[key]
    }
    root.settings = entry
    if (root.bar && root.bar.shell && typeof root.bar.shell.updateEntryInline === "function")
      root.bar.shell.updateEntryInline(root.moduleName, entry)
  }

  property bool settingsOpen: false

  function showSettings(open) {
    settingsOpen = open === true
    if (settingsOpen) {
      hotkeyProc.running = true
      Qt.callLater(function() { settingsFocus.forceActiveFocus() })
    } else {
      focusInput()
    }
  }

  // ---- exchange rates -----------------------------------------------------
  // open.er-api.com publishes USD-based rates once a day, keyless, and tells
  // us when the next update lands. The raw payload is cached on disk so the
  // panel works offline and only refetches when that timestamp has passed.
  readonly property string ratesEndpoint: "https://open.er-api.com/v6/latest/USD"
  readonly property int ratesMaxBytes: 65536
  readonly property string cacheDir: Quickshell.env("HOME") + "/.cache/omarchy-convert"
  readonly property string cachePath: cacheDir + "/rates.json"

  property var rates: ({})
  property bool hasRates: false
  property double ratesUpdatedAt: 0     // unix seconds, from the payload
  property double ratesNextUpdateAt: 0
  property double lastFetchAt: 0        // unix seconds, this session
  property bool ratesLoading: false
  property bool ratesFailed: false
  property double nowSeconds: Date.now() / 1000

  readonly property bool ratesStale: hasRates && nowSeconds - ratesUpdatedAt > 3 * 86400
  readonly property string ratesStatus: {
    if (ratesLoading && !hasRates) return "fetching rates…"
    if (!hasRates) return ratesFailed ? "offline · no currency rates yet" : ""
    var age = Model.relativeAge(ratesUpdatedAt, nowSeconds)
    if (ratesFailed) return "offline · rates from " + age
    return "rates " + age + (ratesLoading ? " · refreshing…" : "")
  }

  function ratesFresh() {
    if (!hasRates) return false
    if (ratesRefresh === "provider") return nowSeconds < ratesNextUpdateAt + 600
    var hours = parseInt(ratesRefresh, 10) || 24
    return nowSeconds - Math.max(lastFetchAt, ratesUpdatedAt) < hours * 3600
  }

  function refreshRates(force) {
    if (ratesLoading) return
    if (!force && ratesFresh()) return
    ratesLoading = true
    lastFetchAt = Date.now() / 1000
    fetchProc.running = true
  }

  function applyRatesText(raw) {
    try {
      var parsed = Model.parseRatesPayload(raw, ratesMaxBytes)
      rates = parsed.rates
      ratesUpdatedAt = parsed.updatedAt
      ratesNextUpdateAt = parsed.nextUpdateAt
      hasRates = true
      ratesFailed = false
      recompute()
    } catch (e) {
      // A corrupt cache file is simply replaced by the next fetch.
      if (!hasRates) refreshRates(true)
    }
  }

  // ---- query / result -----------------------------------------------------
  property string query: ""
  property var result: null
  property var history: []
  property int historyIndex: -1
  property string draftBeforeHistory: ""
  property string flash: ""

  readonly property bool hasValue: !!result && result.value !== undefined
  readonly property string valueText: hasValue ? Model.formatValue(result.value, result.to.cat, separators) : ""
  readonly property string valueUnit: hasValue ? Model.unitLabel(result.to) : ""
  readonly property string sourceText: hasValue ? Model.formatAmount(result.amount, separators) + " " + Model.unitLabel(result.from) + " =" : ""
  readonly property string detailText: {
    if (!result) return ""
    if (result.error) return result.ratesMissing && !hasRates ? (ratesLoading ? "Waiting for exchange rates…" : "No exchange rates available offline") : result.error
    if (result.pending) return result.from ? (Model.unitName(result.from) + " — " + result.hint) : ""
    var line = Model.rateLine(result, separators)
    if (result.from.cat === "currency" || result.to.cat === "currency") {
      var names = Model.unitName(result.from) + " → " + Model.unitName(result.to)
      return line !== "" ? line + "  ·  " + names : names
    }
    return line
  }
  readonly property bool showIdleHint: result === null || (result.pending === true && !result.from)
  readonly property string copyText: hasValue ? Model.formatValue(result.value, result.to.cat, { decimal: ".", group: "" }) : ""

  function recompute() {
    result = Model.evaluate(query, {
      rates: rates,
      defaultCurrency: defaultCurrency,
      secondaryCurrency: secondaryCurrency,
      unitSystem: unitSystem,
      decimal: separators.decimal
    })
  }

  onQueryChanged: recompute()
  onDefaultCurrencyChanged: recompute()
  onSecondaryCurrencyChanged: recompute()
  onUnitSystemChanged: recompute()
  onSeparatorsChanged: recompute()

  function commit() {
    if (!hasValue) return
    var line = query.trim()
    var next = history.filter(function(h) { return h !== line })
    next.unshift(line)
    history = next.slice(0, historyLength)
    historyIndex = -1
    if (copyOnEnter) {
      copyProc.command = ["wl-copy", "--", copyText]
      copyProc.running = true
      flash = "copied " + valueText + " " + valueUnit
      flashTimer.restart()
    }
    if (closeOnEnter) close()
  }

  function recallHistory(step) {
    if (history.length === 0) return
    if (historyIndex === -1) draftBeforeHistory = inputField.text
    var idx = historyIndex + step
    if (idx < -1) idx = -1
    if (idx >= history.length) idx = history.length - 1
    historyIndex = idx
    inputField.text = idx === -1 ? draftBeforeHistory : history[idx]
    inputField.cursorPosition = inputField.text.length
  }

  // ---- hotkey (read-only; lives in Hyprland's config) ---------------------
  property string hotkeyLabel: ""

  Process {
    id: hotkeyProc
    command: ["bash", "-c",
      "hyprctl binds -j 2>/dev/null | jq -r --arg id \"$1\" '" +
      "[.[] | select((.description // \"\") | test(\"Convert\"; \"i\"))] | .[0] | " +
      "if . == null then \"\" else " +
      "([(if (.modmask % 128) >= 64 then \"Super\" else empty end)," +
      "  (if (.modmask % 16) >= 8 then \"Alt\" else empty end)," +
      "  (if (.modmask % 8) >= 4 then \"Ctrl\" else empty end)," +
      "  (if (.modmask % 2) >= 1 then \"Shift\" else empty end), (.key | ascii_upcase)] | join(\"+\")) end'",
      "omarchy-convert", root.moduleName]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.hotkeyLabel = String(text || "").trim()
    }
  }

  // ---- lifecycle ----------------------------------------------------------
  function focusInput() {
    Qt.callLater(function() {
      if (!root.opened || root.settingsOpen) return
      inputField.forceActiveFocus()
      inputField.selectAll()
    })
  }

  function open() {
    openedFromHotkey = false
    setCenterHoverRevealSuppressed(false)
    root.controller.show()
    nowSeconds = Date.now() / 1000
    refreshRates(false)
    focusInput()
  }

  function openFromHotkey() {
    openedFromHotkey = true
    root.controller.show()
    nowSeconds = Date.now() / 1000
    refreshRates(false)
    focusInput()
    Qt.callLater(function() {
      if (root.opened) setCenterHoverRevealSuppressed(true)
    })
  }

  function close() {
    setCenterHoverRevealSuppressed(false)
    historyIndex = -1
    settingsOpen = false
    root.controller.hide()
  }

  function toggle() {
    if (root.opened) root.close()
    else root.openFromHotkey()
  }

  function switchPanel(direction) {
    if (root.bar && typeof root.bar.switchPanelFrom === "function")
      return root.bar.switchPanelFrom(root.barIdentity, direction)
    return false
  }

  function setCenterHoverRevealSuppressed(value) {
    if (root.bar && typeof root.bar.setCenterHoverRevealSuppressed === "function")
      root.bar.setCenterHoverRevealSuppressed(value)
  }

  Component.onCompleted: ratesFile.reload()

  // ---- processes ----------------------------------------------------------
  // curl writes to a temp file, jq confirms it is a real rates document, and
  // only then does it replace the cache. Arguments travel as argv, not text.
  Process {
    id: fetchProc
    command: ["bash", "-c",
      'set -o pipefail; mkdir -p "$1" || exit 1; ' +
      'curl -fsS --max-time 10 --max-filesize "$4" -A "omarchy-convert/0.2" -o "$2.tmp" "$3" || { rm -f "$2.tmp"; exit 2; }; ' +
      'jq -e \'.result == "success" and (.rates | type) == "object"\' "$2.tmp" >/dev/null || { rm -f "$2.tmp"; exit 3; }; ' +
      'mv -f "$2.tmp" "$2"',
      "omarchy-convert", root.cacheDir, root.cachePath, root.ratesEndpoint, String(root.ratesMaxBytes)]
    onExited: function(exitCode) {
      root.ratesLoading = false
      root.ratesFailed = exitCode !== 0
      if (exitCode === 0) ratesFile.reload()
      else root.recompute()
    }
  }

  FileView {
    id: ratesFile
    path: root.cachePath
    printErrors: false
    onLoaded: root.applyRatesText(text())
    onLoadFailed: root.refreshRates(true)
  }

  Process {
    id: copyProc
  }

  Timer {
    id: flashTimer
    interval: 1800
    onTriggered: root.flash = ""
  }

  // Keep the cache warm while the shell runs, so opening the panel is instant.
  Timer {
    interval: 30 * 60 * 1000
    running: true
    repeat: true
    onTriggered: {
      root.nowSeconds = Date.now() / 1000
      root.refreshRates(false)
    }
  }

  IpcHandler {
    target: root.ipcTarget

    function open(): void { root.openFromHotkey() }
    function close(): void { root.close() }
    function show(): void { root.openFromHotkey() }
    function hide(): void { root.close() }
    function toggle(): void { root.toggle() }
    function refresh(): void { root.refreshRates(true) }
    function settings(): void { root.openFromHotkey(); root.showSettings(true) }
    function query(text: string): void { root.openFromHotkey(); root.showSettings(false); inputField.text = String(text || ""); inputField.cursorPosition = inputField.text.length }
  }

  // ---- UI -----------------------------------------------------------------
  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    centerOnBar: true
    focusTarget: inputField
    contentWidth: panel.fittedContentWidth(Style.space(460))
    contentHeight: panel.fittedContentHeight(root.settingsOpen ? settingsColumn.implicitHeight : mainColumn.implicitHeight)

    // ======================= main page =======================
    Column {
      id: mainColumn
      width: parent.width
      spacing: Style.space(12)
      visible: !root.settingsOpen

      Item {
        width: parent.width
        height: Math.max(titleText.implicitHeight, statusText.implicitHeight, gearButton.implicitHeight)

        PanelSectionHeader {
          id: titleText
          anchors.left: parent.left
          anchors.verticalCenter: parent.verticalCenter
          text: "CONVERT"
          foreground: root.foreground
          fontFamily: root.fontFamily
        }

        Row {
          anchors.right: parent.right
          anchors.verticalCenter: parent.verticalCenter
          spacing: Style.space(8)

          Text {
            id: statusText
            anchors.verticalCenter: parent.verticalCenter
            textFormat: Text.PlainText
            text: root.flash !== "" ? root.flash : root.ratesStatus
            color: root.flash !== "" ? root.foreground : (root.ratesFailed || root.ratesStale ? root.urgent : root.faint)
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            elide: Text.ElideLeft
            width: Math.min(implicitWidth, mainColumn.width - titleText.implicitWidth - gearButton.width - Style.space(24))

            MouseArea {
              anchors.fill: parent
              cursorShape: Qt.PointingHandCursor
              onClicked: root.refreshRates(true)
            }
          }

          PanelActionButton {
            id: gearButton
            anchors.verticalCenter: parent.verticalCenter
            iconText: ""  // nf-fa-cog
            tooltipText: "Settings"
            foreground: root.dim
            hoverColor: root.foreground
            fontFamily: root.fontFamily
            onClicked: root.showSettings(true)
          }
        }
      }

      TextField {
        id: inputField
        width: parent.width
        placeholderText: "100 EUR in " + root.defaultCurrency
        foreground: root.foreground
        accent: Color.accent
        font.family: root.fontFamily
        font.pixelSize: Style.font.title
        verticalPadding: Style.space(9)
        inputMethodHints: Qt.ImhNoPredictiveText

        onTextChanged: {
          if (root.historyIndex !== -1 && text !== root.history[root.historyIndex]) root.historyIndex = -1
          root.query = text
        }

        Keys.onPressed: function(event) {
          if (event.key === Qt.Key_Escape) {
            root.close(); event.accepted = true
          } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
            root.commit(); event.accepted = true
          } else if (event.key === Qt.Key_Up) {
            root.recallHistory(1); event.accepted = true
          } else if (event.key === Qt.Key_Down) {
            root.recallHistory(-1); event.accepted = true
          } else if (event.key === Qt.Key_Tab || event.key === Qt.Key_Backtab) {
            root.switchPanel(event.key === Qt.Key_Backtab || (event.modifiers & Qt.ShiftModifier) ? -1 : 1)
            event.accepted = true
          } else if (event.key === Qt.Key_R && (event.modifiers & Qt.ControlModifier)) {
            root.refreshRates(true); event.accepted = true
          } else if (event.key === Qt.Key_Comma && (event.modifiers & Qt.ControlModifier)) {
            root.showSettings(true); event.accepted = true
          }
        }
      }

      // Result block. Three states: value, message (error/pending), or the
      // idle hint with examples.
      Column {
        width: parent.width
        spacing: Style.space(4)

        Text {
          visible: root.hasValue
          width: parent.width
          textFormat: Text.PlainText
          text: root.sourceText
          color: root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.font.subtitle
          elide: Text.ElideRight
        }

        Row {
          visible: root.hasValue
          width: parent.width
          spacing: Style.space(8)

          Text {
            id: valueLabel
            textFormat: Text.PlainText
            text: root.valueText
            color: root.foreground
            font.family: root.fontFamily
            font.pixelSize: Style.font.displayLarge
            font.bold: true
            width: Math.min(implicitWidth, parent.width - unitLabel.implicitWidth - parent.spacing)
            elide: Text.ElideRight
          }
          Text {
            id: unitLabel
            textFormat: Text.PlainText
            anchors.baseline: valueLabel.baseline
            text: root.valueUnit
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.heading
          }
        }

        Text {
          visible: !root.hasValue && !root.showIdleHint && root.detailText !== ""
          width: parent.width
          textFormat: Text.PlainText
          text: root.detailText
          color: root.result && root.result.error ? root.urgent : root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.font.body
          wrapMode: Text.Wrap
        }

        Text {
          visible: root.showIdleHint
          width: parent.width
          textFormat: Text.PlainText
          text: root.result === null
            ? "Try  " + Model.EXAMPLES.slice(0, 4).join("   ·   ")
            : "Add a unit or currency, e.g. “" + Model.formatAmount(root.result.amount, root.separators) + " EUR in " + root.defaultCurrency + "”"
          color: root.faint
          font.family: root.fontFamily
          font.pixelSize: Style.font.bodySmall
          wrapMode: Text.Wrap
        }

        Text {
          visible: root.hasValue && root.detailText !== ""
          width: parent.width
          textFormat: Text.PlainText
          text: root.detailText
          color: root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          elide: Text.ElideRight
        }
      }

      PanelSeparator {
        width: parent.width
        foreground: root.foreground
      }

      Text {
        width: parent.width
        textFormat: Text.PlainText
        text: "↵ copy" + (root.closeOnEnter ? " & close" : "") + "   ·   esc close   ·   ↑↓ history   ·   ^R rates   ·   ^, settings"
        color: root.faint
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
        elide: Text.ElideRight
      }
    }

    // ======================= settings page =======================
    FocusScope {
      id: settingsFocus
      width: parent.width
      height: settingsColumn.implicitHeight
      visible: root.settingsOpen
      focus: root.settingsOpen

      Keys.onPressed: function(event) {
        if (event.key === Qt.Key_Escape) {
          root.showSettings(false); event.accepted = true
        }
      }

      Column {
        id: settingsColumn
        width: parent.width
        spacing: Style.space(14)

        Item {
          width: parent.width
          height: Math.max(backButton.implicitHeight, settingsTitle.implicitHeight)

          Row {
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(8)

            PanelActionButton {
              id: backButton
              anchors.verticalCenter: parent.verticalCenter
              iconText: ""  // nf-fa-arrow_left
              tooltipText: "Back"
              foreground: root.dim
              hoverColor: root.foreground
              fontFamily: root.fontFamily
              onClicked: root.showSettings(false)
            }

            PanelSectionHeader {
              id: settingsTitle
              anchors.verticalCenter: parent.verticalCenter
              text: "CONVERT SETTINGS"
              foreground: root.foreground
              fontFamily: root.fontFamily
            }
          }

          Text {
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            textFormat: Text.PlainText
            text: "saved to shell.json"
            color: root.faint
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
          }
        }

        // -- currencies
        Row {
          width: parent.width
          spacing: Style.space(12)

          Column {
            width: (parent.width - parent.spacing) / 2
            spacing: Style.space(6)

            Text {
              text: "DEFAULT CURRENCY"
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              font.bold: true
            }

            SearchableDropdown {
              id: defaultCurrencyPicker
              width: parent.width
              showLabel: false
              placeholderText: "Search code or name…"
              options: Model.currencyOptions(true)
              triggerLabel: root.defaultCurrencySetting.toLowerCase() === "auto" ? "System locale (" + root.localeCurrency + ")" : root.defaultCurrency
              foreground: root.foreground
              background: Color.popups.background
              accent: Color.accent
              fontFamily: root.fontFamily
              onChanged: function(value) { root.persistSettings({ defaultCurrency: value }) }

              Binding on value { value: root.defaultCurrencySetting.toLowerCase() === "auto" ? "auto" : root.defaultCurrency }
            }
          }

          Column {
            width: (parent.width - parent.spacing) / 2
            spacing: Style.space(6)

            Text {
              text: "SECONDARY CURRENCY"
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              font.bold: true
            }

            SearchableDropdown {
              id: secondaryCurrencyPicker
              width: parent.width
              showLabel: false
              placeholderText: "Search code or name…"
              options: Model.currencyOptions(false)
              triggerLabel: root.secondaryCurrency
              foreground: root.foreground
              background: Color.popups.background
              accent: Color.accent
              fontFamily: root.fontFamily
              onChanged: function(value) { root.persistSettings({ secondaryCurrency: value }) }

              Binding on value { value: root.secondaryCurrency }
            }
          }
        }

        Text {
          width: parent.width
          textFormat: Text.PlainText
          text: "“100 EUR” converts to the default; “100 " + root.defaultCurrency + "” converts to the secondary."
          color: root.faint
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          wrapMode: Text.WordWrap
        }

        // -- unit system + number format
        Row {
          width: parent.width
          spacing: Style.space(12)

          Column {
            width: (parent.width - parent.spacing) / 2
            spacing: Style.space(6)

            Text {
              text: "UNIT SYSTEM"
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              font.bold: true
            }

            Dropdown {
              id: unitSystemDropdown
              width: parent.width
              showLabel: false
              options: Model.UNIT_SYSTEMS
              foreground: root.foreground
              background: Color.popups.background
              accent: Color.accent
              fontFamily: root.fontFamily
              onChanged: function(value) { root.persistSettings({ unitSystem: value }) }

              Binding on value { value: root.unitSystemSetting }
            }
          }

          Column {
            width: (parent.width - parent.spacing) / 2
            spacing: Style.space(6)

            Text {
              text: "NUMBER FORMAT"
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              font.bold: true
            }

            Dropdown {
              id: numberFormatDropdown
              width: parent.width
              showLabel: false
              options: Model.NUMBER_FORMATS
              foreground: root.foreground
              background: Color.popups.background
              accent: Color.accent
              fontFamily: root.fontFamily
              onChanged: function(value) { root.persistSettings({ numberFormat: value }) }

              Binding on value { value: root.numberFormat }
            }
          }
        }

        Text {
          width: parent.width
          textFormat: Text.PlainText
          text: (root.unitSystemSetting === "auto" ? "Locale " + root.systemLocale.name + " → " + root.unitSystem + ". " : "")
            + "With " + root.unitSystem + ", “10 nmi” gives " + (root.unitSystem === "metric" ? "km" : "mi")
            + " and “20 kn” gives " + (root.unitSystem === "metric" ? "km/h" : "mph") + ". Numbers read as "
            + Model.formatValue(1234.5, "length", root.separators) + "."
          color: root.faint
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          wrapMode: Text.WordWrap
        }

        // -- rates + history
        Row {
          width: parent.width
          spacing: Style.space(12)

          Column {
            width: (parent.width - parent.spacing) / 2
            spacing: Style.space(6)

            Text {
              text: "EXCHANGE-RATE REFRESH"
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              font.bold: true
            }

            Dropdown {
              id: ratesRefreshDropdown
              width: parent.width
              showLabel: false
              options: Model.RATE_REFRESH
              foreground: root.foreground
              background: Color.popups.background
              accent: Color.accent
              fontFamily: root.fontFamily
              onChanged: function(value) { root.persistSettings({ ratesRefresh: value }) }

              Binding on value { value: root.ratesRefresh }
            }
          }

          Column {
            width: (parent.width - parent.spacing) / 2
            spacing: Style.space(6)

            Text {
              text: "HISTORY LENGTH"
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              font.bold: true
            }

            NumberField {
              width: parent.width
              fieldWidth: parent.width
              from: 0
              to: 100
              stepSize: 5
              value: root.historyLength
              foreground: root.foreground
              accent: Color.accent
              fontFamily: root.fontFamily
              onModified: function(value) { root.persistSettings({ historyLength: value }) }
            }
          }
        }

        PanelSeparator {
          width: parent.width
          foreground: root.foreground
        }

        Toggle {
          width: parent.width
          label: "Copy result on Enter"
          description: "Puts the plain number (dot decimal, no grouping) on the clipboard."
          checked: root.copyOnEnter
          foreground: root.foreground
          accent: Color.accent
          fontFamily: root.fontFamily
          onClicked: root.persistSettings({ copyOnEnter: !root.copyOnEnter })
        }

        Toggle {
          width: parent.width
          label: "Close panel on Enter"
          description: "Turn off to keep converting after copying."
          checked: root.closeOnEnter
          foreground: root.foreground
          accent: Color.accent
          fontFamily: root.fontFamily
          onClicked: root.persistSettings({ closeOnEnter: !root.closeOnEnter })
        }

        PanelSeparator {
          width: parent.width
          foreground: root.foreground
        }

        // -- hotkey (read-only)
        Column {
          width: parent.width
          spacing: Style.space(6)

          Row {
            width: parent.width
            spacing: Style.space(8)

            Text {
              text: "KEYBOARD SHORTCUT"
              anchors.verticalCenter: parent.verticalCenter
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              font.bold: true
            }

            Text {
              anchors.verticalCenter: parent.verticalCenter
              textFormat: Text.PlainText
              text: root.hotkeyLabel !== "" ? root.hotkeyLabel : "not bound"
              color: root.hotkeyLabel !== "" ? root.foreground : root.urgent
              font.family: root.fontFamily
              font.pixelSize: Style.font.body
              font.bold: true
            }
          }

          Text {
            width: parent.width
            textFormat: Text.PlainText
            text: "Shortcuts belong to Hyprland, not to the plugin. Change it in ~/.config/hypr/bindings.lua:"
            color: root.faint
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            wrapMode: Text.WordWrap
          }

          Row {
            width: parent.width
            spacing: Style.space(8)

            Text {
              id: bindLine
              width: parent.width - copyBindButton.width - parent.spacing
              anchors.verticalCenter: parent.verticalCenter
              textFormat: Text.PlainText
              text: 'o.bind("SUPER + U", "Convert", "omarchy-shell shell toggle dante.convert")'
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              elide: Text.ElideMiddle
            }

            Button {
              id: copyBindButton
              anchors.verticalCenter: parent.verticalCenter
              text: "Copy"
              tooltipText: "Copy the binding line"
              foreground: root.foreground
              fontFamily: root.fontFamily
              fontSize: Style.font.caption
              onClicked: {
                copyProc.command = ["wl-copy", "--", bindLine.text]
                copyProc.running = true
              }
            }
          }
        }
      }
    }
  }
}
