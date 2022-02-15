const hre = require("hardhat");

async function main() {
    console.log("Deploying on Rinkeby");

    const daiPoolAddress = "0x6033Ed27652E1157D792A99CC77D3F6893B72fce";
    const wethAddress = "0xc778417E063141139Fce010982780140Aa0cD5Ab";
    const daiAddress = "0x5592EC0cfb4dbc12D3aB100b257153436a1f0FEa";
    const spacing = 60;
/* 
    const Explorer = await hre.ethers.getContractFactory("UniswapV3Explorer");
    const explorer = await Explorer.deploy(
        daiPoolAddress,
        daiAddress,
        wethAddress,
        spacing,
        {gasLimit: 8000000}  
    );
    await explorer.deployed();
    
    console.log("UniswapV3Explorer deployed to:", explorer.address); 
 */
    await hre.run("verify:verify", {
        address: "0x2CD58F1455810E374Df86dc25bb9e6878BD49B68",
        constructorArguments: [
            daiPoolAddress,
            daiAddress,
            wethAddress,
            spacing
        ]
    });

    console.log("UniswapV3Explorer has been verified");
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
