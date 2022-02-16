const { ethers } = require("hardhat");
const BN = require("bn.js");
const erc20_abi = require("../abi/erc20.json");
const pool_abi = require("../abi/pool.json");
const weth_abi = require("../abi/weth.json");
const router_abi = require("../abi/router.json");

function getSpacedTick(tick, spacing, roundUp) {
  return roundUp ?
    Math.ceil(tick / spacing) * spacing :
    Math.floor(tick / spacing) * spacing;
}

function getSwapThresholdPrice(currentSqrtPrice, zeroForOne, slippagePPM) {
  currentSqrtPrice = new BN(String(currentSqrtPrice));
  slippagePPM = new BN(String(slippagePPM));
  const denominator = new BN("1000000");
  return zeroForOne 
    ? currentSqrtPrice.mul(slippagePPM).div(denominator) 
    : currentSqrtPrice.mul(denominator.add(slippagePPM)).div(denominator) ;
}

function getRealPrice(sqrtPrice, decimals0, decimals1, zeroForOne) {
  sqrtPrice = new BN(sqrtPrice.toString());
  decimals0 = new BN(decimals0.toString());
  decimals1 = new BN(decimals1.toString());

  const Q96 = (new BN("2")).pow(new BN("192"));
  if (zeroForOne) {
    const scalar = (new BN("10")).pow((new BN(decimals0)).add(new BN("18")).sub(new BN(decimals1)));
    return sqrtPrice.mul(sqrtPrice).mul(scalar).div(Q96);  
  } else {
    const scalar = (new BN("10")).pow((new BN(decimals1)).add(new BN("18")).sub(new BN(decimals0)));
    return Q96.mul(scalar).div(sqrtPrice).div(sqrtPrice).toString();
  }
}

function getOptimalQuantities(x_0, y_0, p_a, P, p_b) {
  x_0 = new BN(x_0.toString());
  y_0 = new BN(y_0.toString());
  p_a = new BN(p_a.toString());
  P = new BN(P.toString());
  p_b = new BN(p_b.toString());

  const Q96 = (new BN("2")).pow(new BN("192"));
  const mantissaScalar = new BN("1000000000000000000");
  const scaledPrice = P.mul(P).mul(mantissaScalar).div(Q96);

  const A = P.mul(p_b).mul(mantissaScalar).div(p_b.sub(P));
  const B = mantissaScalar.mul(Q96).div(P.sub(p_a));

  const x = scaledPrice.mul(x_0).add(y_0.mul(mantissaScalar)).mul(B).div(A.mul(mantissaScalar).add(scaledPrice.mul(B)));
  const y = scaledPrice.mul(x_0).add(y_0.mul(mantissaScalar)).mul(A).div(A.mul(mantissaScalar).add(scaledPrice.mul(B)));

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

describe("USDC pool", async () => {
  let deployer, pool, usdc, weth, router, explorer, signers;

  const usdc_pool = "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640";
  const usdc_address = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

  const pool_address = usdc_pool;
  const token_address = usdc_address;
  const weth_address = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  const router_address = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
  const SPACING = 10;
  const decimals0 = 6;
  const decimals1 = 18;

  before(async () => {
    signers = await ethers.getSigners();
    deployer = signers[10];
    
    pool = new ethers.Contract(pool_address, pool_abi, ethers.provider);
    usdc = new ethers.Contract(token_address, erc20_abi, ethers.provider);
    weth = new ethers.Contract(weth_address, weth_abi, ethers.provider);
    router = new ethers.Contract(router_address, router_abi, ethers.provider);

    explorer = await (await ethers.getContractFactory("UniswapV3Explorer"))
      .connect(deployer)
      .deploy(pool_address, token_address, weth_address, SPACING);
    await explorer.deployed();

    await weth.connect(deployer).deposit({value: ethers.utils.parseEther("1000")});
  });

  it("deposits", async () => {
    await usdc.connect(deployer).approve(explorer.address, ethers.constants.MaxUint256);
    await weth.connect(deployer).approve(explorer.address, ethers.constants.MaxUint256);

    const x_0 = await usdc.balanceOf(deployer.address);
    const y_0 = await weth.balanceOf(deployer.address);
    
    const slot0 = await pool.slot0();
    
    const thirtyPercentDownTick = Math.round(Math.log(.7) / Math.log(1.0001));
    const thirtyPercentUpTick =  Math.round(Math.log(1.3) / Math.log(1.0001));

    console.log("The amounts by which we must change the tick:",
      "\nLower tick:", thirtyPercentDownTick,
      "\nUpper tick:", thirtyPercentUpTick
    );

    const TICK = (await slot0.tick).toString();
    const LOWER = getSpacedTick(Number(TICK) + thirtyPercentDownTick, SPACING, false);
    const UPPER = getSpacedTick(Number(TICK) + thirtyPercentUpTick, SPACING, true);

    console.log("Ticks:",
      "\n", LOWER.toString(),
      "\n", TICK.toString(),
      "\n", UPPER.toString()
    );

    console.log("Upper and lower sqrt prices without spacing:",
      "\n", (await explorer.getSqrtRatioAtTick(Number(TICK) + thirtyPercentDownTick)).toString(),
      "\n", (await explorer.getSqrtRatioAtTick(Number(TICK) + thirtyPercentUpTick)).toString()
    );

    const p_a = await explorer.getSqrtRatioAtTick(LOWER);
    const P = slot0.sqrtPriceX96;
    const p_b = await explorer.getSqrtRatioAtTick(UPPER);
  
    console.log("Sqrt prices (with spacing):",
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

    const realPrice = getRealPrice(P, decimals0, decimals1, zeroForOne);

    console.log("Scaled prices:",
      "\n Lower:", getRealPrice(p_a, decimals0, decimals1, true).toString(),
      "\n Current:", getRealPrice(P, decimals0, decimals1, true).toString(),
      "\n Upper:", getRealPrice(p_b, decimals0, decimals1, true).toString()
    );

    const initialValue = (new BN(y_0.toString())).mul(new BN(realPrice.toString()))
      .div((new BN("10")).pow(new BN("18")))
      .add(new BN(x_0.toString()));

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

    const x_fin = new BN((await usdc.balanceOf(deployer.address)).toString());
    const y_fin = new BN((await weth.balanceOf(deployer.address)).toString());

    console.log("Final token supplies:",
      "\nX:", x_fin.toString(), 
      "\nY:", y_fin.toString()
    );

    const liquidity = await explorer.getLiquidity();
    console.log("Liquidity:", liquidity.toString());

    const finalValue = (new BN(y_fin.toString())).mul(new BN(realPrice.toString()))
      .div((new BN("10")).pow(new BN("18")))
      .add(new BN(x_fin.toString()));
    console.log("Value before deposit:", initialValue.toString());
    console.log("Value after deposit:", finalValue.toString());
    const precision = "10000000000000";
    console.log(`Roughly ${100 * (Number(finalValue.mul(new BN(precision)).div(initialValue).toString()) / Number(precision))}% of initial funds didn't go in`);
  });
});

describe("DAI pool", () => {
  let deployer, pool, dai, weth, router, explorer, signers;

  const dai_pool = "0xC2e9F25Be6257c210d7Adf0D4Cd6E3E881ba25f8";
  const dai_address = "0x6B175474E89094C44Da98b954EedeAC495271d0F";

  // Mainnet Addresses
  const pool_address = dai_pool;
  const token_address = dai_address;
  const fee = 3000;
  const weth_address = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  const router_address = "0xE592427A0AEce92De3Edee1F18E0157C05861564";

  const SPACING = 60;

  before(async () => {
    signers = await ethers.getSigners();
    deployer = signers[11];
    
    pool = new ethers.Contract(pool_address, pool_abi, ethers.provider);
    dai = new ethers.Contract(token_address, erc20_abi, ethers.provider);
    weth = new ethers.Contract(weth_address, weth_abi, ethers.provider);
    router = new ethers.Contract(router_address, router_abi, ethers.provider);

    explorer = await (await ethers.getContractFactory("UniswapV3Explorer"))
      .connect(deployer)
      .deploy(pool_address, token_address, weth_address, SPACING);
    await explorer.deployed();

    // for(let i = 0; i < signers.length; i++) {
    //   const owner = signers[i];
    //   if (owner != deployer) {
    //     await owner.sendTransaction({
    //       to: deployer.address,
    //       value: ethers.utils.parseEther("1000"),
    //     });
    //   } 
    // }

    await weth.connect(deployer).deposit({value: ethers.utils.parseEther("100")});
  });

  it("deposits", async () => {
    await dai.connect(deployer).approve(explorer.address, ethers.constants.MaxUint256);
    await weth.connect(deployer).approve(explorer.address, ethers.constants.MaxUint256);

    const x_0 = await dai.balanceOf(deployer.address);
    const y_0 = await weth.balanceOf(deployer.address);
    
    const slot0 = await pool.slot0();
    
    // p(i) = 1.0001^i (Uniswap definition)
    // So if p(a) * p% = p(b)
    // then b = a + log(1.0001, p%) (where log(b, a), b - base, a - argument)
    // So, to get -30% from our tick, we need to add log(1.0001, .7)  =~ -3567
    // to get +30% from our tick, we need to add log(1.0001. 1.3) =~ 2624
    
    const thirtyPercentDownTick = Math.floor(Math.log(.7) / Math.log(1.0001));
    const thirtyPercentUpTick = Math.floor(Math.log(1.3) / Math.log(1.0001));

    console.log("The amounts by which we must change the tick:",
      "\nLower tick:", thirtyPercentDownTick,
      "\nUpper tick:", thirtyPercentUpTick
    );

    const TICK = (await slot0.tick).toString();
    const LOWER = getSpacedTick(Number(TICK) + thirtyPercentDownTick, SPACING, true);
    const UPPER = getSpacedTick(Number(TICK) + thirtyPercentUpTick, SPACING, true);

    console.log("Ticks:",
      "\n", LOWER.toString(),
      "\n", TICK.toString(),
      "\n", UPPER.toString()
    );

    console.log("Upper and lower sqrt prices without spacing:",
      "\n", (await explorer.getSqrtRatioAtTick(Number(TICK) + thirtyPercentDownTick)).toString(),
      "\n", (await explorer.getSqrtRatioAtTick(Number(TICK) + thirtyPercentUpTick)).toString()
    );

    const p_a = await explorer.getSqrtRatioAtTick(LOWER);
    const P = slot0.sqrtPriceX96;
    const p_b = await explorer.getSqrtRatioAtTick(UPPER);
  
    console.log("Sqrt prices (with spacing):",
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

    const realPrice = getRealPrice(P, 18, 18, zeroForOne);

    console.log("Scaled prices:",
      "\n Lower:", getRealPrice(p_a, 18, 18, true).toString(),
      "\n Current:", getRealPrice(P, 18, 18, true).toString(),
      "\n Upper:", getRealPrice(p_b, 18, 18, true).toString()
    );

    const initialValue = (new BN(y_0.toString())).mul(new BN(realPrice.toString()))
      .div((new BN("10")).pow(new BN("18")))
      .add(new BN(x_0.toString()));

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

    const finalValue = (new BN(y_fin.toString())).mul(new BN(realPrice.toString()))
      .div((new BN("10")).pow(new BN("18")))
      .add(new BN(x_fin.toString()));
    console.log("Value before deposit:", initialValue.toString());
    console.log("Value after deposit:", finalValue.toString());
    const precision = "1000000";
    console.log(`Roughly ${100 * (Number(finalValue.mul(new BN(precision)).div(initialValue).toString()) / Number(precision))}% of initial funds didn't go in`);
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
