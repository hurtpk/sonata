/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Every unit the Converter knows, by kind. Most are a plain factor to the
// kind's base unit; temperature, fuel economy, wind force and shoe sizes
// need their own formulas.

export interface Unit {
    id: string;
    name: string;
    symbol: string;
    /** What people type for it (lower case; matched whole). */
    aliases: string[];
    /** Multiply by this to get the base unit… */
    factor?: number;
    /** …or these, for units that aren't a simple multiple. */
    toBase?: (v: number) => number;
    fromBase?: (v: number) => number;
    /** Which system it belongs to, for "show me the other one" in messages. */
    system?: "metric" | "imperial";
    /** Shown in the list only after "Show all". */
    rare?: boolean;
}

export interface Category { id: string; name: string; icon: string; units: Unit[]; }

const u = (id: string, name: string, symbol: string, factor: number, aliases: string[], extra: Partial<Unit> = {}): Unit => ({ id, name, symbol, factor, aliases: [symbol.toLowerCase(), id, name.toLowerCase(), `${name.toLowerCase()}s`, ...aliases], ...extra });
const M = { system: "metric" as const }, I = { system: "imperial" as const }, R = { rare: true };

export const CATEGORIES: Category[] = [
    {
        id: "length", name: "Length & distance", icon: "📏", units: [
            u("mm", "Millimetre", "mm", 0.001, ["millimeter", "millimeters", "millimetres"], M),
            u("cm", "Centimetre", "cm", 0.01, ["centimeter", "centimeters", "centimetres", "cms"], M),
            u("m", "Metre", "m", 1, ["meter", "meters", "metres", "mtr"], M),
            u("km", "Kilometre", "km", 1000, ["kilometer", "kilometers", "kilometres", "kms", "klick", "klicks", "k"], M),
            u("in", "Inch", "in", 0.0254, ["inches", "\"", "″", "inchs"], I),
            u("ft", "Foot", "ft", 0.3048, ["feet", "'", "′", "foots"], I),
            u("yd", "Yard", "yd", 0.9144, ["yards", "yds"], I),
            u("mi", "Mile", "mi", 1609.344, ["miles", "mile"], I),
            u("nmi", "Nautical mile", "nmi", 1852, ["nautical miles", "nm"], R),
            u("um", "Micrometre", "µm", 1e-6, ["micron", "microns", "micrometer", "micrometers", "um"], { ...M, ...R }),
            u("au", "Astronomical unit", "AU", 1.495978707e11, ["astronomical units"], R),
            u("ly", "Light-year", "ly", 9.4607304725808e15, ["light year", "light years", "lightyear", "lightyears", "light-years"], R),
        ],
    },
    {
        id: "mass", name: "Weight", icon: "⚖️", units: [
            u("mg", "Milligram", "mg", 1e-6, ["milligrams"], M),
            u("g", "Gram", "g", 0.001, ["grams", "gr", "grammes"], M),
            u("kg", "Kilogram", "kg", 1, ["kilograms", "kilo", "kilos", "kgs"], M),
            u("t", "Tonne", "t", 1000, ["tonnes", "metric ton", "metric tons"], M),
            u("oz", "Ounce", "oz", 0.028349523125, ["ounces"], I),
            u("lb", "Pound", "lb", 0.45359237, ["pounds", "lbs", "#"], I),
            u("st", "Stone", "st", 6.35029318, ["stones"], I),
            u("ton", "US ton", "ton", 907.18474, ["tons", "short ton", "short tons"], { ...I, ...R }),
            u("ct", "Carat", "ct", 0.0002, ["carats"], R),
            u("ozt", "Troy ounce", "oz t", 0.0311034768, ["troy ounce", "troy ounces"], R),
        ],
    },
    {
        id: "temp", name: "Temperature", icon: "🌡️", units: [
            { id: "c", name: "Celsius", symbol: "°C", aliases: ["c", "°c", "celsius", "centigrade", "degc", "degrees c", "degrees celsius", "ºc"], toBase: v => v, fromBase: v => v, system: "metric" },
            { id: "f", name: "Fahrenheit", symbol: "°F", aliases: ["f", "°f", "fahrenheit", "degf", "degrees f", "degrees fahrenheit", "ºf"], toBase: v => (v - 32) * 5 / 9, fromBase: v => v * 9 / 5 + 32, system: "imperial" },
            { id: "k", name: "Kelvin", symbol: "K", aliases: ["kelvin", "kelvins"], toBase: v => v - 273.15, fromBase: v => v + 273.15 },
            { id: "r", name: "Rankine", symbol: "°R", aliases: ["°r", "rankine"], toBase: v => (v - 491.67) * 5 / 9, fromBase: v => (v + 273.15) * 9 / 5, rare: true },
        ],
    },
    {
        id: "volume", name: "Volume & cooking", icon: "🧪", units: [
            u("ml", "Millilitre", "ml", 0.001, ["milliliter", "milliliters", "millilitres", "mls", "cc"], M),
            u("cl", "Centilitre", "cl", 0.01, ["centiliter", "centiliters"], { ...M, ...R }),
            u("l", "Litre", "L", 1, ["liter", "liters", "litres", "ltr", "ltrs"], M),
            u("m3", "Cubic metre", "m³", 1000, ["m3", "cubic meter", "cubic meters", "cubic metres"], { ...M, ...R }),
            u("tsp", "Teaspoon", "tsp", 0.00492892159375, ["teaspoons", "tsps"], I),
            u("tbsp", "Tablespoon", "tbsp", 0.01478676478125, ["tablespoons", "tbsps", "tbs", "tbl"], I),
            u("floz", "Fluid ounce (US)", "fl oz", 0.0295735295625, ["fl oz", "fluid ounce", "fluid ounces", "floz"], I),
            u("cup", "Cup (US)", "cup", 0.2365882365, ["cups"], I),
            u("pt", "Pint (US)", "pt", 0.473176473, ["pints", "pint"], I),
            u("qt", "Quart (US)", "qt", 0.946352946, ["quarts"], I),
            u("gal", "Gallon (US)", "gal", 3.785411784, ["gallons", "gallon"], I),
            u("ukpt", "Pint (UK)", "UK pt", 0.56826125, ["uk pint", "uk pints", "imperial pint", "imperial pints"], R),
            u("ukgal", "Gallon (UK)", "UK gal", 4.54609, ["uk gallon", "uk gallons", "imperial gallon", "imperial gallons"], R),
            u("in3", "Cubic inch", "in³", 0.016387064, ["in3", "cubic inch", "cubic inches"], R),
            u("ft3", "Cubic foot", "ft³", 28.316846592, ["ft3", "cubic foot", "cubic feet"], R),
            u("bbl", "Barrel (oil)", "bbl", 158.987294928, ["barrel", "barrels"], R),
        ],
    },
    {
        id: "area", name: "Area", icon: "⬛", units: [
            u("cm2", "Square centimetre", "cm²", 1e-4, ["cm2", "sq cm", "square centimeters", "square centimetres"], M),
            u("m2", "Square metre", "m²", 1, ["m2", "sq m", "sqm", "square meter", "square meters", "square metres"], M),
            u("ha", "Hectare", "ha", 1e4, ["hectares"], M),
            u("km2", "Square kilometre", "km²", 1e6, ["km2", "sq km", "square kilometers", "square kilometres"], M),
            u("in2", "Square inch", "in²", 0.00064516, ["in2", "sq in", "square inches"], I),
            u("ft2", "Square foot", "ft²", 0.09290304, ["ft2", "sq ft", "sqft", "square feet"], I),
            u("yd2", "Square yard", "yd²", 0.83612736, ["yd2", "sq yd", "square yards"], I),
            u("acre", "Acre", "ac", 4046.8564224, ["acres"], I),
            u("mi2", "Square mile", "mi²", 2589988.110336, ["mi2", "sq mi", "square miles"], I),
        ],
    },
    {
        id: "speed", name: "Speed & wind", icon: "💨", units: [
            u("mps", "Metres per second", "m/s", 1, ["meters per second", "metres per second"], M),
            u("kmh", "Kilometres per hour", "km/h", 1 / 3.6, ["kmh", "kph", "kmph", "kilometers per hour", "kilometres per hour"], M),
            u("mph", "Miles per hour", "mph", 0.44704, ["mi/h", "miles per hour"], I),
            u("kn", "Knot", "kn", 1852 / 3600, ["knots", "kt", "kts"]),
            u("fts", "Feet per second", "ft/s", 0.3048, ["fps", "feet per second"], R),
            u("mach", "Mach", "Mach", 343, ["mach"], R),
            { id: "bft", name: "Beaufort (wind force)", symbol: "Bft", aliases: ["bft", "beaufort", "force"], toBase: b => 0.836 * Math.pow(Math.max(0, b), 1.5), fromBase: v => Math.round(Math.pow(Math.max(0, v) / 0.836, 2 / 3) * 10) / 10 },
        ],
    },
    {
        id: "time", name: "Time", icon: "⏱️", units: [
            u("ms", "Millisecond", "ms", 0.001, ["milliseconds", "millisecond", "msec"]),
            u("s", "Second", "s", 1, ["sec", "secs", "seconds"]),
            u("min", "Minute", "min", 60, ["mins", "minutes", "m"]),
            u("h", "Hour", "h", 3600, ["hr", "hrs", "hours"]),
            u("d", "Day", "d", 86400, ["days"]),
            u("wk", "Week", "wk", 604800, ["weeks", "w"]),
            u("mo", "Month", "mo", 2629746, ["months", "mos"]),
            u("yr", "Year", "yr", 31556952, ["years", "yrs", "y"]),
            u("dec", "Decade", "decade", 315569520, ["decades"], R),
            u("cen", "Century", "century", 3155695200, ["centuries"], R),
            u("us", "Microsecond", "µs", 1e-6, ["microseconds", "us"], R),
            u("ns", "Nanosecond", "ns", 1e-9, ["nanoseconds"], R),
        ],
    },
    {
        id: "data", name: "Data size", icon: "💾", units: [
            u("bit", "Bit", "bit", 1 / 8, ["bits"]),
            u("B", "Byte", "B", 1, ["bytes"]),
            u("KB", "Kilobyte", "KB", 1e3, ["kilobytes", "kb"]),
            u("MB", "Megabyte", "MB", 1e6, ["megabytes", "mb", "megs"]),
            u("GB", "Gigabyte", "GB", 1e9, ["gigabytes", "gb", "gigs", "gig"]),
            u("TB", "Terabyte", "TB", 1e12, ["terabytes", "tb"]),
            u("PB", "Petabyte", "PB", 1e15, ["petabytes", "pb"], R),
            u("KiB", "Kibibyte", "KiB", 1024, ["kib", "kibibytes"]),
            u("MiB", "Mebibyte", "MiB", 1024 ** 2, ["mib", "mebibytes"]),
            u("GiB", "Gibibyte", "GiB", 1024 ** 3, ["gib", "gibibytes"]),
            u("TiB", "Tebibyte", "TiB", 1024 ** 4, ["tib", "tebibytes"], R),
        ],
    },
    {
        id: "rate", name: "Internet speed", icon: "📶", units: [
            u("kbps", "Kilobits per second", "kbps", 1e3, ["kb/s", "kbit/s"]),
            u("mbps", "Megabits per second", "Mbps", 1e6, ["mb/s", "mbit/s", "megabits"]),
            u("gbps", "Gigabits per second", "Gbps", 1e9, ["gb/s", "gbit/s", "gigabits"]),
            u("kBps", "Kilobytes per second", "KB/s", 8e3, ["kbytes/s", "kilobytes per second"]),
            u("mBps", "Megabytes per second", "MB/s", 8e6, ["mbytes/s", "megabytes per second"]),
            u("gBps", "Gigabytes per second", "GB/s", 8e9, ["gbytes/s", "gigabytes per second"]),
        ],
    },
    {
        id: "energy", name: "Energy & food", icon: "⚡", units: [
            u("j", "Joule", "J", 1, ["joules"], M),
            u("kj", "Kilojoule", "kJ", 1e3, ["kilojoules"], M),
            u("cal", "Calorie (small)", "cal", 4.184, ["calories (small)", "gram calorie"], R),
            u("kcal", "Calorie (food)", "kcal", 4184, ["calories", "calorie", "kilocalories", "kcals", "cals", "food calories"], I),
            u("wh", "Watt-hour", "Wh", 3600, ["watt hours", "watt-hours"]),
            u("kwh", "Kilowatt-hour", "kWh", 3.6e6, ["kilowatt hours", "kilowatt-hours"]),
            u("btu", "BTU", "BTU", 1055.05585262, ["btus", "british thermal units"]),
            u("ev", "Electronvolt", "eV", 1.602176634e-19, ["electronvolts"], R),
        ],
    },
    {
        id: "power", name: "Power", icon: "🔌", units: [
            u("w", "Watt", "W", 1, ["watts"]),
            u("kw", "Kilowatt", "kW", 1e3, ["kilowatts"], M),
            u("mw", "Megawatt", "MW", 1e6, ["megawatts"], R),
            u("hp", "Horsepower", "hp", 745.69987158227, ["horsepower", "bhp"], I),
            u("ps", "Metric horsepower", "PS", 735.49875, ["metric horsepower", "cv", "pk"], R),
            u("btuh", "BTU per hour", "BTU/h", 0.29307107, ["btu/h", "btu/hr"], R),
        ],
    },
    {
        id: "pressure", name: "Pressure", icon: "🎈", units: [
            u("pa", "Pascal", "Pa", 1, ["pascals"], R),
            u("hpa", "Hectopascal", "hPa", 100, ["hectopascals", "mbar", "millibar", "millibars"], M),
            u("kpa", "Kilopascal", "kPa", 1e3, ["kilopascals"], M),
            u("bar", "Bar", "bar", 1e5, ["bars"], M),
            u("atm", "Atmosphere", "atm", 101325, ["atmospheres"]),
            u("psi", "Pounds per square inch", "psi", 6894.757293168, ["lb/in2", "pounds per square inch"], I),
            u("mmhg", "Millimetres of mercury", "mmHg", 133.322387415, ["mm hg", "torr"]),
            u("inhg", "Inches of mercury", "inHg", 3386.389, ["in hg", "inches of mercury"], I),
        ],
    },
    {
        id: "force", name: "Force", icon: "💪", units: [
            u("n", "Newton", "N", 1, ["newtons"], M),
            { id: "knewton", name: "Kilonewton", symbol: "kN", factor: 1e3, aliases: ["kilonewton", "kilonewtons"], system: "metric" },
            u("lbf", "Pound-force", "lbf", 4.4482216152605, ["pound force", "pounds force"], I),
            u("kgf", "Kilogram-force", "kgf", 9.80665, ["kilogram force", "kp"]),
        ],
    },
    {
        id: "angle", name: "Angle", icon: "📐", units: [
            u("deg", "Degree", "°", 1, ["degrees", "deg", "degs"]),
            u("rad", "Radian", "rad", 180 / Math.PI, ["radians"]),
            u("grad", "Gradian", "grad", 0.9, ["gradians", "gon"], R),
            u("turn", "Turn", "turn", 360, ["turns", "revolution", "revolutions", "rev"]),
            u("arcmin", "Arcminute", "′", 1 / 60, ["arcminutes", "arcmin"], R),
            u("arcsec", "Arcsecond", "″", 1 / 3600, ["arcseconds", "arcsec"], R),
        ],
    },
    {
        id: "freq", name: "Frequency", icon: "〰️", units: [
            u("hz", "Hertz", "Hz", 1, ["hertz"]),
            u("khz", "Kilohertz", "kHz", 1e3, ["kilohertz"]),
            u("mhz", "Megahertz", "MHz", 1e6, ["megahertz"]),
            u("ghz", "Gigahertz", "GHz", 1e9, ["gigahertz"]),
            u("rpm", "Revolutions per minute", "rpm", 1 / 60, ["revs per minute"]),
            u("bpm", "Beats per minute", "bpm", 1 / 60, ["beats per minute"]),
        ],
    },
    {
        id: "fuel", name: "Fuel economy", icon: "⛽", units: [
            // Base: kilometres per litre.
            { id: "l100", name: "Litres per 100 km", symbol: "L/100 km", aliases: ["l/100km", "l/100 km", "l per 100km", "liters per 100 km"], toBase: v => 100 / v, fromBase: v => 100 / v, system: "metric" },
            { id: "kml", name: "Kilometres per litre", symbol: "km/L", aliases: ["km/l", "kmpl", "kilometers per liter"], toBase: v => v, fromBase: v => v, system: "metric" },
            { id: "mpg", name: "Miles per gallon (US)", symbol: "mpg", aliases: ["mpg", "us mpg", "miles per gallon"], toBase: v => v * 0.425143707, fromBase: v => v / 0.425143707, system: "imperial" },
            { id: "ukmpg", name: "Miles per gallon (UK)", symbol: "UK mpg", aliases: ["uk mpg", "mpg uk", "imperial mpg"], toBase: v => v * 0.35400619, fromBase: v => v / 0.35400619 },
        ],
    },
    {
        id: "shoe", name: "Shoe sizes (adult, approx.)", icon: "👟", units: [
            // Base: UK size. Real sizes vary by brand — these are the usual charts.
            { id: "uk", name: "UK", symbol: "UK", aliases: ["uk", "uk size", "uk shoe", "uk shoe size"], toBase: v => v, fromBase: v => v },
            { id: "eu", name: "EU", symbol: "EU", aliases: ["eu", "eu size", "eu shoe", "euro size", "eu shoe size"], toBase: v => (v - 33.5) , fromBase: v => v + 33.5 },
            { id: "usm", name: "US men's", symbol: "US M", aliases: ["us men", "us mens", "us men's", "us m", "us size", "us shoe"], toBase: v => v - 1, fromBase: v => v + 1 },
            { id: "usw", name: "US women's", symbol: "US W", aliases: ["us women", "us womens", "us women's", "us w"], toBase: v => v - 2.5, fromBase: v => v + 2.5 },
            { id: "cm", name: "Foot length", symbol: "cm", aliases: ["foot cm", "mondopoint"], toBase: v => (v / 2.54 + 0.33) * 3 - 25, fromBase: v => Math.round(((v + 25) / 3 - 0.33) * 2.54 * 2) / 2 },
        ],
    },
];

export const categoryById = (id: string) => CATEGORIES.find(c => c.id === id);

/** A value in one unit → the same in another (same category). */
export function convertUnit(value: number, from: Unit, to: Unit): number {
    const base = from.toBase ? from.toBase(value) : value * from.factor!;
    return to.fromBase ? to.fromBase(base) : base / to.factor!;
}

// ─── Reading what's typed ───

const ALIAS = new Map<string, { cat: Category; unit: Unit; }[]>();
for (const cat of CATEGORIES) for (const unit of cat.units) for (const a of unit.aliases) {
    const list = ALIAS.get(a) ?? [];
    list.push({ cat, unit });
    ALIAS.set(a, list);
}

/** Units for a word — several when it's ambiguous ("m" is metres or minutes). */
export const unitsNamed = (word: string) => ALIAS.get(word.trim().toLowerCase().replace(/\.$/, "")) ?? [];

export interface Parsed { cat: Category; unit: Unit; value: number; /** For "5 ft 3 in": every part. */ text: string; to?: Unit; }

const NUM_RE = /-?(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)(?:e-?\d+)?/g;

/** The longest unit name at the start of `rest` (up to four words: "light year", "fl oz", "l/100 km"). */
function unitAt(rest: string): { name: string; length: number; } | null {
    const m = rest.match(/^\s*([^\s\d]+(?:\s+[^\s\d]+){0,3}|[^\s]*\d[^\s]*)/);
    if (!m) return null;
    const words = m[1].split(/\s+/);
    for (let n = words.length; n > 0; n--) {
        const name = words.slice(0, n).join(" ");
        for (const candidate of [name, name.replace(/\s+/g, ""), name.replace(/[.,;:!?)]+$/, "")]) {
            if (unitsNamed(candidate).length) return { name: candidate, length: rest.indexOf(words[n - 1]) + words[n - 1].length };
        }
    }
    // Units with digits in them ("l/100km", "m2").
    const glued = rest.match(/^\s*([a-zµ°/]+\d+[a-z]*|[a-z]+\/\d+\s?[a-z]+)/);
    if (glued && unitsNamed(glued[1].replace(/\s+/g, "")).length) return { name: glued[1].replace(/\s+/g, ""), length: glued[0].length };
    return null;
}

/**
 * "5 ft 3 in", "5'3\"", "72°F", "3 cups", "2h 30m", "10 GB", "30 mph to km/h".
 * Several parts of one kind are added together.
 */
export function parseQuantity(input: string, preferCat?: string): Parsed | null {
    let text = input.trim().toLowerCase().replace(/(\d)\s*(?:°|º)\s*([cfr])\b/g, "$1 °$2").replace(/×/g, "x");
    let to: string | undefined;
    const split = text.match(/^(.*?\d.*?)\s+(?:to|in|into|as|->|=)\s+([^\d].*)$/);
    if (split && unitsNamed(split[2]).length) { text = split[1]; to = split[2]; }
    const parts: [string, string, string][] = [];
    let usedUntil = 0;
    for (const m of text.matchAll(NUM_RE)) {
        // Numbers inside a unit's name ("l/100km") aren't quantities.
        if (m.index! < usedUntil) continue;
        const start = m.index! + m[0].length, unit = unitAt(text.slice(start));
        if (!unit) continue;
        parts.push([m[0], m[0], unit.name]);
        usedUntil = start + unit.length;
    }
    if (!parts.length) return null;
    // Pick the category every part agrees on (preferring the one asked for, then the first listed).
    const options = parts.map(p => unitsNamed(p[2]));
    if (options.some(o => !o.length)) return null;
    const cats = options.reduce<Category[]>((acc, o) => acc.filter(c => o.some(x => x.cat === c)), options[0].map(o => o.cat));
    const target = to ? unitsNamed(to) : [];
    const cat = cats.find(c => c.id === preferCat) ?? cats.find(c => !target.length || target.some(t => t.cat === c)) ?? cats[0];
    if (!cat) return null;
    const units = options.map(o => o.find(x => x.cat === cat)!.unit);
    // Several parts: add them up in the first one's unit (5 ft 3 in → 5.25 ft).
    let value = 0;
    parts.forEach((p, i) => { value += convertUnit(Number(p[1].replace(/,/g, "")), units[i], units[0]); });
    return { cat, unit: units[0], value, text: input.trim(), to: target.find(t => t.cat === cat)?.unit };
}

/** Numbers that read well: 12,345.6 · 0.000123 · 1.23e+21. */
export function formatNumber(n: number) {
    if (!Number.isFinite(n)) return "—";
    const a = Math.abs(n);
    if (a !== 0 && (a >= 1e15 || a < 1e-6)) return n.toExponential(4).replace(/\.?0+e/, "e");
    return new Intl.NumberFormat(undefined, { maximumSignificantDigits: a >= 1e6 ? 10 : 7 }).format(n);
}

// ─── Feet-and-inches and similar, written the way people say them ───

/** 1.88 m → 6′ 2″ ; 2.75 h → 2 h 45 min ; 70.3 kg in st → 11 st 1 lb. */
export function compound(cat: string, unit: Unit, value: number): string | null {
    const split = (big: number, small: number, bigSym: string, smallSym: string, smallDigits = 0) => {
        const sign = value < 0 ? "-" : "", v = Math.abs(value);
        let whole = Math.floor(v / big), rest = Math.round((v - whole * big) / small * 10 ** smallDigits) / 10 ** smallDigits;
        if (rest * small >= big - 1e-9) { whole++; rest = 0; }
        return `${sign}${whole}${bigSym} ${rest}${smallSym}`;
    };
    if (cat === "length" && unit.id === "ft") return split(1, 1 / 12, "′", "″", 1);
    if (cat === "mass" && unit.id === "st") return split(1, 1 / 14, " st", " lb", 1);
    if (cat === "mass" && unit.id === "lb") return value < 1000 ? split(1, 1 / 16, " lb", " oz", 1) : null;
    if (cat === "time" && unit.id === "h" && value < 1000) return split(1, 1 / 60, " h", " min");
    if (cat === "time" && unit.id === "min" && value < 6000) return split(1, 1 / 60, " min", " s");
    return null;
}
