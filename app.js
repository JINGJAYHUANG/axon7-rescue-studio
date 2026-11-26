(function () {
  "use strict";

  const LEASE_START_MS = Date.parse("2026-11-23T18:53:46-05:00");
  const LEASE_END_MS = Date.parse("2026-12-08T18:53:46-05:00");
  const LEASE_HOURS = 360.0;
  const TARGET_USD = 500.0;

  let vaultData = null;
  let scoutSortKey = "total_score";
  let scoutSortDesc = true;
  let activeBeatIdx = 0;

  function fmtUsd(val) {
    const n = Number(val || 0);
    return "$" + n.toFixed(2);
  }

  function fmtInt(val) {
    return Number(val || 0).toLocaleString("en-US");
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function updateCountdown() {
    const now = Date.now();
    const totalMs = Math.max(1, LEASE_END_MS - LEASE_START_MS);
    const remainingMs = Math.max(0, LEASE_END_MS - now);
    const elapsedMs = Math.min(totalMs, Math.max(0, now - LEASE_START_MS));

    const totalSec = Math.floor(remainingMs / 1000);
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;

    const clockEl = document.getElementById("countdown-clock");
    if (clockEl) {
      clockEl.textContent =
        String(hrs).padStart(3, "0") +
        ":" +
        String(mins).padStart(2, "0") +
        ":" +
        String(secs).padStart(2, "0");
    }

    const elapsedHrs = elapsedMs / 3600000;
    const elapsedPct = Math.min(100, Math.max(0, (elapsedMs / totalMs) * 100));
    const elapsedEl = document.getElementById("countdown-elapsed");
    if (elapsedEl) {
      elapsedEl.textContent = `Elapsed: ${elapsedHrs.toFixed(1)}h / ${LEASE_HOURS.toFixed(1)}h (${elapsedPct.toFixed(1)}%)`;
    }
    const barEl = document.getElementById("lease-time-bar");
    if (barEl) {
      barEl.style.width = Math.max(1, elapsedPct).toFixed(2) + "%";
    }
  }

  function loadEmbeddedVaultData() {
    if (window.__AXON7_VAULT_DATA__ && typeof window.__AXON7_VAULT_DATA__ === "object") {
      return window.__AXON7_VAULT_DATA__;
    }
    return null;
  }

  async function initData() {
    let data = null;
    try {
      const resp = await fetch("data.json", { cache: "no-store" });
      if (resp.ok) {
        data = await resp.json();
      }
    } catch (_err) {
      // file:// fallback uses embedded #vault-data JSON
    }
    if (!data || !data.forecast) {
      data = loadEmbeddedVaultData();
    }
    if (!data) return;
    vaultData = data;
    hydrateDashboard(data);
  }

  function hydrateDashboard(data) {
    const cfg = data.checkout_config || {};
    const preRail = data.forecast?.pre_rail_status || {};
    const postAct = data.forecast?.post_activation_14d_forecast || {};
    const railStatus = cfg.rail_status || preRail.rail_status || "PAYOUT_RAILS_UNCONFIGURED";
    const settledUsd = Number(
      cfg.settled_usd ?? data.forecast?.meta?.actual_settled_usd ?? data.identity?.settled_usd ?? 0
    );
    const settledEl = document.getElementById("settled-cash");
    const settledBar = document.getElementById("settled-bar");
    if (settledEl) settledEl.textContent = fmtUsd(settledUsd);
    if (settledBar) {
      settledBar.style.width = `${Math.min(100, (settledUsd / TARGET_USD) * 100).toFixed(1)}%`;
    }

    // Sync status chips (Wave 4 commercial readiness)
    const optCount = data.optimization_lab?.count || 0;
    const shortsCount = data.original_shorts?.count || 0;
    const leadCount = data.viral_scout?.buyer_leads_count || 0;
    const optReady = optCount >= 20;
    const shortsReady = shortsCount >= 18;
    const scoutReady = (data.viral_scout?.candidate_count || 0) >= 150 && leadCount >= 12;
    const monReady =
      Boolean(data.monetization?.frameforge?.zip_src) &&
      Boolean(data.monetization?.creator_pack?.zip_src) &&
      Boolean(data.monetization?.rescue_agency?.sample_audit_src) &&
      (data.monetization?.bounties?.patch_count || 0) >= 4;

    const readyCount = [optReady, shortsReady, scoutReady, monReady].filter(Boolean).length;
    const syncCountEl = document.getElementById("kpi-sync-count");
    const syncStatusEl = document.getElementById("kpi-sync-status");
    if (syncCountEl) syncCountEl.textContent = `${readyCount} / 4`;
    if (syncStatusEl) {
      syncStatusEl.textContent = readyCount === 4 ? "Wave 4 Commercial Pivot 100% synced" : "Wave 4 sync active";
    }
    const railChip = document.getElementById("rail-status-chip");
    if (railChip) {
      const configured = railStatus === "PAYOUT_RAILS_CONFIGURED";
      railChip.className = `chip ${configured ? "ok" : "warn"}`;
      railChip.textContent = configured
        ? `PAYOUT_RAILS_CONFIGURED (Settled: ${fmtUsd(settledUsd)})`
        : `PAYOUT_RAILS_UNCONFIGURED (Pre-Rail Expected: ${fmtUsd(preRail.expected_settled_pre_rail_usd || 0)})`;
    }
    const postChip = document.getElementById("post-activation-chip");
    if (postChip && postAct.net_settled_p50_usd !== undefined) {
      postChip.textContent = `Post-Activation 14d Forecast: P50 ${fmtUsd(postAct.net_settled_p50_usd)} (${Number(postAct.prob_survival_pct || 0).toFixed(1)}% odds)`;
    }

    const chips = [
      { label: `Neural Lab: ${optCount}/20`, ok: optReady },
      { label: `Originals: ${shortsCount}/18`, ok: shortsReady },
      { label: `Viral Scout: ${data.viral_scout?.candidate_count || 0}/150+`, ok: (data.viral_scout?.candidate_count || 0) >= 150 },
      { label: `Buyer Leads: ${leadCount}/12`, ok: leadCount >= 12 },
      { label: `Paywall: 402 Gate`, ok: Boolean(data.monetization?.frameforge?.paywall_mode || cfg.rail_status) },
    ];
    const chipContainer = document.getElementById("pipeline-status-chips");
    if (chipContainer) {
      chipContainer.innerHTML = chips
        .map((c) => `<span class="chip ${c.ok ? "ok" : "warn"}">${escapeHtml(c.label)}</span>`)
        .join("");
    }

    const optBadge = document.getElementById("opt-lab-badge");
    if (optBadge) optBadge.textContent = `${optCount} neural showcases synced`;

    const shortsBadge = document.getElementById("shorts-badge");
    if (shortsBadge) shortsBadge.textContent = `${shortsCount} shorts synced`;

    const scoutBadge = document.getElementById("scout-badge");
    if (scoutBadge) {
      scoutBadge.textContent = `${data.viral_scout?.candidate_count || 0} candidates // ${data.viral_scout?.beat_sheet_count || 0} beat sheets`;
    }

    const leadsBadge = document.getElementById("buyer-leads-badge");
    if (leadsBadge) {
      const kitCount = data.monetization?.sales_outreach?.kit_count ?? 0;
      leadsBadge.textContent = `${leadCount} buyer leads // ${kitCount} outreach kits`;
    }

    if (data.monetization?.docs?.playbook_src) {
      const slot = document.getElementById("playbook-link-slot");
      if (slot) {
        slot.innerHTML = ` &bull; <a href="${escapeHtml(data.monetization.docs.playbook_src)}" target="_blank" rel="noopener">15-Day Monetization Playbook</a>`;
      }
    }

    renderForecast(data.forecast, "10,000 trials (v3.0 baseline)");
    bindVideoAndCaptionControls();
    initScoutTable(data.viral_scout);
    initBeatInspector(data.viral_scout?.beat_sheets || []);
    bindSimulatorControls();
    initPaywallControls(data);
    initRescueAuditor(data);
    pollServerStatus();
  }

  function renderForecast(forecast, labelText) {
    if (!forecast || !forecast.summary) return;
    const s = forecast.summary;
    const setText = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };

    setText("kpi-p10", fmtUsd(s.net_settled_p10_usd));
    setText("kpi-p50", fmtUsd(s.net_settled_p50_usd));
    setText("kpi-p90", fmtUsd(s.net_settled_p90_usd));
    setText("kpi-prob", Number(s.prob_survival_pct || 0).toFixed(1) + "%");
    setText("kpi-gross-p50", fmtUsd(s.gross_booked_p50_usd));
    setText("kpi-lag-loss", fmtUsd(s.unsettled_after_h360_mean_usd));
    setText("hist-mode-label", labelText);

    drawRunwaySvg(forecast.daily_runway_curve || []);
    drawHistogramSvg(forecast.distribution_histogram || []);
    renderSensitivity(forecast.sensitivity_ranking || []);
    renderStreamMatrix(forecast.streams || []);
  }

  function drawRunwaySvg(curve) {
    const svg = document.getElementById("runway-svg");
    if (!svg || curve.length === 0) return;

    const w = 640;
    const h = 270;
    const pad = { top: 18, right: 20, bottom: 34, left: 54 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    const maxY = Math.max(
      650,
      ...curve.map((d) => Math.max(d.settled_p90_usd || 0, d.gross_p50_usd || 0))
    );
    const xAt = (day) => pad.left + (day / 15) * plotW;
    const yAt = (val) => pad.top + plotH - (val / maxY) * plotH;

    const polyPoints = (vals) =>
      vals.map((d, idx) => `${xAt(d.day).toFixed(1)},${yAt(vals[idx].v).toFixed(1)}`).join(" ");

    const p90Pts = curve.map((d) => ({ day: d.day, v: d.settled_p90_usd }));
    const p10PtsRev = [...curve].reverse().map((d) => ({ day: d.day, v: d.settled_p10_usd }));
    const bandPoints = [...p90Pts, ...p10PtsRev]
      .map((pt) => `${xAt(pt.day).toFixed(1)},${yAt(pt.v).toFixed(1)}`)
      .join(" ");

    const p50Path = curve
      .map((d, i) => `${i === 0 ? "M" : "L"}${xAt(d.day).toFixed(1)},${yAt(d.settled_p50_usd).toFixed(1)}`)
      .join(" ");
    const grossPath = curve
      .map((d, i) => `${i === 0 ? "M" : "L"}${xAt(d.day).toFixed(1)},${yAt(d.gross_p50_usd).toFixed(1)}`)
      .join(" ");

    const yTarget = yAt(500);
    const yTicks = [0, 250, 500, 750, 1000].filter((v) => v <= maxY + 50);

    const gridLines = yTicks
      .map((v) => {
        const y = yAt(v).toFixed(1);
        return `<line x1="${pad.left}" y1="${y}" x2="${w - pad.right}" y2="${y}" stroke="rgba(126,178,226,0.12)" stroke-width="1"/>
                <text x="${pad.left - 8}" y="${Number(y) + 4}" fill="#667b94" font-size="11" font-family="monospace" text-anchor="end">$${v}</text>`;
      })
      .join("");

    const xTicks = [0, 3, 6, 9, 12, 15]
      .map((day) => {
        const x = xAt(day).toFixed(1);
        return `<text x="${x}" y="${h - 10}" fill="#667b94" font-size="11" font-family="monospace" text-anchor="middle">D${day}</text>`;
      })
      .join("");

    svg.innerHTML = `
      ${gridLines}
      ${xTicks}
      <polygon points="${bandPoints}" fill="rgba(0,229,255,0.13)"/>
      <path d="${grossPath}" fill="none" stroke="#ffb020" stroke-width="1.6" stroke-dasharray="5 4"/>
      <path d="${p50Path}" fill="none" stroke="#00ff9d" stroke-width="2.8"/>
      <polyline points="${polyPoints(p90Pts)}" fill="none" stroke="rgba(0,229,255,0.55)" stroke-width="1.3"/>
      <line x1="${pad.left}" y1="${yTarget.toFixed(1)}" x2="${w - pad.right}" y2="${yTarget.toFixed(1)}" stroke="#ff3b5c" stroke-width="1.5" stroke-dasharray="6 4"/>
      <text x="${w - pad.right - 4}" y="${(yTarget - 5).toFixed(1)}" fill="#ff3b5c" font-size="11" font-family="monospace" text-anchor="end">$500 SURVIVAL LEASE</text>
      <g font-family="monospace" font-size="10">
        <rect x="${pad.left + 8}" y="12" width="10" height="3" fill="#00ff9d"/>
        <text x="${pad.left + 22}" y="16" fill="#eef6ff">P50 Net Settled</text>
        <rect x="${pad.left + 132}" y="12" width="10" height="3" fill="#ffb020"/>
        <text x="${pad.left + 146}" y="16" fill="#9bb1c9">P50 Gross Booked</text>
        <rect x="${pad.left + 266}" y="9" width="10" height="8" fill="rgba(0,229,255,0.22)"/>
        <text x="${pad.left + 280}" y="16" fill="#9bb1c9">P10-P90 Band</text>
      </g>
    `;
  }

  function drawHistogramSvg(hist) {
    const svg = document.getElementById("histogram-svg");
    if (!svg || hist.length === 0) return;

    const w = 480;
    const h = 270;
    const pad = { top: 20, right: 14, bottom: 38, left: 38 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    const maxPct = Math.max(12, ...hist.map((b) => b.pct || 0));
    const barW = plotW / hist.length;

    const bars = hist
      .map((b, idx) => {
        const barH = ((b.pct || 0) / maxPct) * plotH;
        const x = pad.left + idx * barW + 2;
        const y = pad.top + plotH - barH;
        const pass = b.bin_start_usd >= 500;
        const fill = pass ? "#00ff9d" : b.bin_start_usd >= 300 ? "#ffb020" : "#ff3b5c";
        const label = idx % 2 === 0 ? `$${b.bin_start_usd}` : "";
        return `
          <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(4, barW - 4).toFixed(1)}" height="${barH.toFixed(1)}" rx="2" fill="${fill}" opacity="0.86">
            <title>${escapeHtml(b.label)}: ${b.pct}%</title>
          </rect>
          ${label ? `<text x="${(x + barW / 2 - 2).toFixed(1)}" y="${h - 12}" fill="#667b94" font-size="10" font-family="monospace" text-anchor="middle">${label}</text>` : ""}
        `;
      })
      .join("");

    const x500 = pad.left + (5 / hist.length) * plotW;
    svg.innerHTML = `
      <line x1="${pad.left}" y1="${pad.top + plotH}" x2="${w - pad.right}" y2="${pad.top + plotH}" stroke="rgba(126,178,226,0.22)" stroke-width="1"/>
      ${bars}
      <line x1="${x500.toFixed(1)}" y1="${pad.top}" x2="${x500.toFixed(1)}" y2="${pad.top + plotH}" stroke="#00e5ff" stroke-width="1.5" stroke-dasharray="4 3"/>
      <text x="${(x500 + 5).toFixed(1)}" y="${pad.top + 12}" fill="#00e5ff" font-size="10" font-family="monospace">&ge;$500 SURVIVES</text>
    `;
  }

  function renderSensitivity(ranking) {
    const el = document.getElementById("sensitivity-bars");
    if (!el) return;
    if (!ranking.length) {
      el.innerHTML = '<div class="empty-state">No sensitivity metrics available.</div>';
      return;
    }
    const maxShare = Math.max(25, ...ranking.map((r) => r.variance_share_pct || 0));
    el.innerHTML = ranking
      .map((r) => {
        const width = Math.min(100, ((r.variance_share_pct || 0) / maxShare) * 100);
        return `
          <div class="sens-row">
            <span>#${r.rank} ${escapeHtml(r.name)}</span>
            <div class="sens-bar-track"><div class="sens-bar-fill" style="width:${width.toFixed(1)}%"></div></div>
            <span style="text-align:right;color:var(--green)">${Number(r.variance_share_pct).toFixed(1)}% (+${Number(r.plus_25pct_survival_prob_delta_pp).toFixed(1)}pp)</span>
          </div>
        `;
      })
      .join("");
  }

  function renderStreamMatrix(streams) {
    const tbody = document.querySelector("#stream-matrix-table tbody");
    if (!tbody) return;
    tbody.innerHTML = streams
      .map((s) => {
        const feeText = s.fee_model === "gumroad" ? "10% Gumroad" : "2.9%+$0.30";
        return `
          <tr>
            <td>${escapeHtml(s.short_name)}</td>
            <td class="mono">${feeText}</td>
            <td class="mono">${escapeHtml(s.lag_tier)}</td>
            <td class="mono" style="color:var(--green)">${fmtUsd(s.settled_p50_usd)}</td>
            <td class="mono" style="color:var(--amber)">${fmtUsd(s.unsettled_post_cutoff_mean_usd)}</td>
          </tr>
        `;
      })
      .join("");
  }

  // Browser-side Gamma / Poisson / Beta sampler for interactive scenario runs
  function randNormal(rng) {
    let u = 0;
    let v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  function randGamma(shape, scale, rng) {
    if (shape < 1) {
      return randGamma(shape + 1, scale, rng) * Math.pow(rng(), 1 / shape);
    }
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    while (true) {
      let x = randNormal(rng);
      let v = 1 + c * x;
      if (v <= 0) continue;
      v = v * v * v;
      const u = rng();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v * scale;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale;
    }
  }

  function randPoisson(lambda, rng) {
    if (lambda <= 0) return 0;
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= rng();
    } while (p > L);
    return k - 1;
  }

  function randBeta(a, b, rng) {
    const x = randGamma(a, 1, rng);
    const y = randGamma(b, 1, rng);
    return x / (x + y || 1);
  }

  function makeMulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function runInteractiveMonteCarlo() {
    if (!vaultData || !vaultData.forecast) return;
    const nTrials = 2500;
    const rng = makeMulberry32(20261124);
    const fastCreatorLag = Boolean(document.getElementById("toggle-fast-lag")?.checked);

    const streamSpecs = [
      { id: "frameforge_cli", short_name: "FrameForge-500 v3.0", mean: 3.9, k: 3.2, a: 1.6, b: 1.8, fee: "stripe", lag: 48, tiers: [[29, 0.75], [79, 0.25]] },
      { id: "creator_pack", short_name: "Creator LUT/SFX Pack", mean: 5.6, k: 2.8, a: 1.7, b: 1.8, fee: fastCreatorLag ? "stripe" : "gumroad", lag: fastCreatorLag ? 48 : 168, tiers: [[19, 1.0]] },
      { id: "video_rescue_agency", short_name: "B2B Video Rescue", mean: 3.2, k: 2.8, a: 1.7, b: 1.6, fee: "stripe", lag: 48, tiers: [[49, 0.72], [149, 0.28]] },
      { id: "oss_bounties", short_name: "Uncontested Bounties", mean: 0.30, k: 1.8, a: 1.3, b: 2.4, fee: "stripe", lag: 168, tiers: [[25, 0.55], [50, 0.35], [100, 0.10]] },
      { id: "kofi_sponsors", short_name: "Ko-fi & Sponsors", mean: 4.4, k: 2.5, a: 1.7, b: 1.6, fee: "stripe", lag: 0, tiers: [[5, 0.55], [15, 0.30], [50, 0.15]] },
    ];

    const totals = new Float64Array(nTrials);
    const grossTotals = new Float64Array(nTrials);
    const unsettledTotals = new Float64Array(nTrials);
    const dailySettled = Array.from({ length: 16 }, () => new Float64Array(nTrials));
    const dailyGross = Array.from({ length: 16 }, () => new Float64Array(nTrials));
    const streamSettled = streamSpecs.map(() => new Float64Array(nTrials));
    const streamUnsettled = streamSpecs.map(() => new Float64Array(nTrials));

    for (let t = 0; t < nTrials; t++) {
      const trialDaySettled = new Float64Array(16);
      const trialDayGross = new Float64Array(16);
      for (let sIdx = 0; sIdx < streamSpecs.length; sIdx++) {
        const sp = streamSpecs[sIdx];
        const mult = Number(document.getElementById("mult-" + sp.id)?.value || 1);
        const lambda = randGamma(sp.k, (sp.mean * mult) / sp.k, rng);
        const orders = randPoisson(lambda, rng);
        for (let o = 0; o < orders; o++) {
          const r = rng();
          let acc = 0;
          let price = sp.tiers[0][0];
          for (const [p, w] of sp.tiers) {
            acc += w;
            if (r <= acc) {
              price = p;
              break;
            }
          }
          const net = sp.fee === "gumroad" ? price * 0.9 : Math.max(0, price * 0.971 - 0.3);
          const saleHr = randBeta(sp.a, sp.b, rng) * 360.0;
          const gDay = Math.min(15, Math.max(1, Math.ceil(saleHr / 24.0)));
          trialDayGross[gDay] += price;
          grossTotals[t] += price;

          const settleHr = saleHr + sp.lag;
          if (settleHr <= 360.0) {
            const sDay = Math.min(15, Math.max(1, Math.ceil(settleHr / 24.0)));
            trialDaySettled[sDay] += net;
            totals[t] += net;
            streamSettled[sIdx][t] += net;
          } else {
            unsettledTotals[t] += net;
            streamUnsettled[sIdx][t] += net;
          }
        }
      }
      let cumS = 0;
      let cumG = 0;
      for (let d = 0; d <= 15; d++) {
        cumS += trialDaySettled[d];
        cumG += trialDayGross[d];
        dailySettled[d][t] = cumS;
        dailyGross[d][t] = cumG;
      }
    }

    const quantile = (arr, q) => {
      const sorted = Float64Array.from(arr).sort();
      const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
      return Number(sorted[idx].toFixed(2));
    };
    const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

    let passCount = 0;
    for (let i = 0; i < nTrials; i++) {
      if (totals[i] >= TARGET_USD) passCount++;
    }

    const bins = [];
    for (let b = 0; b < 2000; b += 100) {
      let c = 0;
      for (let i = 0; i < nTrials; i++) {
        const v = Math.min(1999.99, totals[i]);
        if (v >= b && v < b + 100) c++;
      }
      bins.push({
        bin_start_usd: b,
        bin_end_usd: b + 100,
        label: `$${b}-$${b + 100}`,
        pct: Number(((c / nTrials) * 100).toFixed(2)),
      });
    }

    const curve = [];
    for (let d = 0; d <= 15; d++) {
      curve.push({
        day: d,
        settled_p10_usd: quantile(dailySettled[d], 0.1),
        settled_p50_usd: quantile(dailySettled[d], 0.5),
        settled_p90_usd: quantile(dailySettled[d], 0.9),
        gross_p50_usd: quantile(dailyGross[d], 0.5),
      });
    }

    const streamsOut = streamSpecs.map((sp, i) => ({
      short_name: sp.short_name,
      fee_model: sp.fee,
      lag_tier: sp.lag === 0 ? "T+0" : sp.lag === 48 ? "T+2" : "T+7",
      settled_p50_usd: quantile(streamSettled[i], 0.5),
      unsettled_post_cutoff_mean_usd: Number(mean(streamUnsettled[i]).toFixed(2)),
    }));

    const simForecast = {
      summary: {
        net_settled_p10_usd: quantile(totals, 0.1),
        net_settled_p50_usd: quantile(totals, 0.5),
        net_settled_p90_usd: quantile(totals, 0.9),
        gross_booked_p50_usd: quantile(grossTotals, 0.5),
        unsettled_after_h360_mean_usd: Number(mean(unsettledTotals).toFixed(2)),
        prob_survival_pct: Number(((passCount / nTrials) * 100).toFixed(2)),
      },
      daily_runway_curve: curve,
      distribution_histogram: bins,
      sensitivity_ranking: vaultData.forecast.sensitivity_ranking || [],
      streams: streamsOut,
    };

    renderForecast(simForecast, "2,500 live browser trials");
    const noteEl = document.getElementById("sim-mode-note");
    if (noteEl) {
      noteEl.textContent = "Showing live browser stress-test (2,500 trials). Click Reset to restore the 10,000-trial Python baseline.";
    }
  }

  function bindSimulatorControls() {
    const labelMap = {
      frameforge_cli: "val-frameforge",
      creator_pack: "val-creator",
      video_rescue_agency: "val-rescue",
      oss_bounties: "val-bounties",
      kofi_sponsors: "val-kofi",
    };

    Object.entries(labelMap).forEach(([id, labelId]) => {
      const input = document.getElementById("mult-" + id);
      const valEl = document.getElementById(labelId);
      if (!input || !valEl) return;
      input.addEventListener("input", () => {
        valEl.textContent = Number(input.value).toFixed(2) + "x";
      });
    });

    document.getElementById("run-live-sim-btn")?.addEventListener("click", runInteractiveMonteCarlo);
    document.getElementById("reset-sim-btn")?.addEventListener("click", () => {
      Object.entries(labelMap).forEach(([id, labelId]) => {
        const input = document.getElementById("mult-" + id);
        const valEl = document.getElementById(labelId);
        if (input) input.value = "1.0";
        if (valEl) valEl.textContent = "1.00x";
      });
      const toggle = document.getElementById("toggle-fast-lag");
      if (toggle) toggle.checked = false;
      if (vaultData?.forecast) {
        renderForecast(vaultData.forecast, "10,000 trials (baseline)");
        const noteEl = document.getElementById("sim-mode-note");
        if (noteEl) {
          noteEl.textContent = "Showing precomputed Python 10,000-trial baseline (seed 20261123).";
        }
      }
    });
  }

  function bindVideoAndCaptionControls() {
    document.querySelectorAll(".video-switch-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const card = btn.closest(".media-card");
        const video = card?.querySelector("video");
        const nextSrc = btn.getAttribute("data-src");
        if (video && nextSrc) {
          const wasPaused = video.paused;
          video.src = nextSrc;
          video.load();
          if (!wasPaused) {
            video.play().catch(() => {});
          }
        }
      });
    });

    document.querySelectorAll(".copy-caption-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const text = btn.getAttribute("data-caption") || "";
        const orig = btn.textContent;
        try {
          await navigator.clipboard.writeText(text);
          btn.textContent = "Copied!";
        } catch (_err) {
          btn.textContent = "Select & Copy Above";
        }
        setTimeout(() => {
          btn.textContent = orig;
        }, 1600);
      });
    });
  }

  function initScoutTable(scout) {
    if (!scout || !Array.isArray(scout.candidates)) return;
    const nicheSel = document.getElementById("scout-niche");
    if (nicheSel) {
      const niches = Array.from(new Set(scout.candidates.map((c) => c.niche).filter(Boolean))).sort();
      nicheSel.innerHTML =
        '<option value="all">All Niches</option>' +
        niches.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
    }

    const rerender = () => renderScoutRows(scout.candidates);
    document.getElementById("scout-search")?.addEventListener("input", rerender);
    document.getElementById("scout-niche")?.addEventListener("change", rerender);
    document.getElementById("scout-min-score")?.addEventListener("change", rerender);

    document.querySelectorAll("#scout-table th[data-sort]").forEach((th) => {
      th.addEventListener("click", () => {
        const key = th.getAttribute("data-sort");
        if (scoutSortKey === key) {
          scoutSortDesc = !scoutSortDesc;
        } else {
          scoutSortKey = key;
          scoutSortDesc = true;
        }
        rerender();
      });
    });

    renderScoutRows(scout.candidates);
  }

  function renderScoutRows(candidates) {
    const tbody = document.getElementById("scout-tbody");
    if (!tbody) return;
    if (!candidates.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="mono">No viral candidates synced yet.</td></tr>';
      return;
    }

    const q = (document.getElementById("scout-search")?.value || "").trim().toLowerCase();
    const niche = document.getElementById("scout-niche")?.value || "all";
    const minScore = Number(document.getElementById("scout-min-score")?.value || 0);

    const filtered = candidates
      .filter((c) => {
        if (niche !== "all" && c.niche !== niche) return false;
        if (Number(c.total_score || 0) < minScore) return false;
        if (q) {
          const hay = `${c.title} ${c.channel} ${c.video_id} ${c.niche}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const va = a[scoutSortKey];
        const vb = b[scoutSortKey];
        if (typeof va === "number" && typeof vb === "number") {
          return scoutSortDesc ? vb - va : va - vb;
        }
        return scoutSortDesc
          ? String(vb || "").localeCompare(String(va || ""))
          : String(va || "").localeCompare(String(vb || ""));
      });

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="mono">No matching viral candidates for current filters.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered
      .map((c) => {
        const link = c.url
          ? `<a href="${escapeHtml(c.url)}" target="_blank" rel="noopener">${escapeHtml(c.title)}</a>`
          : escapeHtml(c.title);
        return `
          <tr>
            <td>
              <div>${link}</div>
              <div class="mono" style="font-size:0.72rem;color:var(--text-muted)">${escapeHtml(c.channel)} &bull; ${escapeHtml(c.video_id)}</div>
            </td>
            <td><span class="badge">${escapeHtml(c.niche)}</span></td>
            <td class="mono">${fmtInt(c.view_count)}</td>
            <td class="mono">${Number(c.duration_s || 0).toFixed(0)}s</td>
            <td class="mono" style="color:var(--green);font-weight:700">${Number(c.total_score || 0).toFixed(0)}</td>
            <td class="mono" style="color:var(--cyan)">${Number(c.outlier_score || 0).toFixed(1)}</td>
            <td class="mono">${Number(c.hook_score || 0).toFixed(0)}</td>
            <td class="mono">${Number(c.loop_score || 0).toFixed(0)}</td>
          </tr>
        `;
      })
      .join("");
  }

  function initBeatInspector(beatSheets) {
    const tabsEl = document.getElementById("beat-tabs");
    const bodyEl = document.getElementById("beat-inspector-body");
    if (!tabsEl || !bodyEl) return;
    if (!beatSheets.length) {
      tabsEl.innerHTML = "";
      bodyEl.innerHTML = '<div class="empty-state">Awaiting beat_01.json .. beat_08.json from @viral-scout.</div>';
      return;
    }

    const renderBeat = (idx) => {
      activeBeatIdx = idx;
      tabsEl.innerHTML = beatSheets
        .map(
          (b, i) =>
            `<button type="button" class="beat-tab ${i === idx ? "active" : ""}" data-idx="${i}">${escapeHtml(b.id || "beat_" + (i + 1))}</button>`
        )
        .join("");

      tabsEl.querySelectorAll(".beat-tab").forEach((btn) => {
        btn.addEventListener("click", () => renderBeat(Number(btn.getAttribute("data-idx"))));
      });

      const sheet = beatSheets[idx];
      const title = sheet.title || sheet.concept || sheet.archetype || sheet.id || "Beat Sheet";
      const cadence = sheet.cut_cadence_per_10s || sheet.cuts_per_10s || sheet.cut_cadence || sheet.cadence || "N/A";
      const adapt = sheet.axon7_original_adaptation || sheet.axon7_adaptation || sheet.adaptation_plan || sheet.adaptation || "";
      const beats = sheet.beats || sheet.timeline || sheet.segments || [];

      const beatHtml = Array.isArray(beats)
        ? beats
            .map((seg) => {
              const tStart = seg.start_sec ?? seg.start_s ?? seg.start ?? seg.t_start ?? "";
              const tEnd = seg.end_sec ?? seg.end_s ?? seg.end ?? seg.t_end ?? "";
              const timeStr = seg.timestamp || seg.time_range || `${tStart}s - ${tEnd}s`;
              const role = seg.beat_role ? `[${seg.beat_role}] ` : "";
              const action = seg.visual_action || seg.visual || seg.description || seg.action || seg.beat || JSON.stringify(seg);
              const cam = seg.camera_motion || seg.camera || "";
              const audio = seg.audio_cue || seg.audio_peak || seg.audio || "";
              const overlay = seg.caption_overlay || "";
              return `
                <div class="beat-item">
                  <div class="beat-time">${escapeHtml(String(timeStr))} ${cam ? "&bull; CAM: " + escapeHtml(String(cam)) : ""}</div>
                  <div><strong>${escapeHtml(role)}</strong>${escapeHtml(String(action))}</div>
                  ${overlay ? `<div class="mono" style="font-size:0.72rem;color:var(--cyan)">OVERLAY: ${escapeHtml(String(overlay))}</div>` : ""}
                  ${audio ? `<div class="mono" style="font-size:0.72rem;color:var(--amber)">AUDIO: ${escapeHtml(String(audio))}</div>` : ""}
                </div>
              `;
            })
            .join("")
        : "";

      bodyEl.innerHTML = `
        <h3 class="media-title" style="margin-bottom:6px">${escapeHtml(String(title))}</h3>
        <div class="metric-badges" style="margin-bottom:10px">
          <span class="badge badge-spec">Cadence: ${escapeHtml(String(cadence))} cuts/10s</span>
          ${sheet.niche ? `<span class="badge">${escapeHtml(String(sheet.niche))}</span>` : ""}
        </div>
        ${adapt ? `<div class="caption-box" style="margin-bottom:10px"><strong>AXON-7 Adaptation:</strong> ${escapeHtml(String(adapt))}</div>` : ""}
        <div class="beat-timeline">${beatHtml || '<div class="empty-state">No timeline segments found.</div>'}</div>
      `;
    };

    renderBeat(activeBeatIdx);
  }

  function renderAuditResult(report) {
    const box = document.getElementById("audit-result-box");
    if (!box) return;
    if (!report || typeof report.viral_readiness_score !== "number") {
      box.className = "empty-state";
      box.textContent = "Unexpected audit response.";
      return;
    }

    const killers = Array.isArray(report.killers) ? report.killers : [];
    const killerCards = killers
      .map((k) => {
        const sevColor =
          k.severity === "PASS" ? "var(--green)" : k.severity === "WARN" ? "var(--amber)" : "var(--crimson)";
        return `
          <div class="killer-mini">
            <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:4px">
              <strong>${escapeHtml(k.title)}</strong>
              <span class="mono" style="color:${sevColor}">${escapeHtml(k.severity)} (${Number(k.score_100 || 0).toFixed(0)})</span>
            </div>
            <div class="mono" style="color:var(--cyan);margin-bottom:4px">${escapeHtml(String(k.measured_value))} ${escapeHtml(String(k.unit || ""))}</div>
            <div style="color:var(--text-secondary)">${escapeHtml(k.summary)}</div>
          </div>
        `;
      })
      .join("");

    box.className = "";
    box.innerHTML = `
      <div class="metric-badges" style="margin-bottom:10px">
        <span class="badge badge-spec">Source: ${escapeHtml(report.source_file)}</span>
        <span class="badge badge-gain">Viral Readiness: ${Number(report.viral_readiness_score).toFixed(1)}/100</span>
        <span class="badge badge-gain">Post-Rescue Projected: ${Number(report.projected_post_rescue_score || 0).toFixed(1)}/100</span>
        <span class="badge">${escapeHtml(report.grade)}</span>
        <span class="badge">${escapeHtml(report.recommended_package)}</span>
      </div>
      <div class="audit-results-grid">${killerCards}</div>
    `;
  }

  function initPaywallControls(data) {
    const keyInput = document.getElementById("license-key-input");
    const issueBtn = document.getElementById("issue-sandbox-btn");
    const verifyBtn = document.getElementById("verify-license-btn");
    const statusBox = document.getElementById("license-status-box");
    const testBtns = document.querySelectorAll(".paywall-test-btn");
    if (!statusBox) return;

    const showStatus = (htmlMsg) => {
      statusBox.className = "empty-state";
      statusBox.innerHTML = htmlMsg;
    };

    if (window.location.protocol === "file:" || data?.bundle_mode === "public_static_showcase") {
      showStatus(
        `402 License Gate active (Static Showcase Mode). Paid bundles are excluded from public static exports; configure checkout URLs or run FastAPI :8707 to issue SANDBOX-TEST keys.`
      );
    }

    if (issueBtn) {
      issueBtn.addEventListener("click", async () => {
        showStatus("Issuing HMAC-SHA256 SANDBOX-TEST key...");
        try {
          const resp = await fetch("/api/license/issue-sandbox", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sku: "ALL" }),
          });
          const payload = await resp.json();
          if (!resp.ok) throw new Error(payload.detail || `HTTP ${resp.status}`);
          if (keyInput) keyInput.value = payload.license_key || "";
          showStatus(
            `<strong>SANDBOX-TEST Issued</strong> (expires ${escapeHtml(payload.expires_at_utc || "")}) &mdash; <span style="color:var(--amber)">counted_toward_settled_usd: false</span><br><span class="mono">${escapeHtml(payload.license_key || "")}</span>`
          );
        } catch (err) {
          showStatus(`402 Sandbox issuer requires FastAPI server at http://127.0.0.1:8707 (${escapeHtml(err.message)}).`);
        }
      });
    }

    if (verifyBtn) {
      verifyBtn.addEventListener("click", async () => {
        const key = (keyInput?.value || "").trim();
        if (!key) {
          showStatus("Paste an AXON7 license key or click Issue SANDBOX-TEST Key first.");
          return;
        }
        try {
          const resp = await fetch("/api/license/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ license_key: key }),
          });
          const payload = await resp.json();
          if (!payload.valid) {
            showStatus(`<span style="color:var(--crimson)">INVALID KEY:</span> ${escapeHtml(payload.reason || "Rejected")}`);
            return;
          }
          showStatus(
            `<span style="color:var(--green)">VERIFIED:</span> tier=${escapeHtml(payload.tier)} &bull; sku=${escapeHtml(payload.sku)} &bull; sandbox=${Boolean(payload.sandbox)} &bull; counted_toward_settled_usd=${Boolean(payload.counted_toward_settled_usd)}`
          );
        } catch (err) {
          showStatus(`License verification requires FastAPI server at http://127.0.0.1:8707 (${escapeHtml(err.message)}).`);
        }
      });
    }

    testBtns.forEach((btn) => {
      btn.addEventListener("click", async () => {
        const item = btn.getAttribute("data-item") || "frameforge-v3";
        const key = (keyInput?.value || "").trim();
        const url = key
          ? `/api/download/${encodeURIComponent(item)}?license_key=${encodeURIComponent(key)}`
          : `/api/download/${encodeURIComponent(item)}`;
        showStatus(`Requesting <code>${escapeHtml(url)}</code>...`);
        try {
          const resp = await fetch(url);
          if (resp.status === 402) {
            const payload = await resp.json();
            showStatus(
              `<span style="color:var(--amber)">HTTP 402 Payment Required</span> &bull; rail_status=${escapeHtml(payload.rail_status || "PAYOUT_RAILS_UNCONFIGURED")} &bull; ${escapeHtml(payload.instructions || payload.reason || "Checkout or issue a SANDBOX-TEST key above to unlock.")}`
            );
            return;
          }
          if (!resp.ok) {
            const payload = await resp.json().catch(() => ({}));
            throw new Error(payload.detail || `HTTP ${resp.status}`);
          }
          const blob = await resp.blob();
          const disp = resp.headers.get("content-disposition") || "";
          const match = /filename="?([^";]+)"?/i.exec(disp);
          const filename = match ? match[1] : `${item}-verified-bundle`;
          const blobUrl = URL.createObjectURL(blob);
          const anchor = document.createElement("a");
          anchor.href = blobUrl;
          anchor.download = filename;
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
          setTimeout(() => URL.revokeObjectURL(blobUrl), 4000);
          showStatus(
            `<span style="color:var(--green)">HTTP 200 Unlocked</span> &bull; Delivered <strong>${escapeHtml(filename)}</strong> (${(blob.size / (1024 * 1024)).toFixed(2)} MB).`
          );
        } catch (err) {
          showStatus(`402 Download gate test requires FastAPI server at http://127.0.0.1:8707 (${escapeHtml(err.message)}).`);
        }
      });
    });
  }

  function initRescueAuditor(data) {
    const select = document.getElementById("audit-clip-select");
    const previewBtn = document.getElementById("rescue-preview-btn");
    const clipBtn = document.getElementById("audit-clip-btn");
    const uploadBtn = document.getElementById("audit-upload-btn");
    const fileInput = document.getElementById("audit-upload-input");
    const previewStage = document.getElementById("rescue-preview-stage");
    const previewVideo = document.getElementById("rescue-preview-video");
    const box = document.getElementById("audit-result-box");
    if (!select || !clipBtn || !uploadBtn || !box) return;

    const rawClips = data?.viral_scout?.raw_clips || [];
    const leadClips = data?.viral_scout?.lead_clips || [];
    const allClips = [
      ...leadClips.map((c) => ({ id: c.id, label: `${c.id} [Lead Demo · ${c.license || "CC-BY"}]` })),
      ...rawClips.map((c) => ({ id: c.id, label: `${c.id} [Raw · ${c.license || "CC"}]` })),
    ].filter((c) => c.id);
    if (allClips.length) {
      select.innerHTML = allClips
        .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.label)}</option>`)
        .join("");
    }

    const showPreviewPayload = (payload) => {
      if (previewStage && previewVideo && payload.preview_url) {
        previewStage.style.display = "block";
        previewVideo.src = payload.preview_url;
        previewVideo.load();
      }
      if (payload.audit) {
        renderAuditResult(payload.audit);
      }
    };

    if (previewBtn) {
      previewBtn.addEventListener("click", async () => {
        const clipId = select.value;
        box.className = "empty-state";
        box.textContent = `Running 7-killer diagnostic & rendering 4.5s 1080p60 watermarked preview for ${clipId}...`;
        try {
          const resp = await fetch("/api/rescue-preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clip_id: clipId }),
          });
          const payload = await resp.json();
          if (!resp.ok) throw new Error(payload.detail || `HTTP ${resp.status}`);
          showPreviewPayload(payload);
        } catch (err) {
          box.className = "empty-state";
          box.textContent = `Live Rescue Preview API requires FastAPI server at http://127.0.0.1:8707 (${err.message}).`;
        }
      });
    }

    clipBtn.addEventListener("click", async () => {
      const clipId = select.value;
      box.className = "empty-state";
      box.textContent = `Running 7-killer diagnostic on ${clipId}...`;
      try {
        const resp = await fetch("/api/audit-clip", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clip_id: clipId }),
        });
        const payload = await resp.json();
        if (!resp.ok) throw new Error(payload.detail || `HTTP ${resp.status}`);
        renderAuditResult(payload);
      } catch (err) {
        box.className = "empty-state";
        box.textContent = `Live Rescue API requires FastAPI server at http://127.0.0.1:8707 (${err.message}).`;
      }
    });

    uploadBtn.addEventListener("click", async () => {
      const file = fileInput?.files?.[0];
      if (!file) {
        box.className = "empty-state";
        box.textContent = "Choose an MP4 video file first.";
        return;
      }
      box.className = "empty-state";
      box.textContent = `Uploading ${file.name} & rendering 4.5s watermarked rescue preview...`;
      try {
        const form = new FormData();
        form.append("file", file);
        const resp = await fetch("/api/rescue-preview", { method: "POST", body: form });
        const payload = await resp.json();
        if (!resp.ok) throw new Error(payload.detail || `HTTP ${resp.status}`);
        showPreviewPayload(payload);
      } catch (err) {
        box.className = "empty-state";
        box.textContent = `Live Rescue API upload requires FastAPI server at http://127.0.0.1:8707 (${err.message}).`;
      }
    });
  }

  async function pollServerStatus() {
    const chip = document.getElementById("server-api-chip");
    if (!chip || window.location.protocol === "file:") return;
    try {
      const [statusResp, cfgResp] = await Promise.all([
        fetch("/api/status", { cache: "no-store" }),
        fetch("/api/checkout/config", { cache: "no-store" }),
      ]);
      if (statusResp.ok) {
        const st = await statusResp.json();
        chip.className = "chip ok";
        chip.textContent = `Live API :8707 · Heartbeats: ${st.heartbeat?.count ?? 0}`;
      }
      if (cfgResp.ok) {
        const cfg = await cfgResp.json();
        const settledEl = document.getElementById("settled-cash");
        const railChip = document.getElementById("rail-status-chip");
        const configured = cfg.rail_status === "PAYOUT_RAILS_CONFIGURED";
        if (settledEl && cfg.settled_usd !== undefined) {
          settledEl.textContent = fmtUsd(cfg.settled_usd);
        }
        if (railChip && cfg.rail_status) {
          railChip.className = `chip ${configured ? "ok" : "warn"}`;
          railChip.textContent = configured
            ? `PAYOUT_RAILS_CONFIGURED (Settled: ${fmtUsd(cfg.settled_usd || 0)})`
            : `PAYOUT_RAILS_UNCONFIGURED (Pre-Rail Expected: $0.00)`;
        }
      }
    } catch (_err) {
      // Offline / static server mode
    }
  }

  updateCountdown();
  setInterval(updateCountdown, 1000);
  document.addEventListener("DOMContentLoaded", initData);
})();
