// Position Guard - watches the owner wallet's perp positions and protects them.
//
// A linked bot cannot arm exchange-side TP/SL (only the wallet itself can), so the
// guard watches prices and closes positions itself via placeOrderFor:
//
//   1. Account health  : equity / maintenance margin < GUARD_MIN_HEALTH
//                        -> reduce the largest position by GUARD_REDUCE_FRACTION
//   2. Stop-loss       : adverse move from entry >= GUARD_SL_PCT %  -> close position
//   3. Take-profit     : favourable move from entry >= GUARD_TP_PCT % -> close position
//
// Every close is an IOC (market) order on the opposite side, sized <= the position,
// priced through the book with GUARD_SLIPPAGE_PCT, simulated before it is sent.
//
// Usage: node guard.mjs            (dry run: logs + notifies what it WOULD do)
//        node guard.mjs --live     (actually sends the closing orders)
//        node guard.mjs --once     (one check, then exit)

import { readFileSync, appendFileSync } from "fs"
import { createPublicClient, createWalletClient, http, formatUnits, parseEventLogs, decodeErrorResult } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import {
  SOMNIA_HIDEKI_TESTNET_ADDRESSES, SomniaMarkets, contractErrorsAbi, orderBookEventsAbi, perpPoolEventsAbi,
} from "@somnia-chain/markets-sdk"
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains"

// ---------- config ----------
const env = Object.fromEntries(
  readFileSync(new URL(".env", import.meta.url), "utf8")
    .split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
)
const cfg = (k, d) => process.env[k] ?? env[k] ?? d
const LIVE = process.argv.includes("--live")
const ONCE = process.argv.includes("--once")
const OWNER = cfg("OWNER_ADDRESS")
const SL_PCT = Number(cfg("GUARD_SL_PCT", "0"))            // 0 = off
const TP_PCT = Number(cfg("GUARD_TP_PCT", "0"))            // 0 = off
const MIN_HEALTH = Number(cfg("GUARD_MIN_HEALTH", "1.5"))  // equity / maintenance margin
const REDUCE_FRACTION = Number(cfg("GUARD_REDUCE_FRACTION", "0.5"))
const SLIPPAGE_PCT = Number(cfg("GUARD_SLIPPAGE_PCT", "0.5"))
const INTERVAL_SEC = Number(cfg("GUARD_INTERVAL_SEC", "15"))
const COOLDOWN_SEC = Number(cfg("GUARD_COOLDOWN_SEC", "60"))
const DISCORD = cfg("DISCORD_WEBHOOK_URL", "")
const TG_TOKEN = cfg("TELEGRAM_BOT_TOKEN", "")
const TG_CHAT = cfg("TELEGRAM_CHAT_ID", "")
const RPC = "https://api.hideki2.infra.testnet.somnia.network"
const EXPLORER = "https://explorer.testnet.somnia.network/tokyo"
const LOG_FILE = new URL("guard.log", import.meta.url)
if (!env.PRIVATE_KEY || !OWNER) throw new Error("PRIVATE_KEY / OWNER_ADDRESS missing in .env")

// ---------- clients ----------
const account = privateKeyToAccount(env.PRIVATE_KEY)
const pub = createPublicClient({ chain: hidekiTestnet, transport: http(RPC) })
const wallet = createWalletClient({ chain: hidekiTestnet, transport: http(RPC), account })
const markets = new SomniaMarkets({
  chain: hidekiTestnet,
  indexerUrl: "https://hideki-dev.smk.somnia.host/v1/graphql",
  addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES,
})
const placeOrderForAbi = [{
  type: "function", name: "placeOrderFor", stateMutability: "payable",
  inputs: [
    { name: "owner", type: "address" }, { name: "isBid", type: "bool" }, { name: "userData", type: "uint64" },
    { name: "price", type: "uint256" }, { name: "quantity", type: "uint256" },
    { name: "expireTimestampNs", type: "uint64" }, { name: "orderType", type: "uint8" },
    { name: "selfMatchingOption", type: "uint8" }, { name: "builder", type: "address" },
    { name: "builderFeeBpsTimes1k", type: "uint96" },
  ],
  outputs: [{ name: "success", type: "bool" }, { name: "orderId", type: "uint128" }],
}]

// ---------- helpers ----------
const ZERO = "0x0000000000000000000000000000000000000000"
const abs = (x) => (x < 0n ? -x : x)
const floorTo = (v, s) => (s > 0n ? (v / s) * s : v)
const ceilTo = (v, s) => (s > 0n ? ((v + s - 1n) / s) * s : v)
const num = (v, d) => Number(formatUnits(v, d))
const ts = () => new Date().toISOString().replace("T", " ").slice(0, 19)
const cooldown = new Map() // pool -> unix ms until which no new action

function log(msg) {
  const line = `[${ts()}] ${msg}`
  console.log(line)
  try { appendFileSync(LOG_FILE, line + "\n") } catch {}
}

async function notify(text) {
  const tag = LIVE ? "" : "[DRY RUN] "
  const body = `🛡️ Position Guard ${tag}\n${text}`
  const jobs = []
  if (DISCORD) jobs.push(fetch(DISCORD, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: body }) }))
  if (TG_TOKEN && TG_CHAT) jobs.push(fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: TG_CHAT, text: body }),
  }))
  const res = await Promise.allSettled(jobs)
  for (const r of res) if (r.status === "rejected") log(`notify failed: ${r.reason?.message || r.reason}`)
}

// Close (or reduce) a position with an opposite-side IOC order through placeOrderFor.
async function closePosition(m, pos, mark, fraction, reason) {
  const isLong = pos.size > 0n
  const lot = BigInt(m.lotSize ?? 0), tick = BigInt(m.tickSize ?? 0), minQ = BigInt(m.minQuantity ?? 0)
  let qty = floorTo((abs(pos.size) * BigInt(Math.round(fraction * 10_000))) / 10_000n, lot)
  if (qty < minQ || qty === 0n) qty = abs(pos.size) // too small to split: close all
  if (qty > abs(pos.size)) qty = abs(pos.size)
  const slip = BigInt(Math.round(SLIPPAGE_PCT * 100)) // bps
  // selling a long: willing to sell down to mark*(1-slip); buying back a short: up to mark*(1+slip)
  const price = isLong ? floorTo((mark * (10_000n - slip)) / 10_000n, tick) : ceilTo((mark * (10_000n + slip)) / 10_000n, tick)
  const isBid = !isLong
  const args = [OWNER, isBid, 0n, price, qty, BigInt(Date.now() + 60_000) * 1_000_000n, 2 /* IOC */, 0, ZERO, 0n]
  const desc = `${m.baseSymbol}-PERP ${isLong ? "SELL" : "BUY"} ${num(qty, m.baseDecimals)} @ <= ${num(price, m.quoteDecimals)} (${Math.round(fraction * 100)}% of position) - ${reason}`

  try {
    await pub.simulateContract({ address: m.poolAddress, abi: placeOrderForAbi, functionName: "placeOrderFor", args, account, gas: 10_000_000n })
  } catch (e) {
    const data = e?.walk?.((x) => typeof x?.data === "string")?.data
    let name = e.shortMessage
    try { if (data) name = decodeErrorResult({ abi: contractErrorsAbi, data }).errorName } catch { name = `unknown ${String(data).slice(0, 10)}` }
    log(`SIMULATION FAILED ${desc}: ${name}`)
    await notify(`⚠️ Could not close: ${desc}\nreason: ${name}`)
    return
  }

  cooldown.set(m.poolAddress, Date.now() + COOLDOWN_SEC * 1000)
  if (!LIVE) {
    log(`WOULD SEND ${desc}`)
    await notify(`Would close: ${desc}`)
    return
  }
  const hash = await wallet.writeContract({ address: m.poolAddress, abi: placeOrderForAbi, functionName: "placeOrderFor", args, gas: 10_000_000n })
  const rc = await pub.waitForTransactionReceipt({ hash })
  const evs = parseEventLogs({ abi: [...orderBookEventsAbi, ...perpPoolEventsAbi], logs: rc.logs }).map((e) => e.eventName)
  log(`SENT ${desc} tx=${hash} status=${rc.status} events=${evs.join(",")}`)
  await notify(`✅ Closed: ${desc}\nstatus: ${rc.status}\n${EXPLORER}/tx/${hash}`)
}

// ---------- one check ----------
let perps = []
async function check() {
  if (!perps.length) perps = await markets.client.listPerpMarkets()
  const bank = perps[0].marginBank
  const h = await markets.client.getAccountHealth(bank, OWNER)
  const ratio = h.mmReq > 0n ? Number((h.equity * 10_000n) / h.mmReq) / 10_000 : Infinity

  const positions = []
  for (const m of perps) {
    const ref = { marginBank: m.marginBank, account: OWNER, pool: m.poolAddress }
    const pos = await markets.client.getPerpPosition(ref)
    if (pos.size === 0n) continue
    const a = await markets.client.getPerpPositionAnalytics(ref)
    if (!a.priceable) { log(`${m.baseSymbol}: mark feed stale, skipped`); continue }
    positions.push({ m, pos, mark: a.markPrice, notional: a.notional })
  }

  const summary = positions.map(({ m, pos, mark }) => {
    const move = (num(mark, m.quoteDecimals) / num(pos.avgEntryPrice, m.quoteDecimals) - 1) * 100 * (pos.size > 0n ? 1 : -1)
    return `${m.baseSymbol} ${pos.size > 0n ? "L" : "S"} ${move >= 0 ? "+" : ""}${move.toFixed(3)}%`
  }).join(" | ")
  log(`health=${h.marginStatus} equity/MM=${ratio === Infinity ? "inf" : ratio.toFixed(2)}x  ${summary || "no positions"}`)

  const now = Date.now()
  const ready = positions.filter((p) => (cooldown.get(p.m.poolAddress) ?? 0) <= now)

  // 1. account health: reduce the biggest position
  if (ratio < MIN_HEALTH && ready.length) {
    const biggest = ready.reduce((a, b) => (b.notional > a.notional ? b : a))
    await closePosition(biggest.m, biggest.pos, biggest.mark, REDUCE_FRACTION, `account health ${ratio.toFixed(2)}x < ${MIN_HEALTH}x`)
    return
  }
  // 2/3. per-position stop-loss / take-profit (move measured in the position's favour)
  for (const { m, pos, mark } of ready) {
    const move = (num(mark, m.quoteDecimals) / num(pos.avgEntryPrice, m.quoteDecimals) - 1) * 100 * (pos.size > 0n ? 1 : -1)
    if (SL_PCT > 0 && move <= -SL_PCT) await closePosition(m, pos, mark, 1, `stop-loss ${move.toFixed(3)}% <= -${SL_PCT}%`)
    else if (TP_PCT > 0 && move >= TP_PCT) await closePosition(m, pos, mark, 1, `take-profit +${move.toFixed(3)}% >= ${TP_PCT}%`)
  }
}

// ---------- main loop ----------
log(`start: owner=${OWNER} bot=${account.address} mode=${LIVE ? "LIVE" : "DRY RUN"} SL=${SL_PCT || "off"}% TP=${TP_PCT || "off"}% minHealth=${MIN_HEALTH}x reduce=${REDUCE_FRACTION * 100}% every ${INTERVAL_SEC}s`)
await notify(`started (${LIVE ? "LIVE" : "dry run"}) - watching ${OWNER.slice(0, 6)}...${OWNER.slice(-4)}\nSL ${SL_PCT || "off"}% / TP ${TP_PCT || "off"}% / health < ${MIN_HEALTH}x -> reduce ${REDUCE_FRACTION * 100}%`)
for (;;) {
  try { await check() } catch (e) { log(`check error: ${e.shortMessage || e.message}`) }
  if (ONCE) process.exit(0)
  await new Promise((r) => setTimeout(r, INTERVAL_SEC * 1000))
}
