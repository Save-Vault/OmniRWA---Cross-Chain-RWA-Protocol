require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

// Override the source-path task to exclude node_modules/.
// The project keeps .sol files at the root of the contracts/ folder, which
// Hardhat would otherwise scan together with node_modules.
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS } = require("hardhat/builtin-tasks/task-names");

subtask(TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS).setAction(async (_, hre, runSuper) => {
  const paths = await runSuper();
  return paths.filter((p) => !p.includes("node_modules"));
});

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    hardhat: {
      chainId: 31337
    },
    localhost: {
      url: "http://127.0.0.1:8545"
    },
    // Chain A (Ethereum simulation)
    chainA: {
      url: "http://127.0.0.1:8545",
      chainId: 1
    },
    // Chain B (Avalanche simulation)
    chainB: {
      url: "http://127.0.0.1:8546",
      chainId: 43114
    }
  },
  paths: {
    sources: "./",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  }
};
