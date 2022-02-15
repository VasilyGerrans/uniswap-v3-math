const { ethers } = require("hardhat");
const erc20_abi = require("../abi/erc20.json");
const pool_abi = require("../abi/pool.json");
const weth_abi = require("../abi/weth.json");
const router_abi = require("../abi/router.json");
const BN = require("bn.js");

function getSpacedTick(tick, spacing, roundUp) {
  return roundUp ?
    Math.ceil(tick / spacing) * spacing :
    Math.floor(tick / spacing) * spacing;
}

function getSwapThresholdPrice(currentSqrtPrice, zeroForOne, slippagePPM) {
  currentSqrtPrice = new BN(String(currentSqrtPrice));
  slippagePPM = new BN(String(slippagePPM));
  const denominator = new BN("1000000");
  return zeroForOne ? 
    currentSqrtPrice.mul(slippagePPM).div(denominator) : 
    currentSqrtPrice.mul(denominator.add(slippagePPM)).div(denominator) ;
}

function getOptimalQuantities(x_0, y_0, p_a, P, p_b) {
  x_0 = new BN(x_0.toString());
  y_0 = new BN(y_0.toString());
  p_a = new BN(p_a.toString());
  P = new BN(P.toString());
  p_b = new BN(p_b.toString());

  const Q96 = (new BN("2")).pow(new BN("192"));
  const mantissaScalar = new BN("1000000000000000000");
  const realPrice = P.mul(P).mul(mantissaScalar).div(Q96);

  const A = P.mul(p_b).mul(mantissaScalar).div(p_b.sub(P));
  const B = mantissaScalar.mul(Q96).div(P.sub(p_a));

  const x = realPrice.mul(x_0).add(y_0.mul(mantissaScalar)).mul(B).div(A.mul(mantissaScalar).add(realPrice.mul(B)));
  const y = realPrice.mul(x_0).add(y_0.mul(mantissaScalar)).mul(A).div(A.mul(mantissaScalar).add(realPrice.mul(B)));

  return {
    x: x, 
    y: y
  };
}

function getSwapAmount(x_0, y_0, x, y) {
  x_0 = new BN(x_0.toString());
  y_0 = new BN(y_0.toString());
  x = new BN(x.toString());
  y = new BN(y.toString());

  const zeroForOne = x_0.gt(x);
  const swapAmount = (zeroForOne ? x_0.sub(x) : y_0.sub(y));

  return {
    zeroForOne: zeroForOne,
    swapAmount: swapAmount
  }
}

describe("math", () => {
  let 
  deployer, 
  pool, 
  dai, 
  weth, 
  router,
  explorer,
  signers;

  const dai_pool = "0xC2e9F25Be6257c210d7Adf0D4Cd6E3E881ba25f8";
  const dai_address = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
  const usdc_pool = "0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8";
  const usdc_address = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

  // Mainnet Addresses
  const pool_address = usdc_pool;
  const token_address = usdc_address;
  const fee = 3000;
  const weth_address = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  const router_address = "0xE592427A0AEce92De3Edee1F18E0157C05861564";

  const SPACING = 60;

  before(async () => {
    signers = await ethers.getSigners();
    deployer = signers[10];
    
    pool = new ethers.Contract(pool_address, pool_abi, ethers.provider);
    dai = new ethers.Contract(token_address, erc20_abi, ethers.provider);
    weth = new ethers.Contract(weth_address, weth_abi, ethers.provider);
    router = new ethers.Contract(router_address, router_abi, ethers.provider);

    explorer = await (await ethers.getContractFactory("UniswapV3Explorer"))
      .connect(deployer)
      .deploy(pool_address, token_address, weth_address, SPACING);
    await explorer.deployed();

    for(let i = 0; i < signers.length; i++) {
      const owner = signers[i];
      if (owner != deployer) {
        await owner.sendTransaction({
          to: deployer.address,
          value: ethers.utils.parseEther("1000"),
        });
      } 
    }

    await weth.connect(deployer).deposit({value: ethers.utils.parseEther("20000")});
  });

  it("deposits", async () => {
    await dai.connect(deployer).approve(explorer.address, ethers.constants.MaxUint256);
    await weth.connect(deployer).approve(explorer.address, ethers.constants.MaxUint256);

    const x_0 = await dai.balanceOf(deployer.address);
    const y_0 = await weth.balanceOf(deployer.address);
    
    const slot0 = await pool.slot0();
    
    const TICK = (await slot0.tick).toString();
    const LOWER = getSpacedTick(Number(TICK), SPACING, false);
    const UPPER = getSpacedTick(Number(TICK), SPACING, true);

    console.log("Ticks:",
      "\n", LOWER.toString(),
      "\n", TICK.toString(),
      "\n", UPPER.toString()
    );
    
    const p_a = await explorer.getSqrtRatioAtTick(LOWER);
    const P = slot0.sqrtPriceX96;
    const p_b = await explorer.getSqrtRatioAtTick(UPPER);

    console.log("Sqrt prices:",
      "\n", p_a.toString(),
      "\n", P.toString(),
      "\n", p_b.toString()
    );

    const { x, y } = getOptimalQuantities(x_0, y_0, p_a, P, p_b);

    console.log("Initial token supplies:",
      "\nX:", x_0.toString(), 
      "\nY:", y_0.toString()
    );
    console.log("Optimal token supplies:",
      "\nX:", x.toString(), 
      "\nY:", y.toString()
    );

    const { zeroForOne, swapAmount } = getSwapAmount(x_0, y_0, x, y);

    console.log(
      "swapping X for Y:", zeroForOne, 
      "\nswapAmount:", swapAmount.toString()
    );

    const sqrtPriceLimit = getSwapThresholdPrice(P, zeroForOne, 50000); // allow price to slip 5% max

    await explorer.connect(deployer).deposit(
      x_0.toString(),
      y_0.toString(),
      zeroForOne,
      swapAmount.toString(),
      sqrtPriceLimit.toString(),
      LOWER,
      UPPER,
      {
        gasLimit: "1000000"
      }
    );

    const x_fin = new BN((await dai.balanceOf(deployer.address)).toString());
    const y_fin = new BN((await weth.balanceOf(deployer.address)).toString());

    console.log("Final token supplies:",
      "\nX:", x_fin.toString(), 
      "\nY:", y_fin.toString()
    );

    const liquidity = await explorer.getLiquidity();
    console.log("Liquidity:", liquidity.toString());
  });

  it("process swaps", async () => {
    for(var i = 0; i < 3; i++) {
      const signer = signers[i];
      await weth.connect(signer).deposit({value: ethers.utils.parseEther("10")});
      await weth.connect(signer).approve(router_address, ethers.utils.parseEther("10"));
      await router.connect(signer).exactInputSingle([
        weth_address, token_address, fee, deployer.address, Date.now() + 120, ethers.utils.parseEther("10"), "0", "0"
      ]); 
    }
  });

  it("exits", async () => {
    const slot0 = await pool.slot0();
    const P = new BN(slot0.sqrtPriceX96.toString());

    const swapThresholdPrice = getSwapThresholdPrice(
      P.toString(),
      false,
      50000
    ).toString();

    await explorer.exit(false, swapThresholdPrice);

    const x_fin = new BN((await dai.balanceOf(deployer.address)).toString());
    const y_fin = new BN((await weth.balanceOf(deployer.address)).toString());
    console.log("Final token supplies:",
      "\nX:", x_fin.toString(), 
      "\nY:", y_fin.toString()
    );
  });
});

// some scribbles (ignore)...

//  2477.845896265886329462 initial DAI
//     5.241263843982485614 post-mint DAI (.2% miss, 99.8% deposit)

//  2514.381877892968546120
//     5.525519804748421516
// 77524.383076734725834859

//  2614.925271255228771922 DAI
//     6.529860539382954079 DAI (.2% miss)

//  2603.208804 usdc
//     3.747030 usdc (.14% miss)

//  2447.061068570808888928
//     2.470054653392643521 (99.9% hit)

// 0 -> 5,563,140.126688 (USDC) 5,563,140.126688
// 20000000000000000000000 -> 50 (WETH)