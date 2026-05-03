/**
 * Generates config.yaml from networks.json (single source of truth).
 * Run from indexer/: node scripts/build-config.mjs > config.yaml
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const networks = JSON.parse(fs.readFileSync(path.join(root, "networks.json"), "utf8"));

const CHAIN_IDS = {
  gnosis: 100,
  mainnet: 1,
  optimism: 10,
  base: 8453,
  sepolia: 11155111,
};

const ZERO = "0x0000000000000000000000000000000000000000".toLowerCase();

const RPC = {
  100: "https://rpc.gnosischain.com",
  1: "https://eth.llamarpc.com",
  10: "https://mainnet.optimism.io",
  8453: "https://mainnet.base.org",
  11155111: "https://rpc.sepolia.org",
};

const marketFactoryEvents = [
  {
    event:
      "NewMarket(address indexed market, string marketName, address parentMarket, bytes32 conditionId, bytes32 questionId, bytes32[] questionsIds)",
    field_selection: { transaction_fields: ["hash", "from"] },
  },
];

const conditionalEvents = [
  {
    event:
      "PositionSplit(address indexed stakeholder, address collateralToken, bytes32 indexed parentCollectionId, bytes32 indexed conditionId, uint256[] partition, uint256 amount)",
    field_selection: { transaction_fields: ["hash", "from", "input"] },
  },
  {
    event:
      "PositionsMerge(address indexed stakeholder, address collateralToken, bytes32 indexed parentCollectionId, bytes32 indexed conditionId, uint256[] partition, uint256 amount)",
    field_selection: { transaction_fields: ["hash", "from", "input"] },
  },
  {
    event:
      "PayoutRedemption(address indexed redeemer, address indexed collateralToken, bytes32 indexed parentCollectionId, bytes32 conditionId, uint256[] indexSets, uint256 payout)",
    field_selection: { transaction_fields: ["hash", "from", "input"] },
  },
  {
    event:
      "ConditionResolution(bytes32 indexed conditionId, address indexed oracle, bytes32 indexed questionId, uint256 outcomeSlotCount, uint256[] payoutNumerators)",
  },
];

const realityEvents = [
  {
    event:
      "LogNewAnswer(bytes32 answer, bytes32 indexed question_id, bytes32 history_hash, address indexed user, uint256 bond, uint256 ts, bool is_commitment)",
  },
  { event: "LogFinalize(bytes32 indexed question_id, bytes32 indexed answer)" },
  {
    event:
      "LogNotifyOfArbitrationRequest(bytes32 indexed question_id, address indexed requester)",
  },
  { event: "LogReopenQuestion(bytes32 indexed question_id, bytes32 indexed reopened_question_id)" },
  { event: "LogCancelArbitration(bytes32 indexed question_id)" },
];

const futarchyEvents = [
  {
    event:
      "NewProposal(address indexed proposal, string marketName, bytes32 conditionId, bytes32 questionId)",
    field_selection: { transaction_fields: ["hash", "from"] },
  },
];

const metaEvidenceEvents = [{ event: "MetaEvidence(uint256 indexed _metaEvidenceID, string _evidence)" }];

function isZero(addr) {
  return !addr || addr.toLowerCase() === ZERO;
}

function minStartBlock(net) {
  let m = Infinity;
  for (const k of Object.keys(net)) {
    const { address, startBlock } = net[k];
    if (isZero(address)) continue;
    m = Math.min(m, startBlock);
  }
  return m === Infinity ? 0 : m;
}

function addrList(net, key) {
  const v = net[key];
  if (!v || isZero(v.address)) return null;
  return v.address.toLowerCase();
}

function yamlStr(s) {
  return JSON.stringify(s);
}

const globalContracts = [
  {
    name: "MarketFactory",
    abi_file_path: "./abis/MarketFactory.json",
    handler: "./src/EventHandlers.ts",
    events: marketFactoryEvents,
  },
  {
    name: "FutarchyFactory",
    abi_file_path: "./abis/FutarchyFactory.json",
    handler: "./src/EventHandlers.ts",
    events: futarchyEvents,
  },
  {
    name: "Reality",
    abi_file_path: "./abis/Realitiy.json",
    handler: "./src/EventHandlers.ts",
    events: realityEvents,
  },
  {
    name: "ConditionalTokens",
    abi_file_path: "./abis/ConditionalTokens.json",
    handler: "./src/EventHandlers.ts",
    events: conditionalEvents,
  },
  {
    name: "CurateIEvidence",
    abi_file_path: "./abis/IEvidence.json",
    handler: "./src/EventHandlers.ts",
    events: metaEvidenceEvents,
  },
  {
    name: "ArbitratorIEvidence",
    abi_file_path: "./abis/IEvidence.json",
    handler: "./src/EventHandlers.ts",
    events: metaEvidenceEvents,
  },
];

function emitGlobalContracts() {
  let y = "";
  for (const c of globalContracts) {
    y += `  - name: ${c.name}\n`;
    y += `    abi_file_path: ${c.abi_file_path}\n`;
    y += `    handler: ${c.handler}\n`;
    y += `    events:\n`;
    for (const ev of c.events) {
      y += `      - event: ${ev.event}\n`;
      if (ev.field_selection) {
        y += `        field_selection:\n`;
        if (ev.field_selection.transaction_fields) {
          y += `          transaction_fields:\n`;
          for (const f of ev.field_selection.transaction_fields) y += `            - ${f}\n`;
        }
      }
    }
  }
  return y;
}

function networkContracts(net) {
  const out = [];
  const mf = [];
  if (!isZero(net.MarketFactory?.address)) mf.push(net.MarketFactory.address.toLowerCase());
  if (!isZero(net.MarketFactoryFast?.address)) mf.push(net.MarketFactoryFast.address.toLowerCase());
  if (mf.length) {
    const sbMf = Math.min(
      isZero(net.MarketFactory?.address) ? Infinity : net.MarketFactory.startBlock,
      isZero(net.MarketFactoryFast?.address) ? Infinity : net.MarketFactoryFast.startBlock
    );
    out.push({
      name: "MarketFactory",
      address: mf.length === 1 ? mf[0] : mf,
      start_block: Number.isFinite(sbMf) ? sbMf : undefined,
    });
  }
  const ff = addrList(net, "FutarchyFactory");
  if (ff)
    out.push({
      name: "FutarchyFactory",
      address: ff,
      start_block: net.FutarchyFactory.startBlock,
    });
  const r = addrList(net, "Reality");
  if (r)
    out.push({
      name: "Reality",
      address: r,
      start_block: net.Reality.startBlock,
    });
  const ct = addrList(net, "ConditionalTokens");
  if (ct)
    out.push({
      name: "ConditionalTokens",
      address: ct,
      start_block: net.ConditionalTokens.startBlock,
    });
  const cur = addrList(net, "LightGeneralizedTCR");
  if (cur)
    out.push({
      name: "CurateIEvidence",
      address: cur,
      start_block: net.LightGeneralizedTCR.startBlock,
    });
  const arb = [];
  if (!isZero(net.Realitio_v2_1_ArbitratorWithAppeals?.address))
    arb.push(net.Realitio_v2_1_ArbitratorWithAppeals.address.toLowerCase());
  if (!isZero(net.RealitioForeignArbitrationProxyWithAppeals?.address))
    arb.push(net.RealitioForeignArbitrationProxyWithAppeals.address.toLowerCase());
  if (!isZero(net.RealitioForeignProxyOptimism?.address))
    arb.push(net.RealitioForeignProxyOptimism.address.toLowerCase());
  if (arb.length) {
    const sbArb = Math.min(
      ...arb.map((a) => {
        if (a === net.Realitio_v2_1_ArbitratorWithAppeals?.address?.toLowerCase())
          return net.Realitio_v2_1_ArbitratorWithAppeals.startBlock;
        if (a === net.RealitioForeignArbitrationProxyWithAppeals?.address?.toLowerCase())
          return net.RealitioForeignArbitrationProxyWithAppeals.startBlock;
        return net.RealitioForeignProxyOptimism.startBlock;
      })
    );
    out.push({
      name: "ArbitratorIEvidence",
      address: arb.length === 1 ? arb[0] : arb,
      start_block: sbArb,
    });
  }
  return out;
}

let header = `# yaml-language-server: $schema=./node_modules/envio/evm.schema.json
# Generated by scripts/build-config.mjs — do not edit by hand; run: node scripts/build-config.mjs > config.yaml
name: seer-pm-indexer
description: Seer PM markets indexer (HyperIndex)
unordered_multichain_mode: true
preload_handlers: false
address_format: lowercase

contracts:
`;

header += emitGlobalContracts();
header += "\nnetworks:\n";

for (const [chainName, net] of Object.entries(networks)) {
  const id = CHAIN_IDS[chainName];
  if (!id) continue;
  const contracts = networkContracts(net);
  if (!contracts.length) continue;
  const sb = minStartBlock(net);
  header += `  - id: ${id}\n`;
  header += `    start_block: ${sb}\n`;
  if (RPC[id]) {
    header += `    rpc_config:\n`;
    header += `      url: ${yamlStr(RPC[id])}\n`;
  }
  header += `    contracts:\n`;
  for (const c of contracts) {
    header += `      - name: ${c.name}\n`;
    if (Array.isArray(c.address)) {
      header += `        address:\n`;
      for (const a of c.address) header += `          - ${a}\n`;
    } else {
      header += `        address: ${c.address}\n`;
    }
    if (c.start_block != null && c.start_block !== sb) {
      header += `        start_block: ${c.start_block}\n`;
    }
  }
}

process.stdout.write(header);
