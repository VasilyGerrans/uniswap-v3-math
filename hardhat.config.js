require("dotenv").config();
require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-etherscan");
require("hardhat-gas-reporter");

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  networks: {
    hardhat: {
      forking: {
        url: process.env.ETH_RPC_URL,
      }
    },
    local: {
			url: 'http://127.0.0.1:8545'
    },
    rinkeby: {
      chainId: 4,
      url: process.env.RINKEBY_RPC_URL,
      gasPrice: 30000000001,
      gas: 8000000,
      accounts: [ process.env.RINKEBY_PRIVATE_KEY ]
    },
    polygon: {
      chainId: 137,
      url: process.env.POLYGON_RPC_URL,
      gasPrice: 30000000000,
      gas: 500000,
      accounts: [ process.env.POLYGON_PRIVATE_KEY ]
    }
  },
  etherscan: {
    apiKey: process.env.API_KEY
  },
  solidity: {
    version:  "0.8.11",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
        details: {
          yul: false,
        }
      }
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
  },
};
