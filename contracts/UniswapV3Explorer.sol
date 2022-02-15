// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.11;

import { IUniswapV3MintCallback } from "@uniswap/v3-core/contracts/interfaces/callback/IUniswapV3MintCallback.sol";
import { IUniswapV3SwapCallback } from "@uniswap/v3-core/contracts/interfaces/callback/IUniswapV3SwapCallback.sol";
import { IUniswapV3Pool } from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import { IERC20, SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { TickMath } from "./vendor/uniswap/TickMath.sol";
import { FullMath, LiquidityAmounts } from "./vendor/uniswap/LiquidityAmounts.sol";

contract UniswapV3Explorer is
    IUniswapV3MintCallback,
    IUniswapV3SwapCallback,
    Ownable
{
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    int24 public lowerTick;
    int24 public upperTick;

    IUniswapV3Pool public immutable pool;       // DAI/ETH pool
    IERC20 public immutable token0;             // DAI
    IERC20 public immutable token1;             // ETH
    int24 public immutable tickSpacing;         // spacing of the DAI/ETH pool

    // solhint-disable-next-line max-line-length
    constructor(address _pool, address _token0, address _token1, int24 _tickSpacing) {
        pool = IUniswapV3Pool(_pool);
        (_token0, _token1) = _token0 < _token1 ? 
            (_token0, _token1) : (_token1, _token0);
        token0 = IERC20(_token0);
        token1 = IERC20(_token1);
        tickSpacing = _tickSpacing;
    } 

    /// @notice Uniswap V3 callback fn, called back on pool.mint
    function uniswapV3MintCallback(
        uint256 amount0Owed,
        uint256 amount1Owed,
        bytes calldata /* _data */
    ) external override {
        require(msg.sender == address(pool), "callback caller");
        if (amount0Owed > 0) token0.safeTransfer(msg.sender, amount0Owed);
        if (amount1Owed > 0) token1.safeTransfer(msg.sender, amount1Owed);
    }

    /// @notice Uniswap v3 callback fn, called back on pool.swap
    function uniswapV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata /* _data */
    ) external override {
        require(msg.sender == address(pool), "callback caller");
        if (amount0Delta > 0) token0.safeTransfer(msg.sender, uint256(amount0Delta));
        else if (amount1Delta > 0) token1.safeTransfer(msg.sender, uint256(amount1Delta));
    }

    /// @dev Useful view functions
    function getSqrtRatioAtTick(int24 tick) external view returns (uint160 sqrtPriceX96) {
        return TickMath.getSqrtRatioAtTick(tick);
    }

    function getTickAtSqrtRatio(uint160 sqrtPriceX96) external view returns (int24 tick) {
        return TickMath.getTickAtSqrtRatio(sqrtPriceX96);
    }

    function getLiquidity() external view returns(uint160 liquidity) {
        require(lowerTick < upperTick, "no existng position");
        (liquidity,,,,) = pool.positions(
            keccak256(abi.encodePacked(address(this), lowerTick, upperTick)) // positionID
        );
    }

    /// @dev Given token amounts A and B, swap a specific amount of one
    /// for more of the other, then mint max liquidity position with 
    /// the two resulting balances.
    /// @param amount0In token0 available (should already be approved)
    /// @param amount1In token1 available (should already be approved)
    /// @param zeroForOne what to swap for what
    /// @param swapAmount how much to swap
    /// @param swapThresholdPrice protection against large price changes
    /// @param _lowerTick new lower tick
    /// @param _upperTick new upper tick
    /// @notice There should be no existing position in order for the ticks
    /// to be accepted.
    function deposit(
        uint256 amount0In,
        uint256 amount1In,
        bool zeroForOne,
        int256 swapAmount,
        uint160 swapThresholdPrice,
        int24 _lowerTick,
        int24 _upperTick
    ) external onlyOwner returns(uint256 mintAmount0, uint256 mintAmount1, uint128 mintLiquidity) {
        require(
            token0.allowance(msg.sender, address(this)) >= amount0In &&
            token1.allowance(msg.sender, address(this)) >= amount1In, 
            "allowance"
        );
        require(
            (lowerTick == upperTick && _lowerTick < _upperTick) // open new valid position
            || (lowerTick == _lowerTick && upperTick == _upperTick), // add to existing position
            "ticks"
        );

        if (amount0In > 0) token0.safeTransferFrom(msg.sender, address(this), amount0In);
        if (amount1In > 0) token1.safeTransferFrom(msg.sender, address(this), amount1In);

        lowerTick = _lowerTick;
        upperTick = _upperTick;

        if (swapAmount > 0) {
            /// Swap from one to the other
            /// @notice If one of the returns is negative, then that amount
            /// of the token has already been sent over to address(this).
            /// If it is positive, then it's the amount we gave
            /// to the pool in the callback.
            {
                (int256 poolDelta0, int256 poolDelta1) = pool.swap(
                    address(this),
                    zeroForOne,
                    swapAmount,
                    swapThresholdPrice,
                    ""
                );

                amount0In = poolDelta0 >= 0 ? amount0In - uint256(poolDelta0) : amount0In + uint256(-poolDelta0);
                amount1In = poolDelta1 >= 0 ? amount1In - uint256(poolDelta1) : amount1In + uint256(-poolDelta1);
            }
        }

        /// @dev Mint
        {
            (uint160 sqrtRatioX96,,,,,,) = pool.slot0();
            mintLiquidity = LiquidityAmounts.getLiquidityForAmounts(
                sqrtRatioX96, 
                TickMath.getSqrtRatioAtTick(_lowerTick), 
                TickMath.getSqrtRatioAtTick(_upperTick), 
                amount0In, 
                amount1In
            );
        }

        (mintAmount0, mintAmount1) = pool.mint(
            address(this),
            _lowerTick,
            _upperTick,
            mintLiquidity,
            ""
        );

        _transferAll();
    }

    function withdraw() external onlyOwner {
        _withdraw();
        _transferAll();
    }

    function exit(bool zeroForOne, uint160 swapThresholdPrice) external onlyOwner {
        _withdraw();
        uint256 volatileBalance = zeroForOne ?
            token0.balanceOf(address(this)) :
            token1.balanceOf(address(this));
        if (volatileBalance > 0) {
            pool.swap(
                address(this),
                zeroForOne,
                volatileBalance.toInt256(),
                swapThresholdPrice,
                ""
            );
        }
        _transferAll();
    }

    function _withdraw() private {
        (int24 _lowerTick, int24 _upperTick) = (lowerTick, upperTick); // SLOAD save gas
        require(_lowerTick < _upperTick, "no position");
        (uint128 liquidity,,,,) = pool.positions(
            keccak256(abi.encodePacked(address(this), _lowerTick, _upperTick)) // positionID
        );
        pool.burn(_lowerTick, _upperTick, liquidity);
        pool.collect(
            address(this),
            _lowerTick,
            _upperTick,
            type(uint128).max,
            type(uint128).max
        );
        (lowerTick, upperTick) = (0, 0);
    }

    function _transferAll() private {
        (uint256 balance0, uint256 balance1) = 
            (token0.balanceOf(address(this)), token1.balanceOf(address(this)));
        if (balance0 > 0) token0.safeTransfer(msg.sender, balance0);
        if (balance1 > 0) token1.safeTransfer(msg.sender, balance1);
    }
}
