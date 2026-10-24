# Revert reasons cannot be decoded: node refuses historical eth_call

Severity: major
Area: SDK

## Steps to reproduce
1. Send any tx through the SDK that reverts on chain (here: `claimPerpVoucher` from the bot account, 5 STT gas on Hideki).
2. The SDK tries to explain the revert by replaying the call at the parent block.

## Expected
A decoded revert reason (error name), as the docs suggest:
"A transaction that runs out of gas or reverts lands with status 0 and no reason in the receipt.
Replay it with eth_call at the parent block to see the revert."

## Actual
```
ContractRevertError: claim reverted: rpc eth_call failed: RPC Request failed.
  Request body: {"method":"eth_call","params":[{...,"data":"0x4e71d92d"},"0x1e2eaa0"]}
  Details: unable to load historical state  (code -1)
```
The public Hideki node does not serve historical state, so the SDK's revert decoding
(and the documented debugging method) cannot work. Every on-chain revert surfaces with no reason.

Workaround: simulate at `latest` before sending (see `diag_voucher.mjs`, `order_for.mjs`).

## Evidence
Stack trace from `node first_order.mjs --send`; bot `0x26421030A92Bb1e96C6E0137b004AA583b463388` nonce 1 (the reverted claim).

## Environment
@somnia-chain/markets-sdk 0.32.1, viem 2.57.10, Node 22, RPC wss://api.hideki2.infra.testnet.somnia.network/ws
