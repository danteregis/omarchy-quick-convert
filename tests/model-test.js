// Run with: node tests/model-test.js
// Loads Model.js the way QML would (minus the .pragma line) and checks the parser.
const fs = require("fs")
const path = require("path")
const vm = require("vm")

const src = fs.readFileSync(path.join(__dirname, "..", "Model.js"), "utf8").replace(/^\.pragma library\s*/m, "")
const ctx = {}
vm.createContext(ctx)
vm.runInContext(src + "\n;this.M = { evaluate, formatValue, formatAmount, rateLine, parseAmount, parseRatesPayload, unitLabel, EXAMPLES }", ctx)
const M = ctx.M

const rates = { USD: 1, EUR: 0.865688, BRL: 5.146298, JPY: 147.2, GBP: 0.74, INR: 88.1, MXN: 18.4 }
const env = { rates, defaultCurrency: "BRL" }
let failures = 0

function eq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) { failures++; console.log("FAIL", label, "\n  expected:", JSON.stringify(expected), "\n  actual:  ", JSON.stringify(actual)) }
  else console.log("ok  ", label)
}
function close(actual, expected, label, tol = 1e-6) {
  const ok = typeof actual === "number" && Math.abs(actual - expected) <= tol * Math.max(1, Math.abs(expected))
  if (!ok) { failures++; console.log("FAIL", label, "\n  expected:", expected, "\n  actual:  ", actual) }
  else console.log("ok  ", label)
}
function conv(text, extra) {
  const r = M.evaluate(text, Object.assign({}, env, extra || {}))
  if (!r || r.error || r.pending) return r
  return { amount: r.amount, from: M.unitLabel(r.from), to: M.unitLabel(r.to), value: r.value }
}
function shape(text, extra) {
  const r = conv(text, extra)
  return r && r.value !== undefined ? { amount: r.amount, from: r.from, to: r.to, value: Number(r.value.toFixed(4)) } : r
}

const eurBrl = 100 / rates.EUR * rates.BRL

// Currency phrasing
close(conv("100 EUR in BRL").value, eurBrl, "100 EUR in BRL")
close(conv("100 eur to brl").value, eurBrl, "lowercase + to")
close(conv("100 eur brl").value, eurBrl, "no connector")
close(conv("100eur brl").value, eurBrl, "glued suffix")
close(conv("€100 brl").value, eurBrl, "symbol prefix")
close(conv("100€ -> brl").value, eurBrl, "symbol suffix + arrow")
close(conv("100 euros in reais").value, eurBrl, "spoken names")
close(conv("eur 100 to brl").value, eurBrl, "unit before amount")
close(conv("R$ 100 in usd").value, 100 / rates.BRL, "R$ prefix with space")
close(conv("r$100 usd").value, 100 / rates.BRL, "r$ glued")
close(conv("$250 to JPY").value, 250 * rates.JPY, "$ prefix")
close(conv("1,000.50 usd to eur").value, 1000.5 * rates.EUR, "us grouping")
close(conv("1.000,50 usd to eur").value, 1000.5 * rates.EUR, "eu grouping")
close(conv("1,5 usd eur").value, 1.5 * rates.EUR, "decimal comma")
close(conv("1,000 usd eur").value, 1000 * rates.EUR, "comma thousands")
eq(shape("100 EUR"), { amount: 100, from: "EUR", to: "BRL", value: Number(eurBrl.toFixed(4)) }, "default target currency")
eq(shape("100 BRL").to, "USD", "default target avoids same currency")
eq(shape("eur").amount, 1, "bare code -> amount 1")
eq(shape("eur brl").amount, 1, "pair without amount")
eq(shape("100 pounds to usd").from, "GBP", "pounds resolves to GBP against a currency")
eq(shape("100 pounds to kg").from, "lb", "pounds resolves to lb against a mass")
eq(shape("10 quid in eur").from, "GBP", "quid")

// Units
close(conv("10 km to mi").value, 6.21371192, "km to mi")
close(conv("10 km in in").value, 393700.787, "connector 'in' before unit 'in'", 1e-6)
close(conv("5 in to cm").value, 12.7, "unit 'in' before connector")
close(conv("72 F").value, 22.2222222, "72 F default to C")
close(conv("72f").value, 22.2222222, "72f glued")
close(conv("-40 c to f").value, -40, "negative temperature")
close(conv("0 c in k").value, 273.15, "kelvin")
close(conv("1 GiB in MB").value, 1073.741824, "GiB to MB")
close(conv("3 cups in ml").value, 709.7647095, "cups")
close(conv("120 km/h in mph").value, 74.5645431, "km/h")
close(conv("100 kmh mph").value, 62.1371192, "kmh alias")
close(conv("2 square meters in square feet").value, 21.5278208, "multiword units")
close(conv("1 m2 ft2").value, 10.7639104, "m2 is a unit, not a number")
close(conv("1.5 h in min").value, 90, "time")
close(conv("80 kg").value, 176.369810, "kg default to lb")
close(conv("1 mile").value, 1.609344, "mile default to km")
eq(M.evaluate("10 km to kg", env).error, "Can't convert km to kg", "mismatch message")

// Partial / pending states
eq(M.evaluate("", env), null, "empty")
eq(M.evaluate("100", env).pending, true, "amount only pending")
eq(M.evaluate("100 eur to", env).trailing, true, "trailing connector still converts to default")
eq(M.evaluate("100 xyz", env).error, "Unknown unit “xyz”", "unknown unit")
eq(M.evaluate("100 eur to xyz", env).error, "Unknown unit “xyz”", "unknown target")
eq(M.evaluate("100 eur brl", { rates: {} }).ratesMissing, true, "no rates flagged")

// Formatting
eq(M.formatValue(594.4805, "currency"), "594.48", "money 2dp")
eq(M.formatValue(1234567.891, "currency"), "1,234,567.89", "money grouping")
eq(M.formatValue(0.0068, "currency"), "0.0068", "small money keeps significance")
eq(M.formatValue(6.21371192, "length"), "6.21371", "unit 6 significant")
eq(M.formatValue(393700.787, "length"), "393,700.79", "big unit value 2dp")
eq(M.formatValue(273.15, "temperature"), "273.15", "temp trims zeros")
eq(M.formatValue(-40, "temperature"), "-40", "negative")
eq(M.formatValue(1234.5, "length", { decimal: ",", group: "." }), "1.234,5", "locale separators")
eq(M.formatAmount(100), "100", "amount int")
eq(M.formatAmount(1000.5), "1,000.5", "amount frac")
eq(M.rateLine(M.evaluate("100 eur brl", env)), "1 EUR = 5.9447 BRL", "rate line")
eq(M.rateLine(M.evaluate("72 f", env)), "", "no rate line for temperature")
eq(M.parseAmount("1 000"), 1000, "space grouping")

// Rates payload validation
const many = {}; for (let i = 0; i < 30; i++) many["A" + String.fromCharCode(65 + i % 26) + String.fromCharCode(65 + Math.floor(i / 26))] = 1 + i
const payload = JSON.stringify({ result: "success", time_last_update_unix: 1, time_next_update_unix: 2, rates: Object.assign({}, many, rates, { bad: "x", ZZZ: -1 }) })
const parsed = M.parseRatesPayload(payload)
eq(Object.keys(parsed.rates).length, 30 + Object.keys(rates).length, "payload drops junk keys")
let threw = false
try { M.parseRatesPayload(JSON.stringify({ result: "error" })) } catch (e) { threw = true }
eq(threw, true, "payload rejects error result")

// Every example must evaluate cleanly
for (const ex of M.EXAMPLES) {
  const r = M.evaluate(ex, env)
  eq(!!(r && r.value !== undefined), true, "example: " + ex)
}

console.log(failures === 0 ? "\nall passed" : "\n" + failures + " failure(s)")
process.exit(failures === 0 ? 0 : 1)
