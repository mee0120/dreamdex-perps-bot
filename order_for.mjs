// Place a perp order for Wallet 1 (OWNER_ADDRESS) from the linked bot key.
// Uses the pool's placeOrderFor (operator path set up by "Link a bot").
//
// Default: a resting LIMIT BUY on BTC-PERP ~10% below mark at min size (won't fill).
//
// Usage: node order_for.mjs          (dry run: simulates, sends nothing)
//        node order_for.mjs --send   (sends the transaction)
// Options via env: SYMBOL=ETH  DISCOUNT=0.9

import { readFileSync } from "fs"
import { createPublicClient, createWalletClient, http, formatUnits, parseEventLogs, decodeErrorResult } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import {
  SOMNIA_HIDEKI_TESTNET_ADDRESSES, SomniaMarkets, contractErrorsAbi, orderBookEventsAbi, perpPoolEventsAbi,
} from "@somnia-chain/markets-sdk"
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains"

const SEND = process.argv.includes("--send")
const SYMBOL = process.env.SYMBOL || "BTC"
const DISCOUNT = Number(process.env.DISCOUNT || "0.9")
const RPC = "https://api.hideki2.infra.testnet.somnia.network"
const EXPLORER = "https://explorer.testnet.somnia.network/tokyo"

const env = Object.fromEntries(
  readFileSync(new URL(".env", import.meta.url), "utf8")
    .split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
)
if (!env.PRIVATE_KEY || !env.OWNER_ADDRESS) throw new Error("PRIVATE_KEY / OWNER_ADDRESS missing in .env")

const json = (v) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2)
const big = (x) => (x === null || x === undefined ? null : BigInt(x))
const floorTo = (v, s) => (s > 0n ? (v / s) * s : v)
const ceilTo = (v, s) => (s > 0n ? ((v + s - 1n) / s) * s : v)

// placeOrderFor signature from the dreamDEX developer docs (Perps on Testnet > Raw and operator calls)
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

const account = privateKeyToAccount(env.PRIVATE_KEY)
const owner = env.OWNER_ADDRESS
const pub = createPublicClient({ chain: hidekiTestnet, transport: http(RPC) })
const wallet = createWalletClient({ chain: hidekiTestnet, transport: http(RPC), account })
const markets = new SomniaMarkets({
  chain: hidekiTestnet,
  indexerUrl: "https://hideki-dev.smk.somnia.host/v1/graphql",
  addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES,
})

console.log("bot  :", account.address, `(${formatUnits(await pub.getBalance({ address: account.address }), 18)} STT)`)
console.log("owner:", owner)

const m = (await markets.client.listPerpMarkets()).find((x) => x.baseSymbol === SYMBOL)
if (!m) throw new Error(`market ${SYMBOL} not found`)
// live mark from the chain - the market row's markPrice only advances at hourly funding settlement
const st = await markets.client.getPerpState(m.poolAddress)
if (!st.markPriceOk) throw new Error("mark feed stale - retry later")
const mark = st.markPrice
const price = floorTo((mark * BigInt(Math.round(DISCOUNT * 1000))) / 1000n, big(m.tickSize) ?? 0n)
const quantity = ceilTo(big(m.minQuantity) ?? 0n, big(m.lotSize) ?? 0n)
console.log(`${SYMBOL}-PERP pool=${m.poolAddress}`)
console.log(`mark=${formatUnits(mark, m.quoteDecimals)} limit=${formatUnits(price, m.quoteDecimals)} qty=${formatUnits(quantity, m.baseDecimals)} ${SYMBOL}`)

const max = await markets.client.getMaxPerpOrderSize({
  pool: m.poolAddress, marginBank: m.marginBank, account: owner, isBid: true, price,
})
console.log(`owner max order: placeable=${max.placeable} limitedBy=${max.limitedBy} maxQty=${formatUnits(big(max.maxQuantity), m.baseDecimals)}`)
if (!max.priceable) throw new Error("mark price stale - retry later")
if (!max.placeable || quantity > big(max.maxQuantity)) throw new Error(`owner cannot place this order: ${max.limitedBy}`)

const expireTimestampNs = BigInt(Date.now() + 365 * 24 * 3600 * 1000) * 1_000_000n // GTC-ish: 1 year
const args = [owner, true, 0n, price, quantity, expireTimestampNs, 0, 0, "0x0000000000000000000000000000000000000000", 0n]

// simulate first (at latest block) so a revert shows its reason
try {
  const sim = await pub.simulateContract({ address: m.poolAddress, abi: placeOrderForAbi, functionName: "placeOrderFor", args, account, gas: 10_000_000n })
  console.log("simulation OK -> returns", json(sim.result))
} catch (e) {
  const data = e?.walk?.((x) => typeof x?.data === "string")?.data
  let name = ""
  try { name = data ? decodeErrorResult({ abi: contractErrorsAbi, data }).errorName : "" } catch { name = `(unknown selector ${String(data).slice(0, 10)})` }
  console.log("simulation REVERTS:", name || e.shortMessage)
  process.exit(1)
}

if (!SEND) {
  console.log("\nDRY RUN - nothing sent. Re-run with --send.")
  process.exit(0)
}

const hash = await wallet.writeContract({ address: m.poolAddress, abi: placeOrderForAbi, functionName: "placeOrderFor", args, gas: 10_000_000n })
console.log("\ntx sent:", hash)
const rc = await pub.waitForTransactionReceipt({ hash })
console.log(`status=${rc.status} block=${rc.blockNumber} gasUsed=${rc.gasUsed}`)
const events = parseEventLogs({ abi: [...orderBookEventsAbi, ...perpPoolEventsAbi], logs: rc.logs })
for (const ev of events) console.log("event:", ev.eventName, json(ev.args))
console.log(`\nexplorer: ${EXPLORER}/tx/${hash}`)
process.exit(0)
