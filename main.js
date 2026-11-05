"use strict"

/* ==========================================================================
   Calculation (ported from the WebUI trigger settings timelines)
   --------------------------------------------------------------------------
   OneShotTimeline.tsx, ContinousTimeline.tsx, PhaseTimeline.tsx
   ========================================================================== */

const A = 20 // ACQUISITION_MS
const DEFAULT_PERIOD = 50
const MIN_PROCESSING = 20
const ONE_SHOT_PROCESSING = 170
const TIMEOUT_GAP = 10
const MIN_GOOD_READ_WINDOW = A + MIN_PROCESSING + TIMEOUT_GAP // 50
const TRIGGER_OFF_MARGIN = 35
const MAX_CYCLES = 30

const toMs = value => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

const fmt = n => String(Number(n.toFixed(2)))

const normalizePeriod = raw => Math.max(toMs(raw) || DEFAULT_PERIOD, A)

const row = (kind, label, start, end, formula) => ({ kind, label, start, end, formula })
const marker = (kind, label, x, formula) => ({ kind, label, start: x, end: null, formula })

/* ---------------------------------- One Shot ---------------------------------- */

function calcOneShot(outcome, rawTimeout, rawDelay) {
  const TO = toMs(rawTimeout)
  const TD = toMs(rawDelay)
  const W = TO - TD

  if (!(TO > TD)) {
    return {
      valid: false,
      caseId: null,
      why: `Application Timeout (${fmt(TO)}) phải lớn hơn Trigger Delay (${fmt(TD)}). Diagram không được vẽ và nút Apply bị vô hiệu hoá.`,
      steps: [],
      rows: [],
      notes: []
    }
  }

  let caseId, why, acqEnd, end
  const steps = [`W = TO − TD = ${fmt(TO)} − ${fmt(TD)} = ${fmt(W)}`]

  if (outcome === "noRead") {
    caseId = "OS-NR"
    why = `No Read: không có kết quả đọc nên operating mode chạy đến Application Timeout (TO = ${fmt(TO)}).`
    acqEnd = TD + W / 2
    end = TO
    steps.push(
      `acqEnd = TD + W/2 = ${fmt(TD)} + ${fmt(W / 2)} = ${fmt(acqEnd)}`,
      `readingEnd = TO = ${fmt(end)}`
    )
  } else if (W >= MIN_GOOD_READ_WINDOW) {
    acqEnd = TD + A
    end = Math.min(acqEnd + ONE_SHOT_PROCESSING, TO - TIMEOUT_GAP)
    steps.push(
      `acqEnd = TD + 20 = ${fmt(acqEnd)}`,
      `readingEnd = min(acqEnd + 170, TO − 10) = min(${fmt(acqEnd + ONE_SHOT_PROCESSING)}, ${fmt(TO - TIMEOUT_GAP)}) = ${fmt(end)}`
    )
    if (acqEnd + ONE_SHOT_PROCESSING <= TO - TIMEOUT_GAP) {
      caseId = "OS-GR-1"
      why = `Good Read, W = ${fmt(W)} ≥ 200: processing đạt tối đa 170 ms (acqEnd + 170 ≤ TO − 10).`
    } else {
      caseId = "OS-GR-2"
      why = `Good Read, 50 ≤ W = ${fmt(W)} < 200: processing bị giới hạn bởi TO − 10 (acqEnd + 170 > TO − 10).`
    }
  } else {
    const s = W / MIN_GOOD_READ_WINDOW
    caseId = "OS-GR-3"
    why = `Good Read, W = ${fmt(W)} < 50: khoảng thời gian quá ngắn cho 20 + 20 + 10 ms nên các phase bị co theo hệ số s = W/50 = ${fmt(s)}.`
    acqEnd = TD + A * s
    end = acqEnd + MIN_PROCESSING * s
    steps.push(
      `s = W / 50 = ${fmt(s)}`,
      `acqEnd = TD + 20·s = ${fmt(acqEnd)}`,
      `readingEnd = acqEnd + 20·s = ${fmt(end)}`
    )
  }

  const outcomeLabel = outcome === "goodRead" ? "Good Read outcome" : "No Read outcome"
  const rows = [
    row("operating", "Operating mode active", TD, end, "TD → readingEnd"),
    row("acquisition", "Acquisition", TD, acqEnd, "TD → acqEnd"),
    row("processing", "Processing", acqEnd, end, "acqEnd → readingEnd"),
    marker("outcome", outcomeLabel, end, "readingEnd"),
    row("busy", "Trigger Busy", TD, end, "TD → readingEnd")
  ]
  if (TD > 0) rows.push(row("delay", "Trigger Delay", 0, TD, "0 → TD"))
  rows.push(marker("timeout", "Application Timeout", TO, "TO"))

  return {
    valid: true,
    caseId,
    why,
    steps,
    rows,
    notes: [
      "Trigger bắt đầu tại 0 ms; Acquisition chỉ bắt đầu sau Trigger Delay.",
      outcome === "goodRead"
        ? "Trigger Busy kết thúc ngay khi nhận Good Read."
        : "Operating mode kết thúc tại Application Timeout, sau đó trả No Read."
    ]
  }
}

/* ---------------------------------- Continuous ---------------------------------- */

function calcContinuous(outcome, rawPeriod) {
  const raw = toMs(rawPeriod)
  const P = normalizePeriod(rawPeriod)
  const good = outcome === "goodRead"
  const steps = []
  if (P !== raw) {
    steps.push(
      `P = max(Acquisition Period || 50, 20) = ${fmt(P)} (giá trị nhập ${raw ? fmt(raw) : "trống/0"} được chuẩn hoá)`
    )
  } else {
    steps.push(`P = Acquisition Period = ${fmt(P)}`)
  }

  const proc = good ? [40, 20] : [20, P]
  const cycles = [0, 1].map(i => {
    const accStart = i * P
    const accEnd = accStart + A
    return { n: i + 1, accStart, accEnd, procEnd: accEnd + proc[i] }
  })
  const graphEnd = good ? cycles[1].accStart + P + 35 : cycles[1].procEnd + 90

  steps.push(
    good
      ? `Processing 1 = 40, Processing 2 = 20 → graphEnd = 2P + 35 = ${fmt(graphEnd)}`
      : `Processing 1 = 20, Processing 2 = P (processing timeout) → graphEnd = (2P + 20) + 90 = ${fmt(graphEnd)}`
  )

  const rows = [row("operating", "Operating mode active", 0, graphEnd, "0 → graphEnd")]
  cycles.forEach(c => {
    rows.push(
      row(
        "acquisition",
        `Acquisition ${c.n}`,
        c.accStart,
        c.accEnd,
        `${c.n === 1 ? "0" : "P"} → ${c.n === 1 ? "" : "P + "}20`
      )
    )
  })
  cycles.forEach(c => {
    const startF = c.n === 1 ? "20" : "P + 20"
    const endF = good
      ? c.n === 1
        ? "20 + 40 = 60"
        : "P + 20 + 20 = P + 40"
      : c.n === 1
        ? "20 + 20 = 40"
        : "P + 20 + P = 2P + 20"
    rows.push(row("processing", `Processing ${c.n}`, c.accEnd, c.procEnd, `${startF} → ${endF}`))
  })
  cycles.forEach(c => {
    const label = good
      ? `Good Read outcome ${c.n}`
      : c.n === 1
        ? "No Read outcome 1"
        : "No Read outcome 2 (processing timeout)"
    rows.push(marker("outcome", label, c.procEnd, "cuối Processing " + c.n))
  })
  rows.push(row("busy", "Trigger Busy", 0, graphEnd, "0 → graphEnd (liên tục)"))

  return {
    valid: true,
    caseId: good ? "CT-GR" : "CT-NR",
    why: good
      ? "Good Read: mỗi cycle xử lý xong khi nhận Good Read — Processing 1 dài 40 ms, Processing 2 dài 20 ms."
      : "No Read: Processing 1 dài 20 ms, Processing 2 không có kết quả nên chạy hết 1 acquisition period (processing timeout = P).",
    steps,
    rows,
    periodSpan: { start: 0, end: P },
    notes: [
      "Acquisition period là khoảng thời gian giữa 2 lần bắt đầu Acquisition liên tiếp.",
      "Operating mode và Trigger Busy chạy liên tục (diagram chỉ vẽ 2 cycle đầu).",
      "Mỗi Processing phải kết thúc trong 1 acquisition period (processing timeout)."
    ]
  }
}

/* ---------------------------------- Phase ---------------------------------- */

function buildPhaseCycles(outcome, readingStart, P, limit) {
  const cycles = []
  for (let i = 0; i < MAX_CYCLES; i++) {
    const accStart = readingStart + i * P
    const accEnd = accStart + A
    if (outcome === "noRead") {
      if (accStart >= limit) break
    } else if (accStart >= limit && i > 2) {
      break
    }
    const proc = outcome === "goodRead" && i > 0 ? MIN_PROCESSING : P
    cycles.push({ n: i + 1, accStart, accEnd, procEnd: accEnd + proc })
  }
  return cycles
}

function calcPhase(outcome, rawPeriod, rawOn, rawOff) {
  const good = outcome === "goodRead"
  const raw = toMs(rawPeriod)
  const P = normalizePeriod(rawPeriod)
  const on = toMs(rawOn)
  const offInput = toMs(rawOff)
  const OD = good ? 0 : offInput

  const calcOff = on + P + A + P // on + (2 − 1)·P + 20 + P
  const prelim = buildPhaseCycles(outcome, on, P, calcOff + (good ? 0 : 2 * P))

  const triggerOffAt =
    good && prelim[1]
      ? prelim[1].procEnd
      : !good && prelim[2]
        ? prelim[2].accEnd + (prelim[2].procEnd - prelim[2].accEnd) / 2
        : calcOff
  const effTriggerOff = good ? triggerOffAt + TRIGGER_OFF_MARGIN : triggerOffAt
  const readingEnd = Math.max(on, good ? triggerOffAt : triggerOffAt + OD)
  const busyEnd = Math.max(readingEnd, effTriggerOff)
  const cycles = buildPhaseCycles(outcome, on, P, readingEnd)

  const steps = []
  steps.push(
    P !== raw
      ? `P = max(Acquisition Period || 50, 20) = ${fmt(P)} (giá trị nhập được chuẩn hoá)`
      : `P = Acquisition Period = ${fmt(P)}`
  )
  steps.push(`on = Trigger On Delay = ${fmt(on)}`)
  if (good) {
    steps.push(
      `Trigger Off Delay bị bỏ qua (OD = 0) vì đã Good Read nên reading dừng ngay`,
      `triggerOffAt = cuối Processing 2 = on + P + 40 = ${fmt(triggerOffAt)}`,
      `readingEnd = triggerOffAt = ${fmt(readingEnd)}`,
      `trigger OFF (minh hoạ) = triggerOffAt + 35 = ${fmt(effTriggerOff)}`,
      `Trigger Busy end = max(readingEnd, trigger OFF) = ${fmt(busyEnd)}`
    )
  } else {
    steps.push(
      `triggerOffAt = giữa Processing 3 = on + 2P + 20 + P/2 = on + 2.5P + 20 = ${fmt(triggerOffAt)}`,
      `OD = Trigger Off Delay = ${fmt(OD)}`,
      `readingEnd = triggerOffAt + OD = ${fmt(readingEnd)}`,
      `Số acquisition = số n có on + (n−1)·P < readingEnd = ${cycles.length}`,
      `Trigger Busy end = max(readingEnd, triggerOffAt) = ${fmt(busyEnd)}`
    )
  }

  const clip = x => Math.min(x, readingEnd)
  const rows = []
  const opEnd = clip(triggerOffAt)
  rows.push(
    row(
      "operating",
      "Operating mode active",
      on,
      opEnd,
      good ? "on → on + P + 40" : "on → triggerOffAt (= on + 2.5P + 20)"
    )
  )
  if (!good && OD > 0) {
    rows.push(row("delay", "Trigger Off Delay", triggerOffAt, triggerOffAt + OD, "triggerOffAt → triggerOffAt + OD"))
  }
  if (on > 0) rows.push(row("delay", "Trigger On Delay", 0, on, "0 → on"))

  cycles.forEach(c => {
    const s = clip(c.accStart)
    const e = clip(c.accEnd)
    if (e > s) {
      rows.push(row("acquisition", `Acquisition ${c.n}`, s, e, `on + ${c.n - 1}·P → +20`))
    }
  })
  cycles.forEach(c => {
    const s = clip(c.accEnd)
    const e = clip(c.procEnd)
    if (e > s) {
      const incomplete = c.procEnd > readingEnd ? " (bị cắt tại readingEnd)" : ""
      const len = good && c.n > 1 ? "20" : "P"
      rows.push(row("processing", `Processing ${c.n}`, s, e, `acqEnd → acqEnd + ${len}${incomplete}`))
    }
  })

  if (good) {
    const c2 = cycles.find(c => c.n === 2 && c.procEnd <= readingEnd)
    if (c2) rows.push(marker("outcome", "Good Read outcome", c2.procEnd, "cuối Processing 2"))
  } else {
    rows.push(marker("outcome", "No Read outcome", readingEnd, "readingEnd = triggerOffAt + OD"))
  }
  rows.push(row("busy", "Trigger Busy", on, busyEnd, "on → max(readingEnd, trigger OFF)"))
  rows.push(row("input", "Trigger Input (held)", 0, effTriggerOff, "0 → trigger OFF"))
  rows.push(marker("trigger", "Trigger ON", 0, "0"))
  rows.push(marker("trigger", "Trigger OFF", effTriggerOff, good ? "triggerOffAt + 35" : "triggerOffAt"))

  let caseId, why
  if (good) {
    caseId = "PH-GR"
    why = `Good Read: Processing 1 không thấy code, Processing 2 thấy code nên reading kết thúc tại on + P + 40. Trigger Off Delay${offInput > 0 ? ` (${fmt(offInput)})` : ""} không ảnh hưởng.`
  } else if (OD > 0) {
    caseId = "PH-NR-1"
    why = `No Read, Trigger Off Delay = ${fmt(OD)} > 0: reading tiếp tục thêm OD sau trigger OFF rồi mới trả No Read.`
  } else {
    caseId = "PH-NR-2"
    why = "No Read, Trigger Off Delay = 0: reading dừng ngay tại trigger OFF rồi trả No Read."
  }

  const span =
    cycles.length >= 2 && cycles[1].accStart <= readingEnd
      ? { start: cycles[0].accStart, end: cycles[1].accStart }
      : null

  return {
    valid: true,
    caseId,
    why,
    steps,
    rows,
    periodSpan: span,
    notes: [
      "Cửa sổ operating mode được xác định bởi trigger ON/OFF, có thể lệch bởi Trigger On/Off Delay.",
      "Mọi ảnh trong cửa sổ được gộp thành 1 kết quả duy nhất.",
      "Chiều dài trigger held, và +35 ms của Good Read, chỉ mang tính minh hoạ.",
      `Số acquisition tối đa trong diagram: ${MAX_CYCLES}. Reading operation timeout không được áp dụng (WebUI không truyền giá trị này).`
    ]
  }
}

/* ==========================================================================
   Formula reference shown at the top of the page
   ========================================================================== */

const FORMULAS = [
  {
    mode: "oneShot",
    title: "One Shot",
    vars: "TD = Trigger Delay, TO = Application Timeout, W = TO − TD (cần TO > TD)",
    cases: [
      {
        id: "OS-GR-1",
        outcome: "goodRead",
        title: "Good Read — W ≥ 200",
        lines: [
          "Acquisition = TD → TD + 20",
          "readingEnd = TD + 190 (processing = 170)",
          "Processing = TD + 20 → readingEnd",
          "Operating mode active = Trigger Busy = TD → readingEnd",
          "Good Read tại readingEnd"
        ]
      },
      {
        id: "OS-GR-2",
        outcome: "goodRead",
        title: "Good Read — 50 ≤ W < 200",
        lines: [
          "Acquisition = TD → TD + 20",
          "readingEnd = TO − 10",
          "Processing = TD + 20 → TO − 10",
          "Operating mode active = Trigger Busy = TD → TO − 10",
          "Good Read tại TO − 10"
        ]
      },
      {
        id: "OS-GR-3",
        outcome: "goodRead",
        title: "Good Read — W < 50 (co theo s = W/50)",
        lines: [
          "Acquisition = TD → TD + 20·s",
          "Processing = TD + 20·s → TD + 40·s (= TD + 0.8·W)",
          "Operating mode active = Trigger Busy = TD → TD + 0.8·W",
          "Good Read tại TD + 0.8·W"
        ]
      },
      {
        id: "OS-NR",
        outcome: "noRead",
        title: "No Read",
        lines: [
          "Acquisition = TD → TD + W/2",
          "Processing = TD + W/2 → TO",
          "Operating mode active = Trigger Busy = TD → TO",
          "No Read tại TO"
        ]
      }
    ]
  },
  {
    mode: "continuous",
    title: "Continuous",
    vars: "P = max(Acquisition Period || 50, 20); cycle n = 1, 2",
    cases: [
      {
        id: "CT-GR",
        outcome: "goodRead",
        title: "Good Read",
        lines: [
          "Acquisition 1 = 0 → 20; Acquisition 2 = P → P + 20",
          "Processing 1 = 20 → 60; Processing 2 = P + 20 → P + 40",
          "Good Read tại 60 và P + 40",
          "Operating mode active = Trigger Busy = 0 → 2P + 35"
        ]
      },
      {
        id: "CT-NR",
        outcome: "noRead",
        title: "No Read",
        lines: [
          "Acquisition 1 = 0 → 20; Acquisition 2 = P → P + 20",
          "Processing 1 = 20 → 40; Processing 2 = P + 20 → 2P + 20",
          "No Read tại 40 và 2P + 20 (processing timeout)",
          "Operating mode active = Trigger Busy = 0 → 2P + 110"
        ]
      }
    ]
  },
  {
    mode: "phase",
    title: "Phase",
    vars: "P = max(Acquisition Period || 50, 20), on = Trigger On Delay, OD = Trigger Off Delay (chỉ dùng cho No Read)",
    cases: [
      {
        id: "PH-GR",
        outcome: "goodRead",
        title: "Good Read (OD không ảnh hưởng)",
        lines: [
          "Acquisition n = on + (n−1)·P → +20",
          "Processing 1 = on + 20 → on + P + 20; Processing 2 = on + P + 20 → on + P + 40",
          "readingEnd = Good Read = on + P + 40",
          "Operating mode active = on → on + P + 40",
          "Trigger OFF (minh hoạ) = on + P + 75",
          "Trigger Busy = on → on + P + 75"
        ]
      },
      {
        id: "PH-NR-1",
        outcome: "noRead",
        title: "No Read — OD > 0",
        lines: [
          "triggerOffAt = on + 2.5P + 20",
          "readingEnd = No Read = triggerOffAt + OD",
          "Acquisition n = on + (n−1)·P → +20, với on + (n−1)·P < readingEnd",
          "Processing n = acqEnd → min(acqEnd + P, readingEnd)",
          "Operating mode active = on → triggerOffAt; Off Delay = triggerOffAt → readingEnd",
          "Trigger Busy = on → readingEnd"
        ]
      },
      {
        id: "PH-NR-2",
        outcome: "noRead",
        title: "No Read — OD = 0",
        lines: [
          "triggerOffAt = on + 2.5P + 20",
          "readingEnd = No Read = triggerOffAt",
          "Acquisition/Processing như PH-NR-1 (cắt tại readingEnd)",
          "Operating mode active = Trigger Busy = on → triggerOffAt"
        ]
      }
    ]
  }
]

/* ==========================================================================
   UI
   ========================================================================== */

const MODES = {
  oneShot: {
    label: "One Shot",
    inputs: [
      { id: "timeout", label: "Application Timeout (ms)", value: 1000 },
      { id: "delay", label: "Trigger Delay (ms)", value: 200 }
    ],
    calc: (outcome, v) => calcOneShot(outcome, v.timeout, v.delay)
  },
  continuous: {
    label: "Continuous",
    inputs: [{ id: "period", label: "Acquisition Period (ms)", value: 100 }],
    calc: (outcome, v) => calcContinuous(outcome, v.period)
  },
  phase: {
    label: "Phase",
    inputs: [
      { id: "period", label: "Acquisition Period (ms)", value: 100 },
      { id: "on", label: "Trigger On Delay (ms)", value: 200 },
      {
        id: "off",
        label: "Trigger Off Delay (ms)",
        value: 300,
        onlyFor: "noRead",
        hint: "Chỉ ảnh hưởng No Read; với Good Read giá trị này không có tác dụng."
      }
    ],
    calc: (outcome, v) => calcPhase(outcome, v.period, v.on, v.off)
  }
}

const OUTCOMES = { goodRead: "Good Read", noRead: "No Read" }

const state = {
  mode: "oneShot",
  outcome: "goodRead",
  values: {
    oneShot: { timeout: 1000, delay: 200 },
    continuous: { period: 100 },
    phase: { period: 100, on: 200, off: 300 }
  }
}

const $ = selector => document.querySelector(selector)

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag)
  Object.entries(props).forEach(([key, value]) => {
    if (key === "class") node.className = value
    else if (key === "text") node.textContent = value
    else if (key === "html") node.innerHTML = value
    else node.setAttribute(key, value)
  })
  children.forEach(child => node.append(child))
  return node
}

function renderFormulas() {
  const container = $("#formulas")
  container.innerHTML = ""
  FORMULAS.forEach(group => {
    const column = el("div", { class: "formula-col", "data-mode": group.mode }, [
      el("h3", { text: group.title }),
      el("p", { class: "vars", text: group.vars })
    ])
    group.cases.forEach(c => {
      column.append(
        el("article", { class: `formula-card ${c.outcome}`, "data-case": c.id }, [
          el("header", {}, [
            el("span", { class: "case-id", text: c.id }),
            el("span", { class: "case-title", text: c.title })
          ]),
          el("ul", {}, c.lines.map(line => el("li", {}, [el("code", { text: line })])))
        ])
      )
    })
    container.append(column)
  })
}

function renderTabs() {
  const modeTabs = $("#mode-tabs")
  modeTabs.innerHTML = ""
  Object.entries(MODES).forEach(([key, mode]) => {
    const btn = el("button", {
      type: "button",
      role: "tab",
      class: key === state.mode ? "active" : "",
      "aria-selected": String(key === state.mode),
      text: mode.label
    })
    btn.addEventListener("click", () => {
      state.mode = key
      renderAll()
    })
    modeTabs.append(btn)
  })

  const outcomeTabs = $("#outcome-tabs")
  outcomeTabs.innerHTML = ""
  Object.entries(OUTCOMES).forEach(([key, label]) => {
    const btn = el("button", {
      type: "button",
      role: "tab",
      class: `${key} ${key === state.outcome ? "active" : ""}`,
      "aria-selected": String(key === state.outcome),
      text: label
    })
    btn.addEventListener("click", () => {
      state.outcome = key
      renderAll()
    })
    outcomeTabs.append(btn)
  })
}

function renderInputs() {
  const form = $("#inputs")
  form.innerHTML = ""
  MODES[state.mode].inputs.forEach(input => {
    const disabled = input.onlyFor && input.onlyFor !== state.outcome
    const field = el("label", { class: `input-field${disabled ? " muted" : ""}` }, [
      el("span", { class: "label", text: input.label })
    ])
    const control = el("input", {
      type: "number",
      inputmode: "decimal",
      step: "any",
      id: `input-${input.id}`,
      "data-input": input.id
    })
    control.value = state.values[state.mode][input.id]
    control.addEventListener("input", () => {
      state.values[state.mode][input.id] = control.value
      renderResult()
    })
    field.append(control)
    if (input.hint) field.append(el("small", { text: input.hint }))
    form.append(field)
  })
}

function renderResult() {
  const result = MODES[state.mode].calc(state.outcome, state.values[state.mode])

  document.querySelectorAll(".formula-card").forEach(card => {
    card.classList.toggle("active", card.dataset.case === result.caseId)
  })

  const banner = $("#case-banner")
  banner.className = `case-banner ${result.valid ? state.outcome : "invalid"}`
  banner.innerHTML = ""
  if (result.valid) {
    banner.append(
      el("strong", { text: `Áp dụng công thức ${result.caseId}` }),
      el("span", { text: result.why })
    )
  } else {
    banner.append(el("strong", { text: "Dữ liệu không hợp lệ" }), el("span", { text: result.why }))
  }

  const steps = $("#steps")
  steps.innerHTML = ""
  result.steps.forEach(step => steps.append(el("li", {}, [el("code", { text: step })])))

  const tbody = $("#results tbody")
  tbody.innerHTML = ""
  result.rows.forEach(r => {
    const isMarker = r.end === null
    tbody.append(
      el("tr", { class: `kind-${r.kind}` }, [
        el("td", { text: r.label }),
        el("td", { text: fmt(r.start) }),
        el("td", { text: isMarker ? "—" : fmt(r.end) }),
        el("td", { text: isMarker ? "—" : fmt(r.end - r.start) }),
        el("td", {}, [el("code", { text: r.formula })])
      ])
    )
  })

  const notes = $("#notes")
  notes.innerHTML = ""
  result.notes.forEach(n => notes.append(el("li", { text: n })))

  renderTimeline(result)
}

function niceStep(span) {
  const steps = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000]
  return steps.find(s => span / s <= 8) ?? 10000
}

function renderTimeline(result) {
  const host = $("#timeline")
  host.innerHTML = ""
  if (!result.valid) return

  const lanes = [
    ...(state.mode === "phase" ? [["input", "Trigger Input"]] : []),
    ["busy", "Trigger Busy"],
    ["operating", "Operating mode"],
    ["acquisition", "Acquisition"],
    ["processing", "Processing"]
  ]
  const laneOf = { delay: "operating", input: "input" }
  const ends = result.rows.map(r => (r.end === null ? r.start : r.end))
  const maxX = Math.max(...ends, 1)
  const xEnd = Math.ceil((maxX + 40) / 50) * 50

  const W = 960
  const left = 130
  const right = 20
  const top = 34
  const laneH = 52
  const H = top + lanes.length * laneH + 36
  const sx = ms => left + (ms / xEnd) * (W - left - right)
  const NS = "http://www.w3.org/2000/svg"
  const svg = document.createElementNS(NS, "svg")
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`)
  svg.setAttribute("class", `outcome-${state.outcome}`)
  svg.setAttribute("role", "img")
  svg.setAttribute("aria-label", "Timeline")

  const add = (tag, attrs, text) => {
    const node = document.createElementNS(NS, tag)
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v))
    if (text !== undefined) node.textContent = text
    svg.append(node)
    return node
  }

  const step = niceStep(xEnd)
  for (let t = 0; t <= xEnd; t += step) {
    add("line", { x1: sx(t), x2: sx(t), y1: top - 6, y2: H - 30, class: "grid" })
    add("text", { x: sx(t), y: H - 14, class: "tick", "text-anchor": "middle" }, String(t))
  }
  add("text", { x: W - right, y: H - 2, class: "tick", "text-anchor": "end" }, "Time (ms)")

  lanes.forEach(([key, label], i) => {
    const cy = top + i * laneH + laneH / 2
    add("text", { x: left - 10, y: cy + 4, class: "lane-label", "text-anchor": "end" }, label)
    result.rows
      .filter(r => r.end !== null && (laneOf[r.kind] ?? r.kind) === key)
      .forEach(r => {
        const x1 = sx(r.start)
        const w = Math.max(sx(r.end) - x1, 1)
        const h = key === "input" ? 8 : 26
        const bar = add("rect", {
          x: x1,
          y: cy - h / 2,
          width: w,
          height: h,
          rx: 4,
          class: `bar bar-${r.kind}`
        })
        const title = document.createElementNS(NS, "title")
        title.textContent = `${r.label}: ${fmt(r.start)} → ${fmt(r.end)} ms`
        bar.append(title)
        if (w > 34 && h > 10) {
          add("text", { x: x1 + w / 2, y: cy + 4, class: "bar-text", "text-anchor": "middle" }, fmt(r.end - r.start))
        }
      })
  })

  const markerRows = result.rows.filter(r => r.end === null)
  markerRows.forEach((m, i) => {
    const x = sx(m.start)
    add("line", { x1: x, x2: x, y1: top - 6, y2: H - 30, class: `marker marker-${m.kind}` })
    add(
      "text",
      { x, y: 12 + (i % 2) * 13, class: `marker-text marker-${m.kind}`, "text-anchor": "middle" },
      `${m.label.replace(" outcome", "")} ${fmt(m.start)}`
    )
  })

  host.append(svg)
}

function renderAll() {
  renderTabs()
  renderInputs()
  renderResult()
}

if (typeof document !== "undefined") {
  $("#inputs").addEventListener("submit", e => e.preventDefault())
  renderFormulas()
  renderAll()
}

if (typeof module !== "undefined") {
  module.exports = { calcOneShot, calcContinuous, calcPhase }
}
