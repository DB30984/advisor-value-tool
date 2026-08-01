import { useState } from "react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Cell, LineChart, Line
} from "recharts";

// ─── DESIGN TOKENS ──────────────────────────────────────────────
const C = {
  canvas:"#0A0C10", surface:"#111318", card:"#161B24", border:"#1E2530",
  gold:"#C9A84C", goldSoft:"#C9A84C18",
  emerald:"#10B981", emeraldS:"#10B98118",
  red:"#F87171", redS:"#F8717118",
  blue:"#6E9EF5", purple:"#A78BFA",
  orange:"#F97316", pink:"#EC4899",
  muted:"#4B5563", text:"#E2E8F0", textSoft:"#94A3B8", white:"#F8FAFC",
};

const fmt = (n) =>
  n >= 1_000_000 ? `$${(n/1_000_000).toFixed(2)}M`
  : n >= 1_000   ? `$${Math.round(n/1_000).toLocaleString()}K`
  : `$${Math.round(n).toLocaleString()}`;
const fmtPct = (n, d=2) => `${parseFloat(n).toFixed(d)}%`;

// ─── PLANNING GAPS CONFIG ───────────────────────────────────────
// type: "both" | "business" | "consumer"
const PLANNING_GAPS = [
  { key:"hasRetirePlan",  label:"Retirement plan in place (401k, DB Plan, SEP-IRA, IRA)",     type:"both",     icon:"🏦" },
  { key:"hasRoth",        label:"Roth / Mega Backdoor Roth strategy in place",                 type:"both",     icon:"🔄" },
  { key:"hasEstatePlan",  label:"Estate plan in place (will, POA, trust, beneficiaries)",      type:"both",     icon:"📋" },
  { key:"hasLifeIns",     label:"Personal life & disability insurance in place",               type:"both",     icon:"🛡️" },
  { key:"hasLTC",         label:"Long-term care plan / insurance in place",                    type:"consumer", icon:"🏥" },
  { key:"hasCollegePlan", label:"College / education funding plan in place (529, etc.)",       type:"consumer", icon:"🎓" },
  { key:"hasSocialSec",   label:"Social Security optimization strategy defined",               type:"consumer", icon:"📅" },
  { key:"hasKeyMan",      label:"Key-man life & disability insurance in place",                type:"business", icon:"👔" },
  { key:"hasBuySell",     label:"Buy-sell agreement funded and in place",                      type:"business", icon:"🤝" },
  { key:"qsbsConfirmed",  label:"QSBS eligibility confirmed (IRC §1202)",                      type:"business", icon:"✅" },
  { key:"hasSuccession",  label:"Business succession / exit plan documented",                  type:"business", icon:"🏢" },
  { key:"hasEntityReview",label:"Business entity structure reviewed for tax optimization",     type:"business", icon:"⚖️" },
];

const GAP_DEFAULTS = Object.fromEntries(PLANNING_GAPS.map(g => [g.key, false]));
// ─── CAPITAL MARKET ASSUMPTIONS ─────────────────────────────────
// Long-run annualized return estimates per asset class
// Source: BlackRock CMAs / Vanguard 10-yr projections (blended)
const CMA = {
  usEquity:    10.5,   // US large-cap equity
  intlEquity:   8.5,   // International developed + EM blend
  fixedIncome:  4.5,   // Aggregate bond (investment grade)
  alternatives: 9.0,   // Private equity / real assets blend
  cash:         4.8,   // Money market / short-term treasury
  other:        7.0,   // Catch-all / user-defined
};

const CMA_LABELS = {
  usEquity:    "US Equity",
  intlEquity:  "Intl Equity",
  fixedIncome: "Fixed Income",
  alternatives:"Alternatives",
  cash:        "Cash",
  other:       "Other",
};

function calcBlendedReturn(alloc) {
  const total = Object.values(alloc).reduce((s, v) => s + v, 0);
  if (total === 0) return 0;
  return Object.entries(alloc).reduce((sum, [key, pct]) => {
    return sum + (pct / total) * (CMA[key] || 0);
  }, 0);
}


// ─── COMPUTE ENGINE ─────────────────────────────────────────────
// Key fix: fee is applied to growing AUM each year, not flat starting AUM.
// We build a year-by-year model where:
//   - Portfolio grows at grossReturn each year
//   - Fee is deducted each year as feeRate% of that year's AUM
//   - Benefits compound on the growing base
function buildYearlyModel(aum, feeRate, grossReturn, horizon, taxRate, gaps) {
  const feeR     = feeRate / 100;
  const grossR   = grossReturn / 100;
  const tlhRate  = 0.008 * (taxRate / 37);  // TLH alpha as % of AUM
  const behavR   = 0.025;                   // behavioral alpha as % of AUM
  const locR     = 0.0045;                  // asset location alpha as % of AUM

  // Self-directed: gross minus behavioral drag, no fee
  const selfNetR = grossR - 0.037;
  // With advisor: gross - fee + behavioral + location
  const advNetR  = grossR - feeR + behavR + locR;

  let portAdv  = aum;
  let portSelf = aum;
  let totalFeesPaid = 0;
  let totalTLH      = 0;
  let totalBehav    = 0;
  let totalLoc      = 0;

  const yearRows = [];

  for (let yr = 1; yr <= horizon; yr++) {
    // Fee paid THIS year = feeRate% of START-of-year value
    const feeThisYear  = portAdv * feeR;
    const tlhThisYear  = portAdv * tlhRate;
    const behavThisYear= portAdv * behavR;
    const locThisYear  = portAdv * locR;

    totalFeesPaid += feeThisYear;
    totalTLH      += tlhThisYear;
    totalBehav    += behavThisYear;
    totalLoc      += locThisYear;

    portAdv  = portAdv  * (1 + advNetR);
    portSelf = portSelf * (1 + selfNetR);

    yearRows.push({
      year:      `Y${yr}`,
      withAdvisor: Math.round(portAdv),
      selfDirected: Math.round(portSelf),
      feeThisYear: Math.round(feeThisYear),
      cumulFees:   Math.round(totalFeesPaid),
      gap:         Math.round(portAdv - portSelf),
    });
  }

  return { yearRows, totalFeesPaid, totalTLH, totalBehav, totalLoc,
           finalAdv: portAdv, finalSelf: portSelf, advNetR, selfNetR };
}

function compute(d) {
  const { aum, feeRate, grossReturn, horizon, taxRate, estateSize, gaps } = d;
  const feeR = feeRate / 100;
  const tlhRate = 0.008 * (taxRate / 37);

  const ym = buildYearlyModel(aum, feeRate, grossReturn, horizon, taxRate, gaps);

  // Retirement plan — only if missing
  // Age 65 DB Plan limit ~$265K/yr (IRS 2024 max benefit / actuarial); default $85K for younger clients
  const dbPlanLimit = 265000; // Updated: age 65 owner gets much higher DB Plan contribution room
  const retireSavings = gaps.hasRetirePlan ? 0 : dbPlanLimit * (taxRate / 100);
  const retire10yr    = retireSavings * horizon;
  const retireFeeRec  = ym.totalFeesPaid > 0 ? (retireSavings / (ym.totalFeesPaid/horizon)) * 100 : 0;

  // Estate
  const exemption    = 7_000_000;
  const taxableEst   = Math.max(0, estateSize - exemption);
  const estateWithout = taxableEst * 0.40;
  const estateWith    = taxableEst * 0.40 * 0.35;
  const estateSaved   = estateWithout - estateWith;

  // QSBS / Exit
  const exitValue = gaps.qsbsConfirmed ? 0 : 3_700_000;

  // Measurable annual alpha as % of AUM (non-fee-related)
  const measurableAlpha = (tlhRate + 0.025 + 0.0045 + (retireSavings/aum)) * 100;

  const totalValue = ym.totalTLH + ym.totalBehav + ym.totalLoc + retire10yr + estateSaved + exitValue;
  const roi = ym.totalFeesPaid > 0 ? totalValue / ym.totalFeesPaid : 0;

  // Year 1 fee for reference
  const yr1Fee = aum * feeR;

  return {
    ...ym, yr1Fee, feeR,
    tlhRate, retireSavings, retire10yr, retireFeeRec,
    estateWithout, estateWith, estateSaved,
    exitValue, measurableAlpha, totalValue, roi,
  };
}

// ─── UI COMPONENTS ──────────────────────────────────────────────
function Eyebrow({ children, color=C.gold }) {
  return <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.13em",
    textTransform:"uppercase", color, marginBottom:5 }}>{children}</div>;
}
function Card({ children, style={} }) {
  return <div style={{ background:C.card, border:`1px solid ${C.border}`,
    borderRadius:12, padding:"14px 16px", ...style }}>{children}</div>;
}
function Lbl({ children }) {
  return <div style={{ fontSize:11, color:C.textSoft, fontWeight:600,
    marginBottom:4, textTransform:"uppercase", letterSpacing:"0.07em" }}>{children}</div>;
}
function TxtInput({ value, onChange, placeholder, type="text", style={} }) {
  return <input type={type} value={value} onChange={e=>onChange(e.target.value)}
    placeholder={placeholder}
    style={{ width:"100%", background:C.surface, border:`1px solid ${C.border}`,
      borderRadius:8, padding:"8px 11px", color:C.white, fontSize:13,
      fontFamily:"inherit", outline:"none", boxSizing:"border-box", ...style }} />;
}
function SliderRow({ label, min, max, step, value, set, display }) {
  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4,
        fontSize:12, color:C.textSoft }}>
        <span>{label}</span>
        <span style={{ color:C.gold, fontWeight:700 }}>{display}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e=>set(+e.target.value)}
        style={{ width:"100%", accentColor:C.gold, cursor:"pointer" }} />
    </div>
  );
}
function Toggle({ label, checked, onChange, accent=C.emerald, tag }) {
  return (
    <label style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer",
      userSelect:"none", padding:"6px 0" }}>
      <div onClick={()=>onChange(!checked)} style={{ width:34, height:18, borderRadius:9,
        position:"relative", background:checked ? accent : C.muted, transition:"background .2s",
        flexShrink:0 }}>
        <div style={{ position:"absolute", top:2, left:checked?18:2, width:14, height:14,
          borderRadius:"50%", background:C.white, transition:"left .2s" }} />
      </div>
      <div style={{ flex:1 }}>
        <span style={{ fontSize:12, color:checked ? C.text : C.textSoft }}>{label}</span>
        {tag && <span style={{ marginLeft:8, fontSize:9, fontWeight:700, color:
          tag==="business" ? C.orange : tag==="consumer" ? C.blue : C.muted,
          background: tag==="business" ? `${C.orange}22` : tag==="consumer" ? `${C.blue}22` : `${C.muted}22`,
          borderRadius:6, padding:"1px 6px", textTransform:"uppercase",
          letterSpacing:"0.05em" }}>{tag}</span>}
      </div>
    </label>
  );
}
function AllocBar({ alloc }) {
  const entries = [
    ["US Equity",alloc.usEquity,"#6E9EF5"],
    ["Intl Equity",alloc.intlEquity,"#10B981"],
    ["Fixed Income",alloc.fixedIncome,"#C9A84C"],
    ["Alternatives",alloc.alternatives,"#A78BFA"],
    ["Cash",alloc.cash,"#4B5563"],
    ["Other",alloc.other,"#EC4899"],
  ].filter(e=>e[1]>0);
  const total = entries.reduce((s,e)=>s+e[1],0);
  return (
    <div>
      <div style={{ display:"flex", height:16, borderRadius:6, overflow:"hidden", gap:2 }}>
        {entries.map(([n,v,c])=>(
          <div key={n} style={{ flex:v, background:c }} title={`${n}: ${v}%`} />
        ))}
      </div>
      <div style={{ display:"flex", flexWrap:"wrap", gap:"3px 10px", marginTop:7 }}>
        {entries.map(([n,v,c])=>(
          <div key={n} style={{ display:"flex", alignItems:"center", gap:4 }}>
            <div style={{ width:7, height:7, borderRadius:2, background:c }} />
            <span style={{ fontSize:9, color:C.textSoft }}>{n}: <strong style={{color:C.text}}>{v}%</strong></span>
          </div>
        ))}
        <span style={{ fontSize:9, fontWeight:700,
          color:total===100 ? C.emerald : C.red }}>
          Total: {total}% {total!==100?`(${total>100?"over":"under"} ${Math.abs(100-total)}%)`:"✓"}
        </span>
      </div>
    </div>
  );
}

const TTip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background:"#1A2030", border:`1px solid ${C.border}`,
      borderRadius:8, padding:"8px 12px" }}>
      <div style={{ color:C.textSoft, fontSize:10, marginBottom:5 }}>{label}</div>
      {payload.map((p,i)=>(
        <div key={i} style={{ color:p.color||p.stroke, fontSize:12, fontWeight:600, marginBottom:2 }}>
          {p.name}: {typeof p.value==="number" && p.value>1000 ? fmt(p.value) : p.value}
        </div>
      ))}
    </div>
  );
};

function BenefitRow({ number, title, annual, annualPctOfFee, annualPctOfAUM,
    total, horizon, accent, detail, source, isOpportunity, isCaptured }) {
  const [open, setOpen] = useState(false);
  return (
    <div onClick={()=>setOpen(o=>!o)} style={{
      background: isCaptured ? "transparent" : open ? `${accent}0A` : "transparent",
      border:`1px solid ${open ? accent+"55" : C.border}`,
      borderRadius:10, padding:"11px 13px", cursor:"pointer",
      transition:"all .2s", marginBottom:6, opacity:isCaptured?0.45:1,
    }}>
      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
        <div style={{ width:26, height:26, borderRadius:7, flexShrink:0,
          background:`${accent}22`, display:"flex", alignItems:"center",
          justifyContent:"center", fontSize:11, fontWeight:800, color:accent }}>
          {number}
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
            <div style={{ fontSize:12, fontWeight:600, color:C.text }}>{title}</div>
            {isOpportunity && !isCaptured && (
              <div style={{ fontSize:9, fontWeight:700, background:`${accent}22`,
                color:accent, borderRadius:8, padding:"2px 6px",
                textTransform:"uppercase", letterSpacing:"0.06em" }}>Opportunity</div>
            )}
            {isCaptured && (
              <div style={{ fontSize:9, fontWeight:700, background:`${C.muted}33`,
                color:C.muted, borderRadius:8, padding:"2px 6px",
                textTransform:"uppercase", letterSpacing:"0.06em" }}>In place</div>
            )}
          </div>
          <div style={{ fontSize:9, color:C.textSoft, marginTop:1 }}>{source}</div>
        </div>
        {annualPctOfFee !== null && !isCaptured && (
          <div style={{ textAlign:"center", minWidth:60 }}>
            <div style={{ fontSize:14, fontWeight:800, color:accent,
              fontVariantNumeric:"tabular-nums" }}>{fmtPct(annualPctOfFee,0)}%</div>
            <div style={{ fontSize:9, color:C.textSoft, lineHeight:1.3 }}>fee<br/>recovered/yr</div>
          </div>
        )}
        <div style={{ textAlign:"right", minWidth:68 }}>
          <div style={{ fontSize:15, fontWeight:800,
            color:isCaptured ? C.muted : accent,
            fontVariantNumeric:"tabular-nums" }}>{fmt(total)}</div>
          <div style={{ fontSize:9, color:C.textSoft }}>{horizon}yr value</div>
        </div>
        <div style={{ color:C.muted, fontSize:10, marginLeft:2 }}>{open?"▲":"▼"}</div>
      </div>
      {open && !isCaptured && (
        <div style={{ marginTop:10, paddingTop:10, borderTop:`1px solid ${C.border}`,
          fontSize:12, color:C.textSoft, lineHeight:1.75 }}>
          {detail}
          {annual > 0 && (
            <div style={{ marginTop:10, display:"flex", gap:8, flexWrap:"wrap" }}>
              {[
                ["Annual value", fmt(annual), accent],
                annualPctOfAUM!==null ? [`As % of AUM`, fmtPct(annualPctOfAUM,2)+"%", accent] : null,
                annualPctOfFee!==null ? [`Fee recovered/yr`, fmtPct(annualPctOfFee,0)+"%", C.gold] : null,
                [`${horizon}-yr total`, fmt(total), accent],
              ].filter(Boolean).map(([l,v,col],i)=>(
                <div key={i} style={{ background:C.surface, borderRadius:7, padding:"6px 10px" }}>
                  <div style={{ fontSize:9, color:C.textSoft, marginBottom:2 }}>{l}</div>
                  <div style={{ fontSize:12, fontWeight:700, color:col }}>{v}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// MAIN APP
// ════════════════════════════════════════════════════════════════
export default function App() {
  const [screen, setScreen] = useState("intake");
  const [tab, setTab]       = useState(0);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [clientType, setClientType] = useState("business"); // "both"|"consumer"|"business"

  // Intake fields
  const [clientName,  setClientName]  = useState("Richard M.");
  const [clientAge,   setClientAge]   = useState("65");
  const [advisorName, setAdvisorName] = useState("Dmitriy Berman, VP");
  const [firmName,    setFirmName]    = useState("Citizens Wealth Management");
  const [description, setDescription] = useState("65yo business owner, 50 employees, $5M revenue. Exit planned in 3 yrs. $3M cash, zero investments, no retirement plan, no estate plan. Renting in West Palm Beach, wants to buy a home. FL resident — 0% state income/estate tax.");

  // Quantitative
  const [aum,         setAum]         = useState(3000000);
  const [feeRate,     setFeeRate]     = useState(1.00);
  const [grossReturn, setGrossReturn] = useState(6.9); // auto-calc from conservative pre-exit allocation
  const [manualOverride, setManualOverride] = useState(false);
  const [horizon,     setHorizon]     = useState(15);
  const [taxRate,     setTaxRate]     = useState(37);
  const [estateSize,  setEstate]      = useState(8500000);

  // Planning gaps
  const [gaps, setGaps] = useState(GAP_DEFAULTS);
  const setGap = (key, val) => setGaps(g => ({ ...g, [key]: val }));

  // Allocation
  const [alloc, setAlloc] = useState({
    usEquity:30, intlEquity:5, fixedIncome:35, alternatives:5, cash:20, other:5
  }); // Pre-exit conservative: heavy fixed income + cash buffer
  const setAllocF = (k, val) => {
    const next = { ...alloc, [k]: +val };
    setAlloc(next);
    if (!manualOverride) {
      setGrossReturn(parseFloat(calcBlendedReturn(next).toFixed(1)));
    }
  };
  const allocTotal = Object.values(alloc).reduce((s,v)=>s+v,0);
  const canGenerate = allocTotal === 100 && clientName.trim().length > 0;

  const v = compute({ aum, feeRate, grossReturn, horizon, taxRate, estateSize, gaps });

  // Filter visible planning gaps by clientType
  const visibleGaps = PLANNING_GAPS.filter(g =>
    clientType === "both" || g.type === "both" || g.type === clientType
  );

  const TABS = ["Value Breakdown", "Wealth Gap", "Fee Growth", "Estate Impact", "ROI Breakdown"];
  const clientLabel = clientName || "Your Client";
  const ageLabel    = clientAge  ? `, age ${clientAge}` : "";

  // Build benefit rows
  const benefitRows = [
    {
      number:"01", accent:C.emerald,
      title:"Tax-Loss Harvesting",
      annual:v.totalTLH/horizon,
      annualPctOfFee:(v.tlhRate / v.feeR)*100,
      annualPctOfAUM:v.tlhRate*100,
      total:v.totalTLH,
      source:"Vanguard Advisor Alpha · Parametric Research",
      isOpportunity:true, isCaptured:false,
      detail:`Systematic harvesting of unrealized losses offsets capital gains at a ${taxRate}% marginal rate, generating ~${fmtPct(v.tlhRate*100,2)}% of AUM annually in tax alpha — recovering ${fmtPct((v.tlhRate/v.feeR)*100,0)}% of the Year 1 advisory fee from this benefit alone. Because the portfolio grows, so does the absolute value of harvesting opportunities — compounding to ${fmt(v.totalTLH)} over ${horizon} years.`,
    },
    {
      number:"02", accent:C.blue,
      title:"Behavioral Alpha — Staying Invested",
      annual:v.totalBehav/horizon,
      annualPctOfFee:(0.025/v.feeR)*100,
      annualPctOfAUM:2.5,
      total:v.totalBehav,
      source:"Dalbar QAIB Study 2024 · Morningstar Advisor Value",
      isOpportunity:true, isCaptured:false,
      detail:`Dalbar's 30-year study shows the average self-directed investor underperforms their own fund by 3.7%/yr due to panic selling. An advisor closes ~2.5% of that gap annually — recovering ${fmtPct((0.025/v.feeR)*100,0)}% of the advisory fee from behavioral protection alone. This grows in dollar terms as AUM grows, compounding to ${fmt(v.totalBehav)} over ${horizon} years.`,
    },
    {
      number:"03", accent:C.gold,
      title:"Retirement Plan Optimization",
      annual:v.retireSavings,
      annualPctOfFee:v.retireFeeRec,
      annualPctOfAUM:(v.retireSavings/aum)*100,
      total:v.retire10yr,
      source:"IRS 2024 Contribution Limits · State Tax Authority",
      isOpportunity:!gaps.hasRetirePlan, isCaptured:gaps.hasRetirePlan,
      detail:gaps.hasRetirePlan
        ? `Retirement plan is established — this benefit is captured. Review contribution levels and Roth conversion strategy annually.`
        : `No retirement plan in place — this is the highest-urgency item for a 65-year-old with 3 years to a business exit and ZERO retirement savings. Florida has no state income tax, so federal is the only layer to shelter. A DB Plan can shelter $265,000+ annually at age 65 (maximum contribution is age-dependent and significantly higher for older owners). At a ${taxRate}% marginal rate that saves ${fmt(v.retireSavings)}/yr — ${fmtPct(v.retireFeeRec,0)}% of the advisory fee recovered from this single benefit. Over ${horizon} years: ${fmt(v.retire10yr)} in preserved wealth.`,
    },
    {
      number:"04", accent:C.purple,
      title:"Tax-Efficient Asset Location",
      annual:v.totalLoc/horizon,
      annualPctOfFee:(0.0045/v.feeR)*100,
      annualPctOfAUM:0.45,
      total:v.totalLoc,
      source:"Morningstar Gamma Study · Kitces Research",
      isOpportunity:!gaps.hasRoth, isCaptured:false,
      detail:`Optimal placement of assets across taxable, tax-deferred, and Roth accounts generates ~0.45% of AUM annually — recovering ${fmtPct((0.0045/v.feeR)*100,0)}% of the fee through structure alone.${!gaps.hasRoth ? " A Roth or Mega Backdoor Roth strategy is not yet in place — this is an active opportunity." : ""} Grows in dollar terms as AUM grows, compounding to ${fmt(v.totalLoc)} over ${horizon} years.`,
    },
    {
      number:"05", accent:C.orange,
      title:"Exit Planning & QSBS Exclusion",
      annual:0, annualPctOfFee:null, annualPctOfAUM:null,
      total:v.exitValue,
      source:"IRC §1202 · Exit Tax Planning",
      isOpportunity:!gaps.qsbsConfirmed, isCaptured:gaps.qsbsConfirmed,
      detail:gaps.qsbsConfirmed
        ? `QSBS eligibility confirmed — §1202 exclusion is in place. Monitor the 5-year holding period and $50M gross asset limit annually.`
        : `If the client holds qualifying small business stock under IRC §1202, up to $10M in capital gains may be excluded from federal taxes on a future sale — worth $3.7M+ at the 37% rate. Cannot be established retroactively. At ${fmtPct(feeRate,2)}% on ${fmt(aum)}, this benefit alone justifies ${Math.round(v.exitValue / v.yr1Fee)} years of advisory fees.`,
    },
    {
      number:"06", accent:C.pink,
      title:"Estate Tax Mitigation",
      annual:0, annualPctOfFee:null, annualPctOfAUM:null,
      total:v.estateSaved,
      source:"IRS Estate Tax · TCJA Sunset 2026",
      isOpportunity:!gaps.hasEstatePlan, isCaptured:gaps.hasEstatePlan,
      detail:gaps.hasEstatePlan
        ? `Estate plan is in place. Monitor the TCJA sunset — exemption drops from $13.6M to ~$7M in 2026. Annual gifting and trust structures should be reviewed this year.`
        : `No estate plan in place. Florida has NO state estate tax and no state income tax. The federal exemption is now $15M per person (permanent under the One Big Beautiful Bill Act, 2025). At a projected estate of ${fmt(estateSize)}, federal estate tax exposure is currently limited — but a successful business exit, home purchase, and portfolio growth could push the estate toward or above $15M over a 10-15 year horizon. More immediately: without a will, POA, and healthcare directive, a health event creates a legal and financial crisis. A trust structure protects assets from probate, ensures the right people have control, and positions the estate for any future tax law changes. Gifting ($19K/person/yr) can also transfer wealth to heirs tax-free today.`,
    },
  ];

  const roiBarData = [
    { label:"Tax-Loss Harvest",    value:Math.round(v.totalTLH),     fill:C.emerald },
    { label:"Behavioral Alpha",    value:Math.round(v.totalBehav),   fill:C.blue },
    { label:"Retirement Savings",  value:Math.round(v.retire10yr),   fill:C.gold },
    { label:"Asset Location",      value:Math.round(v.totalLoc),     fill:C.purple },
    { label:"Exit / QSBS",         value:Math.round(v.exitValue),    fill:C.orange },
    { label:"Estate Mitigation",   value:Math.round(v.estateSaved),  fill:C.pink },
  ];

  // ── PDF export ────────────────────────────────────────────────
  const handleDownloadPdf = async () => {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "pt", format: "letter" });
    const PAGE_W = 612, PAGE_H = 792, MARGIN = 40, CONTENT_W = PAGE_W - MARGIN * 2;

    const ink = [26, 26, 24];
    const soft = [110, 110, 104];
    const faint = [225, 222, 212];
    const gold = [178, 140, 43];
    const goldFill = [250, 244, 228];
    const canvas = [10, 12, 16];
    const green = [11, 110, 86];
    const greenFill = [232, 244, 238];
    const red = [153, 44, 30];
    const redFill = [250, 234, 229];

    const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    let y = 0;

    const ensureSpace = (needed) => {
      if (y + needed > PAGE_H - 56) {
        doc.addPage();
        y = MARGIN;
      }
    };

    const sectionTitle = (label) => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(...gold);
      doc.text(label.toUpperCase(), MARGIN, y);
      doc.setDrawColor(...faint);
      doc.setLineWidth(0.75);
      doc.line(MARGIN, y + 5, PAGE_W - MARGIN, y + 5);
      y += 22;
    };

    const statBox = (x, w, h, label, value, valueColor) => {
      doc.setDrawColor(...faint);
      doc.setLineWidth(0.75);
      doc.roundedRect(x, y, w, h, 4, 4, "S");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...soft);
      doc.text(label.toUpperCase(), x + 10, y + 16, { maxWidth: w - 20 });
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(...(valueColor || ink));
      doc.text(value, x + 10, y + h - 12, { maxWidth: w - 20 });
    };

    // ── Header band ──
    doc.setFillColor(...canvas);
    doc.rect(0, 0, PAGE_W, 76, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...gold);
    doc.text(`${advisorName.toUpperCase()}  ·  ${firmName.toUpperCase()}`, MARGIN, 26);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(19);
    doc.setTextColor(255, 255, 255);
    doc.text("Advisory Value Analysis", MARGIN, 50);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(190, 190, 185);
    doc.text(`${clientLabel}${ageLabel}`, MARGIN, 66);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(160, 160, 155);
    doc.text(dateStr, PAGE_W - MARGIN, 26, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(...gold);
    doc.text(fmtPct(feeRate, 2), PAGE_W - MARGIN, 52, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(160, 160, 155);
    doc.text("ADVISORY FEE RATE", PAGE_W - MARGIN, 64, { align: "right" });

    y = 104;

    // ── Top stat band ──
    const gap = 10;
    const boxW = (CONTENT_W - gap * 3) / 4;
    const boxH = 56;
    statBox(MARGIN, boxW, boxH, `Total fees (${horizon}yr)`, fmt(v.totalFeesPaid));
    statBox(MARGIN + (boxW + gap), boxW, boxH, "Total value generated", fmt(v.totalValue), green);
    statBox(MARGIN + (boxW + gap) * 2, boxW, boxH, `${horizon}-yr fee ROI`, `${Math.round(v.roi)}\u00D7`, gold);
    statBox(MARGIN + (boxW + gap) * 3, boxW, boxH, "Net alpha / yr", `+${fmtPct(v.measurableAlpha - feeRate, 2)}`, green);
    y += boxH + 18;

    // ── Wealth gap section ──
    ensureSpace(110);
    sectionTitle("Wealth accumulation — with advisor vs. self-directed");
    const gapBoxW = (CONTENT_W - gap * 2) / 3;
    const gapBoxH = 50;
    const finalGapVal = v.yearRows[v.yearRows.length - 1]?.gap || 0;
    statBox(MARGIN, gapBoxW, gapBoxH, "With advisor (final)", fmt(v.finalAdv), green);
    statBox(MARGIN + (gapBoxW + gap), gapBoxW, gapBoxH, "Self-directed (final)", fmt(v.finalSelf));
    statBox(MARGIN + (gapBoxW + gap) * 2, gapBoxW, gapBoxH, `Wealth gap (Y${horizon})`, fmt(finalGapVal), gold);
    y += gapBoxH + 8;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...soft);
    const gapNote = doc.splitTextToSize(
      `Modeled at ${fmtPct(v.advNetR * 100, 1)} net with an advisor vs. ${fmtPct(v.selfNetR * 100, 1)} net self-directed, reflecting fee, behavioral, and tax-location effects.`,
      CONTENT_W
    );
    doc.text(gapNote, MARGIN, y);
    y += gapNote.length * 11 + 14;

    // ── Benefit breakdown table ──
    ensureSpace(40 + benefitRows.length * 30);
    sectionTitle("Value breakdown by benefit");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...soft);
    doc.text("BENEFIT", MARGIN, y);
    doc.text("STATUS", MARGIN + 300, y);
    doc.text(`${horizon}-YEAR VALUE`, PAGE_W - MARGIN, y, { align: "right" });
    y += 8;
    doc.setDrawColor(...faint);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    y += 16;

    benefitRows.forEach((r, i) => {
      ensureSpace(30);
      if (i % 2 === 1) {
        doc.setFillColor(250, 249, 245);
        doc.rect(MARGIN, y - 14, CONTENT_W, 24, "F");
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(...ink);
      doc.text(r.title, MARGIN + 4, y);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...soft);
      doc.text(r.source, MARGIN + 4, y + 10);

      const captured = r.isCaptured;
      const badgeColor = captured ? soft : green;
      const badgeText = captured ? "In place" : "Opportunity";
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(...badgeColor);
      doc.text(badgeText, MARGIN + 300, y);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(...(captured ? soft : ink));
      doc.text(fmt(r.total), PAGE_W - MARGIN, y, { align: "right" });

      y += 26;
    });

    y += 6;
    ensureSpace(60);
    doc.setFillColor(...goldFill);
    doc.setDrawColor(...gold);
    doc.roundedRect(MARGIN, y, CONTENT_W, 46, 4, 4, "FD");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...gold);
    doc.text(`TOTAL QUANTIFIABLE VALUE — ${horizon} YEARS`, MARGIN + 12, y + 17);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(...ink);
    doc.text(fmt(v.totalValue), MARGIN + 12, y + 36);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...soft);
    doc.text(`vs. ${fmt(v.totalFeesPaid)} in total fees  —  ${Math.round(v.roi)}\u00D7 return on fees paid`, PAGE_W - MARGIN - 12, y + 27, { align: "right" });
    y += 46 + 16;

    // ── Estate impact ──
    ensureSpace(110);
    sectionTitle("Estate tax impact");
    const eBoxW = (CONTENT_W - gap * 2) / 3;
    statBox(MARGIN, eBoxW, 50, "Without planning", fmt(v.estateWithout), red);
    statBox(MARGIN + (eBoxW + gap), eBoxW, 50, "With planning", fmt(v.estateWith), green);
    statBox(MARGIN + (eBoxW + gap) * 2, eBoxW, 50, "Preserved for heirs", fmt(v.estateSaved), gold);
    y += 50 + 14;

    // ── Footer / disclaimer ──
    ensureSpace(60);
    doc.setDrawColor(...faint);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    y += 16;
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7.5);
    doc.setTextColor(...soft);
    const disclaimer = doc.splitTextToSize(
      `This analysis is a hypothetical illustration based on the assumptions and figures entered above (${fmtPct(grossReturn,1)} projected gross return, ${fmtPct(taxRate,0)} marginal tax rate, ${horizon}-year horizon). It does not represent guaranteed returns and is not a substitute for personalized financial, tax, or legal advice. Prepared by ${advisorName}, ${firmName} on ${dateStr} for ${clientLabel}.`,
      CONTENT_W
    );
    doc.text(disclaimer, MARGIN, y);

    const filename = `${(clientName || "Client").trim().replace(/\s+/g, "_")}_Advisory_Value_Analysis.pdf`;
    doc.save(filename);
  };

  // ── Fee growth data (shows annual fee growing with AUM) ──────
  const feeGrowthData = v.yearRows.map(r => ({
    year: r.year,
    annualFee: r.feeThisYear,
    cumulFees: r.cumulFees,
    portfolioValue: r.withAdvisor,
  }));

  // ════════════════════════════════════════════════════════════
  // INTAKE SCREEN
  // ════════════════════════════════════════════════════════════
  if (screen === "intake") {
    return (
      <div style={{ minHeight:"100vh", background:C.canvas, color:C.text,
        fontFamily:"-apple-system,'SF Pro Display',sans-serif", padding:"20px" }}>

        <div style={{ marginBottom:20 }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.14em",
            textTransform:"uppercase", color:C.gold, marginBottom:5 }}>
            Advisory Value Tool
          </div>
          <h1 style={{ fontSize:24, fontWeight:800, color:C.white,
            letterSpacing:"-0.5px", margin:"0 0 3px" }}>New Client Analysis</h1>
          <p style={{ fontSize:12, color:C.textSoft, margin:0 }}>
            Fill in client details below — takes under 2 minutes. Works for consumer and business clients.
          </p>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, maxWidth:860 }}>

          {/* ── Client Info ── */}
          <Card>
            <Eyebrow>Client Information</Eyebrow>
            <div style={{ display:"flex", flexDirection:"column", gap:11 }}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                <div>
                  <Lbl>Client Name *</Lbl>
                  <TxtInput value={clientName} onChange={setClientName} placeholder="e.g. Jane Smith" />
                </div>
                <div>
                  <Lbl>Client Age</Lbl>
                  <TxtInput value={clientAge} onChange={setClientAge} placeholder="e.g. 45" type="number" />
                </div>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                <div>
                  <Lbl>Advisor Name</Lbl>
                  <TxtInput value={advisorName} onChange={setAdvisorName} placeholder="Your name" />
                </div>
                <div>
                  <Lbl>Firm</Lbl>
                  <TxtInput value={firmName} onChange={setFirmName} placeholder="Firm name" />
                </div>
              </div>
              <div>
                <Lbl>Client Summary (optional)</Lbl>
                <textarea value={description} onChange={e=>setDescription(e.target.value)}
                  placeholder="e.g. Business owner, 45, $3M revenue, recently sold real estate, two kids in college..."
                  rows={3} style={{ width:"100%", background:C.surface, border:`1px solid ${C.border}`,
                    borderRadius:8, padding:"8px 11px", color:C.white, fontSize:12,
                    fontFamily:"inherit", outline:"none", resize:"vertical",
                    boxSizing:"border-box" }} />
              </div>

              {/* Client Type */}
              <div>
                <Lbl>Client Type</Lbl>
                <div style={{ display:"flex", gap:8 }}>
                  {[["both","Both"],["consumer","Consumer"],["business","Business"]].map(([val,lbl])=>(
                    <button key={val} onClick={()=>setClientType(val)} style={{
                      flex:1, padding:"7px 0", borderRadius:8, border:`1px solid ${
                        clientType===val ? C.gold : C.border}`,
                      background: clientType===val ? C.goldSoft : C.surface,
                      color: clientType===val ? C.gold : C.textSoft,
                      fontWeight: clientType===val ? 700 : 400,
                      fontSize:12, cursor:"pointer", fontFamily:"inherit",
                    }}>{lbl}</button>
                  ))}
                </div>
              </div>
            </div>
          </Card>

          {/* ── Financial Parameters ── */}
          <Card>
            <Eyebrow>Financial Parameters</Eyebrow>
            <div style={{ display:"flex", flexDirection:"column", gap:13 }}>

              {/* Fee rate — prominent */}
              <div style={{ background:C.goldSoft, border:`1px solid ${C.gold}44`,
                borderRadius:9, padding:"11px 13px" }}>
                <div style={{ display:"flex", justifyContent:"space-between",
                  alignItems:"center", marginBottom:7 }}>
                  <div>
                    <div style={{ fontSize:12, fontWeight:700, color:C.gold }}>Advisory Fee Rate</div>
                    <div style={{ fontSize:10, color:C.textSoft, marginTop:1 }}>
                      Applied to AUM each year as portfolio grows
                    </div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontSize:24, fontWeight:800, color:C.gold }}>
                      {fmtPct(feeRate,2)}%
                    </div>
                    <div style={{ fontSize:10, color:C.textSoft }}>
                      Year 1: {fmt(aum * feeRate/100)}/yr
                    </div>
                  </div>
                </div>
                <input type="range" min={0.25} max={2.0} step={0.05} value={feeRate}
                  onChange={e=>setFeeRate(+e.target.value)}
                  style={{ width:"100%", accentColor:C.gold, cursor:"pointer" }} />
                <div style={{ display:"flex", justifyContent:"space-between",
                  fontSize:9, color:C.muted, marginTop:3 }}>
                  <span>0.25%</span><span>0.50%</span><span>0.75%</span>
                  <span>1.00%</span><span>1.25%</span><span>1.50%</span>
                  <span>1.75%</span><span>2.00%</span>
                </div>
              </div>

              <SliderRow label="Total AUM" min={50000} max={10000000} step={50000}
                value={aum} set={setAum} display={fmt(aum)} />
              {/* Projected Return — auto-calculated from allocation, manual override available */}
              <div style={{ background:`${C.surface}`, border:`1px solid ${C.border}`,
                borderRadius:8, padding:"10px 12px" }}>
                <div style={{ display:"flex", justifyContent:"space-between",
                  alignItems:"center", marginBottom:6 }}>
                  <div>
                    <div style={{ fontSize:11, color:C.textSoft, fontWeight:600,
                      textTransform:"uppercase", letterSpacing:"0.07em" }}>
                      Expected Gross Return
                    </div>
                    <div style={{ fontSize:9, color:C.muted, marginTop:2 }}>
                      {manualOverride
                        ? "Manual override — drag to adjust"
                        : "Auto-calculated from allocation · drag to override"}
                    </div>
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontSize:20, fontWeight:800,
                        color: manualOverride ? C.orange : C.emerald }}>
                        {fmtPct(grossReturn,1)}%
                      </div>
                      {!manualOverride && (
                        <div style={{ fontSize:9, color:C.textSoft }}>blended CMA</div>
                      )}
                    </div>
                    <button onClick={()=>{
                      if (manualOverride) {
                        // switching back to auto — recalc from current alloc
                        setGrossReturn(parseFloat(calcBlendedReturn(alloc).toFixed(1)));
                      }
                      setManualOverride(m=>!m);
                    }} style={{
                      background: manualOverride ? `${C.orange}22` : `${C.emerald}22`,
                      border: `1px solid ${manualOverride ? C.orange : C.emerald}44`,
                      borderRadius:6, padding:"4px 8px", cursor:"pointer",
                      fontSize:9, fontWeight:700,
                      color: manualOverride ? C.orange : C.emerald,
                      fontFamily:"inherit", whiteSpace:"nowrap",
                    }}>
                      {manualOverride ? "← Auto" : "Override"}
                    </button>
                  </div>
                </div>
                {manualOverride && (
                  <input type="range" min={2} max={20} step={0.5} value={grossReturn}
                    onChange={e=>setGrossReturn(+e.target.value)}
                    style={{ width:"100%", accentColor:C.orange, cursor:"pointer" }} />
                )}
                {/* Per-class breakdown when in auto mode */}
                {!manualOverride && (
                  <div style={{ display:"flex", flexWrap:"wrap", gap:"4px 10px", marginTop:6 }}>
                    {Object.entries(CMA).map(([key, ret]) => alloc[key] > 0 ? (
                      <div key={key} style={{ fontSize:9, color:C.textSoft }}>
                        {CMA_LABELS[key]}: <strong style={{ color:C.text }}>
                          {alloc[key]}% × {ret}%
                        </strong>
                      </div>
                    ) : null)}
                  </div>
                )}
              </div>
              <SliderRow label="Planning horizon (years)" min={5} max={30} step={5}
                value={horizon} set={setHorizon} display={`${horizon} yrs`} />
              <SliderRow label="Marginal tax rate (%)" min={22} max={50} step={1}
                value={taxRate} set={setTaxRate} display={fmtPct(taxRate,0)+"%"} />
              <SliderRow label="Projected estate size" min={500000} max={50000000} step={250000}
                value={estateSize} set={setEstate} display={fmt(estateSize)} />
            </div>
          </Card>

          {/* ── Asset Allocation ── */}
          <Card>
            <Eyebrow>Asset Allocation</Eyebrow>
            <div style={{ marginBottom:12 }}>
              <AllocBar alloc={alloc} />
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              {[
                ["usEquity","US Equity (%)","#6E9EF5"],
                ["intlEquity","Intl Equity (%)","#10B981"],
                ["fixedIncome","Fixed Income (%)","#C9A84C"],
                ["alternatives","Alternatives (%)","#A78BFA"],
                ["cash","Cash (%)","#4B5563"],
                ["other","Other (%)","#EC4899"],
              ].map(([key,label,color])=>(
                <div key={key}>
                  <div style={{ display:"flex", justifyContent:"space-between",
                    marginBottom:3, fontSize:11, color:C.textSoft }}>
                    <span style={{ display:"flex", alignItems:"center", gap:5 }}>
                      <span style={{ width:7, height:7, borderRadius:2,
                        background:color, display:"inline-block" }} />{label}
                    </span>
                    <span style={{ color, fontWeight:700 }}>{alloc[key]}%</span>
                  </div>
                  <input type="range" min={0} max={100} step={5} value={alloc[key]}
                    onChange={e=>setAllocF(key,e.target.value)}
                    style={{ width:"100%", accentColor:color, cursor:"pointer" }} />
                </div>
              ))}
            </div>
          </Card>

          {/* ── Planning Gaps ── */}
          <Card>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              <Eyebrow>Planning Gaps</Eyebrow>
              <div style={{ fontSize:10, color:C.textSoft }}>
                Toggle ON = already in place · Toggle OFF = opportunity
              </div>
            </div>

            <div style={{ display:"flex", flexDirection:"column",
              gap:2, marginBottom:14,
              maxHeight:260, overflowY:"auto",
              paddingRight:4 }}>
              {visibleGaps.map(g => (
                <Toggle key={g.key}
                  label={`${g.icon}  ${g.label}`}
                  checked={gaps[g.key]}
                  onChange={val => setGap(g.key, val)}
                  tag={g.type !== "both" ? g.type : null}
                />
              ))}
            </div>

            {/* Alerts for critical missing items */}
            {(!gaps.hasKeyMan || !gaps.hasLifeIns) && (
              <div style={{ background:`${C.red}12`, border:`1px solid ${C.red}33`,
                borderRadius:7, padding:"8px 10px", marginBottom:12, fontSize:11,
                color:C.textSoft }}>
                <span style={{ fontWeight:700, color:C.red }}>⚠ Protection gaps detected — </span>
                flagged as immediate action items in the analysis.
              </div>
            )}

            {/* Generate button */}
            <button onClick={()=>{ if(canGenerate){ setScreen("analysis"); setTab(0); } }}
              style={{ width:"100%", padding:"12px",
                background: canGenerate ? C.gold : C.muted,
                border:"none", borderRadius:9,
                color: canGenerate ? "#0A0C10" : C.textSoft,
                fontSize:13, fontWeight:800, cursor: canGenerate ? "pointer" : "not-allowed",
                fontFamily:"inherit", letterSpacing:"0.02em", transition:"all .2s" }}>
              {!clientName.trim()
                ? "Enter a client name to continue"
                : !canGenerate
                  ? `Allocation must total 100% (currently ${allocTotal}%)`
                  : `Generate Analysis for ${clientName} →`}
            </button>
          </Card>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════
  // ANALYSIS SCREEN
  // ════════════════════════════════════════════════════════════
  const yr1Fee    = v.yr1Fee;
  const finalFee  = v.yearRows[v.yearRows.length-1]?.feeThisYear || yr1Fee;
  const finalGap  = v.yearRows[v.yearRows.length-1]?.gap || 0;

  return (
    <div style={{ minHeight:"100vh", background:C.canvas, color:C.text,
      fontFamily:"-apple-system,'SF Pro Display',sans-serif" }}>

      {/* ── Header ── */}
      <div style={{ borderBottom:`1px solid ${C.border}`, padding:"18px 20px 0",
        background:`linear-gradient(180deg,#0F1420 0%,${C.canvas} 100%)` }}>

        <div style={{ display:"flex", justifyContent:"space-between",
          alignItems:"flex-start", marginBottom:8 }}>
          <div>
            <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.12em",
              textTransform:"uppercase", color:C.gold, marginBottom:3 }}>
              {advisorName}  ·  {firmName}
            </div>
            <h1 style={{ fontSize:22, fontWeight:800, color:C.white,
              letterSpacing:"-0.4px", margin:"0 0 2px" }}>
              The True Value of {fmtPct(feeRate,2)}%
            </h1>
            <p style={{ fontSize:12, color:C.textSoft, margin:0 }}>
              {clientLabel}{ageLabel}
              {description ? ` — ${description.slice(0,90)}${description.length>90?"…":""}` : ""}
            </p>
          </div>
          <div style={{ display:"flex", gap:8, flexShrink:0 }}>
            <button onClick={async ()=>{
              if (pdfLoading) return;
              setPdfLoading(true);
              try { await handleDownloadPdf(); }
              finally { setPdfLoading(false); }
            }}
              disabled={pdfLoading}
              style={{ background:C.gold, border:"none",
                borderRadius:8, padding:"6px 14px", color:"#0A0C10",
                fontSize:11, fontWeight:700, cursor: pdfLoading ? "default" : "pointer",
                fontFamily:"inherit", opacity: pdfLoading ? 0.6 : 1,
                display:"flex", alignItems:"center", gap:6 }}>
              {pdfLoading ? "Generating…" : "⬇ Download PDF"}
            </button>
            <button onClick={()=>{setScreen("intake");setTab(0);}}
              style={{ background:C.surface, border:`1px solid ${C.border}`,
                borderRadius:8, padding:"6px 12px", color:C.textSoft,
                fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>
              ← Edit Inputs
            </button>
          </div>
        </div>

        {/* Fee strip — shows Year 1 vs final year fee to make growth visible */}
        <div style={{ background:C.surface, border:`1px solid ${C.border}`,
          borderRadius:9, padding:"10px 14px", marginBottom:14,
          display:"flex", alignItems:"center", flexWrap:"wrap", gap:14 }}>
          <div>
            <div style={{ fontSize:9, color:C.textSoft, textTransform:"uppercase",
              letterSpacing:"0.07em", marginBottom:2 }}>Fee Rate (constant)</div>
            <div style={{ fontSize:20, fontWeight:800, color:C.gold }}>{fmtPct(feeRate,2)}% AUM</div>
          </div>
          <div style={{ width:1, height:32, background:C.border }} />
          <div>
            <div style={{ fontSize:9, color:C.textSoft, textTransform:"uppercase",
              letterSpacing:"0.07em", marginBottom:2 }}>Year 1 Fee</div>
            <div style={{ fontSize:16, fontWeight:700, color:C.white }}>{fmt(yr1Fee)}</div>
          </div>
          <div style={{ fontSize:12, color:C.muted }}>→</div>
          <div>
            <div style={{ fontSize:9, color:C.textSoft, textTransform:"uppercase",
              letterSpacing:"0.07em", marginBottom:2 }}>Year {horizon} Fee</div>
            <div style={{ fontSize:16, fontWeight:700, color:C.emerald }}>{fmt(finalFee)}</div>
            <div style={{ fontSize:9, color:C.textSoft }}>({fmtPct(feeRate,2)}% on larger AUM)</div>
          </div>
          <div style={{ width:1, height:32, background:C.border }} />
          <div>
            <div style={{ fontSize:9, color:C.textSoft, textTransform:"uppercase",
              letterSpacing:"0.07em", marginBottom:2 }}>Total Fees Paid ({horizon} yrs)</div>
            <div style={{ fontSize:16, fontWeight:700, color:C.white }}>{fmt(v.totalFeesPaid)}</div>
          </div>
          <div style={{ width:1, height:32, background:C.border }} />
          <div>
            <div style={{ fontSize:9, color:C.textSoft, textTransform:"uppercase",
              letterSpacing:"0.07em", marginBottom:2 }}>Net Alpha/yr (vs. self-directed)</div>
            <div style={{ fontSize:16, fontWeight:700, color:C.emerald }}>
              +{fmtPct(v.measurableAlpha - feeRate, 2)}% AUM
            </div>
          </div>
          <div style={{ width:1, height:32, background:C.border }} />
          <div>
            <div style={{ fontSize:9, color:C.textSoft, textTransform:"uppercase",
              letterSpacing:"0.07em", marginBottom:2 }}>{horizon}-yr Fee ROI</div>
            <div style={{ fontSize:20, fontWeight:800, color:C.gold }}>
              {Math.round(v.roi)}×
            </div>
          </div>
        </div>

        {/* Stat chips */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:14 }}>
          {[
            { val:fmt(v.totalFeesPaid),  sub:`Total fees over ${horizon} yrs (grows w/ AUM)`, accent:C.muted },
            { val:fmt(v.totalValue),     sub:`Total quantifiable value`, accent:C.emerald },
            { val:`${Math.round(v.roi)}×`, sub:"Return on every fee dollar", accent:C.gold },
            { val:fmt(finalGap),         sub:"Wealth gap vs. self-directed", accent:C.blue },
          ].map((s,i)=>(
            <div key={i} style={{ background:C.card, border:`1px solid ${C.border}`,
              borderRadius:9, padding:"9px 11px" }}>
              <div style={{ fontSize:18, fontWeight:800, color:s.accent,
                fontVariantNumeric:"tabular-nums" }}>{s.val}</div>
              <div style={{ fontSize:9, color:C.textSoft, marginTop:2 }}>{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Allocation bar */}
        <div style={{ marginBottom:12 }}>
          <AllocBar alloc={alloc} />
        </div>

        {/* Tabs */}
        <div style={{ display:"flex", gap:2, borderBottom:`1px solid ${C.border}` }}>
          {TABS.map((t,i)=>(
            <button key={i} onClick={()=>setTab(i)} style={{
              background:"none", border:"none", cursor:"pointer",
              padding:"6px 11px 8px", fontSize:11,
              fontWeight:tab===i?600:400,
              color:tab===i?C.gold:C.textSoft,
              borderBottom:tab===i?`2px solid ${C.gold}`:"2px solid transparent",
              fontFamily:"inherit", transition:"all .15s",
            }}>{t}</button>
          ))}
        </div>
      </div>

      <div style={{ padding:"16px 20px", maxWidth:860 }}>

        {/* ── TAB 0: VALUE BREAKDOWN ── */}
        {tab===0 && (
          <div>
            {(!gaps.hasKeyMan || !gaps.hasLifeIns) && (
              <div style={{ background:`${C.red}12`, border:`1px solid ${C.red}33`,
                borderRadius:9, padding:"9px 12px", marginBottom:10,
                display:"flex", alignItems:"center", gap:9 }}>
                <span>⚠</span>
                <div>
                  <div style={{ fontSize:11, fontWeight:700, color:C.red }}>
                    Protection Gap — Immediate Action
                  </div>
                  <div style={{ fontSize:10, color:C.textSoft }}>
                    {!gaps.hasKeyMan && "No key-man insurance. "}
                    {!gaps.hasLifeIns && "No personal life/disability coverage. "}
                    Underwriting is cheapest now — every year of delay increases premium and scrutiny.
                  </div>
                </div>
              </div>
            )}
            <p style={{ fontSize:12, color:C.textSoft, marginBottom:11, lineHeight:1.7 }}>
              Each row is a distinct, quantifiable benefit independent of portfolio returns.
              <strong style={{ color:C.gold }}> Opportunity badges</strong> = gaps not yet addressed for {clientLabel}.
              All values reflect the <strong style={{ color:C.gold }}>{fmtPct(feeRate,2)}% fee applied to growing AUM</strong> — not a flat starting balance.
            </p>
            {benefitRows.map((r,i)=><BenefitRow key={i} horizon={horizon} {...r} />)}
            <Card style={{ marginTop:11, borderColor:`${C.gold}44`, background:C.goldSoft }}>
              <div style={{ display:"flex", justifyContent:"space-between",
                alignItems:"center", flexWrap:"wrap", gap:10 }}>
                <div>
                  <Eyebrow color={C.gold}>Total quantifiable value — {horizon} years</Eyebrow>
                  <div style={{ fontSize:30, fontWeight:800, color:C.gold,
                    fontVariantNumeric:"tabular-nums" }}>{fmt(v.totalValue)}</div>
                  <div style={{ fontSize:11, color:C.textSoft, marginTop:3 }}>
                    vs. {fmt(v.totalFeesPaid)} in total fees (growing with AUM) —{" "}
                    <strong style={{ color:C.gold }}>{Math.round(v.roi)}× return on fees paid</strong>
                  </div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontSize:10, color:C.textSoft, marginBottom:3 }}>
                    Net alpha after {fmtPct(feeRate,2)}% fee
                  </div>
                  <div style={{ fontSize:18, fontWeight:700, color:C.emerald }}>
                    +{fmtPct(v.measurableAlpha - feeRate, 2)}% AUM/yr
                  </div>
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* ── TAB 1: WEALTH GAP ── */}
        {tab===1 && (
          <div>
            <Card style={{ marginBottom:11 }}>
              <Eyebrow>Wealth accumulation — with advisor vs. self-directed</Eyebrow>
              <p style={{ fontSize:11, color:C.textSoft, marginBottom:11, lineHeight:1.6 }}>
                With advisor: {fmtPct(v.advNetR*100,1)}% net
                ({fmtPct(grossReturn,1)}% gross − {fmtPct(feeRate,2)}% fee + 2.5% behavioral + 0.45% tax).
                Self-directed: {fmtPct(v.selfNetR*100,1)}% net
                ({fmtPct(grossReturn,1)}% gross − 3.7% Dalbar behavioral drag). Fee applied to growing AUM each year.
              </p>
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={v.yearRows}>
                  <defs>
                    <linearGradient id="gA" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={C.emerald} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={C.emerald} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gS" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={C.muted} stopOpacity={0.15} />
                      <stop offset="95%" stopColor={C.muted} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
                  <XAxis dataKey="year" tick={{ fill:C.textSoft, fontSize:10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill:C.textSoft, fontSize:10 }} axisLine={false}
                    tickLine={false} tickFormatter={n=>fmt(n)} />
                  <Tooltip content={<TTip />} />
                  <Area dataKey="withAdvisor" name="With Advisor" type="monotone"
                    stroke={C.emerald} strokeWidth={2.5} fill="url(#gA)" />
                  <Area dataKey="selfDirected" name="Self-Directed" type="monotone"
                    stroke={C.muted} strokeWidth={1.5} fill="url(#gS)" strokeDasharray="5 3" />
                </AreaChart>
              </ResponsiveContainer>
            </Card>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:9, marginBottom:9 }}>
              {[
                { label:"With advisor (final)", val:fmt(v.finalAdv), accent:C.emerald },
                { label:"Self-directed (final)", val:fmt(v.finalSelf), accent:C.muted },
                { label:`Wealth gap Y${horizon}`, val:fmt(finalGap), accent:C.gold },
              ].map((s,i)=>(
                <Card key={i} style={{ textAlign:"center" }}>
                  <div style={{ fontSize:9, color:C.textSoft, marginBottom:4 }}>{s.label}</div>
                  <div style={{ fontSize:20, fontWeight:800, color:s.accent,
                    fontVariantNumeric:"tabular-nums" }}>{s.val}</div>
                </Card>
              ))}
            </div>
            <Card>
              <Eyebrow color={C.textSoft}>The fee is visible. The drag is not.</Eyebrow>
              <p style={{ fontSize:12, color:C.textSoft, lineHeight:1.75, margin:0 }}>
                The {fmtPct(feeRate,2)}% fee shows up on every statement and grows as AUM grows —
                total fees paid over {horizon} years: <strong style={{ color:C.white }}>{fmt(v.totalFeesPaid)}</strong>.
                But the 3.7% Dalbar behavioral drag, tax inefficiency, and missed planning opportunities of
                self-direction are invisible — they compound quietly. Net advisor advantage:{" "}
                <strong style={{ color:C.emerald }}>+{fmtPct(v.measurableAlpha-feeRate,2)}% per year</strong> before estate and exit benefits.
              </p>
            </Card>
          </div>
        )}

        {/* ── TAB 2: FEE GROWTH ── */}
        {tab===2 && (
          <div>
            <Card style={{ marginBottom:11 }}>
              <Eyebrow>Annual advisory fee over time — grows with AUM at {fmtPct(feeRate,2)}%</Eyebrow>
              <p style={{ fontSize:11, color:C.textSoft, marginBottom:11, lineHeight:1.6 }}>
                The fee rate stays constant at {fmtPct(feeRate,2)}%, but the dollar amount grows as the portfolio grows.
                This chart shows what you pay each year and what the portfolio is worth.
              </p>
              <ResponsiveContainer width="100%" height={230}>
                <LineChart data={feeGrowthData}>
                  <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
                  <XAxis dataKey="year" tick={{ fill:C.textSoft, fontSize:10 }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="fee" tick={{ fill:C.gold, fontSize:10 }} axisLine={false}
                    tickLine={false} tickFormatter={n=>fmt(n)} />
                  <YAxis yAxisId="port" orientation="right" tick={{ fill:C.emerald, fontSize:10 }}
                    axisLine={false} tickLine={false} tickFormatter={n=>fmt(n)} />
                  <Tooltip content={<TTip />} />
                  <Line yAxisId="fee" dataKey="annualFee" name="Annual Fee ($)"
                    stroke={C.gold} strokeWidth={2.5} dot={false} />
                  <Line yAxisId="port" dataKey="portfolioValue" name="Portfolio Value"
                    stroke={C.emerald} strokeWidth={2} dot={false} strokeDasharray="4 2" />
                </LineChart>
              </ResponsiveContainer>
            </Card>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:9, marginBottom:9 }}>
              {[
                { label:"Year 1 fee", val:fmt(yr1Fee), sub:`${fmtPct(feeRate,2)}% of ${fmt(aum)}`, accent:C.gold },
                { label:`Year ${horizon} fee`, val:fmt(finalFee), sub:`${fmtPct(feeRate,2)}% of larger AUM`, accent:C.gold },
                { label:`Total fees paid (${horizon} yrs)`, val:fmt(v.totalFeesPaid), sub:"Grows with portfolio", accent:C.white },
              ].map((s,i)=>(
                <Card key={i} style={{ textAlign:"center" }}>
                  <div style={{ fontSize:9, color:C.textSoft, marginBottom:3 }}>{s.label}</div>
                  <div style={{ fontSize:18, fontWeight:800, color:s.accent,
                    fontVariantNumeric:"tabular-nums" }}>{s.val}</div>
                  <div style={{ fontSize:9, color:C.textSoft, marginTop:2 }}>{s.sub}</div>
                </Card>
              ))}
            </div>
            <Card>
              <Eyebrow color={C.textSoft}>Why this matters for the ROI calculation</Eyebrow>
              <p style={{ fontSize:12, color:C.textSoft, lineHeight:1.75, margin:0 }}>
                A flat-fee model would understate what you pay over time. This tool models total fees paid as
                {" "}<strong style={{ color:C.white }}>{fmt(v.totalFeesPaid)}</strong> over {horizon} years —
                not just Year 1 fee × {horizon}. The {Math.round(v.roi)}× ROI multiple is calculated against
                that honest, compounding fee total. Even with growing fees, the value generated is dramatically higher.
              </p>
            </Card>
          </div>
        )}

        {/* ── TAB 3: ESTATE IMPACT ── */}
        {tab===3 && (
          <div>
            <Card style={{ marginBottom:11 }}>
              <Eyebrow>Estate tax exposure — with and without planning</Eyebrow>
              <p style={{ fontSize:11, color:C.textSoft, marginBottom:11, lineHeight:1.6 }}>
                Projected estate: {fmt(estateSize)}. Federal exemption sunsets to ~$7M in 2026. NY state cliff tax
                exposes the entire estate above $7.16M — not just the excess.
              </p>
              <ResponsiveContainer width="100%" height={210}>
                <BarChart data={[
                  { scenario:"Without planning", tax:Math.round(v.estateWithout),
                    keep:Math.round(Math.max(0,estateSize-v.estateWithout)) },
                  { scenario:"With planning",    tax:Math.round(v.estateWith),
                    keep:Math.round(Math.max(0,estateSize-v.estateWith)) },
                ]} barCategoryGap="40%">
                  <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
                  <XAxis dataKey="scenario" tick={{ fill:C.textSoft, fontSize:11 }}
                    axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill:C.textSoft, fontSize:10 }} axisLine={false}
                    tickLine={false} tickFormatter={n=>fmt(n)} />
                  <Tooltip content={<TTip />} />
                  <Bar dataKey="tax"  name="Estate taxes owed" radius={[4,4,0,0]} fill={C.red} />
                  <Bar dataKey="keep" name="Heirs receive"     radius={[4,4,0,0]} fill={C.emerald} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:9, marginBottom:9 }}>
              {[
                { label:"Without planning", val:fmt(v.estateWithout), accent:C.red },
                { label:"With planning",    val:fmt(v.estateWith),    accent:C.emerald },
                { label:"Preserved",        val:fmt(v.estateSaved),   accent:C.gold },
              ].map((s,i)=>(
                <Card key={i} style={{ textAlign:"center" }}>
                  <div style={{ fontSize:9, color:C.textSoft, marginBottom:4 }}>{s.label}</div>
                  <div style={{ fontSize:18, fontWeight:800, color:s.accent,
                    fontVariantNumeric:"tabular-nums" }}>{s.val}</div>
                </Card>
              ))}
            </div>
            <Card>
              <Eyebrow color={C.textSoft}>Estate savings vs. cumulative fees</Eyebrow>
              <p style={{ fontSize:12, color:C.textSoft, lineHeight:1.75, margin:0 }}>
                Estate planning preserves {fmt(v.estateSaved)} for {clientLabel}'s heirs.
                Over {horizon} years, total fees paid (growing with AUM) come to {fmt(v.totalFeesPaid)}.
                The estate benefit alone is{" "}
                <strong style={{ color:C.gold }}>
                  {fmtPct((v.estateSaved/v.totalFeesPaid)*100,0)}% of total cumulative fees
                </strong>{" "}
                — and grows as the estate does.
              </p>
            </Card>
          </div>
        )}

        {/* ── TAB 4: ROI BREAKDOWN ── */}
        {tab===4 && (
          <div>
            <Card style={{ marginBottom:11 }}>
              <Eyebrow>Value generated per benefit — {horizon}-year total (vs. {fmt(v.totalFeesPaid)} in cumulative fees)</Eyebrow>
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={roiBarData} layout="vertical" barCategoryGap="25%">
                  <CartesianGrid stroke={C.border} strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fill:C.textSoft, fontSize:10 }}
                    axisLine={false} tickLine={false} tickFormatter={n=>fmt(n)} />
                  <YAxis type="category" dataKey="label" width={128}
                    tick={{ fill:C.textSoft, fontSize:10 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<TTip />} />
                  <Bar dataKey="value" name="Value generated" radius={[0,5,5,0]}>
                    {roiBarData.map((e,i)=><Cell key={i} fill={e.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:11 }}>
              <Card style={{ borderColor:`${C.gold}44` }}>
                <Eyebrow color={C.gold}>The {fmtPct(feeRate,2)}% in perspective</Eyebrow>
                <div style={{ fontSize:12, color:C.textSoft, lineHeight:1.9 }}>
                  {[
                    [`Year 1 fee (${fmtPct(feeRate,2)}% of ${fmt(aum)})`, fmt(yr1Fee), C.white],
                    [`Year ${horizon} fee (${fmtPct(feeRate,2)}% of larger AUM)`, fmt(finalFee), C.white],
                    [`Total fees paid (${horizon} yrs)`, fmt(v.totalFeesPaid), C.white],
                    [`Tax-loss harvest (${horizon} yrs)`, fmt(v.totalTLH), C.emerald],
                    [`Behavioral alpha (${horizon} yrs)`, fmt(v.totalBehav), C.blue],
                    [`Total value vs. fees`, `${Math.round(v.roi)}× ROI`, C.gold],
                  ].map(([l,val,col],i,arr)=>(
                    <div key={i} style={{ display:"flex", justifyContent:"space-between",
                      padding:"6px 0", borderBottom:i<arr.length-1?`1px solid ${C.border}`:"none" }}>
                      <span>{l}</span>
                      <span style={{ color:col, fontWeight:600 }}>{val}</span>
                    </div>
                  ))}
                </div>
              </Card>
              <Card>
                <Eyebrow color={C.textSoft}>What {fmtPct(feeRate,2)}% actually buys</Eyebrow>
                <p style={{ fontSize:12, color:C.textSoft, lineHeight:1.8, margin:0 }}>
                  The fee starts at {fmt(yr1Fee)}/yr and grows to {fmt(finalFee)}/yr by Year {horizon}
                  as the portfolio grows — total {fmt(v.totalFeesPaid)} paid over {horizon} years.
                  Against that honest fee total, the quantifiable value generated is{" "}
                  <strong style={{ color:C.gold }}>{Math.round(v.roi)}×</strong> every dollar paid.
                  <br /><br />
                  Measurable annual alpha vs. self-directed:{" "}
                  <strong style={{ color:C.emerald }}>+{fmtPct(v.measurableAlpha-feeRate,2)}% AUM/yr</strong>{" "}
                  — net of the fee, before estate and exit benefits.
                </p>
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
