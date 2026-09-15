.pragma library

// Conversion engine for the Convert panel. Pure functions, no Qt access, so
// it can be unit-tested with plain node (see tests/model-test.js).
//
// evaluate(text, ctx) turns a line like "100 EUR in BRL", "10 km to mi",
// "72f", "3 * 14" or "(54 * 12) BRL in USD" into
// { amount, from, to, value, rate, expr, error, pending }. Plain arithmetic
// has from/to null and value === amount.

// ---------------------------------------------------------------------------
// Unit tables. `factor` converts to the category's base unit (metre, kilogram,
// litre, metre/second, square metre, byte, second). Temperature uses formulas.
// `names` are the accepted spellings; the first entry is the display label.
// ---------------------------------------------------------------------------

var UNITS = [
  // length (base: metre)
  { id: "mm", cat: "length", factor: 1e-3, names: ["mm", "millimeter", "millimeters", "millimetre", "millimetres"] },
  { id: "cm", cat: "length", factor: 1e-2, names: ["cm", "centimeter", "centimeters", "centimetre", "centimetres"] },
  { id: "m", cat: "length", factor: 1, names: ["m", "meter", "meters", "metre", "metres"] },
  { id: "km", cat: "length", factor: 1e3, names: ["km", "kilometer", "kilometers", "kilometre", "kilometres", "kms"] },
  { id: "µm", cat: "length", factor: 1e-6, names: ["um", "µm", "micrometer", "micrometers", "micrometre", "micron", "microns"] },
  { id: "nm", cat: "length", factor: 1e-9, names: ["nm", "nanometer", "nanometers", "nanometre", "nanometres"] },
  { id: "in", cat: "length", factor: 0.0254, names: ["in", "inch", "inches", "\""] },
  { id: "ft", cat: "length", factor: 0.3048, names: ["ft", "foot", "feet", "'"] },
  { id: "yd", cat: "length", factor: 0.9144, names: ["yd", "yard", "yards", "yds"] },
  { id: "mi", cat: "length", factor: 1609.344, names: ["mi", "mile", "miles"] },
  { id: "nmi", cat: "length", factor: 1852, names: ["nmi", "nautical mile", "nautical miles"] },

  // mass (base: kilogram)
  { id: "mg", cat: "mass", factor: 1e-6, names: ["mg", "milligram", "milligrams"] },
  { id: "g", cat: "mass", factor: 1e-3, names: ["g", "gram", "grams", "gr"] },
  { id: "kg", cat: "mass", factor: 1, names: ["kg", "kilogram", "kilograms", "kilo", "kilos", "kgs"] },
  { id: "t", cat: "mass", factor: 1e3, names: ["t", "tonne", "tonnes", "ton", "tons", "metric ton", "metric tons"] },
  { id: "oz", cat: "mass", factor: 0.028349523125, names: ["oz", "ounce", "ounces"] },
  { id: "lb", cat: "mass", factor: 0.45359237, names: ["lb", "lbs", "pound", "pounds"] },
  { id: "st", cat: "mass", factor: 6.35029318, names: ["st", "stone", "stones"] },

  // volume (base: litre)
  { id: "ml", cat: "volume", factor: 1e-3, names: ["ml", "milliliter", "milliliters", "millilitre", "millilitres"] },
  { id: "cl", cat: "volume", factor: 1e-2, names: ["cl", "centiliter", "centilitre"] },
  { id: "l", cat: "volume", factor: 1, names: ["l", "liter", "liters", "litre", "litres", "lt"] },
  { id: "m³", cat: "volume", factor: 1e3, names: ["m3", "m³", "cubic meter", "cubic meters", "cubic metre", "cubic metres"] },
  { id: "gal", cat: "volume", factor: 3.785411784, names: ["gal", "gallon", "gallons", "us gal", "us gallon", "us gallons"] },
  { id: "qt", cat: "volume", factor: 0.946352946, names: ["qt", "quart", "quarts"] },
  { id: "pt", cat: "volume", factor: 0.473176473, names: ["pt", "pint", "pints"] },
  { id: "cup", cat: "volume", factor: 0.2365882365, names: ["cup", "cups"] },
  { id: "fl oz", cat: "volume", factor: 0.0295735295625, names: ["floz", "fl oz", "fl. oz", "fluid ounce", "fluid ounces"] },
  { id: "tbsp", cat: "volume", factor: 0.01478676478125, names: ["tbsp", "tablespoon", "tablespoons"] },
  { id: "tsp", cat: "volume", factor: 0.00492892159375, names: ["tsp", "teaspoon", "teaspoons"] },

  // temperature (formulas)
  { id: "°C", cat: "temperature", names: ["c", "°c", "celsius", "centigrade", "degc", "deg c", "degrees c", "degrees celsius"] },
  { id: "°F", cat: "temperature", names: ["f", "°f", "fahrenheit", "degf", "deg f", "degrees f", "degrees fahrenheit"] },
  { id: "K", cat: "temperature", names: ["k", "kelvin", "kelvins"] },

  // speed (base: metre/second)
  { id: "m/s", cat: "speed", factor: 1, names: ["m/s", "mps", "meters per second", "metres per second"] },
  { id: "km/h", cat: "speed", factor: 1 / 3.6, names: ["km/h", "kmh", "kph", "kilometers per hour", "kilometres per hour"] },
  { id: "mph", cat: "speed", factor: 0.44704, names: ["mph", "miles per hour"] },
  { id: "kn", cat: "speed", factor: 1852 / 3600, names: ["kn", "kt", "kts", "knot", "knots"] },
  { id: "ft/s", cat: "speed", factor: 0.3048, names: ["ft/s", "fps", "feet per second"] },

  // area (base: square metre)
  { id: "m²", cat: "area", factor: 1, names: ["m2", "m²", "sqm", "sq m", "square meter", "square meters", "square metre", "square metres"] },
  { id: "km²", cat: "area", factor: 1e6, names: ["km2", "km²", "sq km", "square kilometer", "square kilometers", "square kilometre", "square kilometres"] },
  { id: "cm²", cat: "area", factor: 1e-4, names: ["cm2", "cm²", "sq cm", "square centimeter", "square centimeters"] },
  { id: "ft²", cat: "area", factor: 0.09290304, names: ["ft2", "ft²", "sqft", "sq ft", "square foot", "square feet"] },
  { id: "in²", cat: "area", factor: 0.00064516, names: ["in2", "in²", "sq in", "square inch", "square inches"] },
  { id: "yd²", cat: "area", factor: 0.83612736, names: ["yd2", "yd²", "sq yd", "square yard", "square yards"] },
  { id: "mi²", cat: "area", factor: 2589988.110336, names: ["mi2", "mi²", "sq mi", "square mile", "square miles"] },
  { id: "ha", cat: "area", factor: 1e4, names: ["ha", "hectare", "hectares"] },
  { id: "acre", cat: "area", factor: 4046.8564224, names: ["acre", "acres", "ac"] },

  // data (base: byte)
  { id: "bit", cat: "data", factor: 1 / 8, names: ["bit", "bits"] },
  { id: "B", cat: "data", factor: 1, names: ["b", "byte", "bytes"] },
  { id: "kB", cat: "data", factor: 1e3, names: ["kb", "kilobyte", "kilobytes"] },
  { id: "MB", cat: "data", factor: 1e6, names: ["mb", "megabyte", "megabytes"] },
  { id: "GB", cat: "data", factor: 1e9, names: ["gb", "gigabyte", "gigabytes"] },
  { id: "TB", cat: "data", factor: 1e12, names: ["tb", "terabyte", "terabytes"] },
  { id: "PB", cat: "data", factor: 1e15, names: ["pb", "petabyte", "petabytes"] },
  { id: "KiB", cat: "data", factor: 1024, names: ["kib", "kibibyte", "kibibytes"] },
  { id: "MiB", cat: "data", factor: 1048576, names: ["mib", "mebibyte", "mebibytes"] },
  { id: "GiB", cat: "data", factor: 1073741824, names: ["gib", "gibibyte", "gibibytes"] },
  { id: "TiB", cat: "data", factor: 1099511627776, names: ["tib", "tebibyte", "tebibytes"] },
  { id: "kbit", cat: "data", factor: 125, names: ["kbit", "kilobit", "kilobits"] },
  { id: "Mbit", cat: "data", factor: 125000, names: ["mbit", "megabit", "megabits"] },
  { id: "Gbit", cat: "data", factor: 125000000, names: ["gbit", "gigabit", "gigabits"] },

  // time (base: second)
  { id: "ms", cat: "time", factor: 1e-3, names: ["ms", "millisecond", "milliseconds", "msec"] },
  { id: "s", cat: "time", factor: 1, names: ["s", "sec", "secs", "second", "seconds"] },
  { id: "min", cat: "time", factor: 60, names: ["min", "mins", "minute", "minutes"] },
  { id: "h", cat: "time", factor: 3600, names: ["h", "hr", "hrs", "hour", "hours"] },
  { id: "d", cat: "time", factor: 86400, names: ["d", "day", "days"] },
  { id: "wk", cat: "time", factor: 604800, names: ["wk", "wks", "week", "weeks"] },
  { id: "mo", cat: "time", factor: 2629800, names: ["mo", "month", "months"] },
  { id: "yr", cat: "time", factor: 31557600, names: ["yr", "yrs", "year", "years"] }
]

// What to convert into when the user gives no target ("10 km", "72 f").
// Cross-system pairs are the same for everyone; units that belong to neither
// system (nautical miles, knots, kelvin, tonnes, data, time) follow the
// user's unit system: a metric user gets km, an imperial user gets miles.
var PARTNER_COMMON = {
  mm: "in", cm: "in", m: "ft", km: "mi", "µm": "mm", nm: "µm", in: "cm", ft: "m", yd: "m", mi: "km",
  mg: "g", g: "oz", kg: "lb", oz: "g", lb: "kg",
  ml: "fl oz", cl: "fl oz", l: "gal", gal: "l", qt: "l", pt: "ml", cup: "ml", "fl oz": "ml", tbsp: "ml", tsp: "ml",
  "°C": "°F", "°F": "°C",
  "km/h": "mph", mph: "km/h",
  "m²": "ft²", "km²": "mi²", "cm²": "in²", "ft²": "m²", "in²": "cm²", "yd²": "m²", "mi²": "km²", ha: "acre", acre: "ha",
  bit: "B", B: "bit", kB: "KiB", MB: "MiB", GB: "GiB", TB: "TiB", PB: "TB", KiB: "kB", MiB: "MB", GiB: "GB", TiB: "TB", kbit: "kB", Mbit: "MB", Gbit: "GB",
  ms: "s", s: "ms", min: "s", h: "min", d: "h", wk: "d", mo: "d", yr: "d"
}
var PARTNER_METRIC = { nmi: "km", kn: "km/h", K: "°C", t: "kg", st: "kg", "m³": "l", "m/s": "km/h", "ft/s": "m/s" }
var PARTNER_IMPERIAL = { nmi: "mi", kn: "mph", K: "°F", t: "lb", st: "lb", "m³": "gal", "m/s": "mph", "ft/s": "mph" }

function defaultPartner(id, unitSystem) {
  var table = unitSystem === "imperial" ? PARTNER_IMPERIAL : PARTNER_METRIC
  return table[id] || PARTNER_COMMON[id] || null
}

// ISO 4217 codes served by open.er-api.com. Lets the parser recognise a
// currency before rates have loaded, so the panel can say "loading" instead
// of "unknown unit".
var CURRENCY_CODES = ("AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD "
  + "CAD CDF CHF CLF CLP CNH CNY COP CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP FOK GBP GEL GGP GHS GIP GMD "
  + "GNF GTQ GYD HKD HNL HRK HTG HUF IDR ILS IMP INR IQD IRR ISK JEP JMD JOD JPY KES KGS KHR KID KMF KRW KWD KYD KZT LAK "
  + "LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK "
  + "PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SLL SOS SRD SSP STN SYP SZL THB TJS TMT TND TOP "
  + "TRY TTD TVD TWD TZS UAH UGX USD UYU UZS VES VND VUV WST XAF XCD XCG XDR XOF XPF YER ZAR ZMW ZWG ZWL").split(" ")

var CURRENCY_NAMES = {
  USD: "US Dollar", EUR: "Euro", GBP: "British Pound", JPY: "Japanese Yen", CHF: "Swiss Franc", CAD: "Canadian Dollar",
  AUD: "Australian Dollar", NZD: "New Zealand Dollar", CNY: "Chinese Yuan", HKD: "Hong Kong Dollar", SGD: "Singapore Dollar",
  KRW: "South Korean Won", INR: "Indian Rupee", IDR: "Indonesian Rupiah", MYR: "Malaysian Ringgit", THB: "Thai Baht",
  VND: "Vietnamese Dong", TWD: "New Taiwan Dollar", PHP: "Philippine Peso", PLN: "Polish Zloty", CZK: "Czech Koruna",
  HUF: "Hungarian Forint", RON: "Romanian Leu", SEK: "Swedish Krona", NOK: "Norwegian Krone", DKK: "Danish Krone",
  ISK: "Icelandic Krona", RUB: "Russian Ruble", UAH: "Ukrainian Hryvnia", TRY: "Turkish Lira", ILS: "Israeli Shekel",
  AED: "UAE Dirham", SAR: "Saudi Riyal", QAR: "Qatari Riyal", EGP: "Egyptian Pound", ZAR: "South African Rand",
  NGN: "Nigerian Naira", KES: "Kenyan Shilling", MAD: "Moroccan Dirham", MXN: "Mexican Peso", BRL: "Brazilian Real",
  ARS: "Argentine Peso", CLP: "Chilean Peso", COP: "Colombian Peso", PEN: "Peruvian Sol", UYU: "Uruguayan Peso",
  PYG: "Paraguayan Guarani", BOB: "Bolivian Boliviano", KZT: "Kazakhstani Tenge", GEL: "Georgian Lari", PKR: "Pakistani Rupee",
  BDT: "Bangladeshi Taka", LKR: "Sri Lankan Rupee", XDR: "IMF Special Drawing Rights"
}

// Spoken names and symbols. Ambiguous words ("pound") are also physical units;
// resolveUnit returns every candidate and the parser picks by category.
var CURRENCY_ALIASES = {
  "$": "USD", "us$": "USD", "usd": "USD", "dollar": "USD", "dollars": "USD", "buck": "USD", "bucks": "USD",
  "€": "EUR", "euro": "EUR", "euros": "EUR",
  "£": "GBP", "pound": "GBP", "pounds": "GBP", "quid": "GBP", "sterling": "GBP",
  "¥": "JPY", "yen": "JPY",
  "元": "CNY", "yuan": "CNY", "rmb": "CNY", "renminbi": "CNY",
  "r$": "BRL", "real": "BRL", "reais": "BRL", "reals": "BRL", "brl": "BRL",
  "₹": "INR", "rs": "INR", "rupee": "INR", "rupees": "INR",
  "₩": "KRW", "won": "KRW",
  "₽": "RUB", "ruble": "RUB", "rubles": "RUB", "rouble": "RUB", "roubles": "RUB",
  "₺": "TRY", "lira": "TRY",
  "₴": "UAH", "hryvnia": "UAH",
  "₪": "ILS", "shekel": "ILS", "shekels": "ILS",
  "₱": "PHP",
  "฿": "THB", "baht": "THB",
  "₫": "VND", "dong": "VND",
  "₦": "NGN", "naira": "NGN",
  "₡": "CRC",
  "₲": "PYG", "guarani": "PYG",
  "₸": "KZT", "tenge": "KZT",
  "₾": "GEL", "lari": "GEL",
  "₼": "AZN", "manat": "AZN",
  "֏": "AMD", "dram": "AMD",
  "₵": "GHS", "cedi": "GHS",
  "₭": "LAK", "kip": "LAK",
  "₮": "MNT", "tugrik": "MNT",
  "zł": "PLN", "zloty": "PLN",
  "kč": "CZK", "koruna": "CZK",
  "a$": "AUD", "au$": "AUD", "c$": "CAD", "ca$": "CAD", "hk$": "HKD", "s$": "SGD", "nz$": "NZD", "mx$": "MXN",
  "franc": "CHF", "francs": "CHF", "chf": "CHF",
  "rand": "ZAR",
  "peso": "MXN", "pesos": "MXN",
  "krona": "SEK", "kronor": "SEK", "krone": "NOK", "kroner": "NOK",
  "forint": "HUF", "leu": "RON", "lei": "RON",
  "dirham": "AED", "dirhams": "AED", "riyal": "SAR", "riyals": "SAR",
  "rupiah": "IDR", "ringgit": "MYR", "sol": "PEN", "soles": "PEN",
  "loonie": "CAD", "loonies": "CAD"
}

var CONNECTORS = { to: true, in: true, into: true, as: true }

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

var unitIndex = null
function buildIndex() {
  if (unitIndex) return unitIndex
  unitIndex = {}
  for (var i = 0; i < UNITS.length; i++) {
    var u = UNITS[i]
    for (var j = 0; j < u.names.length; j++) {
      var key = u.names[j]
      if (!unitIndex[key]) unitIndex[key] = []
      unitIndex[key].push({ cat: u.cat, unit: u })
    }
  }
  return unitIndex
}

function currencyUnit(code) {
  return { cat: "currency", unit: { id: code, cat: "currency", name: CURRENCY_NAMES[code] || code } }
}

function isCurrencyCode(code) {
  return CURRENCY_CODES.indexOf(code) >= 0
}

// All interpretations of a token, physical units first, currencies after.
// The parser prefers the interpretation that agrees with the other side.
function resolveUnit(token) {
  var t = String(token || "").trim().toLowerCase().replace(/\.$/, "")
  if (t === "") return []
  var out = []
  var idx = buildIndex()
  if (idx[t]) out = out.concat(idx[t])
  var code = CURRENCY_ALIASES[t]
  if (!code && /^[a-z]{3}$/.test(t) && isCurrencyCode(t.toUpperCase())) code = t.toUpperCase()
  if (code) out.push(currencyUnit(code))
  return out
}

function pickPair(fromCands, toCands) {
  for (var i = 0; i < fromCands.length; i++)
    for (var j = 0; j < toCands.length; j++)
      if (fromCands[i].cat === toCands[j].cat) return { from: fromCands[i], to: toCands[j] }
  return null
}

// ---------------------------------------------------------------------------
// Number parsing. Accepts "1000", "1,000.5", "1.000,5", "1 000", ".5", "-40".
// ---------------------------------------------------------------------------

// `decimal` is the user's decimal separator ("." or ","). With a "," decimal,
// "1.000" reads as one thousand; with a "." decimal, "1,000" does.
function parseAmount(raw, decimal) {
  var s = String(raw || "").replace(/\s+/g, "")
  if (s === "") return NaN
  var decIsComma = decimal === ","
  var lastDot = s.lastIndexOf("."), lastComma = s.lastIndexOf(",")
  if (lastDot >= 0 && lastComma >= 0) {
    // The later one is the decimal separator; the other is grouping.
    if (lastDot > lastComma) s = s.replace(/,/g, "")
    else s = s.replace(/\./g, "").replace(",", ".")
  } else if (lastComma >= 0) {
    var parts = s.split(",")
    if (parts.length > 2) s = parts.join("")
    // "1,000" is grouping for a "." user; a "," user means one point zero.
    else if (!decIsComma && parts.length === 2 && parts[1].length === 3 && parts[0] !== "" && parts[0] !== "-") s = parts.join("")
    else s = parts.join(".")
  } else if (lastDot >= 0) {
    var dparts = s.split(".")
    if (dparts.length > 2) s = dparts.join("")
    // "1.000" is grouping for a "," user; a "." user means one point zero.
    else if (decIsComma && dparts.length === 2 && dparts[1].length === 3 && dparts[0] !== "" && dparts[0] !== "-") s = dparts.join("")
  }
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN
  return parseFloat(s)
}

// Split a word like "€100", "100eur", "r$100", "100€" into its parts. Returns
// null when the word holds no leading number (so "m2" and "km2" stay units).
var SYMBOL_PREFIXES = ["r$", "us$", "au$", "a$", "ca$", "c$", "hk$", "nz$", "s$", "mx$"]
function splitNumberWord(word) {
  var prefix = ""
  var rest = word
  for (var i = 0; i < SYMBOL_PREFIXES.length; i++) {
    var p = SYMBOL_PREFIXES[i]
    if (rest.length > p.length && rest.substr(0, p.length) === p && /[-+\d.,]/.test(rest.charAt(p.length))) {
      prefix = p
      rest = rest.substr(p.length)
      break
    }
  }
  if (prefix === "") {
    var m = rest.match(/^([^a-z0-9\s.,+-]*)(.*)$/)
    if (m && m[1] !== "") { prefix = m[1]; rest = m[2] }
  }
  var n = rest.match(/^([-+]?(?:\d[\d.,]*|\.\d+))(.*)$/)
  if (!n) return null
  var num = n[1]
  var suffix = n[2]
  // A trailing separator belongs to the suffix (e.g. "100." while typing).
  while (num.length > 1 && /[.,]$/.test(num) && !/^\d/.test(suffix)) {
    suffix = num.charAt(num.length - 1) + suffix
    num = num.substr(0, num.length - 1)
  }
  if (suffix !== "" && /^[.,]/.test(suffix)) suffix = suffix.substr(1)
  return { prefix: prefix, number: num, suffix: suffix }
}

// ---------------------------------------------------------------------------
// Arithmetic. "1 + 3", "3*14", "3^6", "(54 * 12) brl in usd". A leading
// expression is evaluated and its value becomes the amount; whatever follows
// is parsed as units. A lone number is not an expression, so "10 km" and
// "-40 c" keep their old meaning.
// ---------------------------------------------------------------------------

var OPERATORS = { "+": "+", "-": "-", "*": "*", "×": "*", "/": "/", "÷": "/", "^": "^", "(": "(", ")": ")" }

// Tokenise the longest run of maths at the start of `s`. Each token records
// where it ends so the caller can find the text that follows.
function tokenizeMath(s, start, decimal) {
  var tokens = []
  var i = start
  while (i < s.length) {
    var ch = s.charAt(i)
    if (ch === " ") { i++; continue }
    var m = s.substr(i).match(/^(?:\d[\d.,]*|\.\d+)/)
    if (m) {
      var num = m[0]
      // A trailing separator belongs to what follows ("100." while typing).
      while (num.length > 1 && /[.,]$/.test(num)) num = num.substr(0, num.length - 1)
      var value = parseAmount(num, decimal)
      if (isNaN(value)) break
      i += num.length
      tokens.push({ type: "num", value: value, text: num, end: i })
      continue
    }
    if (s.substr(i, 2) === "**") { i += 2; tokens.push({ type: "op", op: "^", end: i }); continue }
    if (OPERATORS[ch]) { i++; tokens.push({ type: "op", op: OPERATORS[ch], end: i }); continue }
    // "x" between numbers multiplies; "xyz" is a word.
    if (ch === "x" && tokens.length > 0 && !/[a-z]/.test(s.charAt(i + 1))) {
      var prev = tokens[tokens.length - 1]
      if (prev.type === "num" || prev.op === ")") { i++; tokens.push({ type: "op", op: "*", end: i }); continue }
    }
    break
  }
  return tokens
}

// Recursive descent over the token list. Parses as far as it can and stops
// before anything it cannot use, so "1 +" evaluates to 1 while typing.
// Returns { value, end, compound } or null when nothing parsed.
function parseMath(tokens) {
  var pos = 0
  var compound = false
  function peek() { return tokens[pos] }
  function isOp(op) { var t = peek(); return !!t && t.type === "op" && t.op === op }

  function primary() {
    var t = peek()
    if (!t) return null
    if (t.type === "num") { pos++; return t.value }
    if (t.op === "(") {
      var save = pos
      pos++
      var v = additive()
      if (v === null) { pos = save; return null }
      if (isOp(")")) pos++          // an unclosed paren is fine while typing
      compound = true
      return v
    }
    return null
  }
  function unary() {
    if (isOp("-") || isOp("+")) {
      var save = pos
      var neg = peek().op === "-"
      pos++
      var v = unary()
      if (v === null) { pos = save; return null }
      return neg ? -v : v
    }
    return primary()
  }
  function power() {
    var base = unary()
    if (base === null) return null
    if (isOp("^")) {
      var save = pos
      pos++
      var exp = power()               // right-associative
      if (exp === null) { pos = save; return base }
      compound = true
      return Math.pow(base, exp)
    }
    return base
  }
  function multiplicative() {
    var v = power()
    if (v === null) return null
    for (;;) {
      var save = pos
      var t = peek()
      if (!t || t.type !== "op") break
      var op = t.op
      if (op === "(") op = "*"         // 2(3+4)
      else if (op === "*" || op === "/") pos++
      else break
      var rhs = power()
      if (rhs === null) { pos = save; break }
      compound = true
      v = op === "*" ? v * rhs : v / rhs
    }
    return v
  }
  function additive() {
    var v = multiplicative()
    if (v === null) return null
    for (;;) {
      var save = pos
      if (!(isOp("+") || isOp("-"))) break
      var add = peek().op === "+"
      pos++
      var rhs = multiplicative()
      if (rhs === null) { pos = save; break }
      compound = true
      v = add ? v + rhs : v - rhs
    }
    return v
  }

  var value = additive()
  if (value === null || pos === 0) return null
  return { value: value, end: tokens[pos - 1].end, compound: compound }
}

// Human form of the consumed expression: "54 × 12", "3 ^ 6", "(1 + 2) ÷ 4".
function prettyMath(tokens, end, sep) {
  var out = ""
  var prev = null            // previous token
  var prevUnary = false      // previous token was a sign, not a subtraction
  for (var i = 0; i < tokens.length && tokens[i].end <= end; i++) {
    var t = tokens[i]
    var text = t.type === "num" ? formatAmount(t.value, sep) : ({ "*": "×", "/": "÷" }[t.op] || t.op)
    var afterOperand = prev && (prev.type === "num" || prev.op === ")")
    var unary = t.type === "op" && (t.op === "-" || t.op === "+") && !afterOperand
    var glue = !prev || prevUnary || (prev.op === "(") || t.op === ")" || (t.op === "(" && prev.type === "num")
    out += (glue ? "" : " ") + text
    prev = t
    prevUnary = unary
  }
  return out
}

// Evaluate arithmetic at the start of `s` (after `start`). Returns null when
// there is no genuine expression there (a bare number does not count).
function leadingMath(s, start, decimal) {
  var tokens = tokenizeMath(s, start, decimal)
  if (tokens.length < 2) return null
  var parsed = parseMath(tokens)
  if (!parsed) return null
  // Operators left over after the parse ("1 +", "2 *") are a half-typed
  // expression: keep the running value and skip past them.
  var end = parsed.end
  var dangling = false
  for (var i = 0; i < tokens.length; i++) {
    if (tokens[i].end <= parsed.end) continue
    if (tokens[i].type !== "op") break
    end = tokens[i].end
    dangling = true
  }
  if (!parsed.compound && !dangling) return null
  return { value: parsed.value, end: end, tokens: tokens }
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

function normalise(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/ /g, " ")
    .replace(/(->|=>|→|=)/g, " to ")
    .replace(/\s+/g, " ")
    .trim()
}

// Words -> [from, to] using a connector word, or a bare split, or from only.
function splitUnits(words) {
  var n = words.length
  if (n === 0) return { from: [], to: [], connector: false, trailing: false }
  var trailing = CONNECTORS[words[n - 1]] === true
  var mismatch = null
  var i
  for (i = 1; i < n - 1; i++) {
    if (!CONNECTORS[words[i]]) continue
    var lc0 = resolveUnit(words.slice(0, i).join(" ")), rc0 = resolveUnit(words.slice(i + 1).join(" "))
    var pair = pickPair(lc0, rc0)
    if (pair) return { from: pair.from, to: pair.to, connector: true }
    if (!mismatch && lc0.length && rc0.length) mismatch = { from: lc0[0], to: rc0[0], mismatch: true }
  }
  for (i = 1; i < n; i++) {
    var lc1 = resolveUnit(words.slice(0, i).join(" ")), rc1 = resolveUnit(words.slice(i).join(" "))
    var pair2 = pickPair(lc1, rc1)
    if (pair2) return { from: pair2.from, to: pair2.to, connector: false }
    if (!mismatch && lc1.length && rc1.length) mismatch = { from: lc1[0], to: rc1[0], mismatch: true }
  }
  if (mismatch) return mismatch
  var body = trailing ? words.slice(0, n - 1) : words
  var only = resolveUnit(body.join(" "))
  // "100 eur to" while typing, or "100 eur": from only.
  if (only.length > 0) return { from: only[0], fromCands: only, to: null, trailing: trailing }
  // Try connector split where only the left side resolves: "100 eur to xx".
  for (i = 1; i < n - 1; i++) {
    if (!CONNECTORS[words[i]]) continue
    var lc = resolveUnit(words.slice(0, i).join(" "))
    if (lc.length > 0) return { from: lc[0], fromCands: lc, to: null, unknown: words.slice(i + 1).join(" ") }
  }
  return { from: null, to: null, unknown: body.join(" ") }
}

// ctx: { rates: { CODE: perUsd }, defaultCurrency: "USD", secondaryCurrency: "EUR",
//        unitSystem: "metric" | "imperial", decimal: "." | ",",
//        separators: { decimal, group } (only used to pretty-print expressions) }
function evaluate(text, ctx) {
  ctx = ctx || {}
  var s = normalise(text)
  if (s === "") return null

  // Optional currency symbol before the maths: "$(2 + 3) in eur", "r$10*2".
  var symbol = ""
  var symbolMatch = s.match(/^(r\$|us\$|au\$|a\$|ca\$|c\$|hk\$|nz\$|s\$|mx\$|[^a-z0-9\s.,+\-(]+)\s*(?=[-+(\d.])/)
  if (symbolMatch && CURRENCY_ALIASES[symbolMatch[1]]) symbol = symbolMatch[1]

  var math = leadingMath(s, symbol.length, ctx.decimal)
  var amount = 1
  var hasAmount = false
  var unitWords = []
  var words
  if (math) {
    if (!isFinite(math.value)) return { error: "Division by zero", amount: NaN }
    amount = math.value
    hasAmount = true
    if (symbol) unitWords.push(symbol)
    words = s.substr(math.end).trim().split(" ").filter(function(w) { return w !== "" })
    // "1 + 3" alone (or "1 + 3 =", which normalises to a trailing "to"): plain maths.
    if (unitWords.length === 0 && (words.length === 0 || (words.length === 1 && CONNECTORS[words[0]])))
      return { amount: amount, value: amount, from: null, to: null, math: math, expr: prettyMath(math.tokens, math.end, ctx.separators) }
  } else {
    words = s.split(" ")
  }
  for (var i = 0; i < words.length; i++) {
    var w = words[i]
    if (!hasAmount) {
      var parts = splitNumberWord(w)
      if (parts) {
        var value = parseAmount(parts.number, ctx.decimal)
        if (!isNaN(value)) {
          amount = value
          hasAmount = true
          if (parts.prefix) unitWords.push(parts.prefix)
          if (parts.suffix) unitWords.push(parts.suffix)
          continue
        }
      }
    }
    unitWords.push(w)
  }

  if (unitWords.length === 0)
    return { pending: true, amount: amount, hint: "what?" }

  var split = splitUnits(unitWords)
  if (!split.from) {
    // Only maths characters so far ("(", "2 +("): still typing an expression.
    if (/^[\d\s.,+\-*\/^()×÷x]*$/.test(split.unknown)) return { pending: true, amount: amount, hint: "…" }
    return { error: "Unknown unit “" + split.unknown + "”", amount: amount }
  }

  var from = split.from
  var to = split.to
  var defaulted = false
  if (!to) {
    if (split.unknown) return { error: "Unknown unit “" + split.unknown + "”", amount: amount, from: from }
    to = defaultTarget(from, ctx)
    defaulted = true
    if (!to) return { pending: true, amount: amount, from: from, hint: "to what?" }
  }

  var res = convert(amount, from, to, ctx.rates)
  if (res.error) return { error: res.error, amount: amount, from: from, to: to, ratesMissing: res.ratesMissing }
  return {
    amount: amount,
    from: from,
    to: to,
    value: res.value,
    rate: res.rate,
    defaulted: defaulted,
    trailing: split.trailing === true,
    expr: math ? prettyMath(math.tokens, math.end, ctx.separators) : ""
  }
}

function defaultTarget(from, ctx) {
  if (from.cat === "currency") {
    var primary = String(ctx.defaultCurrency || "USD").toUpperCase()
    var secondary = String(ctx.secondaryCurrency || (primary === "USD" ? "EUR" : "USD")).toUpperCase()
    var code = from.unit.id === primary ? secondary : primary
    if (!isCurrencyCode(code)) code = from.unit.id === "USD" ? "EUR" : "USD"
    return currencyUnit(code)
  }
  var partner = defaultPartner(from.unit.id, ctx.unitSystem)
  if (!partner) return null
  for (var i = 0; i < UNITS.length; i++)
    if (UNITS[i].id === partner) return { cat: UNITS[i].cat, unit: UNITS[i] }
  return null
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

function convert(amount, from, to, rates) {
  if (from.cat !== to.cat) return { error: "Can't convert " + unitLabel(from) + " to " + unitLabel(to) }
  if (from.cat === "currency") {
    var a = rates ? Number(rates[from.unit.id]) : NaN
    var b = rates ? Number(rates[to.unit.id]) : NaN
    if (!(a > 0) || !(b > 0)) return { error: "No rate for " + (a > 0 ? to.unit.id : from.unit.id), ratesMissing: true }
    var rate = b / a
    return { value: amount * rate, rate: rate }
  }
  if (from.cat === "temperature") {
    var c = amount
    if (from.unit.id === "°F") c = (amount - 32) * 5 / 9
    else if (from.unit.id === "K") c = amount - 273.15
    var out = c
    if (to.unit.id === "°F") out = c * 9 / 5 + 32
    else if (to.unit.id === "K") out = c + 273.15
    return { value: out, rate: null }
  }
  var factor = from.unit.factor / to.unit.factor
  return { value: amount * factor, rate: factor }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function unitLabel(u) {
  if (!u) return ""
  return u.unit.id
}

function unitName(u) {
  if (!u) return ""
  if (u.cat === "currency") return u.unit.name || u.unit.id
  return u.unit.names[0]
}

function groupDigits(intPart, sep) {
  var out = ""
  var count = 0
  for (var i = intPart.length - 1; i >= 0; i--) {
    out = intPart.charAt(i) + out
    count++
    if (count % 3 === 0 && i > 0) out = sep + out
  }
  return out
}

// Fixed-decimal string with locale separators. Trailing zeros are kept when
// `keepZeros` is set (money), trimmed otherwise.
function formatFixed(n, decimals, keepZeros, sep) {
  sep = sep || { decimal: ".", group: "," }
  var neg = n < 0
  var s = Math.abs(n).toFixed(decimals)
  var parts = s.split(".")
  var intPart = groupDigits(parts[0], sep.group)
  var frac = parts.length > 1 ? parts[1] : ""
  if (!keepZeros) frac = frac.replace(/0+$/, "")
  var out = intPart + (frac !== "" ? sep.decimal + frac : "")
  if (out === "0" || out === "0" + sep.decimal) neg = false
  return (neg ? "-" : "") + out
}

function decimalsForPrecision(n, significant) {
  var abs = Math.abs(n)
  if (abs === 0 || !isFinite(abs)) return 0
  var magnitude = Math.floor(Math.log(abs) / Math.LN10) + 1
  return Math.max(0, significant - magnitude)
}

function formatValue(n, cat, sep) {
  if (!isFinite(n)) return "—"
  var abs = Math.abs(n)
  if (cat === "currency") {
    if (abs === 0) return formatFixed(0, 2, true, sep)
    if (abs >= 1) return formatFixed(n, 2, true, sep)
    return formatFixed(n, Math.min(8, decimalsForPrecision(n, 4)), false, sep)
  }
  if (abs === 0) return "0"
  if (cat === "math") {
    if (abs >= 1e18) return n.toExponential(6)
    return formatFixed(n, Math.min(12, decimalsForPrecision(n, 12)), false, sep)
  }
  if (abs >= 1e15) return n.toExponential(4)
  if (abs >= 1000) return formatFixed(n, 2, false, sep)
  return formatFixed(n, Math.min(10, decimalsForPrecision(n, 6)), false, sep)
}

// Category used to format a result's value: the target unit's, or "math".
function resultCategory(result) {
  return result && result.to ? result.to.cat : "math"
}

function formatAmount(n, sep) {
  if (!isFinite(n)) return "—"
  return formatFixed(n, Math.min(10, decimalsForPrecision(n, 8)), false, sep)
}

function formatRate(rate, cat, sep) {
  if (rate === null || rate === undefined || !isFinite(rate)) return ""
  return formatFixed(rate, Math.min(10, decimalsForPrecision(rate, cat === "currency" ? 5 : 6)), false, sep)
}

// "1 EUR = 5.9448 BRL" or "1 km = 0.621371 mi"; empty for temperature.
function rateLine(result, sep) {
  if (!result || result.rate === null || result.rate === undefined) return ""
  return "1 " + unitLabel(result.from) + " = " + formatRate(result.rate, result.from.cat, sep) + " " + unitLabel(result.to)
}

// "54 × 12 = 648" for a converted expression; empty otherwise.
function exprLine(result, sep) {
  if (!result || !result.expr || !result.to) return ""
  return result.expr + " = " + formatAmount(result.amount, sep)
}

function relativeAge(fromUnixSeconds, nowUnixSeconds) {
  var delta = Math.max(0, Math.floor(nowUnixSeconds - fromUnixSeconds))
  if (delta < 90) return "just now"
  if (delta < 3600) return Math.round(delta / 60) + " min ago"
  if (delta < 86400 * 2) return Math.round(delta / 3600) + " h ago"
  return Math.round(delta / 86400) + " days ago"
}

// Validate an open.er-api.com payload. Returns { rates, updatedAt, nextUpdateAt }
// or throws. Only ISO-looking keys with finite positive numbers survive.
function parseRatesPayload(raw, maxBytes) {
  var text = String(raw || "")
  if (maxBytes && text.length > maxBytes) throw new Error("payload too large")
  var data = JSON.parse(text)
  if (!data || data.result !== "success" || !data.rates || typeof data.rates !== "object") throw new Error("bad payload")
  var rates = {}
  var count = 0
  for (var code in data.rates) {
    if (!/^[A-Z]{3}$/.test(code)) continue
    var v = Number(data.rates[code])
    if (!isFinite(v) || v <= 0) continue
    rates[code] = v
    count++
    if (count > 400) throw new Error("too many rates")
  }
  if (count < 20 || !(rates.USD > 0)) throw new Error("too few rates")
  var updatedAt = Number(data.time_last_update_unix) || 0
  var nextUpdateAt = Number(data.time_next_update_unix) || (updatedAt + 86400)
  return { rates: rates, updatedAt: updatedAt, nextUpdateAt: nextUpdateAt }
}

var EXAMPLES = [
  "100 EUR in BRL", "$250 to JPY", "10 km to mi", "3 * 14", "72 F", "(54 * 12) BRL in USD", "2^10", "1 GiB in MB", "3 cups in ml", "120 km/h in mph"
]

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------

var NUMBER_FORMATS = [
  { value: "auto", label: "System locale" },
  { value: "point", label: "1,234.56" },
  { value: "comma", label: "1.234,56" },
  { value: "space", label: "1 234,56" },
  { value: "plain", label: "1234.56" }
]

// Separators for a number format setting; `localeSep` is what Qt reports.
function separatorsFor(format, localeSep) {
  switch (String(format || "auto")) {
    case "point": return { decimal: ".", group: "," }
    case "comma": return { decimal: ",", group: "." }
    case "space": return { decimal: ",", group: " " }
    case "plain": return { decimal: ".", group: "" }
    default:
      var dec = (localeSep && localeSep.decimal) || "."
      var grp = (localeSep && localeSep.group) || ","
      if (grp === dec) grp = dec === "." ? "," : " "
      if (grp === "\u00a0" || grp === "\u202f") grp = " "
      return { decimal: dec, group: grp }
  }
}

var UNIT_SYSTEMS = [
  { value: "auto", label: "System locale" },
  { value: "metric", label: "Metric", description: "Nautical miles → km, knots → km/h, kelvin → °C" },
  { value: "imperial", label: "Imperial / US", description: "Nautical miles → miles, knots → mph, kelvin → °F" }
]

var RATE_REFRESH = [
  { value: "provider", label: "Provider schedule (daily)" },
  { value: "6", label: "Every 6 hours" },
  { value: "12", label: "Every 12 hours" },
  { value: "24", label: "Every 24 hours" }
]

// Dropdown options for every supported currency, named ones first.
function currencyOptions(includeAuto) {
  var named = [], bare = []
  for (var i = 0; i < CURRENCY_CODES.length; i++) {
    var code = CURRENCY_CODES[i]
    if (CURRENCY_NAMES[code]) named.push({ value: code, label: code + "  " + CURRENCY_NAMES[code] })
    else bare.push({ value: code, label: code })
  }
  var out = includeAuto ? [{ value: "auto", label: "System locale" }] : []
  return out.concat(named, bare)
}
