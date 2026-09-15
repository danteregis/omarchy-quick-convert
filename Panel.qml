import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model

// Keyboard-first converter. One text field; the result updates as you type.
// Enter copies the result (wl-copy) and closes, Escape closes, Up/Down walk
// through earlier queries, Tab moves to the neighbouring bar panel.
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
  readonly property string defaultCurrency: String(setting("defaultCurrency", "USD")).toUpperCase()
  readonly property string secondaryCurrency: String(setting("secondaryCurrency", "EUR")).toUpperCase()
  readonly property bool copyOnEnter: setting("copyOnEnter", true) === true
  readonly property bool closeOnEnter: setting("closeOnEnter", true) === true

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
    return hasRates && nowSeconds < ratesNextUpdateAt + 600
  }

  function refreshRates(force) {
    if (ratesLoading) return
    if (!force && ratesFresh()) return
    ratesLoading = true
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

  readonly property var separators: ({
    decimal: Qt.locale().decimalPoint,
    group: Qt.locale().groupSeparator === Qt.locale().decimalPoint ? " " : Qt.locale().groupSeparator
  })

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
  readonly property string copyText: hasValue ? Model.formatValue(result.value, result.to.cat, { decimal: ".", group: "" }) : ""

  function recompute() {
    result = Model.evaluate(query, { rates: rates, defaultCurrency: defaultCurrency, secondaryCurrency: secondaryCurrency })
  }

  onQueryChanged: recompute()
  onDefaultCurrencyChanged: recompute()
  onSecondaryCurrencyChanged: recompute()

  function commit() {
    if (!hasValue) return
    var line = query.trim()
    var next = history.filter(function(h) { return h !== line })
    next.unshift(line)
    history = next.slice(0, 20)
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

  // ---- lifecycle ----------------------------------------------------------
  function focusInput() {
    Qt.callLater(function() {
      if (!root.opened) return
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
      'curl -fsS --max-time 10 --max-filesize "$4" -A "omarchy-convert/0.1" -o "$2.tmp" "$3" || { rm -f "$2.tmp"; exit 2; }; ' +
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
    function query(text: string): void { root.openFromHotkey(); inputField.text = String(text || ""); inputField.cursorPosition = inputField.text.length }
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
    contentHeight: panel.fittedContentHeight(column.implicitHeight)

    Column {
      id: column
      width: parent.width
      spacing: Style.space(12)

      // Header: title left, rate status right.
      Item {
        width: parent.width
        height: Math.max(titleText.implicitHeight, statusText.implicitHeight)

        PanelSectionHeader {
          id: titleText
          anchors.left: parent.left
          anchors.verticalCenter: parent.verticalCenter
          text: "CONVERT"
          foreground: root.foreground
          fontFamily: root.fontFamily
        }

        Text {
          id: statusText
          anchors.right: parent.right
          anchors.verticalCenter: parent.verticalCenter
          textFormat: Text.PlainText
          text: root.flash !== "" ? root.flash : root.ratesStatus
          color: root.flash !== "" ? root.foreground : (root.ratesFailed || root.ratesStale ? root.urgent : root.faint)
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          elide: Text.ElideLeft
          width: Math.min(implicitWidth, parent.width - titleText.implicitWidth - Style.space(12))

          MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            onClicked: root.refreshRates(true)
          }
        }
      }

      TextField {
        id: inputField
        width: parent.width
        placeholderText: "100 EUR in BRL"
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
          }
        }
      }

      // Result block. Three states: value, message (error/pending), or the
      // idle hint with examples.
      Item {
        width: parent.width
        implicitHeight: resultColumn.implicitHeight
        height: implicitHeight

        Column {
          id: resultColumn
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
            visible: !root.hasValue && root.result !== null && root.detailText !== "" && !(root.result.pending === true && !root.result.from)
            width: parent.width
            textFormat: Text.PlainText
            text: root.detailText
            color: root.result && root.result.error ? root.urgent : root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.body
            wrapMode: Text.Wrap
          }

          Text {
            visible: root.result === null || (root.result.pending === true && !root.result.from)
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
      }

      PanelSeparator {
        width: parent.width
      }

      Text {
        width: parent.width
        textFormat: Text.PlainText
        text: "↵ copy" + (root.closeOnEnter ? " & close" : "") + "   ·   esc close   ·   ↑↓ history   ·   ^R rates"
        color: root.faint
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
        elide: Text.ElideRight
      }
    }
  }
}
