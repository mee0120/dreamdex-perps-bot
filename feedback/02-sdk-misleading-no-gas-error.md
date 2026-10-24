# SDK reports "account does not exist" as "claim reverted: Missing or invalid parameters"

Severity: normal
Area: SDK

## Steps to reproduce
1. New EOA with **0 STT on Hideki**.
2. `markets.trader.claimPerpVoucher({ marginBank })` (SDK 0.32.1).

## Expected
An error that says the sender has no gas / the account does not exist on this chain
(e.g. an InsufficientGas / AccountNotFound style error), not a contract revert.

## Actual
```
ContractRevertError: @somnia-chain/markets-sdk: claim reverted: Missing or invalid parameters.
Double check you have provided the correct parameters.
  functionName: 'claim', data: '0x02', address: 0x2ACD9EFdA721450906bfE1bef3edE269636E42C4
  [cause] InvalidInputRpcError ... Details: account does not exist (eth_sendRawTransaction, code -32000)
```
The real cause (`account does not exist` = no balance on this chain) is only visible deep in the cause chain.
The top-level message points the developer at their parameters and labels a tx that was never mined as "reverted".

## Evidence
Full stack trace from `node first_order.mjs --send` before the bot had STT on Hideki.

## Environment
@somnia-chain/markets-sdk 0.32.1, viem 2.57.10, Node 22, Ubuntu 24.04, RPC wss://api.hideki2.infra.testnet.somnia.network/ws
